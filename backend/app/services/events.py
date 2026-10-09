from dataclasses import dataclass, field


@dataclass
class Event:
    """A realtime event produced by a service AFTER its transaction committed."""
    users: list[str]
    event: str
    conversation_id: str | None
    payload: dict = field(default_factory=dict)
