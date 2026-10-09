import asyncio
import json

import httpx
import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.time import add_seconds, now_iso
from app.db import engine
from app.db.models import Message, WebhookDelivery
from app.services import message_service, webhook_service
from app.tasks import webhook_worker
from tests.helpers import direct, login, make_group, messages, send


def make_hook(client, user, events=("message.new",), conv=None):
    body = {"url": "http://example.test/hook", "events": list(events), "conversation_id": conv}
    r = client.post("/api/webhooks", json=body, headers=user["h"])
    assert r.status_code == 201, r.text
    return r.json()


def deliveries(client, user, hook_id):
    return client.get(f"/api/webhooks/{hook_id}/deliveries", headers=user["h"]).json()


def run_worker(handler):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await webhook_worker.process_due(c)

    return asyncio.run(go())


def make_all_due():
    with engine.session_scope() as db:
        for d in db.execute(select(WebhookDelivery).where(WebhookDelivery.status == "PENDING")).scalars():
            d.next_attempt_at = add_seconds(now_iso(), -1)
        db.commit()


def test_message_creates_a_delivery_row_with_event_id(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    hook = make_hook(client, b)
    conv = direct(client, a, b)
    send(client, a, conv, "hello")
    rows = deliveries(client, b, hook["id"])
    assert len(rows) == 1 and rows[0]["event"] == "message.new" and rows[0]["status"] == "PENDING" and rows[0]["event_id"]


def test_delivery_is_written_atomically_with_the_message(client, monkeypatch):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    make_hook(client, b)
    conv = direct(client, a, b)
    original = webhook_service.enqueue_event

    def enqueue_then_crash(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("boom after enqueue")

    monkeypatch.setattr(webhook_service, "enqueue_event", enqueue_then_crash)
    with pytest.raises(RuntimeError):
        send(client, a, conv, "doomed")
    with engine.session_scope() as db:
        assert db.execute(select(func.count()).select_from(Message)).scalar_one() == 0
        assert db.execute(select(func.count()).select_from(WebhookDelivery)).scalar_one() == 0  # rolled back together


def test_worker_delivers_with_token_and_marks_delivered(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    hook = make_hook(client, b)
    send(client, a, direct(client, a, b), "hello")
    seen = {}

    def handler(request: httpx.Request):
        seen["token"] = request.headers["x-webhook-token"]
        seen["event"] = request.headers["x-webhook-event"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True})

    assert run_worker(handler) == 1
    assert seen["token"] == hook["token"] and seen["event"] == "message.new"
    assert seen["body"]["data"]["body"] == "hello" and seen["body"]["event_id"]
    row = deliveries(client, b, hook["id"])[0]
    assert row["status"] == "DELIVERED" and row["attempts"] == 1 and row["response_code"] == 200


def test_failed_delivery_retries_with_backoff_then_fails_after_five_attempts(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    hook = make_hook(client, b)
    send(client, a, direct(client, a, b), "hello")
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(500)

    for attempt in range(1, 6):
        assert run_worker(handler) == 1
        row = deliveries(client, b, hook["id"])[0]
        assert row["attempts"] == attempt
        if attempt < 5:
            assert row["status"] == "PENDING"
            assert run_worker(handler) == 0  # not due yet: backoff is respected
            make_all_due()
    assert row["status"] == "FAILED" and row["last_error"] == "HTTP 500" and len(calls) == 5
    assert run_worker(handler) == 0  # terminal


def test_network_errors_are_recorded_not_raised(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    hook = make_hook(client, b)
    send(client, a, direct(client, a, b), "hello")

    def handler(request):
        raise httpx.ConnectTimeout("slow receiver")

    run_worker(handler)
    row = deliveries(client, b, hook["id"])[0]
    assert row["status"] == "PENDING" and "ConnectTimeout" in row["last_error"]


def test_webhook_never_receives_events_from_conversations_its_owner_left(client):
    a, b, c = login(client, "alice", "Alice"), login(client, "bob", "Bob"), login(client, "carol", "Carol")
    gid = make_group(client, a, [b, c])
    hook = make_hook(client, c)
    send(client, a, gid, "while carol is in")
    before = len(deliveries(client, c, hook["id"]))
    assert before >= 1
    client.post(f"/api/conversations/{gid}/leave", headers=c["h"])
    after_leave = len(deliveries(client, c, hook["id"]))  # includes carol's own leave notice at most
    send(client, a, gid, "after carol left")
    send(client, b, gid, "and again")
    assert len(deliveries(client, c, hook["id"])) == after_leave


def test_webhook_scoped_to_one_conversation(client):
    a, b, c = login(client, "alice", "Alice"), login(client, "bob", "Bob"), login(client, "carol", "Carol")
    c1, c2 = direct(client, a, b), direct(client, b, c)
    hook = make_hook(client, b, conv=c1)
    send(client, a, c1, "in scope")
    send(client, c, c2, "out of scope")
    assert len(deliveries(client, b, hook["id"])) == 1


def test_only_the_owner_manages_a_webhook(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    hook = make_hook(client, a)
    assert client.delete(f"/api/webhooks/{hook['id']}", headers=b["h"]).status_code == 403
    assert client.get(f"/api/webhooks/{hook['id']}/deliveries", headers=b["h"]).status_code == 403
    assert client.post(f"/api/webhooks/{hook['id']}/test", headers=a["h"]).status_code == 200
    assert deliveries(client, a, hook["id"])[0]["event"] == "ping"
    assert client.patch(f"/api/webhooks/{hook['id']}", json={"is_active": False}, headers=a["h"]).json()["is_active"] is False
    assert client.delete(f"/api/webhooks/{hook['id']}", headers=a["h"]).status_code == 200


def test_url_validation_blocks_bad_schemes_and_private_hosts_outside_dev(client):
    a = login(client, "alice", "Alice")
    post = lambda url: client.post("/api/webhooks", json={"url": url, "events": ["message.new"]}, headers=a["h"])
    assert post("ftp://example.test/x").status_code == 422
    assert post("not a url").status_code == 422
    settings.env = "prod"
    try:
        for url in ("http://127.0.0.1:8000/x", "http://localhost/x", "http://169.254.169.254/latest", "http://10.0.0.5/x"):
            r = post(url)
            assert r.status_code == 422, url
            assert "private" in r.json()["error"]["message"] or "resolve" in r.json()["error"]["message"]
    finally:
        settings.env = "dev"


def test_invalid_event_names_rejected(client):
    a = login(client, "alice", "Alice")
    r = client.post("/api/webhooks", json={"url": "http://example.test/x", "events": ["nope"]}, headers=a["h"])
    assert r.status_code == 422


def test_inbound_hook_posts_as_a_bot_through_the_normal_message_path(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    r = client.post(f"/api/conversations/{conv}/inbound-hooks", json={"name": "CI Bot"}, headers=a["h"])
    assert r.status_code == 201, r.text
    hook = r.json()
    posted = client.post(hook["path"], json={"text": "Build passed"})  # public, token is the credential
    assert posted.status_code == 201
    msgs = [m for m in messages(client, b, conv)["messages"] if m["type"] == "TEXT"]
    assert msgs[-1]["body"] == "Build passed" and msgs[-1]["sender_id"] == hook["bot_user_id"] and msgs[-1]["seq"] > 0
    # bots never ack, so they must not block a human's "read" status
    mine = send(client, a, conv, "hi bot").json()
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": mine["seq"]}, headers=b["h"])
    assert [m for m in messages(client, a, conv)["messages"] if m["id"] == mine["id"]][0]["status"] == "read"
    # removing the hook disables the URL
    assert client.delete(f"/api/inbound-hooks/{hook['id']}", headers=a["h"]).status_code == 200
    assert client.post(hook["path"], json={"text": "again"}).status_code == 404
    assert client.post("/api/hooks/in/not-a-token", json={"text": "x"}).status_code == 404


def test_inbound_hook_in_a_group_requires_admin(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    gid = make_group(client, a, [b])
    assert client.post(f"/api/conversations/{gid}/inbound-hooks", json={"name": "Bot"}, headers=b["h"]).status_code == 403
    assert client.post(f"/api/conversations/{gid}/inbound-hooks", json={"name": "Bot"}, headers=a["h"]).status_code == 201


def test_webhook_echo_endpoint(client):
    r = client.post("/api/dev/webhook-echo", json={"event": "ping"})
    assert r.json() == {"ok": True, "received_event": "ping"}
