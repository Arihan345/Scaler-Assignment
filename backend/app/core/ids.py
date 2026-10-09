import uuid


def new_id() -> str:
    return uuid.uuid4().hex


def direct_key(a: str, b: str) -> str:
    """Canonical key for a DM pair; a UNIQUE constraint on it makes duplicate DMs impossible."""
    lo, hi = sorted((a, b))
    return f"{lo}:{hi}"
