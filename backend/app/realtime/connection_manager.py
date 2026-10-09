"""user_id -> set of live sockets (a user may have several tabs/devices)."""
import asyncio
import logging

from fastapi import WebSocket

log = logging.getLogger("signal.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> bool:
        """Register an already-accepted socket. True if this is the user's first connection."""
        first = user_id not in self._conns or not self._conns[user_id]
        self._conns.setdefault(user_id, set()).add(ws)
        return first

    def disconnect(self, user_id: str, ws: WebSocket) -> bool:
        """True if that was the user's last connection."""
        socks = self._conns.get(user_id)
        if socks is None:
            return False
        socks.discard(ws)
        if not socks:
            del self._conns[user_id]
            return True
        return False

    def is_online(self, user_id: str) -> bool:
        return bool(self._conns.get(user_id))

    def online_ids(self) -> set[str]:
        return {u for u, s in self._conns.items() if s}

    async def _send(self, user_id: str, ws: WebSocket, envelope: dict) -> None:
        try:
            await ws.send_json(envelope)
        except Exception:  # dead socket: drop it, the client will reconnect and resync from the DB
            self.disconnect(user_id, ws)

    async def send_to_users(self, user_ids: list[str], envelope: dict) -> None:
        tasks = [
            self._send(uid, ws, envelope) for uid in dict.fromkeys(user_ids) for ws in list(self._conns.get(uid, ()))
        ]
        if tasks:
            await asyncio.gather(*tasks)


manager = ConnectionManager()
