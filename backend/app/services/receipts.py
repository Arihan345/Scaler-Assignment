"""Pure receipt logic. Mirrored by frontend/lib/status.ts; both are tested against shared/status_fixtures.json."""


def is_eligible(member, seq: int, sender_id: str | None) -> bool:
    """Was `member` a recipient of the message at `seq`? (membership interval at message time, sender excluded)"""
    return (
        member.user_id != sender_id
        and member.joined_seq < seq
        and (member.left_seq is None or seq <= member.left_seq)
    )


def compute_status(seq: int, sender_id: str | None, members) -> str:
    recipients = [m for m in members if is_eligible(m, seq, sender_id)]
    if not recipients:
        return "sent"
    if min(m.last_read_seq for m in recipients) >= seq:
        return "read"
    if min(m.last_delivered_seq for m in recipients) >= seq:
        return "delivered"
    return "sent"
