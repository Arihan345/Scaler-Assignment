from sqlalchemy import text

from app.db import engine
from tests.helpers import direct, login, messages, send


def two(client):
    return login(client, "alice", "Alice"), login(client, "bob", "Bob")


def test_edit_own_message_sets_edited_at_and_pushes(client):
    a, b = two(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "helo").json()
    r = client.patch(f"/api/messages/{m['id']}", json={"body": "hello"}, headers=a["h"])
    assert r.status_code == 200 and r.json()["body"] == "hello" and r.json()["edited_at"]
    assert messages(client, b, conv)["messages"][0]["body"] == "hello"


def test_cannot_edit_someone_elses_or_empty_or_old_message(client):
    a, b = two(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "x").json()
    assert client.patch(f"/api/messages/{m['id']}", json={"body": "hack"}, headers=b["h"]).status_code == 403
    assert client.patch(f"/api/messages/{m['id']}", json={"body": "  "}, headers=a["h"]).status_code == 422
    with engine.session_scope() as db:
        db.execute(text("UPDATE messages SET created_at='2000-01-01T00:00:00.000Z' WHERE id=:i"), {"i": m["id"]})
        db.commit()
    assert client.patch(f"/api/messages/{m['id']}", json={"body": "late"}, headers=a["h"]).status_code == 422


def test_hide_message_only_affects_the_caller(client):
    a, b = two(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "secret").json()
    send(client, a, conv, "second")
    assert client.post(f"/api/messages/{m['id']}/hide", headers=b["h"]).status_code == 200
    assert [x["body"] for x in messages(client, b, conv)["messages"]] == ["second"]
    assert [x["body"] for x in messages(client, a, conv)["messages"]] == ["secret", "second"]
    listing = client.get("/api/conversations", headers=b["h"]).json()
    assert listing[0]["unread_count"] == 1  # hidden message no longer counts


def test_search_finds_visible_messages_only(client):
    a, b = two(client)
    conv = direct(client, a, b)
    send(client, a, conv, "Lunch at 1?")
    gone = send(client, a, conv, "lunch cancelled").json()
    send(client, b, conv, "50% off")
    client.delete(f"/api/messages/{gone['id']}", headers=a["h"])
    r = client.get(f"/api/conversations/{conv}/search", params={"q": "lunch"}, headers=b["h"]).json()["messages"]
    assert [m["body"] for m in r] == ["Lunch at 1?"]
    assert len(client.get(f"/api/conversations/{conv}/search", params={"q": "50%"}, headers=a["h"]).json()["messages"]) == 1
    assert client.get(f"/api/conversations/{conv}/search", params={"q": "l"}, headers=a["h"]).json()["messages"] == []
    c = login(client, "carol", "Carol")
    assert client.get(f"/api/conversations/{conv}/search", params={"q": "lunch"}, headers=c["h"]).status_code == 403


def test_old_database_gets_edited_at_column(client):
    with engine.session_scope() as db:
        cols = {r[1] for r in db.execute(text("PRAGMA table_info(messages)"))}
    assert "edited_at" in cols
    engine._add_missing_columns()  # idempotent


def test_realtime_event_carries_attachments(client, monkeypatch):
    """Regression: autoflush is off, so the message.new payload used to ship with attachments=[] (receivers saw an empty bubble)."""
    from app.api import messages as messages_api

    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    up = client.post("/api/attachments", data={"conversation_id": conv}, files={"file": ("pic.png", png, "image/png")}, headers=a["h"])
    seen = []
    monkeypatch.setattr(messages_api, "publish", lambda events: seen.extend(events))
    assert send(client, a, conv, "", attachment_ids=[up.json()["attachment_id"]]).status_code == 201
    new = [e for e in seen if e.event == "message.new"]
    assert new and new[0].payload["attachments"] and new[0].payload["attachments"][0]["file_name"] == "pic.png"
