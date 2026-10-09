"""Inbound webhooks: an external system POSTs {"text": ...} to a secret URL and a bot user posts it."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import forbidden, not_found, validation
from app.core.ids import new_id
from app.core.security import new_token
from app.core.time import now_iso
from app.db.engine import begin_write
from app.db.models import InboundWebhook, User
from app.services import conversation_service, message_service
from app.services.events import Event
from app.services.membership import active_member_ids, get_conversation, require_admin


def _dto(h: InboundWebhook, bot: User | None = None) -> dict:
    return {
        "id": h.id,
        "conversation_id": h.conversation_id,
        "name": h.name,
        "token": h.token,
        "path": f"/api/hooks/in/{h.token}",
        "bot_user_id": h.bot_user_id,
        "is_active": bool(h.is_active),
        "created_at": h.created_at,
    }


def create(db: Session, me: User, conversation_id: str, name: str) -> tuple[dict, list[Event]]:
    name = (name or "").strip()
    if not name or len(name) > 40:
        raise validation("Hook name must be 1-40 characters")
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    require_admin(db, me.id, conv)  # DM: any member; group: admin
    now = now_iso()
    bot = User(
        id=new_id(), username=f"bot_{new_id()[:8]}", display_name=name, is_bot=1, onboarded_at=now, created_at=now
    )
    db.add(bot)
    db.flush()
    hook = InboundWebhook(
        id=new_id(), conversation_id=conversation_id, created_by=me.id, bot_user_id=bot.id,
        token=new_token(), name=name, created_at=now,
    )
    db.add(hook)
    sysmsg = conversation_service.add_bot_member(db, conv, me.id, bot.id)
    audience = active_member_ids(db, conversation_id)
    db.commit()
    events = [
        conversation_service._msg_event(db, sysmsg, audience),
        Event(audience, "member.added", conversation_id, {"user_id": bot.id}),
        conversation_service._conv_updated(db, conversation_id, audience),
    ]
    return _dto(hook), events


def list_for_conversation(db: Session, me: User, conversation_id: str) -> list[dict]:
    conv = get_conversation(db, conversation_id)
    require_admin(db, me.id, conv)
    rows = db.execute(
        select(InboundWebhook).where(InboundWebhook.conversation_id == conversation_id, InboundWebhook.is_active == 1)
    ).scalars()
    return [_dto(h) for h in rows]


def delete(db: Session, me: User, hook_id: str) -> list[Event]:
    hook = db.get(InboundWebhook, hook_id)
    if hook is None or not hook.is_active:
        raise not_found("Hook")
    conv = get_conversation(db, hook.conversation_id)
    require_admin(db, me.id, conv)
    hook.is_active = 0
    db.commit()
    return conversation_service.deactivate_bot_member(db, hook.conversation_id, hook.bot_user_id, me.id)


def post(db: Session, token: str, text: str) -> list[Event]:
    hook = db.execute(
        select(InboundWebhook).where(InboundWebhook.token == token, InboundWebhook.is_active == 1)
    ).scalar_one_or_none()
    if hook is None:
        raise not_found("Hook")
    bot = db.get(User, hook.bot_user_id)
    _, _, events = message_service.send_message(db, bot, hook.conversation_id, body=text)
    return events
