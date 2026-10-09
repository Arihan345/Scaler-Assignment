"""Mock auth: fixed OTP, hashed opaque session tokens. No SMS, no real cryptography."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.errors import AppError, validation
from app.core.ids import new_id
from app.core.security import hash_token, mask_phone, new_token, normalize_identifier
from app.core.time import now_iso, parse_iso, to_iso, utcnow
from app.db.models import Session, User


def request_otp(identifier: str) -> dict:
    """No-op by design: validates the identifier and sends nothing (the OTP is fixed in demo mode)."""
    kind, value = normalize_identifier(identifier)
    return {"ok": True, "identifier_type": kind, "demo_mode": True}


def verify_otp(db: DbSession, identifier: str, otp: str, device_label: str | None = None) -> dict:
    kind, value = normalize_identifier(identifier)
    if (otp or "").strip() != settings.fixed_otp:
        raise AppError("UNAUTHENTICATED", "Invalid verification code", 401)

    user = db.execute(select(User).where(User.phone_number == value)).scalar_one_or_none()
    now = now_iso()
    if user is None:
        user = User(
            id=new_id(),
            phone_number=value,
            display_name=mask_phone(value),  # placeholder until onboarding
            created_at=now,
        )
        db.add(user)
        db.flush()

    token = new_token()
    db.add(
        Session(
            id=new_id(),
            user_id=user.id,
            token_hash=hash_token(token),
            device_label=(device_label or "")[:80] or None,
            created_at=now,
            expires_at=to_iso(utcnow() + timedelta(days=settings.session_ttl_days)),
        )
    )
    db.commit()
    return {"token": token, "user": user, "is_new_user": user.onboarded_at is None}


def authenticate(db: DbSession, token: str | None) -> tuple[User, Session]:
    if not token:
        raise AppError("UNAUTHENTICATED", "Not signed in", 401)
    sess = db.execute(select(Session).where(Session.token_hash == hash_token(token))).scalar_one_or_none()
    if sess is None or sess.revoked_at is not None or sess.expires_at <= now_iso():
        raise AppError("UNAUTHENTICATED", "Session expired, please sign in again", 401)
    user = db.get(User, sess.user_id)
    if user is None:
        raise AppError("UNAUTHENTICATED", "Session expired, please sign in again", 401)
    return user, sess


def logout(db: DbSession, sess: Session) -> None:
    sess.revoked_at = now_iso()
    db.commit()


def update_profile(db: DbSession, user: User, display_name: str | None, about: str | None) -> User:
    if display_name is not None:
        name = display_name.strip()
        if not name or len(name) > 40:
            raise validation("Display name must be 1-40 characters")
        user.display_name = name
        if user.onboarded_at is None:
            user.onboarded_at = now_iso()
    if about is not None:
        if len(about) > 140:
            raise validation("About must be at most 140 characters")
        user.about = about.strip()
    db.commit()
    return user
