"""Outbound webhooks (P2 extension). Events are written to an outbox table inside the SAME transaction
as the change that caused them; the background worker delivers them (at-least-once, with retries)."""
import ipaddress
import json
import socket
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import forbidden, not_found, validation
from app.core.ids import new_id
from app.core.security import new_token
from app.core.time import now_iso
from app.db.models import WebhookDelivery, WebhookEndpoint, User
from app.services.membership import require_active_member

ALLOWED_EVENTS = {"message.new", "message.deleted", "member.added", "member.removed", "conversation.updated"}


def validate_url(url: str) -> None:
    """Reject non-http(s) URLs and, outside dev, anything resolving to a private/internal address (SSRF)."""
    parsed = urlparse(url or "")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise validation("Webhook URL must start with http:// or https://")
    if settings.is_dev:
        return
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror:
        raise validation("Could not resolve the webhook host")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise validation("Webhook URL points to a private or internal address")


def enqueue_event(db: Session, event: str, conversation_id: str | None, audience: list[str], data: dict) -> None:
    """Queue deliveries for every active endpoint owned by someone who can see this event.
    Called inside the caller's transaction, before commit."""
    if not audience:
        return
    endpoints = db.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.owner_id.in_(audience), WebhookEndpoint.is_active == 1)
    ).scalars().all()
    if not endpoints:
        return
    now = now_iso()
    event_id = new_id()
    for ep in endpoints:
        if event not in json.loads(ep.events):
            continue
        if ep.conversation_id and ep.conversation_id != conversation_id:
            continue
        payload = json.dumps(
            {"event_id": event_id, "event": event, "created_at": now, "conversation_id": conversation_id, "data": data}
        )
        db.add(
            WebhookDelivery(
                event_id=event_id, endpoint_id=ep.id, event=event, payload=payload, next_attempt_at=now, created_at=now
            )
        )


def endpoint_dto(ep: WebhookEndpoint) -> dict:
    return {
        "id": ep.id,
        "url": ep.url,
        "token": ep.token,
        "events": json.loads(ep.events),
        "conversation_id": ep.conversation_id,
        "is_active": bool(ep.is_active),
        "created_at": ep.created_at,
    }


def _own(db: Session, user: User, endpoint_id: str) -> WebhookEndpoint:
    ep = db.get(WebhookEndpoint, endpoint_id)
    if ep is None:
        raise not_found("Webhook")
    if ep.owner_id != user.id:
        raise forbidden()
    return ep


def _check_events(events: list[str]) -> list[str]:
    cleaned = list(dict.fromkeys(events or []))
    if not cleaned or any(e not in ALLOWED_EVENTS for e in cleaned):
        raise validation(f"events must be a non-empty subset of {sorted(ALLOWED_EVENTS)}")
    return cleaned


def create_endpoint(db: Session, user: User, url: str, events: list[str], conversation_id: str | None) -> dict:
    validate_url(url)
    events = _check_events(events)
    if conversation_id:
        require_active_member(db, user.id, conversation_id)
    ep = WebhookEndpoint(
        id=new_id(), owner_id=user.id, url=url, token=new_token(), events=json.dumps(events),
        conversation_id=conversation_id, created_at=now_iso(),
    )
    db.add(ep)
    db.commit()
    return endpoint_dto(ep)


def list_endpoints(db: Session, user: User) -> list[dict]:
    rows = db.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.owner_id == user.id).order_by(WebhookEndpoint.created_at.desc())
    ).scalars()
    return [endpoint_dto(e) for e in rows]


def update_endpoint(db: Session, user: User, endpoint_id: str, *, url=None, events=None, is_active=None) -> dict:
    ep = _own(db, user, endpoint_id)
    if url is not None:
        validate_url(url)
        ep.url = url
    if events is not None:
        ep.events = json.dumps(_check_events(events))
    if is_active is not None:
        ep.is_active = 1 if is_active else 0
    db.commit()
    return endpoint_dto(ep)


def delete_endpoint(db: Session, user: User, endpoint_id: str) -> None:
    ep = _own(db, user, endpoint_id)
    db.delete(ep)
    db.commit()


def list_deliveries(db: Session, user: User, endpoint_id: str, limit: int = 50) -> list[dict]:
    _own(db, user, endpoint_id)
    rows = db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == endpoint_id)
        .order_by(WebhookDelivery.id.desc())
        .limit(max(1, min(limit, 100)))
    ).scalars()
    return [
        {
            "id": d.id, "event_id": d.event_id, "event": d.event, "status": d.status, "attempts": d.attempts,
            "response_code": d.response_code, "last_error": d.last_error, "created_at": d.created_at,
            "delivered_at": d.delivered_at, "next_attempt_at": d.next_attempt_at,
        }
        for d in rows
    ]


def send_test(db: Session, user: User, endpoint_id: str) -> None:
    ep = _own(db, user, endpoint_id)
    now = now_iso()
    event_id = new_id()
    payload = json.dumps(
        {"event_id": event_id, "event": "ping", "created_at": now, "conversation_id": None, "data": {"hello": "world"}}
    )
    db.add(WebhookDelivery(event_id=event_id, endpoint_id=ep.id, event="ping", payload=payload, next_attempt_at=now, created_at=now))
    db.commit()
