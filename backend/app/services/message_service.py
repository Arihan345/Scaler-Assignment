"""Messages: seq allocation, idempotent send, history, receipts cursors, reactions, delete.

Every write follows: take write lock -> authorize -> mutate -> commit -> RETURN events.
Broadcasting is the caller's job and happens only after the commit.
"""
import json
import os

from sqlalchemy import and_, delete, or_, select, text, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, forbidden, not_found, validation
from app.core.time import add_seconds, now_iso
from app.db.engine import begin_write
from app.db.models import Attachment, Conversation, ConversationMember, Message, MessageHidden, MessageReaction, User
from app.services import receipts, serializers, webhook_service
from app.services.events import Event
from app.services.membership import (
    active_member_ids,
    get_conversation,
    require_active_member,
    require_member_for_read,
)


# ---------------------------------------------------------------- low level

def allocate_seq(db: Session, conversation_id: str, now: str) -> int:
    """Next per-conversation seq. Caller must hold the write lock (begin_write)."""
    res = db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .values(last_seq=Conversation.last_seq + 1, last_activity_at=now)
    )
    if res.rowcount == 0:
        raise not_found("Conversation")
    return db.execute(select(Conversation.last_seq).where(Conversation.id == conversation_id)).scalar_one()


def insert_message(
    db: Session,
    conversation_id: str,
    sender_id: str | None,
    now: str,
    type_: str = "TEXT",
    body: str | None = None,
    system_event: str | None = None,
    reply_to_id: int | None = None,
    client_message_id: str | None = None,
    expires_at: str | None = None,
) -> Message:
    seq = allocate_seq(db, conversation_id, now)
    msg = Message(
        conversation_id=conversation_id,
        seq=seq,
        sender_id=sender_id,
        client_message_id=client_message_id,
        type=type_,
        body=body,
        system_event=system_event,
        reply_to_id=reply_to_id,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(msg)
    db.flush()
    return msg


def _visible(member: ConversationMember, now: str):
    conds = [
        Message.conversation_id == member.conversation_id,
        Message.seq > member.joined_seq,
        or_(Message.expires_at.is_(None), Message.expires_at > now),
        Message.id.not_in(select(MessageHidden.message_id).where(MessageHidden.user_id == member.user_id)),
    ]
    if member.left_seq is not None:
        conds.append(Message.seq <= member.left_seq)
    return and_(*conds)


def _all_members(db: Session, conversation_id: str) -> list[ConversationMember]:
    return list(
        db.execute(select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)).scalars()
    )


# ---------------------------------------------------------------- send

def _find_dup(db: Session, sender_id: str, conversation_id: str, client_message_id: str) -> Message | None:
    return db.execute(
        select(Message).where(
            Message.sender_id == sender_id,
            Message.conversation_id == conversation_id,
            Message.client_message_id == client_message_id,
        )
    ).scalar_one_or_none()


def send_message(
    db: Session,
    user: User,
    conversation_id: str,
    *,
    body: str | None,
    client_message_id: str | None = None,
    reply_to_id: int | None = None,
    attachment_ids: list[str] | None = None,
) -> tuple[Message, bool, list[Event]]:
    """Returns (message, created, events). A retry with the same client_message_id returns the
    original message with created=False and no events (idempotent)."""
    body = (body or "").strip()
    attachment_ids = list(dict.fromkeys(attachment_ids or []))
    if not body and not attachment_ids:
        raise validation("Message is empty")
    if len(body) > settings.max_body_chars:
        raise validation(f"Message is longer than {settings.max_body_chars} characters")

    begin_write(db)
    member = require_active_member(db, user.id, conversation_id)
    if client_message_id:
        dup = _find_dup(db, user.id, conversation_id, client_message_id)
        if dup is not None:  # checked under the write lock, so concurrent retries can't both insert
            db.rollback()
            return dup, False, []
    conv = get_conversation(db, conversation_id)

    if reply_to_id is not None:
        target = db.get(Message, reply_to_id)
        if target is None or target.conversation_id != conversation_id or target.deleted_at:
            raise validation("Invalid reply target")

    atts: list[Attachment] = []
    if attachment_ids:
        atts = list(
            db.execute(
                select(Attachment).where(
                    Attachment.id.in_(attachment_ids),
                    Attachment.uploader_id == user.id,
                    Attachment.conversation_id == conversation_id,
                    Attachment.message_id.is_(None),
                )
            ).scalars()
        )
        if len(atts) != len(attachment_ids):
            raise validation("Invalid attachment")
    msg_type = "TEXT"
    if atts:
        msg_type = "IMAGE" if all((a.mime_type or "").startswith("image/") for a in atts) else "FILE"

    now = now_iso()
    expires_at = add_seconds(now, conv.disappearing_seconds) if conv.disappearing_seconds else None
    msg = insert_message(
        db, conversation_id, user.id, now, msg_type, body or None,
        reply_to_id=reply_to_id, client_message_id=client_message_id, expires_at=expires_at,
    )
    for a in atts:
        a.message_id = msg.id

    # The sender has, by definition, seen everything up to their own message.
    member.last_read_seq = max(member.last_read_seq, msg.seq)
    member.last_delivered_seq = max(member.last_delivered_seq, msg.seq)
    # Bots (inbound webhooks) never ack, so they count as having received/read instantly.
    db.execute(
        text(
            "UPDATE conversation_members SET last_delivered_seq=:s, last_read_seq=:s "
            "WHERE conversation_id=:c AND user_id IN (SELECT id FROM users WHERE is_bot=1)"
        ),
        {"s": msg.seq, "c": conversation_id},
    )

    audience = active_member_ids(db, conversation_id)
    dto = serializers.message_dto(db, msg, user.id)
    webhook_service.enqueue_event(db, "message.new", conversation_id, audience, dto)
    db.commit()
    return msg, True, [Event(audience, "message.new", conversation_id, dto)]


# ---------------------------------------------------------------- history

def list_messages(
    db: Session,
    user: User,
    conversation_id: str,
    *,
    before_seq: int | None = None,
    after_seq: int | None = None,
    around_seq: int | None = None,
    limit: int = 50,
) -> dict:
    member = require_member_for_read(db, user.id, conversation_id)
    limit = max(1, min(limit, 100))
    now = now_iso()
    base = _visible(member, now)
    has_before = has_after = False

    if around_seq is not None:
        half = max(1, limit // 2)
        older = list(
            db.execute(
                select(Message).where(base, Message.seq <= around_seq).order_by(Message.seq.desc()).limit(half + 1)
            ).scalars()
        )
        newer = list(
            db.execute(
                select(Message).where(base, Message.seq > around_seq).order_by(Message.seq.asc()).limit(half + 1)
            ).scalars()
        )
        has_before, has_after = len(older) > half, len(newer) > half
        rows = list(reversed(older[:half])) + newer[:half]
    elif after_seq is not None:
        fetched = list(
            db.execute(select(Message).where(base, Message.seq > after_seq).order_by(Message.seq.asc()).limit(limit + 1)).scalars()
        )
        has_after = len(fetched) > limit
        rows = fetched[:limit]
    else:
        cond = base if before_seq is None else and_(base, Message.seq < before_seq)
        fetched = list(db.execute(select(Message).where(cond).order_by(Message.seq.desc()).limit(limit + 1)).scalars())
        has_before = len(fetched) > limit
        rows = list(reversed(fetched[:limit]))

    members = _all_members(db, conversation_id)
    return {
        "messages": serializers.messages_to_dto(db, rows, user.id, members),
        "has_more_before": has_before,
        "has_more_after": has_after,
    }


# ---------------------------------------------------------------- receipts (cursors)

def _receipt_event(db: Session, conversation_id: str, member: ConversationMember) -> Event:
    return Event(
        active_member_ids(db, conversation_id),
        "receipt.updated",
        conversation_id,
        {"user_id": member.user_id, "delivered_seq": member.last_delivered_seq, "read_seq": member.last_read_seq},
    )


def mark_delivered(db: Session, user: User, conversation_id: str, up_to_seq: int) -> list[Event]:
    begin_write(db)
    member = require_active_member(db, user.id, conversation_id)
    conv = get_conversation(db, conversation_id)
    target = max(0, min(int(up_to_seq), conv.last_seq))  # clamp: can't ack the future
    if target <= member.last_delivered_seq:  # cursors only move forward
        db.commit()
        return []
    member.last_delivered_seq = target
    db.commit()
    return [_receipt_event(db, conversation_id, member)]


def mark_read(db: Session, user: User, conversation_id: str, up_to_seq: int) -> list[Event]:
    begin_write(db)
    member = require_active_member(db, user.id, conversation_id)
    conv = get_conversation(db, conversation_id)
    target = max(0, min(int(up_to_seq), conv.last_seq))
    if target <= member.last_read_seq and target <= member.last_delivered_seq:
        db.commit()
        return []
    member.last_read_seq = max(member.last_read_seq, target)
    member.last_delivered_seq = max(member.last_delivered_seq, target)  # a read implies delivered
    db.commit()
    return [_receipt_event(db, conversation_id, member)]


def get_receipts(db: Session, user: User, message_id: int) -> list[dict]:
    msg = db.get(Message, message_id)
    if msg is None:
        raise not_found("Message")
    require_member_for_read(db, user.id, msg.conversation_id)
    if msg.sender_id != user.id:
        raise forbidden("Message info is only available for your own messages")
    out = []
    users = {u.id: u for u in db.execute(select(User)).scalars()}
    for m in _all_members(db, msg.conversation_id):
        if not receipts.is_eligible(m, msg.seq, msg.sender_id):
            continue
        state = "read" if m.last_read_seq >= msg.seq else "delivered" if m.last_delivered_seq >= msg.seq else "sent"
        out.append({"user": serializers.user_dto(users[m.user_id]), "state": state})
    return out


# ---------------------------------------------------------------- delete / reactions

def delete_message(db: Session, user: User, message_id: int) -> tuple[list[Event], list[str]]:
    """Soft delete -> tombstone. Returns (events, attachment file paths to unlink after commit)."""
    msg = db.get(Message, message_id)
    if msg is None:
        raise not_found("Message")
    begin_write(db)
    require_active_member(db, user.id, msg.conversation_id)
    if msg.sender_id != user.id:
        raise forbidden("You can only delete your own messages")
    if msg.type == "SYSTEM":
        raise validation("System messages can't be deleted")
    if msg.deleted_at:
        db.commit()
        return [], []
    paths = [a.storage_path for a in db.execute(select(Attachment).where(Attachment.message_id == msg.id)).scalars()]
    db.execute(delete(Attachment).where(Attachment.message_id == msg.id))
    db.execute(delete(MessageReaction).where(MessageReaction.message_id == msg.id))
    msg.deleted_at = now_iso()
    msg.body = None
    audience = active_member_ids(db, msg.conversation_id)
    webhook_service.enqueue_event(db, "message.deleted", msg.conversation_id, audience, {"message_id": msg.id, "seq": msg.seq})
    db.commit()
    return [Event(audience, "message.deleted", msg.conversation_id, {"message_id": msg.id, "seq": msg.seq})], paths


EDIT_WINDOW_SECONDS = 3 * 3600  # like Signal: a message can be edited for a few hours after sending


def edit_message(db: Session, user: User, message_id: int, body: str) -> list[Event]:
    body = (body or "").strip()
    if not body:
        raise validation("Message can't be empty")
    if len(body) > settings.max_body_chars:
        raise validation(f"Message is longer than {settings.max_body_chars} characters")
    msg = db.get(Message, message_id)
    if msg is None:
        raise not_found("Message")
    begin_write(db)
    require_active_member(db, user.id, msg.conversation_id)
    if msg.sender_id != user.id:
        raise forbidden("You can only edit your own messages")
    if msg.type == "SYSTEM" or msg.deleted_at:
        raise validation("This message can't be edited")
    now = now_iso()
    if add_seconds(msg.created_at, EDIT_WINDOW_SECONDS) < now:
        raise validation("Messages can only be edited for 3 hours after sending")
    if body != (msg.body or ""):
        msg.body = body
        msg.edited_at = now
    audience = active_member_ids(db, msg.conversation_id)
    dto = serializers.message_dto(db, msg)
    db.commit()
    return [Event(audience, "message.edited", msg.conversation_id, dto)]


def hide_message(db: Session, user: User, message_id: int) -> None:
    """'Delete for me'. Only this user's view changes; nobody else is notified."""
    msg = db.get(Message, message_id)
    if msg is None:
        raise not_found("Message")
    begin_write(db)
    require_member_for_read(db, user.id, msg.conversation_id)
    if msg.type == "SYSTEM":
        raise validation("System messages can't be deleted")
    if db.get(MessageHidden, (user.id, message_id)) is None:
        db.add(MessageHidden(user_id=user.id, message_id=message_id))
    db.commit()


def search_messages(db: Session, user: User, conversation_id: str, q: str, limit: int = 50) -> list[dict]:
    q = (q or "").strip()
    if len(q) < 2:
        return []
    member = require_member_for_read(db, user.id, conversation_id)
    like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = list(
        db.execute(
            select(Message)
            .where(
                _visible(member, now_iso()),
                Message.deleted_at.is_(None),
                Message.type != "SYSTEM",
                Message.body.ilike(like, escape="\\"),
            )
            .order_by(Message.seq.desc())
            .limit(max(1, min(limit, 100)))
        ).scalars()
    )
    return serializers.messages_to_dto(db, rows, user.id, _all_members(db, conversation_id))


def _reaction_event(db: Session, msg: Message) -> Event:
    return Event(
        active_member_ids(db, msg.conversation_id),
        "reaction.updated",
        msg.conversation_id,
        {"message_id": msg.id, "reactions": serializers.reactions_map(db, [msg.id]).get(msg.id, [])},
    )


def set_reaction(db: Session, user: User, message_id: int, emoji: str) -> list[Event]:
    emoji = (emoji or "").strip()
    if not emoji or len(emoji) > 16:
        raise validation("Invalid emoji")
    msg = db.get(Message, message_id)
    if msg is None:
        raise not_found("Message")
    begin_write(db)
    require_active_member(db, user.id, msg.conversation_id)
    if msg.deleted_at or msg.type == "SYSTEM":
        raise validation("Can't react to this message")
    existing = db.get(MessageReaction, (message_id, user.id))
    if existing:
        existing.emoji = emoji
    else:
        db.add(MessageReaction(message_id=message_id, user_id=user.id, emoji=emoji, created_at=now_iso()))
    db.flush()
    ev = _reaction_event(db, msg)
    db.commit()
    return [ev]


def remove_reaction(db: Session, user: User, message_id: int) -> list[Event]:
    msg = db.get(Message, message_id)
    if msg is None:
        raise not_found("Message")
    begin_write(db)
    require_active_member(db, user.id, msg.conversation_id)
    db.execute(delete(MessageReaction).where(MessageReaction.message_id == message_id, MessageReaction.user_id == user.id))
    ev = _reaction_event(db, msg)
    db.commit()
    return [ev]


def unlink_files(paths: list[str]) -> None:
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


def dto_for_viewer(db: Session, msg: Message, user: User) -> dict:
    """Message DTO including the sender-facing status (derived from members' cursors)."""
    return serializers.message_dto(db, msg, user.id, _all_members(db, msg.conversation_id))
