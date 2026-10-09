import pytest
from starlette.websockets import WebSocketDisconnect

from app.realtime import tickets
from tests.helpers import direct, login, send


def ticket(client, user):
    r = client.post("/api/auth/ws-ticket", headers=user["h"])
    assert r.status_code == 200
    return r.json()["ticket"]


def recv_until(ws, event, limit=10):
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["event"] == event:
            return msg
    raise AssertionError(f"never received {event}")


def test_ws_requires_a_valid_ticket(client):
    with client.websocket_connect("/ws?ticket=bogus") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_ws_ticket_is_single_use(client):
    u = login(client, "alice", "Alice")
    t = ticket(client, u)
    with client.websocket_connect(f"/ws?ticket={t}") as ws:
        ws.send_json({"event": "ping"})
        assert ws.receive_json()["event"] == "pong"
    with client.websocket_connect(f"/ws?ticket={t}") as ws2:  # replay
        with pytest.raises(WebSocketDisconnect) as exc:
            ws2.receive_json()
        assert exc.value.code == 4401


def test_ws_ticket_expires(client, monkeypatch):
    u = login(client, "alice", "Alice")
    t = ticket(client, u)
    monkeypatch.setattr(tickets, "TTL_SECONDS", 0)
    tickets._tickets[t] = (u["id"], 0.0)  # already past its expiry
    assert tickets.consume(t) is None


def test_ws_ticket_requires_login(client):
    assert client.post("/api/auth/ws-ticket").status_code == 401


def test_new_message_is_pushed_to_recipient_and_senders_other_tab(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    with client.websocket_connect(f"/ws?ticket={ticket(client, b)}") as wb, client.websocket_connect(
        f"/ws?ticket={ticket(client, a)}"
    ) as wa:
        r = send(client, a, conv, "live!")
        assert r.status_code == 201
        for ws in (wb, wa):
            ev = recv_until(ws, "message.new")
            assert ev["conversation_id"] == conv and ev["payload"]["body"] == "live!"
            assert ev["payload"]["id"] == r.json()["id"] and ev["event_id"]


def test_receipt_event_after_read(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    m = send(client, a, conv, "hi").json()
    with client.websocket_connect(f"/ws?ticket={ticket(client, a)}") as wa:
        client.post(f"/api/conversations/{conv}/read", json={"up_to_seq": m["seq"]}, headers=b["h"])
        ev = recv_until(wa, "receipt.updated")
        assert ev["payload"] == {"user_id": b["id"], "delivered_seq": m["seq"], "read_seq": m["seq"]}


def test_typing_is_relayed_and_membership_is_rechecked(client):
    a, b, eve = login(client, "alice", "Alice"), login(client, "bob", "Bob"), login(client, "eve", "Eve")
    conv = direct(client, a, b)
    with client.websocket_connect(f"/ws?ticket={ticket(client, b)}") as wb, client.websocket_connect(
        f"/ws?ticket={ticket(client, a)}"
    ) as wa, client.websocket_connect(f"/ws?ticket={ticket(client, eve)}") as we:
        wa.send_json({"event": "typing.start", "conversation_id": conv})
        ev = recv_until(wb, "typing.start")
        assert ev["payload"]["user_id"] == a["id"]
        # an authenticated socket does not authorize a conversation it doesn't belong to
        we.send_json({"event": "typing.start", "conversation_id": conv})
        assert recv_until(we, "error")["payload"]["message"]
        we.send_json({"event": "nope"})
        assert recv_until(we, "error")["payload"]["message"].startswith("Unknown event")


def test_presence_is_announced_to_conversation_peers(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    send(client, a, conv, "hi")
    with client.websocket_connect(f"/ws?ticket={ticket(client, a)}") as wa:
        with client.websocket_connect(f"/ws?ticket={ticket(client, b)}"):
            ev = recv_until(wa, "presence.updated")
            assert ev["payload"]["user_id"] == b["id"] and ev["payload"]["online"] is True
            detail = client.get(f"/api/conversations/{conv}", headers=a["h"]).json()
            assert detail["peer"]["is_online"] is True


def test_deleted_message_event(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    m = send(client, a, conv, "x").json()
    with client.websocket_connect(f"/ws?ticket={ticket(client, b)}") as wb:
        client.delete(f"/api/messages/{m['id']}", headers=a["h"])
        assert recv_until(wb, "message.deleted")["payload"]["message_id"] == m["id"]


# ------------------------------------------------------------------ calls (signaling)

def wait_for(ws, event):
    return recv_until(ws, event, limit=30)


def test_call_flow_invite_accept_signal_end_and_logs_system_message(client):
    a, b = login(client, "alice", "Alice"), login(client, "bob", "Bob")
    conv = direct(client, a, b)
    with client.websocket_connect(f"/ws?ticket={ticket(client, a)}") as wa, client.websocket_connect(f"/ws?ticket={ticket(client, b)}") as wb:
        wa.send_json({"event": "call.invite", "conversation_id": conv, "video": True})
        inc = wait_for(wb, "call.incoming")
        assert inc["payload"]["video"] is True and inc["payload"]["caller"]["id"] == a["id"]
        cid = inc["payload"]["call_id"]
        wb.send_json({"event": "call.accept", "call_id": cid})
        wait_for(wa, "call.accepted")
        wa.send_json({"event": "call.signal", "call_id": cid, "data": {"sdp": "offer"}})
        assert wait_for(wb, "call.signal")["payload"]["data"] == {"sdp": "offer"}
        wb.send_json({"event": "call.signal", "call_id": cid, "data": {"sdp": "answer"}})
        assert wait_for(wa, "call.signal")["payload"]["data"] == {"sdp": "answer"}
        wa.send_json({"event": "call.end", "call_id": cid})
        assert wait_for(wb, "call.ended")["payload"]["reason"] == "ended"
        sysmsg = wait_for(wb, "message.new")["payload"]
        assert sysmsg["type"] == "SYSTEM" and sysmsg["system_event"]["kind"] == "call" and sysmsg["system_event"]["outcome"] == "completed"


def test_call_decline_busy_unavailable_and_blocked(client):
    a, b, c = login(client, "alice", "Alice"), login(client, "bob", "Bob"), login(client, "carol", "Carol")
    conv, conv_ac = direct(client, a, b), direct(client, a, c)
    with client.websocket_connect(f"/ws?ticket={ticket(client, a)}") as wa:
        wa.send_json({"event": "call.invite", "conversation_id": conv, "video": False})  # Bob offline: it still rings
        off_id = wait_for(wa, "call.ringing")["payload"]["call_id"]
        wa.send_json({"event": "call.end", "call_id": off_id})  # Alice gives up
        wait_for(wa, "call.ended")
        with client.websocket_connect(f"/ws?ticket={ticket(client, b)}") as wb, client.websocket_connect(f"/ws?ticket={ticket(client, c)}") as wc:
            wa.send_json({"event": "call.invite", "conversation_id": conv, "video": False})
            cid = wait_for(wb, "call.incoming")["payload"]["call_id"]
            wa.send_json({"event": "call.invite", "conversation_id": conv_ac, "video": False})  # Alice is in a call
            assert wait_for(wa, "call.ended")["payload"]["reason"] == "busy"
            wb.send_json({"event": "call.decline", "call_id": cid})
            assert wait_for(wa, "call.ended")["payload"]["reason"] == "declined"
            client.post(f"/api/blocks/{c['id']}", headers=a["h"])
            wa.send_json({"event": "call.invite", "conversation_id": conv_ac, "video": False})
            assert wait_for(wa, "call.ended")["payload"]["reason"].startswith("error")
