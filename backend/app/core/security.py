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
    """Login is phone-number only. Returns ("phone", "+919...").

    A bare 10-digit number is assumed to be Indian (+91); anything else needs its country code.
    Raises VALIDATION for anything that isn't a phone number."""
    compact = re.sub(r"[\s\-()]", "", (raw or "").strip())
    if re.fullmatch(r"\d{10}", compact):
        return "phone", f"+91{compact}"
    if _PHONE_RE.match(compact):
        return "phone", compact if compact.startswith("+") else f"+{compact}"
    raise validation("Enter a valid phone number (10 digits, or include your country code)")


def mask_phone(phone: str) -> str:
    return f"{phone[:3]} ••••• {phone[-4:]}" if len(phone) > 7 else phone
