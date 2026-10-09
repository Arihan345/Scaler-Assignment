"""Background cleanup. The read paths already hide expired messages; this only reclaims space,
tells clients, and removes uploads that were never attached to a message."""
import asyncio
import logging
import os
from datetime import timedelta

import anyio
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.time import now_iso, to_iso, utcnow
from app.db.engine import begin_write, session_scope
from app.db.models import Attachment, Message
from app.realtime.dispatcher import publish
from app.services.events import Event
from app.services.membership import active_member_ids

log = logging.getLogger("signal.sweeper")
ORPHAN_AFTER = timedelta(hours=1)


def sweep_once() -> list[Event]:
    events: list[Event] = []
    paths: list[str] = []
    with session_scope() as db:
        begin_write(db)
        now = now_iso()
        expired = db.execute(
            select(Message).where(Message.expires_at.is_not(None), Message.expires_at <= now)
        ).scalars().all()
        by_conv: dict[str, list[Message]] = {}
        for m in expired:
            by_conv.setdefault(m.conversation_id, []).append(m)
        ids = [m.id for m in expired]
        if ids:
            paths += [a.storage_path for a in db.execute(select(Attachment).where(Attachment.message_id.in_(ids))).scalars()]
            db.execute(delete(Message).where(Message.id.in_(ids)))  # reactions/attachments cascade; replies SET NULL
        cutoff = to_iso(utcnow() - ORPHAN_AFTER)
        orphans = db.execute(
            select(Attachment).where(Attachment.message_id.is_(None), Attachment.created_at < cutoff)
        ).scalars().all()
        for a in orphans:
            paths.append(a.storage_path)
            db.delete(a)
        db.commit()
        for conv_id, msgs in by_conv.items():
            events.append(
                Event(
                    active_member_ids(db, conv_id),
                    "message.expired",
                    conv_id,
                    {"message_ids": [m.id for m in msgs], "seqs": [m.seq for m in msgs]},
                )
            )
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass
    return events


async def run() -> None:
    while True:
        await asyncio.sleep(settings.sweeper_interval_s)
        try:
            events = await anyio.to_thread.run_sync(sweep_once)
            if events:
                await publish(events)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sweeper iteration failed")
