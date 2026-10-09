"""Canonical DTOs shared with the frontend (see frontend/lib/types.ts)."""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Attachment, Message, MessageReaction, User
from app.services.receipts import compute_status


def user_dto(u: User, online: bool | None = None) -> dict:
    d = {
        "id": u.id,
        "display_name": u.display_name,
        "username": u.username,
        "phone_number": u.phone_number,
        "about": u.about or "",
        "avatar_url": u.avatar_url,
        "last_seen_at": u.last_seen_at,
        "is_bot": bool(u.is_bot),
    }
    if online is not None:
        d["is_online"] = online
    return d


def _snippet(m: Message) -> str:
    if m.deleted_at:
        return ""
    if m.body:
        return m.body[:100]
    return {"IMAGE": "Photo", "FILE": "File"}.get(m.type, "")


def reactions_map(db: Session, message_ids: list[int]) -> dict[int, list[dict]]:
    if not message_ids:
        return {}
    rows = db.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id.in_(message_ids))
        .order_by(MessageReaction.created_at, MessageReaction.user_id)
    ).scalars()
    grouped: dict[int, dict[str, list[str]]] = {}
    for r in rows:
        grouped.setdefault(r.message_id, {}).setdefault(r.emoji, []).append(r.user_id)
    return {
        mid: [{"emoji": e, "count": len(u), "user_ids": u} for e, u in emojis.items()]
        for mid, emojis in grouped.items()
    }


def messages_to_dto(db: Session, msgs: list[Message], viewer_id: str | None = None, members=None) -> list[dict]:
    if not msgs:
        return []
    ids = [m.id for m in msgs]
    reply_ids = {m.reply_to_id for m in msgs if m.reply_to_id}
    replies = {}
    if reply_ids:
        replies = {r.id: r for r in db.execute(select(Message).where(Message.id.in_(reply_ids))).scalars()}
    atts: dict[int, list[dict]] = {}
    for a in db.execute(select(Attachment).where(Attachment.message_id.in_(ids))).scalars():
        atts.setdefault(a.message_id, []).append(
            {
                "id": a.id,
                "file_name": a.file_name,
                "mime_type": a.mime_type,
                "size_bytes": a.size_bytes,
                "width": a.width,
                "height": a.height,
            }
        )
    reacts = reactions_map(db, ids)

    out = []
    for m in msgs:
        deleted = m.deleted_at is not None
        reply = replies.get(m.reply_to_id) if m.reply_to_id else None
        status = None
        if viewer_id and m.sender_id == viewer_id and m.type != "SYSTEM" and not deleted:
            status = compute_status(m.seq, m.sender_id, members) if members is not None else "sent"
        out.append(
            {
                "id": m.id,
                "conversation_id": m.conversation_id,
                "seq": m.seq,
                "sender_id": m.sender_id,
                "client_message_id": m.client_message_id,
                "type": m.type,
                "body": None if deleted else m.body,  # tombstones carry no content
                "system_event": json.loads(m.system_event) if m.system_event else None,
                "reply_to": (
                    {
                        "id": reply.id,
                        "seq": reply.seq,
                        "sender_id": reply.sender_id,
                        "snippet": _snippet(reply),
                        "deleted": reply.deleted_at is not None,
                    }
                    if reply
                    else None
                ),
                "attachments": [] if deleted else atts.get(m.id, []),
                "reactions": [] if deleted else reacts.get(m.id, []),
                "created_at": m.created_at,
                "expires_at": m.expires_at,
                "deleted_at": m.deleted_at,
                "edited_at": m.edited_at,
                "status": status,
            }
        )
    return out


def message_dto(db: Session, msg: Message, viewer_id: str | None = None, members=None) -> dict:
    return messages_to_dto(db, [msg], viewer_id, members)[0]
