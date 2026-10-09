from app.db import engine
from app.db.models import ConversationMember
from tests.helpers import direct, login, make_group, messages, send


def users(client, *names):
    return [login(client, n, n.title()) for n in names]


def test_group_creation_adds_members_and_system_message(client):
    a, b, c = users(client, "alice", "bob", "carol")
    gid = make_group(client, a, [b, c])
    detail = client.get(f"/api/conversations/{gid}", headers=b["h"]).json()
    roles = {m["user"]["id"]: m["role"] for m in detail["members"]}
    assert roles == {a["id"]: "ADMIN", b["id"]: "MEMBER", c["id"]: "MEMBER"}
    first = messages(client, b, gid)["messages"][0]
    assert first["type"] == "SYSTEM" and first["system_event"]["kind"] == "group_created"


def test_group_messages_reach_all_members(client):
    a, b, c = users(client, "alice", "bob", "carol")
    gid = make_group(client, a, [b, c])
    send(client, b, gid, "hello team")
    for u in (a, c):
        assert "hello team" in [m["body"] for m in messages(client, u, gid)["messages"]]


def test_only_admins_can_add_remove_and_change_roles(client):
    a, b, c, d = users(client, "alice", "bob", "carol", "dave")
    gid = make_group(client, a, [b, c])
    assert client.post(f"/api/conversations/{gid}/members", json={"user_ids": [d["id"]]}, headers=b["h"]).status_code == 403
    assert client.delete(f"/api/conversations/{gid}/members/{c['id']}", headers=b["h"]).status_code == 403
    assert client.post(f"/api/conversations/{gid}/members/{c['id']}/role", json={"role": "ADMIN"}, headers=b["h"]).status_code == 403
    assert client.patch(f"/api/conversations/{gid}", json={"title": "New"}, headers=b["h"]).status_code == 403
    assert client.post(f"/api/conversations/{gid}/members", json={"user_ids": [d["id"]]}, headers=a["h"]).status_code == 200


def test_new_member_cannot_see_history_before_joining(client):
    a, b, d = users(client, "alice", "bob", "dave")
    gid = make_group(client, a, [b])
    send(client, a, gid, "old secret")
    client.post(f"/api/conversations/{gid}/members", json={"user_ids": [d["id"]]}, headers=a["h"])
    send(client, a, gid, "welcome")
    bodies = [m["body"] for m in messages(client, d, gid)["messages"] if m["type"] != "SYSTEM"]
    assert bodies == ["welcome"]
    kinds = [m["system_event"]["kind"] for m in messages(client, d, gid)["messages"] if m["type"] == "SYSTEM"]
    assert kinds == ["member_added"]  # they see their own "added" notice only


def test_removed_member_cannot_read_later_messages_or_send(client):
    a, b, c = users(client, "alice", "bob", "carol")
    gid = make_group(client, a, [b, c])
    send(client, a, gid, "before")
    assert client.delete(f"/api/conversations/{gid}/members/{c['id']}", headers=a["h"]).status_code == 200
    send(client, a, gid, "after removal")
    carol_view = messages(client, c, gid)["messages"]
    texts = [m["body"] for m in carol_view if m["type"] != "SYSTEM"]
    assert texts == ["before"]
    assert carol_view[-1]["system_event"]["kind"] == "member_removed"  # she sees the removal notice, nothing newer
    assert send(client, c, gid, "let me in").status_code == 403
    assert gid not in [x["id"] for x in client.get("/api/conversations", headers=c["h"]).json()]


def test_readding_resets_the_visibility_window(client):
    a, b, c = users(client, "alice", "bob", "carol")
    gid = make_group(client, a, [b, c])
    client.delete(f"/api/conversations/{gid}/members/{c['id']}", headers=a["h"])
    send(client, a, gid, "while carol was away")
    client.post(f"/api/conversations/{gid}/members", json={"user_ids": [c["id"]]}, headers=a["h"])
    send(client, a, gid, "welcome back")
    texts = [m["body"] for m in messages(client, c, gid)["messages"] if m["type"] != "SYSTEM"]
    assert texts == ["welcome back"]


def test_group_status_turns_read_only_when_all_have_read_and_removal_can_flip_it(client):
    a, b, c = users(client, "alice", "bob", "carol")
    gid = make_group(client, a, [b, c])
    m = send(client, a, gid, "ping").json()
    for u in (b, c):
        client.post(f"/api/conversations/{gid}/delivered", json={"up_to_seq": m["seq"]}, headers=u["h"])
    assert messages(client, a, gid)["messages"][-1]["status"] == "delivered"
    client.post(f"/api/conversations/{gid}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
    assert messages(client, a, gid)["messages"][-1]["status"] == "delivered"  # carol hasn't read yet
    client.post(f"/api/conversations/{gid}/read", json={"up_to_seq": m["seq"]}, headers=c["h"])
    assert messages(client, a, gid)["messages"][-1]["status"] == "read"


def test_last_admin_leaving_promotes_longest_standing_member(client):
    a, b, c = users(client, "alice", "bob", "carol")
    gid = make_group(client, a, [b, c])
    assert client.post(f"/api/conversations/{gid}/leave", headers=a["h"]).status_code == 200
    detail = client.get(f"/api/conversations/{gid}", headers=b["h"]).json()
    admins = [m["user"]["id"] for m in detail["members"] if m["is_active"] and m["role"] == "ADMIN"]
    assert len(admins) == 1 and admins[0] in (b["id"], c["id"])


def test_cannot_demote_the_only_admin(client):
    a, b = users(client, "alice", "bob")
    gid = make_group(client, a, [b])
    r = client.post(f"/api/conversations/{gid}/members/{a['id']}/role", json={"role": "MEMBER"}, headers=a["h"])
    assert r.status_code == 422


def test_cannot_leave_or_add_members_to_a_direct_chat(client):
    a, b, c = users(client, "alice", "bob", "carol")
    conv = direct(client, a, b)
    assert client.post(f"/api/conversations/{conv}/leave", headers=a["h"]).status_code == 422
    assert client.post(f"/api/conversations/{conv}/members", json={"user_ids": [c["id"]]}, headers=a["h"]).status_code == 422


def test_pin_archive_mute_are_personal(client):
    a, b = users(client, "alice", "bob")
    conv = direct(client, a, b)
    send(client, a, conv, "hi")
    client.patch(f"/api/conversations/{conv}/me", json={"is_pinned": True, "muted_until": "forever"}, headers=b["h"])
    bobs = client.get("/api/conversations", headers=b["h"]).json()[0]
    alices = client.get("/api/conversations", headers=a["h"]).json()[0]
    assert bobs["is_pinned"] and bobs["muted_until"] and not alices["is_pinned"] and not alices["muted_until"]
    client.patch(f"/api/conversations/{conv}/me", json={"is_archived": True}, headers=b["h"])
    assert client.get("/api/conversations", headers=b["h"]).json() == []
    assert len(client.get("/api/conversations", params={"archived": True}, headers=b["h"]).json()) == 1


def test_conversation_list_search_filter_and_sorting(client):
    a, b, c = users(client, "alice", "bob", "carol")
    c1, c2 = direct(client, a, b), direct(client, a, c)
    send(client, b, c1, "first")
    send(client, c, c2, "second")  # more recent
    lst = client.get("/api/conversations", headers=a["h"]).json()
    assert [i["peer"]["display_name"] for i in lst] == ["Carol", "Bob"]
    assert [i["peer"]["display_name"] for i in client.get("/api/conversations", params={"q": "bo"}, headers=a["h"]).json()] == ["Bob"]
    client.post(f"/api/conversations/{c2}/read", json={"up_to_seq": 1}, headers=a["h"])
    assert [i["peer"]["display_name"] for i in client.get("/api/conversations", params={"filter": "unread"}, headers=a["h"]).json()] == ["Bob"]
    client.patch(f"/api/conversations/{c1}/me", json={"is_pinned": True}, headers=a["h"])
    assert client.get("/api/conversations", headers=a["h"]).json()[0]["peer"]["display_name"] == "Bob"  # pinned first


def test_empty_direct_chats_stay_out_of_the_list(client):
    a, b = users(client, "alice", "bob")
    direct(client, a, b)
    assert client.get("/api/conversations", headers=a["h"]).json() == []


def test_contacts_and_user_search(client):
    a, b = users(client, "alice", "bob")
    assert client.post("/api/contacts", json={"identifier": "bob"}, headers=a["h"]).status_code == 201
    assert client.post("/api/contacts", json={"identifier": "nobody1"}, headers=a["h"]).status_code == 404
    assert [c["display_name"] for c in client.get("/api/contacts", headers=a["h"]).json()] == ["Bob"]
    found = client.get("/api/users/search", params={"q": "bo"}, headers=a["h"]).json()
    assert found[0]["display_name"] == "Bob" and found[0]["is_contact"] is True
    client.delete(f"/api/contacts/{b['id']}", headers=a["h"])
    assert client.get("/api/contacts", headers=a["h"]).json() == []
    # users who haven't finished onboarding are not discoverable
    client.post("/api/auth/verify-otp", json={"identifier": "ghost1", "otp": "123456"})
    assert client.get("/api/users/search", params={"q": "ghost"}, headers=a["h"]).json() == []


def test_foreign_keys_are_enforced(env):
    import sqlite3

    engine.configure(env and __import__("app.core.config", fromlist=["settings"]).settings.database_url)
    engine.create_all()
    with engine.session_scope() as db:
        assert db.connection().exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert db.connection().exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
