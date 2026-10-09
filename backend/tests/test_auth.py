from sqlalchemy import select

from app.db import engine
from app.db.models import Session as SessionRow
from tests.helpers import auth, login


def test_request_otp_validates_identifier(client):
    assert client.post("/api/auth/request-otp", json={"identifier": "+919810000099"}).json()["ok"] is True
    assert client.post("/api/auth/request-otp", json={"identifier": "bob_1"}).json()["identifier_type"] == "username"
    bad = client.post("/api/auth/request-otp", json={"identifier": "x"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "VALIDATION"


def test_wrong_otp_is_rejected(client):
    r = client.post("/api/auth/verify-otp", json={"identifier": "alice", "otp": "000000"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_first_login_creates_user_and_requires_onboarding(client):
    r = client.post("/api/auth/verify-otp", json={"identifier": "alice", "otp": "123456"})
    body = r.json()
    assert body["is_new_user"] is True and body["user"]["display_name"] == "alice"
    token = body["token"]
    # onboarding: setting the display name completes it
    r = client.patch("/api/users/me", json={"display_name": "Alice A"}, headers=auth(token))
    assert r.json()["onboarded"] is True
    again = client.post("/api/auth/verify-otp", json={"identifier": "alice", "otp": "123456"}).json()
    assert again["is_new_user"] is False and again["user"]["id"] == body["user"]["id"]


def test_login_is_required_every_fresh_session_and_session_persists(client):
    u = login(client, "alice", "Alice")
    assert client.get("/api/users/me", headers=u["h"]).status_code == 200  # same token keeps working
    assert client.get("/api/users/me").status_code == 401
    assert client.get("/api/users/me", headers=auth("garbage")).status_code == 401


def test_logout_revokes_session(client):
    u = login(client, "alice", "Alice")
    assert client.post("/api/auth/logout", headers=u["h"]).status_code == 200
    assert client.get("/api/users/me", headers=u["h"]).status_code == 401


def test_session_token_is_stored_hashed(client):
    u = login(client, "alice", "Alice")
    with engine.session_scope() as db:
        hashes = [s.token_hash for s in db.execute(select(SessionRow)).scalars()]
    assert hashes and u["token"] not in hashes and all(len(h) == 64 for h in hashes)


def test_phone_login_uses_phone_column(client):
    r = client.post("/api/auth/verify-otp", json={"identifier": "+91 98100-00123", "otp": "123456"}).json()
    assert r["user"]["phone_number"] == "+919810000123" and r["user"]["username"] is None
