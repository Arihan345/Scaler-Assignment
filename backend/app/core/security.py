"""Mock-auth helpers. The OTP is a fixed constant (no SMS, no real cryptography).
Session tokens are random opaque strings; only their SHA-256 hash is stored."""
import hashlib
import re
import secrets

from app.core.errors import validation

_PHONE_RE = re.compile(r"^\+?\d{10,15}$")
_USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_identifier(raw: str) -> tuple[str, str]:
    """Return ("phone", "+919...") or ("username", "priya"). Raises VALIDATION otherwise."""
    value = (raw or "").strip()
    compact = re.sub(r"[\s\-()]", "", value)
    if _PHONE_RE.match(compact):
        return "phone", compact if compact.startswith("+") else f"+{compact}"
    lowered = value.lower().lstrip("@")
    if _USERNAME_RE.match(lowered):
        return "username", lowered
    raise validation("Enter a phone number (10-15 digits) or a username (3-24 letters, digits or _)")


def mask_phone(phone: str) -> str:
    return f"{phone[:3]} ••••• {phone[-4:]}" if len(phone) > 7 else phone
