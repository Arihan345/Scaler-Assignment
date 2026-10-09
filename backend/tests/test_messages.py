import threading

from sqlalchemy import select

from app.core.config import settings
from app.core.time import add_seconds, now_iso
from app.db import engine
from app.db.models import Conversation, Message
from app.services import conversation_service, message_service
from tests.helpers import auth, direct, login, messages, send


def two_users(client):
    return login(client, "alice", "Alice"), login(client, "bob", "Bob")


def test_direct_conversation_is_idempotent_and_shared(client):
    a, b = two_users(client)
    c1 = direct(client, a, b)
    assert direct(client, a, b) == c1 and direct(client, b, a) == c1


def test_send_persists_with_increasing_seq(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    seqs = [send(client, a, conv, f"m{i}").json()["seq"] for i in range(3)]
    assert seqs == [1, 2, 3]
    history = messages(client, b, conv)["messages"]
    assert [m["body"] for m in history] == ["m0", "m1", "m2"]


def test_duplicate_client_message_id_returns_original(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    first = send(client, a, conv, "hello", client_id="c-1")
    again = send(client, a, conv, "hello", client_id="c-1")
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"] and again.json()["seq"] == first.json()["seq"]
    assert len(messages(client, a, conv)["messages"]) == 1


def test_same_client_id_in_other_conversation_is_not_a_duplicate(client):
    a, b = two_users(client)
    c = login(client, "carol", "Carol")
    ab, ac = direct(client, a, b), direct(client, a, c)
    assert send(client, a, ab, "x", client_id="same").status_code == 201
    assert send(client, a, ac, "x", client_id="same").status_code == 201


def test_non_member_cannot_read_or_send(client):
    a, b = two_users(client)
    eve = login(client, "eve", "Eve")
    conv = direct(client, a, b)
    send(client, a, conv, "secret")
    assert client.get(f"/api/conversations/{conv}/messages", headers=eve["h"]).status_code == 403
    r = send(client, eve, conv, "hi")
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_A_MEMBER"
    assert client.get(f"/api/conversations/{conv}", headers=eve["h"]).status_code == 403
    assert client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": 1}, headers=eve["h"]).status_code == 403


def test_validation_of_message_body(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    assert send(client, a, conv, "   ").status_code == 422
    assert send(client, a, conv, "x" * (settings.max_body_chars + 1)).status_code == 422


def test_concurrent_sends_get_distinct_gapless_seqs(env):
    engine.configure(settings.database_url)
    engine.create_all()
    from app.core.ids import new_id
    from app.db.models import User

    with engine.session_scope() as db:
        now = now_iso()
        a = User(id=new_id(), username="a1", display_name="A", created_at=now)
        b = User(id=new_id(), username="b1", display_name="B", created_at=now)
        db.add_all([a, b])
        db.commit()
        conv, _ = conversation_service.get_or_create_direct(db, a, b.id)
        a_id, conv_id = a.id, conv.id

    results, errors = [], []

    def worker(i):
        try:
            with engine.session_scope() as db:
                from app.db.models import User as U

                user = db.get(U, a_id)
                msg, _, _ = message_service.send_message(db, user, conv_id, body=f"m{i}", client_message_id=f"c{i}")
                results.append(msg.seq)
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert sorted(results) == list(range(1, 21))


def test_direct_conversation_race_creates_one_row(env):
    engine.configure(settings.database_url)
    engine.create_all()
    from app.core.ids import new_id
    from app.db.models import User

    with engine.session_scope() as db:
        now = now_iso()
        users = [User(id=new_id(), username=f"u{i}", display_name=f"U{i}", created_at=now) for i in range(2)]
        db.add_all(users)
        db.commit()
        ids = [u.id for u in users]

    def worker(me, other):
        with engine.session_scope() as db:
            from app.db.models import User as U

            conversation_service.get_or_create_direct(db, db.get(U, me), other)

    threads = [threading.Thread(target=worker, args=(ids[i % 2], ids[(i + 1) % 2])) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    with engine.session_scope() as db:
        assert len(db.execute(select(Conversation)).scalars().all()) == 1


def test_pagination_before_after_around(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    for i in range(1, 11):
        send(client, a, conv, f"m{i}")
    latest = messages(client, b, conv, limit=4)
    assert [m["seq"] for m in latest["messages"]] == [7, 8, 9, 10]
    assert latest["has_more_before"] is True and latest["has_more_after"] is False
    older = messages(client, b, conv, before_seq=7, limit=4)
    assert [m["seq"] for m in older["messages"]] == [3, 4, 5, 6]
    newer = messages(client, b, conv, after_seq=8, limit=5)
    assert [m["seq"] for m in newer["messages"]] == [9, 10] and newer["has_more_after"] is False
    around = messages(client, b, conv, around_seq=5, limit=4)
    assert [m["seq"] for m in around["messages"]] == [4, 5, 6, 7]
    assert around["has_more_before"] and around["has_more_after"]


def test_unread_count_excludes_own_system_and_deleted(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    for i in range(3):
        send(client, a, conv, f"a{i}")
    send(client, b, conv, "mine")  # own message never counts as unread
    items = client.get("/api/conversations", headers=b["h"]).json()
    assert items[0]["unread_count"] == 0  # b's reply marked everything read for b
    for i in range(2):
        send(client, a, conv, f"later{i}")
    assert client.get("/api/conversations", headers=b["h"]).json()[0]["unread_count"] == 2
    # deleting one of them lowers the count
    last_id = messages(client, b, conv)["messages"][-1]["id"]
    assert client.delete(f"/api/messages/{last_id}", headers=a["h"]).status_code == 200
    assert client.get("/api/conversations", headers=b["h"]).json()[0]["unread_count"] == 1
    # reading clears it
    seq = messages(client, b, conv)["messages"][-1]["seq"]
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": seq}, headers=b["h"])
    assert client.get("/api/conversations", headers=b["h"]).json()[0]["unread_count"] == 0


def test_status_progresses_sent_delivered_read_and_cursors_only_move_forward(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    assert m["status"] == "sent"
    client.post(f"/api/conversations/{conv}/delivered", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert messages(client, a, conv)["messages"][0]["status"] == "delivered"
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert messages(client, a, conv)["messages"][0]["status"] == "read"
    # a stale (lower) ack must not move the cursor back
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": 0}, headers=b["h"])
    detail = client.get(f"/api/conversations/{conv}", headers=a["h"]).json()
    bob = next(x for x in detail["members"] if x["user"]["id"] == b["id"])
    assert bob["last_read_seq"] == m["seq"] and bob["last_delivered_seq"] == m["seq"]


def test_acks_are_clamped_to_last_seq(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    send(client, a, conv, "hi")
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": 9999}, headers=b["h"])
    detail = client.get(f"/api/conversations/{conv}", headers=b["h"]).json()
    bob = next(x for x in detail["members"] if x["user"]["id"] == b["id"])
    assert bob["last_read_seq"] == 1


def test_delete_message_leaves_tombstone(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "oops").json()
    assert client.delete(f"/api/messages/{m['id']}", headers=b["h"]).status_code == 403  # only the sender
    assert client.delete(f"/api/messages/{m['id']}", headers=a["h"]).status_code == 200
    got = messages(client, b, conv)["messages"][0]
    assert got["deleted_at"] and got["body"] is None


def test_one_reaction_per_user_and_replace(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    client.put(f"/api/messages/{m['id']}/reaction", json={"emoji": "👍"}, headers=b["h"])
    client.put(f"/api/messages/{m['id']}/reaction", json={"emoji": "❤️"}, headers=b["h"])
    reactions = messages(client, a, conv)["messages"][0]["reactions"]
    assert reactions == [{"emoji": "❤️", "count": 1, "user_ids": [b["id"]]}]
    client.delete(f"/api/messages/{m['id']}/reaction", headers=b["h"])
    assert messages(client, a, conv)["messages"][0]["reactions"] == []


def test_reply_quote_is_included(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    first = send(client, a, conv, "original text").json()
    reply = send(client, b, conv, "reply!", reply_to_id=first["id"]).json()
    assert reply["reply_to"]["id"] == first["id"] and reply["reply_to"]["snippet"] == "original text"
    other = direct(client, a, login(client, "carol", "Carol"))
    assert send(client, a, other, "x", reply_to_id=first["id"]).status_code == 422  # wrong conversation


def test_expired_message_is_hidden_before_sweeper_runs_and_swept_after(client, env):
    a, b = two_users(client)
    conv = direct(client, a, b)
    client.patch(f"/api/conversations/{conv}", json={"disappearing_seconds": 3600}, headers=a["h"])
    m = send(client, a, conv, "vanishing").json()
    assert m["expires_at"] is not None
    assert "vanishing" in [x["body"] for x in messages(client, b, conv)["messages"]]
    with engine.session_scope() as db:  # time travel: expire it
        row = db.get(Message, m["id"])
        row.expires_at = add_seconds(now_iso(), -5)
        db.commit()
    assert "vanishing" not in [x["body"] for x in messages(client, b, conv)["messages"]]  # hidden even though row exists
    from app.tasks import expiry_sweeper

    events = expiry_sweeper.sweep_once()
    assert events and events[0].event == "message.expired" and events[0].payload["message_ids"] == [m["id"]]
    with engine.session_scope() as db:
        assert db.get(Message, m["id"]) is None


def test_message_info_receipts_only_for_own_messages(client):
    a, b = two_users(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    r = client.get(f"/api/messages/{m['id']}/receipts", headers=a["h"]).json()
    assert [(x["user"]["id"], x["state"]) for x in r["recipients"]] == [(b["id"], "read")]
    assert client.get(f"/api/messages/{m['id']}/receipts", headers=b["h"]).status_code == 403


def test_attachment_two_step_flow_and_authorization(client):
    a, b = two_users(client)
    eve = login(client, "eve", "Eve")
    conv = direct(client, a, b)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    up = client.post("/api/attachments", data={"conversation_id": conv}, files={"file": ("pic.png", png, "image/png")}, headers=a["h"])
    assert up.status_code == 201, up.text
    att_id = up.json()["attachment_id"]
    assert client.get(f"/api/attachments/{att_id}", headers=b["h"]).status_code == 403  # unbound: uploader only
    m = send(client, a, conv, "", attachment_ids=[att_id])
    assert m.status_code == 201 and m.json()["type"] == "IMAGE" and m.json()["attachments"][0]["file_name"] == "pic.png"
    assert client.get(f"/api/attachments/{att_id}", headers=b["h"]).content == png
    assert client.get(f"/api/attachments/{att_id}", headers=eve["h"]).status_code == 403
    bad = client.post("/api/attachments", data={"conversation_id": conv}, files={"file": ("x.exe", b"MZ", "application/x-msdownload")}, headers=a["h"])
    assert bad.status_code == 422
    assert send(client, a, conv, "again", attachment_ids=[att_id]).status_code == 422  # already bound
    big = client.post("/api/attachments", data={"conversation_id": conv},
                      files={"file": ("big.txt", b"x" * (settings.max_upload_bytes + 1), "text/plain")}, headers=a["h"])
    assert big.status_code == 413
