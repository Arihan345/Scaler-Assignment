"""Conversations (DMs + groups share one model), membership, list/detail views."""
import json

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import forbidden, not_found, validation
from app.core.ids import direct_key, new_id
from app.core.time import now_iso
from app.db.engine import begin_write
from app.db.models import Contact, Block, Conversation, ConversationMember, Message, User
from app.services import message_service, serializers, webhook_service
from app.services.events import Event
from app.services.membership import (
    active_member_ids,
    get_conversation,
    require_active_member,
    require_admin,
    require_member_for_read,
)
from app.services.receipts import compute_status

FOREVER = "9999-12-31T00:00:00.000Z"
MAX_DISAPPEARING = 4 * 7 * 24 * 3600

UNREAD_SQL = text(
    """
    SELECT cm.conversation_id AS cid, COUNT(m.id) AS n
    FROM conversation_members cm
    JOIN messages m ON m.conversation_id = cm.conversation_id
    WHERE cm.user_id = :me AND cm.left_at IS NULL
      AND m.seq > MAX(cm.last_read_seq, cm.own_read_seq, cm.joined_seq)
      AND (cm.left_seq IS NULL OR m.seq <= cm.left_seq)
      AND m.sender_id IS NOT :me
      AND m.type != 'SYSTEM'
      AND m.deleted_at IS NULL
      AND (m.expires_at IS NULL OR m.expires_at > :now)
      AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = :me)
    GROUP BY cm.conversation_id
    """
)

MENTION_SQL = text(
    """
    SELECT DISTINCT cm.conversation_id AS cid
    FROM conversation_members cm
    JOIN messages m ON m.conversation_id = cm.conversation_id
    WHERE cm.user_id = :me AND cm.left_at IS NULL
      AND m.seq > MAX(cm.last_read_seq, cm.own_read_seq, cm.joined_seq)
      AND (cm.left_seq IS NULL OR m.seq <= cm.left_seq)
      AND m.sender_id IS NOT :me AND m.deleted_at IS NULL
      AND m.mentions LIKE '%"' || :me || '"%'
    """
)

LAST_MESSAGE_SQL = text(
    """
    SELECT (SELECT m2.id FROM messages m2
            WHERE m2.conversation_id = cm.conversation_id AND m2.seq > cm.joined_seq
              AND (cm.left_seq IS NULL OR m2.seq <= cm.left_seq)
              AND (m2.expires_at IS NULL OR m2.expires_at > :now)
              AND m2.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = :me)
            ORDER BY m2.seq DESC LIMIT 1) AS mid
    FROM conversation_members cm
    WHERE cm.user_id = :me AND cm.left_at IS NULL
    """
)


# ---------------------------------------------------------------- helpers

def _system_message(db: Session, conversation_id: str, payload: dict, now: str) -> Message:
    return message_service.insert_message(
        db, conversation_id, None, now, "SYSTEM", None, system_event=json.dumps(payload)
    )


def _msg_event(db: Session, msg: Message, audience: list[str]) -> Event:
    return Event(list(dict.fromkeys(audience)), "message.new", msg.conversation_id, serializers.message_dto(db, msg))


def _conv_updated(db: Session, conversation_id: str, audience: list[str] | None = None) -> Event:
    return Event(
        audience if audience is not None else active_member_ids(db, conversation_id),
        "conversation.updated",
        conversation_id,
        {},
    )


def _load_users(db: Session, ids: list[str]) -> dict[str, User]:
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {}
    return {u.id: u for u in db.execute(select(User).where(User.id.in_(ids))).scalars()}


def _is_muted(m: ConversationMember, now: str) -> bool:
    return bool(m.muted_until and m.muted_until > now)


# ---------------------------------------------------------------- list + detail

def _list_items(db: Session, me_id: str, pairs: list[tuple[ConversationMember, Conversation]], online_ids) -> list[dict]:
    if not pairs:
        return []
    now = now_iso()
    unread = {r.cid: r.n for r in db.execute(UNREAD_SQL, {"me": me_id, "now": now})}
    mentioned = {r.cid for r in db.execute(MENTION_SQL, {"me": me_id})}
    last_ids = [r.mid for r in db.execute(LAST_MESSAGE_SQL, {"me": me_id, "now": now}) if r.mid]
    last_msgs = {}
    if last_ids:
        last_msgs = {m.id: m for m in db.execute(select(Message).where(Message.id.in_(last_ids))).scalars()}
    conv_ids = [c.id for _, c in pairs]
    members_by_conv: dict[str, list[ConversationMember]] = {}
    for m in db.execute(select(ConversationMember).where(ConversationMember.conversation_id.in_(conv_ids))).scalars():
        members_by_conv.setdefault(m.conversation_id, []).append(m)
    # newest visible message per conversation
    newest_by_conv: dict[str, Message] = {}
    for m in last_msgs.values():
        newest_by_conv[m.conversation_id] = m
    users = _load_users(
        db,
        [m.user_id for ms in members_by_conv.values() for m in ms if m.user_id != me_id]
        + [m.sender_id for m in newest_by_conv.values() if m.sender_id],
    )

    items = []
    for me, conv in pairs:
        last = newest_by_conv.get(conv.id)
        last_dto = None
        if last is not None:
            members = members_by_conv.get(conv.id, [])
            last_dto = serializers.message_dto(db, last, me_id, members)
            sender = users.get(last.sender_id) if last.sender_id else None
            last_dto["sender_name"] = sender.display_name if sender else None
        item = {
            "id": conv.id,
            "type": conv.type,
            "title": conv.title,
            "avatar_url": conv.avatar_url,
            "member_count": sum(1 for m in members_by_conv.get(conv.id, []) if m.left_at is None),
            "last_message": last_dto,
            "unread_count": unread.get(conv.id, 0),
            "my_last_read_seq": max(me.last_read_seq, me.own_read_seq),
            "marked_unread": bool(me.marked_unread),
            "has_unread_mention": conv.id in mentioned,
            "is_note_to_self": False,
            "blocked": False,
            "is_request": bool(me.request_pending),
            "last_activity_at": conv.last_activity_at,
            "is_pinned": bool(me.is_pinned),
            "is_archived": bool(me.is_archived),
            "muted_until": me.muted_until if _is_muted(me, now) else None,
            "disappearing_seconds": conv.disappearing_seconds,
            "my_role": me.role,
            "peer": None,
        }
        if conv.type == "DIRECT":
            other = next((m for m in members_by_conv.get(conv.id, []) if m.user_id != me_id), None)
            if other is not None and other.user_id in users:
                u = users[other.user_id]
                item["peer"] = serializers.user_dto(u, online=u.id in online_ids)
                item["blocked"] = db.get(Block, (me_id, u.id)) is not None
            elif other is None:
                item["is_note_to_self"] = True  # a DM whose only member is me
        items.append(item)
    return items


def list_conversations(
    db: Session, me_id: str, *, q: str | None = None, unread_only: bool = False, archived: bool = False,
    online_ids=frozenset(), requests: bool = False,
) -> list[dict]:
    rows = db.execute(
        select(ConversationMember, Conversation)
        .join(Conversation, Conversation.id == ConversationMember.conversation_id)
        .where(
            ConversationMember.user_id == me_id,
            ConversationMember.left_at.is_(None),
            ConversationMember.is_archived == (0 if requests else (1 if archived else 0)),
            ConversationMember.request_pending == (1 if requests else 0),
        )
    ).all()
    # A DM nobody has written in yet stays invisible (it's only a navigation target).
    pairs = [(m, c) for m, c in rows if not (c.type == "DIRECT" and c.last_seq == 0)]
    items = _list_items(db, me_id, pairs, online_ids)
    if unread_only:
        items = [i for i in items if i["unread_count"] > 0]
    if q and q.strip():
        needle = q.strip().lower()

        def hit(i: dict) -> bool:
            hay = [i["title"] or ""]
            if i["peer"]:
                hay += [i["peer"]["display_name"], i["peer"]["username"] or "", i["peer"]["phone_number"] or ""]
            return any(needle in (h or "").lower() for h in hay)

        items = [i for i in items if hit(i)]
    items.sort(key=lambda i: (not i["is_pinned"], _neg(i["last_activity_at"])))
    return items


def _neg(iso: str) -> tuple:
    # sort descending by timestamp using a tuple of negated code points
    return tuple(-ord(ch) for ch in iso)


def get_detail(db: Session, me_id: str, conversation_id: str, online_ids=frozenset()) -> dict:
    me = require_member_for_read(db, me_id, conversation_id)
    conv = get_conversation(db, conversation_id)
    if me.left_at is None:
        item = _list_items(db, me_id, [(me, conv)], online_ids)[0]
    else:  # a removed member can still open the thread (read-only), without list extras
        item = {
            "id": conv.id, "type": conv.type, "title": conv.title, "avatar_url": conv.avatar_url, "member_count": 0,
            "last_message": None, "unread_count": 0, "my_last_read_seq": max(me.last_read_seq, me.own_read_seq),
            "marked_unread": False, "has_unread_mention": False, "is_note_to_self": False, "blocked": False, "is_request": False,
            "last_activity_at": conv.last_activity_at, "is_pinned": False, "is_archived": False, "muted_until": None,
            "disappearing_seconds": conv.disappearing_seconds, "my_role": me.role, "peer": None,
        }
    members = list(
        db.execute(select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)).scalars()
    )
    users = _load_users(db, [m.user_id for m in members])
    item["description"] = conv.description
    item["created_at"] = conv.created_at
    item["last_seq"] = conv.last_seq
    item["members"] = [
        {
            "user": serializers.user_dto(users[m.user_id], online=m.user_id in online_ids),
            "role": m.role,
            "joined_seq": m.joined_seq,
            "left_seq": m.left_seq,
            "is_active": m.left_at is None,
            "last_delivered_seq": m.last_delivered_seq,
            "last_read_seq": m.last_read_seq,
        }
        for m in members
    ]
    return item


# ---------------------------------------------------------------- create

def get_or_create_direct(db: Session, me: User, other_id: str) -> tuple[Conversation, bool]:
    if other_id == me.id:
        raise validation("You can't start a chat with yourself")
    other = db.get(User, other_id)
    if other is None or other.is_bot:
        raise not_found("User")
    key = direct_key(me.id, other_id)

    def find() -> Conversation | None:
        return db.execute(select(Conversation).where(Conversation.direct_key == key)).scalar_one_or_none()

    conv = find()
    if conv:
        return conv, False
    begin_write(db)
    conv = find()  # re-check under the write lock: two users opening the chat at once yield ONE row
    if conv:
        db.commit()
        return conv, False
    now = now_iso()
    conv = Conversation(id=new_id(), type="DIRECT", direct_key=key, created_by=me.id, created_at=now, last_activity_at=now)
    db.add(conv)
    db.flush()
    # A first message from someone the other person hasn't added as a contact arrives as a "message request".
    known = db.get(Contact, (other_id, me.id)) is not None
    for uid in (me.id, other_id):
        pending = 1 if (uid == other_id and not known) else 0
        db.add(ConversationMember(conversation_id=conv.id, user_id=uid, joined_at=now, request_pending=pending))
    db.commit()
    return conv, True


def get_or_create_note_to_self(db: Session, me: User) -> Conversation:
    """'Note to Self': a DM whose only member is the user. The direct_key 'id:id' keeps it unique per user."""
    key = direct_key(me.id, me.id)
    conv = db.execute(select(Conversation).where(Conversation.direct_key == key)).scalar_one_or_none()
    if conv:
        return conv
    begin_write(db)
    conv = db.execute(select(Conversation).where(Conversation.direct_key == key)).scalar_one_or_none()
    if conv:
        db.commit()
        return conv
    now = now_iso()
    conv = Conversation(id=new_id(), type="DIRECT", direct_key=key, created_by=me.id, created_at=now, last_activity_at=now)
    db.add(conv)
    db.flush()
    db.add(ConversationMember(conversation_id=conv.id, user_id=me.id, joined_at=now))
    db.commit()
    return conv


def create_group(db: Session, me: User, title: str, member_ids: list[str]) -> tuple[Conversation, list[Event]]:
    title = (title or "").strip()
    if not title or len(title) > 60:
        raise validation("Group name must be 1-60 characters")
    ids = [i for i in dict.fromkeys(member_ids or []) if i != me.id]
    if not ids:
        raise validation("Add at least one member")
    found = _load_users(db, ids)
    if len(found) != len(ids) or any(u.is_bot for u in found.values()):
        raise validation("One or more members don't exist")

    begin_write(db)
    now = now_iso()
    conv = Conversation(id=new_id(), type="GROUP", title=title, created_by=me.id, created_at=now, last_activity_at=now)
    db.add(conv)
    db.flush()
    creator = ConversationMember(conversation_id=conv.id, user_id=me.id, role="ADMIN", joined_at=now)
    db.add(creator)
    for uid in ids:
        db.add(ConversationMember(conversation_id=conv.id, user_id=uid, role="MEMBER", joined_at=now))
    db.flush()
    sysmsg = _system_message(db, conv.id, {"kind": "group_created", "actor": me.id}, now)
    creator.last_read_seq = creator.last_delivered_seq = sysmsg.seq
    audience = [me.id] + ids
    webhook_service.enqueue_event(db, "conversation.updated", conv.id, audience, {"conversation_id": conv.id, "title": title})
    db.commit()
    return conv, [_msg_event(db, sysmsg, audience), _conv_updated(db, conv.id, audience)]


# ---------------------------------------------------------------- per-user + shared settings

def resolve_request(db: Session, me: User, conversation_id: str, action: str) -> list[Event]:
    """Accept (move into the main list, receipts start flowing) or delete (archive it and forget the request)."""
    begin_write(db)
    member = require_active_member(db, me.id, conversation_id)
    if not member.request_pending:
        db.commit()
        return []
    member.request_pending = 0
    if action == "delete":
        member.is_archived = 1
    db.commit()
    return [Event([me.id], "conversation.updated", conversation_id, {})]


def update_my_settings(db: Session, me: User, conversation_id: str, fields: dict) -> list[Event]:
    begin_write(db)
    member = require_active_member(db, me.id, conversation_id)
    if "is_pinned" in fields and fields["is_pinned"] is not None:
        member.is_pinned = 1 if fields["is_pinned"] else 0
    if "is_archived" in fields and fields["is_archived"] is not None:
        member.is_archived = 1 if fields["is_archived"] else 0
    if "marked_unread" in fields and fields["marked_unread"] is not None:
        member.marked_unread = 1 if fields["marked_unread"] else 0
    if "muted_until" in fields:
        v = fields["muted_until"]
        member.muted_until = None if v in (None, "") else (FOREVER if v == "forever" else v)
    db.commit()
    return [Event([me.id], "conversation.updated", conversation_id, {})]  # personal: only my own tabs


def update_conversation(
    db: Session, me: User, conversation_id: str, *, title: str | None = None, disappearing_seconds: int | None = None
) -> list[Event]:
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    require_admin(db, me.id, conv)
    now = now_iso()
    sysmsgs: list[Message] = []
    if title is not None:
        if conv.type != "GROUP":
            raise validation("Direct chats have no title")
        title = title.strip()
        if not title or len(title) > 60:
            raise validation("Group name must be 1-60 characters")
        if title != conv.title:
            conv.title = title
            sysmsgs.append(_system_message(db, conv.id, {"kind": "title_changed", "actor": me.id, "title": title}, now))
    if disappearing_seconds is not None:
        if not 0 <= disappearing_seconds <= MAX_DISAPPEARING:
            raise validation("Invalid disappearing-messages timer")
        if disappearing_seconds != conv.disappearing_seconds:
            conv.disappearing_seconds = disappearing_seconds
            sysmsgs.append(
                _system_message(db, conv.id, {"kind": "disappearing_changed", "actor": me.id, "seconds": disappearing_seconds}, now)
            )
    audience = active_member_ids(db, conv.id)
    if sysmsgs:
        webhook_service.enqueue_event(db, "conversation.updated", conv.id, audience, {"conversation_id": conv.id, "title": conv.title})
    db.commit()
    events = [_msg_event(db, m, audience) for m in sysmsgs]
    events.append(_conv_updated(db, conv.id, audience))
    return events


def set_group_avatar(db: Session, me: User, conversation_id: str, url: str) -> list[Event]:
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    if conv.type != "GROUP":
        raise validation("Only groups have an avatar")
    require_admin(db, me.id, conv)
    conv.avatar_url = url
    db.commit()
    return [_conv_updated(db, conv.id)]


# ---------------------------------------------------------------- members

def _ensure_admin_exists(db: Session, conversation_id: str) -> None:
    """If a group lost its last admin, promote its longest-standing active member."""
    members = list(
        db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id, ConversationMember.left_at.is_(None)
            )
        ).scalars()
    )
    if members and not any(m.role == "ADMIN" for m in members):
        successor = min(members, key=lambda m: (m.joined_at, m.user_id))
        successor.role = "ADMIN"


def add_members(db: Session, me: User, conversation_id: str, user_ids: list[str]) -> list[Event]:
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    if conv.type != "GROUP":
        raise validation("You can't add members to a direct chat")
    require_admin(db, me.id, conv)
    ids = list(dict.fromkeys(user_ids or []))
    users = _load_users(db, ids)
    if not ids or len(users) != len(ids) or any(u.is_bot for u in users.values()):
        raise validation("One or more users don't exist")
    now = now_iso()
    added: list[tuple[str, Message]] = []
    for uid in ids:
        existing = db.get(ConversationMember, (conversation_id, uid))
        if existing is not None and existing.left_at is None:
            continue
        sysmsg = _system_message(db, conversation_id, {"kind": "member_added", "actor": me.id, "target": uid}, now)
        boundary = sysmsg.seq - 1  # the new member sees the "added" notice, but nothing before it
        if existing is not None:  # re-adding: reset the membership interval and cursors
            existing.left_at = None
            existing.left_seq = None
            existing.role = "MEMBER"
            existing.joined_at = now
            existing.joined_seq = boundary
            existing.last_delivered_seq = existing.last_read_seq = boundary
        else:
            db.add(
                ConversationMember(
                    conversation_id=conversation_id, user_id=uid, role="MEMBER", joined_at=now,
                    joined_seq=boundary, last_delivered_seq=boundary, last_read_seq=boundary,
                )
            )
        db.flush()
        added.append((uid, sysmsg))
    audience = active_member_ids(db, conversation_id)
    for uid, _ in added:
        webhook_service.enqueue_event(db, "member.added", conversation_id, audience, {"user_id": uid})
    db.commit()
    events: list[Event] = []
    for uid, sysmsg in added:
        events.append(_msg_event(db, sysmsg, audience))
        events.append(Event(audience, "member.added", conversation_id, {"user_id": uid}))
    if added:
        events.append(_conv_updated(db, conversation_id, audience))
    return events


def _remove(db: Session, conv: Conversation, actor_id: str, target: ConversationMember, kind: str) -> list[Event]:
    now = now_iso()
    sysmsg = _system_message(db, conv.id, {"kind": kind, "actor": actor_id, "target": target.user_id}, now)
    target.left_at = now
    target.left_seq = sysmsg.seq  # they see this notice, but nothing after it
    target.is_pinned = 0
    db.flush()  # autoflush is off: the query below must see this member as gone
    _ensure_admin_exists(db, conv.id)
    db.flush()
    audience = active_member_ids(db, conv.id)
    webhook_service.enqueue_event(db, "member.removed", conv.id, audience, {"user_id": target.user_id})
    db.commit()
    everyone = audience + [target.user_id]
    return [
        _msg_event(db, sysmsg, everyone),
        Event(everyone, "member.removed", conv.id, {"user_id": target.user_id}),
        _conv_updated(db, conv.id, everyone),
    ]


def remove_member(db: Session, me: User, conversation_id: str, target_id: str) -> list[Event]:
    if target_id == me.id:
        return leave(db, me, conversation_id)
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    if conv.type != "GROUP":
        raise validation("You can't remove members from a direct chat")
    require_admin(db, me.id, conv)
    target = db.get(ConversationMember, (conversation_id, target_id))
    if target is None or target.left_at is not None:
        raise not_found("Member")
    return _remove(db, conv, me.id, target, "member_removed")


def leave(db: Session, me: User, conversation_id: str) -> list[Event]:
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    if conv.type != "GROUP":
        raise validation("You can't leave a direct chat (archive it instead)")
    member = require_active_member(db, me.id, conversation_id)
    return _remove(db, conv, me.id, member, "member_left")


def set_role(db: Session, me: User, conversation_id: str, target_id: str, role: str) -> list[Event]:
    if role not in ("ADMIN", "MEMBER"):
        raise validation("Role must be ADMIN or MEMBER")
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    if conv.type != "GROUP":
        raise validation("Direct chats have no roles")
    require_admin(db, me.id, conv)
    target = db.get(ConversationMember, (conversation_id, target_id))
    if target is None or target.left_at is not None:
        raise not_found("Member")
    if role == "MEMBER" and target.role == "ADMIN":
        admins = db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.left_at.is_(None),
                ConversationMember.role == "ADMIN",
            )
        ).scalars().all()
        if len(admins) <= 1:
            raise validation("A group needs at least one admin")
    target.role = role
    db.commit()
    return [_conv_updated(db, conversation_id)]


def deactivate_bot_member(db: Session, conversation_id: str, bot_id: str, actor_id: str) -> list[Event]:
    """Used when an inbound webhook is deleted: the bot leaves quietly with a system notice."""
    begin_write(db)
    conv = get_conversation(db, conversation_id)
    member = db.get(ConversationMember, (conversation_id, bot_id))
    if member is None or member.left_at is not None:
        db.commit()
        return []
    return _remove(db, conv, actor_id, member, "member_removed")


def add_bot_member(db: Session, conv: Conversation, actor_id: str, bot_id: str) -> Message:
    """Add an inbound-webhook bot to a conversation. Caller holds the write lock and commits."""
    now = now_iso()
    sysmsg = _system_message(db, conv.id, {"kind": "member_added", "actor": actor_id, "target": bot_id}, now)
    boundary = sysmsg.seq - 1
    db.add(
        ConversationMember(
            conversation_id=conv.id, user_id=bot_id, role="MEMBER", joined_at=now,
            joined_seq=boundary, last_delivered_seq=sysmsg.seq, last_read_seq=sysmsg.seq,
        )
    )
    db.flush()
    return sysmsg
