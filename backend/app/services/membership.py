"""Single authorization gate for everything conversation-scoped."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, forbidden, not_found
from app.db.models import Conversation, ConversationMember


def get_membership(db: Session, user_id: str, conversation_id: str) -> ConversationMember | None:
    return db.get(ConversationMember, (conversation_id, user_id))


def require_active_member(db: Session, user_id: str, conversation_id: str) -> ConversationMember:
    m = get_membership(db, user_id, conversation_id)
    if m is None or m.left_at is not None:
        raise AppError("NOT_A_MEMBER", "You are not a member of this conversation", 403)
    return m


def require_member_for_read(db: Session, user_id: str, conversation_id: str) -> ConversationMember:
    """Past members may still read history up to their left_seq; strangers may not."""
    m = get_membership(db, user_id, conversation_id)
    if m is None:
        raise AppError("NOT_A_MEMBER", "You are not a member of this conversation", 403)
    return m


def get_conversation(db: Session, conversation_id: str) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise not_found("Conversation")
    return conv


def require_admin(db: Session, user_id: str, conv: Conversation) -> ConversationMember:
    m = require_active_member(db, user_id, conv.id)
    if conv.type == "GROUP" and m.role != "ADMIN":
        raise forbidden("Only group admins can do that")
    return m


def active_member_ids(db: Session, conversation_id: str) -> list[str]:
    rows = db.execute(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id, ConversationMember.left_at.is_(None)
        )
    ).scalars()
    return list(rows)
