"""Profile search, contacts, presence queries."""
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.core.errors import not_found, validation
from app.core.security import normalize_identifier
from app.core.time import now_iso
from app.db.models import Block, Contact, User
from app.services import serializers


def search_users(db: Session, me: User, q: str, online_ids=frozenset()) -> list[dict]:
    q = (q or "").strip().lower()
    if not q:
        return []
    like = f"%{q}%"
    users = db.execute(
        select(User)
        .where(
            User.is_bot == 0,
            User.id != me.id,
            User.onboarded_at.is_not(None),
            or_(User.display_name.ilike(like), User.username.ilike(like), User.phone_number.like(like)),
        )
        .order_by(User.display_name)
        .limit(25)
    ).scalars().all()
    contact_ids = {c for (c,) in db.execute(select(Contact.contact_id).where(Contact.owner_id == me.id))}
    return [{**serializers.user_dto(u, u.id in online_ids), "is_contact": u.id in contact_ids} for u in users]


def list_contacts(db: Session, me: User, online_ids=frozenset()) -> list[dict]:
    rows = db.execute(
        select(User, Contact)
        .join(Contact, Contact.contact_id == User.id)
        .where(Contact.owner_id == me.id)
        .order_by(User.display_name)
    ).all()
    return [{**serializers.user_dto(u, u.id in online_ids), "nickname": c.nickname, "is_contact": True} for u, c in rows]


def add_contact(db: Session, me: User, *, user_id: str | None = None, identifier: str | None = None) -> dict:
    target = None
    if user_id:
        target = db.get(User, user_id)
    elif identifier:
        kind, value = normalize_identifier(identifier)
        col = User.phone_number if kind == "phone" else User.username
        target = db.execute(select(User).where(col == value)).scalar_one_or_none()
    else:
        raise validation("Provide user_id or identifier")
    if target is None or target.is_bot:
        raise not_found("User")
    if target.id == me.id:
        raise validation("You can't add yourself as a contact")
    if db.get(Contact, (me.id, target.id)) is None:
        db.add(Contact(owner_id=me.id, contact_id=target.id, created_at=now_iso()))
        db.commit()
    return {**serializers.user_dto(target), "is_contact": True}


def remove_contact(db: Session, me: User, contact_id: str) -> None:
    c = db.get(Contact, (me.id, contact_id))
    if c is not None:
        db.delete(c)
        db.commit()


def presence_peer_ids(db: Session, user_id: str) -> list[str]:
    """Everyone who shares an active conversation with `user_id` (the presence audience)."""
    rows = db.execute(
        text(
            "SELECT DISTINCT m2.user_id FROM conversation_members m1 "
            "JOIN conversation_members m2 ON m1.conversation_id = m2.conversation_id "
            "WHERE m1.user_id = :u AND m1.left_at IS NULL AND m2.left_at IS NULL AND m2.user_id != :u"
        ),
        {"u": user_id},
    )
    return [r[0] for r in rows]


def touch_last_seen(db: Session, user_id: str) -> str:
    u = db.get(User, user_id)
    now = now_iso()
    if u is not None:
        u.last_seen_at = now
        db.commit()
    return now


# ---------------------------------------------------------------- privacy + blocking

def update_privacy(db: Session, me: User, fields: dict) -> None:
    for key in ("read_receipts", "typing_indicators", "show_online"):
        if key in fields:
            setattr(me, key, 1 if fields[key] else 0)
    db.commit()


def is_blocked_between(db: Session, a: str, b: str) -> str | None:
    """'a' if a blocked b, 'b' if b blocked a, else None."""
    if db.get(Block, (a, b)) is not None:
        return "a"
    if db.get(Block, (b, a)) is not None:
        return "b"
    return None


def block_user(db: Session, me: User, target_id: str) -> None:
    if target_id == me.id:
        raise validation("You can't block yourself")
    target = db.get(User, target_id)
    if target is None or target.is_bot:
        raise not_found("User")
    if db.get(Block, (me.id, target_id)) is None:
        db.add(Block(blocker_id=me.id, blocked_id=target_id, created_at=now_iso()))
        db.commit()


def unblock_user(db: Session, me: User, target_id: str) -> None:
    b = db.get(Block, (me.id, target_id))
    if b is not None:
        db.delete(b)
        db.commit()


def list_blocked(db: Session, me: User) -> list[dict]:
    rows = db.execute(
        select(User).join(Block, Block.blocked_id == User.id).where(Block.blocker_id == me.id).order_by(User.display_name)
    ).scalars()
    return [serializers.user_dto(u) for u in rows]
