import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db.engine import get_db
from app.db.models import Conversation, ConversationMember, Message, MessageHidden, User
from app.services import serializers

router = APIRouter(prefix="/calls", tags=["calls"])


@router.get("")
def call_history(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Call history = the call entries logged as SYSTEM messages in my conversations (newest first)."""
    rows = db.execute(
        select(Message, Conversation)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .join(ConversationMember, (ConversationMember.conversation_id == Message.conversation_id) & (ConversationMember.user_id == user.id))
        .where(Message.type == "SYSTEM", Message.system_event.like('%"kind": "call"%'), Message.deleted_at.is_(None))
        .where(~Message.id.in_(select(MessageHidden.message_id).where(MessageHidden.user_id == user.id)))
        .order_by(Message.id.desc()).limit(100)
    ).all()
    out = []
    for msg, conv in rows:
        ev = json.loads(msg.system_event or "{}")
        peer_id = db.scalar(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conv.id, ConversationMember.user_id != user.id))
        peer = db.get(User, peer_id) if peer_id else None
        out.append({
            "id": msg.id, "conversation_id": conv.id, "created_at": msg.created_at,
            "video": bool(ev.get("video")), "outcome": ev.get("outcome"), "duration": ev.get("duration", 0),
            "outgoing": ev.get("actor") == user.id,
            "peer": serializers.user_dto(peer) if peer else None,
        })
    return out
