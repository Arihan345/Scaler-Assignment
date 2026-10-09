"""WebSocket endpoint. REST creates things; the socket only pushes events and carries typing/ping.
An authenticated socket authorizes nothing by itself: every typing event re-checks membership."""
import asyncio
import json
import logging

import anyio
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.db.engine import session_scope
from app.realtime import tickets
from app.realtime.connection_manager import manager
from app.realtime.dispatcher import envelope, publish
from app.services import user_service
from app.services.events import Event
from app.services.membership import active_member_ids, get_membership

log = logging.getLogger("signal.ws")
router = APIRouter()

TYPING_TTL = 5.0
_typing_tasks: dict[tuple[str, str], asyncio.Task] = {}


def _members_if_active(user_id: str, conversation_id: str) -> list[str] | None:
    with session_scope() as db:
        m = get_membership(db, user_id, conversation_id)
        if m is None or m.left_at is not None:
            return None
        return active_member_ids(db, conversation_id)


def _peers(user_id: str) -> list[str]:
    with session_scope() as db:
        return user_service.presence_peer_ids(db, user_id)


def _touch_last_seen(user_id: str) -> str:
    with session_scope() as db:
        return user_service.touch_last_seen(db, user_id)


async def _announce(user_id: str, online: bool, last_seen_at: str | None = None) -> None:
    peers = await anyio.to_thread.run_sync(_peers, user_id)
    await publish([Event(peers, "presence.updated", None, {"user_id": user_id, "online": online, "last_seen_at": last_seen_at})])


async def _typing_expire(key: tuple[str, str], others: list[str]) -> None:
    try:
        await asyncio.sleep(TYPING_TTL)
    except asyncio.CancelledError:
        return
    _typing_tasks.pop(key, None)
    await publish([Event(others, "typing.stop", key[0], {"user_id": key[1]})])


async def _handle_typing(user_id: str, conversation_id: str, started: bool) -> str | None:
    members = await anyio.to_thread.run_sync(_members_if_active, user_id, conversation_id)
    if members is None:
        return "You are not a member of this conversation"
    others = [u for u in members if u != user_id]
    key = (conversation_id, user_id)
    old = _typing_tasks.pop(key, None)
    if old:
        old.cancel()
    await publish([Event(others, "typing.start" if started else "typing.stop", conversation_id, {"user_id": user_id})])
    if started:  # server-side safety net: a dropped client can't leave "typing…" stuck forever
        _typing_tasks[key] = asyncio.create_task(_typing_expire(key, others))
    return None


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, ticket: str | None = Query(default=None)):
    await websocket.accept()
    user_id = tickets.consume(ticket)  # single-use: invalid, expired and replayed tickets all fail here
    if user_id is None:
        await websocket.close(code=4401, reason="invalid ticket")
        return
    first = await manager.connect(user_id, websocket)
    if first:
        await _announce(user_id, True)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                event = msg.get("event")
            except (ValueError, AttributeError):
                await websocket.send_json(envelope("error", None, {"message": "Malformed event"}))
                continue
            if event == "ping":
                await websocket.send_json(envelope("pong", None, {}))
            elif event in ("typing.start", "typing.stop"):
                conv = msg.get("conversation_id")
                err = await _handle_typing(user_id, conv, event == "typing.start") if isinstance(conv, str) else "Missing conversation_id"
                if err:
                    await websocket.send_json(envelope("error", conv if isinstance(conv, str) else None, {"message": err}))
            else:
                await websocket.send_json(envelope("error", None, {"message": f"Unknown event: {event}"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket crashed")
    finally:
        if manager.disconnect(user_id, websocket):  # last tab closed
            seen = await anyio.to_thread.run_sync(_touch_last_seen, user_id)
            await _announce(user_id, False, seen)
