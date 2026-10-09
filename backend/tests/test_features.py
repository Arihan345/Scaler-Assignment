"""Blocking, Note to Self, mark-as-unread, pinned messages, shared media, mentions, voice notes, privacy, link previews."""
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from tests.helpers import direct, login, make_group, messages, send

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def two(client):
    return login(client, "alice", "Alice"), login(client, "bob", "Bob")


def conv_item(client, user, conv_id):
    return next(c for c in client.get("/api/conversations", headers=user["h"]).json() if c["id"] == conv_id)


# ------------------------------------------------------------------ blocking

def test_block_stops_direct_messages_both_ways_and_unblock_restores(client):
    a, b = two(client)
    conv = direct(client, a, b)
    assert send(client, a, conv, "before").status_code == 201
    assert client.post(f"/api/blocks/{b['id']}", headers=a["h"]).status_code == 201
    r = send(client, a, conv, "nope")
    assert r.status_code == 403 and r.json()["error"]["code"] == "BLOCKED"
    r = send(client, b, conv, "hello?")  # the blocked person gets a neutral failure
    assert r.status_code == 403 and "couldn't be delivered" in r.json()["error"]["message"]
    assert [u["id"] for u in client.get("/api/blocks", headers=a["h"]).json()] == [b["id"]]
    assert conv_item(client, a, conv)["blocked"] is True
    assert client.delete(f"/api/blocks/{b['id']}", headers=a["h"]).status_code == 200
    assert send(client, b, conv, "back").status_code == 201
    assert client.post(f"/api/blocks/{a['id']}", headers=a["h"]).status_code == 422  # can't block yourself


def test_blocking_does_not_affect_group_chats(client):
    a, b = two(client)
    c = login(client, "carol", "Carol")
    g = make_group(client, a, [b, c])
    client.post(f"/api/blocks/{b['id']}", headers=a["h"])
    assert send(client, b, g, "still here").status_code == 201


# ------------------------------------------------------------------ note to self

def test_note_to_self_is_private_single_member_chat(client):
    a, b = two(client)
    r = client.post("/api/conversations/note-to-self", headers=a["h"])
    assert r.status_code == 200
    conv = r.json()["id"]
    assert client.post("/api/conversations/note-to-self", headers=a["h"]).json()["id"] == conv  # idempotent
    assert send(client, a, conv, "remember milk").status_code == 201
    item = conv_item(client, a, conv)
    assert item["is_note_to_self"] is True and item["unread_count"] == 0 and item["peer"] is None
    assert client.get(f"/api/conversations/{conv}", headers=b["h"]).status_code == 403
    assert client.post("/api/conversations/note-to-self", headers=b["h"]).json()["id"] != conv


# ------------------------------------------------------------------ mark as unread

def test_mark_unread_flag_set_and_cleared_by_reading(client):
    a, b = two(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert conv_item(client, b, conv)["unread_count"] == 0
    assert client.patch(f"/api/conversations/{conv}/me", json={"marked_unread": True}, headers=b["h"]).status_code == 200
    assert conv_item(client, b, conv)["marked_unread"] is True
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert conv_item(client, b, conv)["marked_unread"] is False


# ------------------------------------------------------------------ pinned messages

def test_pin_unpin_limit_and_delete_clears_pin(client):
    a, b = two(client)
    conv = direct(client, a, b)
    ids = [send(client, a, conv, f"m{i}").json()["id"] for i in range(4)]
    for i in ids[:3]:
        assert client.put(f"/api/messages/{i}/pin", headers=b["h"]).status_code == 200  # any member may pin
    over = client.put(f"/api/messages/{ids[3]}/pin", headers=a["h"])
    assert over.status_code == 422 and "up to 3" in over.json()["error"]["message"]
    pinned = client.get(f"/api/conversations/{conv}/pinned", headers=a["h"]).json()["messages"]
    assert {m["id"] for m in pinned} == set(ids[:3]) and all(m["pinned_at"] for m in pinned)
    assert client.delete(f"/api/messages/{ids[0]}/pin", headers=a["h"]).status_code == 200
    client.delete(f"/api/messages/{ids[1]}", headers=a["h"])  # deleting for everyone unpins
    left = client.get(f"/api/conversations/{conv}/pinned", headers=a["h"]).json()["messages"]
    assert [m["id"] for m in left] == [ids[2]]


# ------------------------------------------------------------------ shared media

def _upload(client, user, conv, name, mime, data=PNG):
    r = client.post("/api/attachments", data={"conversation_id": conv}, files={"file": (name, data, mime)}, headers=user["h"])
    assert r.status_code == 201, r.text
    return r.json()["attachment_id"]


def test_media_files_audio_links_tabs(client):
    a, b = two(client)
    conv = direct(client, a, b)
    send(client, a, conv, "", attachment_ids=[_upload(client, a, conv, "p.png", "image/png")])
    send(client, a, conv, "", attachment_ids=[_upload(client, a, conv, "n.txt", "text/plain", b"hello")])
    send(client, b, conv, "", attachment_ids=[_upload(client, b, conv, "voice-4s.webm", "audio/webm;codecs=opus", b"\x1aE\xdf\xa3" + b"0" * 16)])
    send(client, b, conv, "look https://example.com/a and http://example.org/b.")

    def kind(k):
        return client.get(f"/api/conversations/{conv}/media", params={"kind": k}, headers=a["h"]).json()["items"]

    assert [i["attachment"]["file_name"] for i in kind("media")] == ["p.png"]
    assert [i["attachment"]["file_name"] for i in kind("files")] == ["n.txt"]
    audio = kind("audio")
    assert len(audio) == 1 and audio[0]["attachment"]["mime_type"] == "audio/webm"  # codec suffix normalised
    assert [i["url"] for i in kind("links")] == ["https://example.com/a", "http://example.org/b"]
    assert client.get(f"/api/conversations/{conv}/media", params={"kind": "bogus"}, headers=a["h"]).status_code == 422
    eve = login(client, "eve", "Eve")
    assert client.get(f"/api/conversations/{conv}/media", headers=eve["h"]).status_code == 403


# ------------------------------------------------------------------ mentions

def test_mentions_validated_and_flag_unread_mention(client):
    a, b = two(client)
    c = login(client, "carol", "Carol")
    outsider = login(client, "dave", "Dave")
    g = make_group(client, a, [b, c])
    m = send(client, a, g, "hi @Bob", mentions=[b["id"], outsider["id"], a["id"]]).json()
    assert m["mentions"] == [b["id"]]  # non-members and self are dropped
    assert conv_item(client, b, g)["has_unread_mention"] is True
    assert conv_item(client, c, g)["has_unread_mention"] is False
    client.post(f"/api/conversations/{g}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert conv_item(client, b, g)["has_unread_mention"] is False


# ------------------------------------------------------------------ privacy

def test_read_receipts_off_hides_read_from_sender_but_clears_own_unread(client):
    a, b = two(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    assert client.patch("/api/users/me/privacy", json={"read_receipts": False}, headers=b["h"]).json()["privacy"]["read_receipts"] is False
    client.post(f"/api/conversations/{conv}/delivered", json={"up_to_seq": m["seq"]}, headers=b["h"])
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert conv_item(client, b, conv)["unread_count"] == 0  # Bob's own unread badge clears
    shown = messages(client, a, conv)["messages"][-1]
    assert shown["status"] == "delivered"  # Alice never sees "read"
    client.patch("/api/users/me/privacy", json={"read_receipts": True}, headers=b["h"])
    m2 = send(client, a, conv, "again").json()
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m2["seq"]}, headers=b["h"])
    assert messages(client, a, conv)["messages"][-1]["status"] == "read"


def test_show_online_off_hides_last_seen_and_presence(client):
    a, b = two(client)
    conv = direct(client, a, b)
    send(client, a, conv, "hi")
    client.patch("/api/users/me/privacy", json={"show_online": False}, headers=b["h"])
    peer = client.get(f"/api/conversations/{conv}", headers=a["h"]).json()["peer"]
    assert peer["last_seen_at"] is None and peer.get("is_online") is False


# ------------------------------------------------------------------ link previews

class _Page(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(
            b'<html><head><title>Fallback</title><meta property="og:title" content="Hello Preview">'
            b'<meta property="og:description" content="A page"><meta property="og:image" content="/i.png"></head></html>'
        )

    def log_message(self, *a):
        pass


def test_link_preview_blocks_private_hosts_and_parses_open_graph(client):
    a, _ = two(client)
    # SSRF guard: loopback / private addresses are refused by default
    for bad in ("http://127.0.0.1:8000/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "ftp://example.com/x"):
        assert client.get("/api/link-preview", params={"url": bad}, headers=a["h"]).status_code == 422, bad
    srv = HTTPServer(("127.0.0.1", 0), _Page)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    from app.core.config import settings

    settings.link_preview_allow_private = True
    try:
        r = client.get("/api/link-preview", params={"url": f"http://127.0.0.1:{srv.server_port}/"}, headers=a["h"])
    finally:
        settings.link_preview_allow_private = False
        srv.shutdown()
    p = r.json()["preview"]
    assert p["title"] == "Hello Preview" and p["description"] == "A page" and p["image"].endswith("/i.png")


# ------------------------------------------------------------------ message requests

def _raw_direct(client, a, b):
    return client.post("/api/conversations/direct", json={"user_id": b["id"]}, headers=a["h"]).json()["id"]


def test_message_request_hidden_until_accepted_and_no_read_receipt(client):
    a, b = two(client)
    conv = _raw_direct(client, a, b)
    m = send(client, a, conv, "hey, it's me").json()
    assert all(c["id"] != conv for c in client.get("/api/conversations", headers=b["h"]).json())  # not in main list
    reqs = client.get("/api/conversations", params={"requests": "true"}, headers=b["h"]).json()
    assert [c["id"] for c in reqs] == [conv] and reqs[0]["is_request"] is True
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert messages(client, a, conv)["messages"][-1]["status"] != "read"  # no read receipt before accepting
    assert client.post(f"/api/conversations/{conv}/request/accept", headers=b["h"]).status_code == 200
    assert [c["id"] for c in client.get("/api/conversations", headers=b["h"]).json()] == [conv]
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert messages(client, a, conv)["messages"][-1]["status"] == "read"


def test_message_request_skipped_for_contacts_and_reply_accepts_and_delete_archives(client):
    a, b = two(client)
    c = login(client, "carol", "Carol")
    client.post("/api/contacts", json={"user_id": a["id"]}, headers=b["h"])
    conv = _raw_direct(client, a, b)
    send(client, a, conv, "hi")
    assert [x["id"] for x in client.get("/api/conversations", headers=b["h"]).json()] == [conv]  # contact => normal chat
    conv2 = _raw_direct(client, a, c)
    send(client, a, conv2, "hello stranger")
    assert send(client, c, conv2, "who is this?").status_code == 201  # replying accepts
    assert client.get("/api/conversations", params={"requests": "true"}, headers=c["h"]).json() == []
    d = login(client, "dave", "Dave")
    conv3 = _raw_direct(client, a, d)
    send(client, a, conv3, "spam")
    client.post(f"/api/conversations/{conv3}/request/delete", headers=d["h"])
    assert client.get("/api/conversations", params={"requests": "true"}, headers=d["h"]).json() == []
    assert [x["id"] for x in client.get("/api/conversations", params={"archived": "true"}, headers=d["h"]).json()] == [conv3]


# ------------------------------------------------------------------ reciprocal receipts + forwarding files

def test_receipts_off_hides_others_read_ticks_too(client):
    a, b = two(client)
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert messages(client, a, conv)["messages"][-1]["status"] == "read"
    client.patch("/api/users/me/privacy", json={"read_receipts": False}, headers=a["h"])
    assert messages(client, a, conv)["messages"][-1]["status"] == "delivered"  # Alice opted out => she can't see reads either


def test_forward_copies_attachments(client):
    a, b = two(client)
    c = login(client, "carol", "Carol")
    src = direct(client, a, b)
    dst = direct(client, a, c)
    mid = send(client, a, src, "", attachment_ids=[_upload(client, a, src, "p.png", "image/png")]).json()["id"]
    r = client.post(f"/api/conversations/{dst}/messages", json={"forward_from_id": mid}, headers=a["h"])
    assert r.status_code == 201 and len(r.json()["attachments"]) == 1
    new_att = r.json()["attachments"][0]["id"]
    client.delete(f"/api/messages/{mid}", headers=a["h"])  # deleting the original must not break the forward
    assert client.get(f"/api/attachments/{new_att}", headers=c["h"]).status_code == 200
    eve = login(client, "eve", "Eve")
    assert client.post(f"/api/conversations/{dst}/messages", json={"forward_from_id": mid}, headers=eve["h"]).status_code == 403


# ------------------------------------------------------------------ stories

def test_stories_visibility_views_and_delete(client):
    a, b = two(client)
    c = login(client, "carol", "Carol")
    conv = direct(client, a, b)
    send(client, a, conv, "hi")  # a and b are now connected through a DM
    s = client.post("/api/stories", json={"body": "my day", "bg": "#8e44ad"}, headers=a["h"])
    assert s.status_code == 201
    sid = s.json()["id"]
    img = client.post("/api/stories/image", files={"file": ("p.png", PNG, "image/png")}, data={"caption": "look"}, headers=a["h"])
    assert img.status_code == 201 and img.json()["has_media"] is True
    assert client.post("/api/stories/image", files={"file": ("x.txt", b"hi", "text/plain")}, headers=a["h"]).status_code == 422
    mine = client.get("/api/stories", headers=a["h"]).json()["mine"]
    assert len(mine) == 2
    feed = client.get("/api/stories", headers=b["h"]).json()["others"]
    assert [g["user"]["id"] for g in feed] == [a["id"]] and feed[0]["all_viewed"] is False
    assert client.get("/api/stories", headers=c["h"]).json()["others"] == []  # strangers can't see
    assert client.get(f"/api/stories/{img.json()['id']}/media", headers=c["h"]).status_code == 404
    assert client.get(f"/api/stories/{img.json()['id']}/media", headers=b["h"]).status_code == 200
    assert client.post(f"/api/stories/{sid}/view", headers=b["h"]).status_code == 200
    assert [v["user"]["id"] for v in client.get(f"/api/stories/{sid}/views", headers=a["h"]).json()["views"]] == [b["id"]]
    assert client.get(f"/api/stories/{sid}/views", headers=b["h"]).status_code == 403
    assert client.get("/api/stories", headers=a["h"]).json()["mine"][0]["view_count"] == 1
    client.patch("/api/users/me/privacy", json={"read_receipts": False}, headers=c["h"])
    client.post("/api/contacts", json={"user_id": a["id"]}, headers=c["h"])
    client.post(f"/api/stories/{sid}/view", headers=c["h"])  # receipts off: viewed, but the author isn't told
    assert len(client.get(f"/api/stories/{sid}/views", headers=a["h"]).json()["views"]) == 1
    assert client.delete(f"/api/stories/{sid}", headers=b["h"]).status_code == 403
    assert client.delete(f"/api/stories/{sid}", headers=a["h"]).status_code == 200


# ------------------------------------------------------------------ linked devices

def test_sessions_list_and_unlink(client):
    a, _ = two(client)
    ua = {"device_label": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Chrome/126.0 Safari/537.36"}
    from tests.helpers import phone_for
    r2 = client.post("/api/auth/verify-otp", json={"identifier": phone_for("alice"), "otp": "123456", **ua}).json()
    h2 = {"Authorization": f"Bearer {r2['token']}"}
    rows = client.get("/api/auth/sessions", headers=a["h"]).json()
    assert len(rows) == 2 and sum(r["current"] for r in rows) == 1
    other = next(r for r in rows if not r["current"])
    assert other["device"] == "Chrome on macOS"
    assert client.delete(f"/api/auth/sessions/{other['id']}", headers=a["h"]).status_code == 200
    assert client.get("/api/users/me", headers=h2).status_code == 401  # the unlinked device is signed out
    assert len(client.get("/api/auth/sessions", headers=a["h"]).json()) == 1
