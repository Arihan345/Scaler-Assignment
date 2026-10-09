"""1:1 voice/video calls. The server is only the SIGNALING channel (invite / accept / decline / end and the relayed
WebRTC offer, answer and ICE candidates); audio and video flow peer-to-peer between browsers.
Call state is in memory (like presence/typing): a restart drops live calls, which is acceptable for a demo."""
import asyncio
import json
import logging
import time
from dataclasses import dataclass, field

import anyio

from app.core.ids import new_id
from app.core.time import now_iso
from app.db.engine import begin_write, session_scope
from app.db.models import Conversation, ConversationMember, User
from app.realtime.connection_manager import manager
from app.realtime.dispatcher import publish
from app.services import message_service, serializers, user_service
from app.services.events import Event
from app.services.membership import active_member_ids

log = logging.getLogger("signal.calls")
RING_SECONDS = 40.0
MAX_SIGNAL_BYTES = 20_000


@dataclass
class Call:
    id: str
    conversation_id: str
    caller: str
    callee: str
    video: bool
    state: str = "ringing"  # ringing | active
    accepted_at: float | None = None
    timer: asyncio.Task | None = field(default=None, repr=False)

    def other(self, uid: str) -> str:
        return self.callee if uid == self.caller else self.caller


CALLS: dict[str, Call] = {}
USER_CALL: dict[str, str] = {}


def _check_invite(user_id: str, conversation_id: str) -> tuple[str | None, dict | None, str | None]:
    """-> (callee_id, caller_dto, error)."""
    with session_scope() as db:
        conv = db.get(Conversation, conversation_id)
        if conv is None or conv.type != "DIRECT":
            return None, None, "Calls are only available in one-to-one chats"
        members = [m for m in db.query(ConversationMember).filter_by(conversation_id=conversation_id) if m.left_at is None]
        if user_id not in {m.user_id for m in members}:
            return None, None, "You are not a member of this conversation"
        others = [m.user_id for m in members if m.user_id != user_id]
        if len(others) != 1:
            return None, None, "Can't call yourself"
        if user_service.is_blocked_between(db, user_id, others[0]):
            return None, None, "This call can't be placed"
        return others[0], serializers.user_dto(db.get(User, user_id)), None


async def _end_reason(uid: str, call_id: str, reason: str) -> None:
    await publish([Event([uid], "call.ended", None, {"call_id": call_id, "reason": reason, "duration": 0})])


async def invite(user_id: str, conversation_id: str, video: bool) -> None:
    callee, caller_dto, err = await anyio.to_thread.run_sync(_check_invite, user_id, conversation_id)
    call_id = new_id()
    if err:
        return await _end_reason(user_id, call_id, "error:" + err)
    if user_id in USER_CALL or callee in USER_CALL:
        return await _end_reason(user_id, call_id, "busy")
    # An offline callee is not an error: like Signal, the call just rings until it times out and is logged as missed.
    call = Call(call_id, conversation_id, user_id, callee, bool(video))
    CALLS[call_id] = call
    USER_CALL[user_id] = USER_CALL[callee] = call_id
    call.timer = asyncio.create_task(_ring_timeout(call_id))
    await publish([
        Event([callee], "call.incoming", conversation_id, {"call_id": call_id, "video": call.video, "caller": caller_dto}),
        Event([user_id], "call.ringing", conversation_id, {"call_id": call_id, "video": call.video}),
    ])


async def _ring_timeout(call_id: str) -> None:
    try:
        await asyncio.sleep(RING_SECONDS)
    except asyncio.CancelledError:
        return
    await end(call_id, "missed")


async def accept(user_id: str, call_id: str) -> None:
    call = CALLS.get(call_id)
    if call is None or call.callee != user_id or call.state != "ringing":
        return
    call.state = "active"
    call.accepted_at = time.monotonic()
    if call.timer:
        call.timer.cancel()
    await publish([Event([call.caller], "call.accepted", call.conversation_id, {"call_id": call_id})])


async def hang_up(user_id: str, call_id: str, declined: bool = False) -> None:
    call = CALLS.get(call_id)
    if call is None or user_id not in (call.caller, call.callee):
        return
    if call.state == "ringing":
        await end(call_id, "declined" if declined and user_id == call.callee else "missed")
    else:
        await end(call_id, "ended")


async def relay(user_id: str, call_id: str, data) -> None:
    call = CALLS.get(call_id)
    if call is None or user_id not in (call.caller, call.callee) or call.state != "active":
        return
    if len(json.dumps(data)) > MAX_SIGNAL_BYTES:
        return
    await publish([Event([call.other(user_id)], "call.signal", call.conversation_id, {"call_id": call_id, "data": data})])


def drop_user(user_id: str) -> asyncio.Task | None:
    """Last socket closed mid-call: hang up on their behalf."""
    cid = USER_CALL.get(user_id)
    return asyncio.create_task(end(cid, "ended" if CALLS[cid].state == "active" else "missed")) if cid in CALLS else None


def _log_call(call: Call, outcome: str, duration: int) -> Event | None:
    with session_scope() as db:
        begin_write(db)
        payload = {"kind": "call", "video": call.video, "outcome": outcome, "duration": duration, "actor": call.caller}
        msg = message_service.insert_message(db, call.conversation_id, None, now_iso(), "SYSTEM", None, system_event=json.dumps(payload))
        audience = active_member_ids(db, call.conversation_id)
        dto = serializers.message_dto(db, msg)
        db.commit()
        return Event(audience, "message.new", call.conversation_id, dto)


async def end(call_id: str, reason: str) -> None:
    call = CALLS.pop(call_id, None)
    if call is None:
        return
    USER_CALL.pop(call.caller, None)
    USER_CALL.pop(call.callee, None)
    if call.timer and call.timer is not asyncio.current_task():
        call.timer.cancel()
    duration = int(time.monotonic() - call.accepted_at) if call.accepted_at else 0
    outcome = "completed" if call.state == "active" else reason  # missed | declined
    events = [Event([call.caller, call.callee], "call.ended", call.conversation_id, {"call_id": call_id, "reason": reason, "duration": duration})]
    try:
        ev = await anyio.to_thread.run_sync(_log_call, call, outcome, duration)
        if ev:
            events.append(ev)
    except Exception:
        log.exception("couldn't log call")
    await publish(events)
