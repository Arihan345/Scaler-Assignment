"""Turns service Events into WebSocket envelopes. Called only after the DB transaction committed."""
import logging

from app.core.ids import new_id
from app.realtime.connection_manager import manager
from app.services.events import Event

log = logging.getLogger("signal.ws")


def envelope(event: str, conversation_id: str | None, payload: dict) -> dict:
    return {"event": event, "event_id": new_id(), "conversation_id": conversation_id, "payload": payload}


async def publish(events: list[Event]) -> None:
    for ev in events:
        try:
            await manager.send_to_users(ev.users, envelope(ev.event, ev.conversation_id, ev.payload))
        except Exception:  # a failed push must never undo or block a saved message
            log.exception("publish failed for %s", ev.event)
