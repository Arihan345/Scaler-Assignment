"""Delivers the webhook outbox. At-least-once: receivers dedupe on payload.event_id."""
import asyncio
import logging

import anyio
import httpx
from sqlalchemy import select

from app.core.config import settings
from app.core.time import add_seconds, now_iso
from app.db.engine import session_scope
from app.db.models import WebhookDelivery, WebhookEndpoint
from app.services import webhook_service

log = logging.getLogger("signal.webhooks")
BACKOFF_SECONDS = [10, 30, 120, 600, 3600]  # 10s, 30s, 2m, 10m, 1h
MAX_ATTEMPTS = 5


def _fetch_due(limit: int = 20) -> list[dict]:
    with session_scope() as db:
        rows = db.execute(
            select(WebhookDelivery, WebhookEndpoint)
            .join(WebhookEndpoint, WebhookEndpoint.id == WebhookDelivery.endpoint_id)
            .where(
                WebhookDelivery.status == "PENDING",
                WebhookDelivery.next_attempt_at <= now_iso(),
                WebhookEndpoint.is_active == 1,
            )
            .order_by(WebhookDelivery.id)
            .limit(limit)
        ).all()
        return [
            {"id": d.id, "url": e.url, "token": e.token, "event": d.event, "payload": d.payload, "attempts": d.attempts}
            for d, e in rows
        ]


def _record(delivery_id: int, ok: bool, code: int | None, error: str | None) -> None:
    with session_scope() as db:
        d = db.get(WebhookDelivery, delivery_id)
        if d is None:
            return
        d.attempts += 1
        d.response_code = code
        d.last_error = None if ok else (error or f"HTTP {code}")[:300]
        if ok:
            d.status = "DELIVERED"
            d.delivered_at = now_iso()
        elif d.attempts >= MAX_ATTEMPTS:
            d.status = "FAILED"
        else:
            d.next_attempt_at = add_seconds(now_iso(), BACKOFF_SECONDS[d.attempts - 1])
        db.commit()


async def deliver(client: httpx.AsyncClient, item: dict) -> None:
    try:
        await anyio.to_thread.run_sync(webhook_service.validate_url, item["url"])  # re-check at send time
        resp = await client.post(
            item["url"],
            content=item["payload"],
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Token": item["token"],  # plain shared token (no HMAC: the brief asks for no real crypto)
                "X-Webhook-Event": item["event"],
            },
        )
        ok, code, err = 200 <= resp.status_code < 300, resp.status_code, None
    except Exception as exc:  # timeouts, DNS errors, SSRF rejections...
        ok, code, err = False, None, f"{type(exc).__name__}: {exc}"
    await anyio.to_thread.run_sync(_record, item["id"], ok, code, err)


async def process_due(client: httpx.AsyncClient) -> int:
    due = await anyio.to_thread.run_sync(_fetch_due)
    for item in due:
        await deliver(client, item)
    return len(due)


async def run() -> None:
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
        while True:
            try:
                await process_due(client)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("webhook worker iteration failed")
            await asyncio.sleep(settings.webhook_poll_s)
