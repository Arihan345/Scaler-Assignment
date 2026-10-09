def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def phone_for(name: str) -> str:
    """Stable fake phone number for a test persona like "alice" (login is phone-only)."""
    import hashlib

    n = int.from_bytes(hashlib.md5(name.encode()).digest()[:6], "big") % 10**10
    return f"+91{n:010d}"


def login(client, identifier: str, name: str | None = None) -> dict:
    if not identifier.lstrip("+").isdigit():
        identifier = phone_for(identifier)
    r = client.post("/api/auth/verify-otp", json={"identifier": identifier, "otp": "123456"})
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["token"]
    if name:
        r = client.patch("/api/users/me", json={"display_name": name}, headers=auth(token))
        assert r.status_code == 200, r.text
    return {"token": token, "id": data["user"]["id"], "h": auth(token)}


def direct(client, a: dict, b: dict) -> str:
    r = client.post("/api/conversations/direct", json={"user_id": b["id"]}, headers=a["h"])
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    # most tests exercise normal chats, so the recipient accepts the (non-contact) message request up front
    client.post(f"/api/conversations/{cid}/request/accept", headers=b["h"])
    return cid


def send(client, user: dict, conv_id: str, body: str = "hi", client_id: str | None = None, **extra):
    payload = {"body": body, **extra}
    if client_id:
        payload["client_message_id"] = client_id
    return client.post(f"/api/conversations/{conv_id}/messages", json=payload, headers=user["h"])


def make_group(client, admin: dict, members: list[dict], title: str = "Team") -> str:
    r = client.post(
        "/api/conversations/groups",
        json={"title": title, "member_ids": [m["id"] for m in members]},
        headers=admin["h"],
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def messages(client, user: dict, conv_id: str, **params) -> dict:
    r = client.get(f"/api/conversations/{conv_id}/messages", params=params, headers=user["h"])
    assert r.status_code == 200, r.text
    return r.json()
