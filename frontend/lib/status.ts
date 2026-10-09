// Mirror of backend/app/services/receipts.py. Both are verified against shared/status_fixtures.json.
export type MemberCursor = {
  user_id?: string;
  user?: { id: string };
  joined_seq: number;
  left_seq: number | null;
  last_delivered_seq: number;
  last_read_seq: number;
};

const idOf = (m: MemberCursor) => m.user_id ?? m.user?.id;

export function computeStatus(
  seq: number,
  senderId: string | null,
  members: MemberCursor[],
): "sent" | "delivered" | "read" {
  const recipients = members.filter(
    (m) => idOf(m) !== senderId && m.joined_seq < seq && (m.left_seq === null || seq <= m.left_seq),
  );
  if (recipients.length === 0) return "sent";
  if (Math.min(...recipients.map((m) => m.last_read_seq)) >= seq) return "read";
  if (Math.min(...recipients.map((m) => m.last_delivered_seq)) >= seq) return "delivered";
  return "sent";
}
