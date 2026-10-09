"""Single-use, 30-second WebSocket tickets (in memory: fine for the documented single worker).
The long-lived session token never appears in a URL."""
import secrets
import threading
import time

TTL_SECONDS = 30.0
_lock = threading.Lock()
_tickets: dict[str, tuple[str, float]] = {}


def issue(user_id: str) -> str:
    ticket = secrets.token_urlsafe(24)
    now = time.monotonic()
    with _lock:
        for t in [t for t, (_, exp) in _tickets.items() if exp <= now]:  # opportunistic purge
            del _tickets[t]
        _tickets[ticket] = (user_id, now + TTL_SECONDS)
    return ticket


def consume(ticket: str | None) -> str | None:
    """Atomically invalidate and return the owner, or None if unknown/expired/already used."""
    if not ticket:
        return None
    with _lock:
        entry = _tickets.pop(ticket, None)
    if entry is None:
        return None
    user_id, expires = entry
    return user_id if expires > time.monotonic() else None
