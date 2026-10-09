import type { ConversationDetail, ConversationListItem, LastMessage, Member, Message, SystemEvent, User } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const parse = (iso: string) => new Date(iso);

export function clock(iso: string): string {
  const d = parse(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

/** Conversation-list timestamp: time today, weekday this week, otherwise a short date. */
export function listTime(iso: string, now = new Date()): string {
  const d = parse(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diff <= 0) return clock(iso);
  if (diff === 1) return "Yesterday";
  if (diff < 7) return WEEKDAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Date separator label inside a thread. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = parse(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

export const dayKey = (iso: string) => {
  const d = parse(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function lastSeen(iso: string | null, now = new Date()): string {
  if (!iso) return "offline";
  const mins = Math.round((now.getTime() - parse(iso).getTime()) / 60000);
  if (mins < 1) return "last seen just now";
  if (mins < 60) return `last seen ${mins} min ago`;
  const diff = Math.round((startOfDay(now) - startOfDay(parse(iso))) / DAY);
  if (diff <= 0) return `last seen today at ${clock(iso)}`;
  if (diff === 1) return `last seen yesterday at ${clock(iso)}`;
  return `last seen ${MONTHS[parse(iso).getMonth()]} ${parse(iso).getDate()}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "?";
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : "";
  return (first + last).toUpperCase();
}

export function convTitle(c: Pick<ConversationListItem, "type" | "title" | "peer"> & { is_note_to_self?: boolean }): string {
  if (c.is_note_to_self) return "Note to Self";
  return c.type === "GROUP" ? c.title ?? "Group" : c.peer?.display_name ?? "Unknown";
}

export const isVoice = (a: { mime_type: string | null }) => !!a.mime_type?.startsWith("audio/");
/** Voice notes are uploaded as "voice-<seconds>s.<ext>"; that is where the duration comes from. */
export function voiceSeconds(name: string | null): number {
  const m = /voice-(\d+)s/.exec(name ?? "");
  return m ? Number(m[1]) : 0;
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function formatTimer(seconds: number): string {
  if (seconds <= 0) return "Off";
  const units: [number, string][] = [
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

export function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isMuted(muted_until: string | null, now = Date.now()): boolean {
  return !!muted_until && new Date(muted_until).getTime() > now;
}

export function nameOf(users: Map<string, User>, id: string | undefined, meId: string | undefined): string {
  if (!id) return "Someone";
  if (id === meId) return "You";
  return users.get(id)?.display_name ?? "Someone";
}

export function systemText(ev: SystemEvent, members: Member[], meId: string | undefined): string {
  const users = new Map(members.map((m) => [m.user.id, m.user] as const));
  const actor = nameOf(users, ev.actor, meId);
  const target = nameOf(users, ev.target, meId);
  switch (ev.kind) {
    case "group_created":
      return `${actor} created the group`;
    case "member_added":
      return `${actor} added ${target}`;
    case "member_removed":
      return `${actor} removed ${target}`;
    case "member_left":
      return `${target} left the group`;
    case "title_changed":
      return `${actor} changed the group name to “${ev.title}”`;
    case "disappearing_changed":
      return ev.seconds
        ? `${actor} set disappearing messages to ${formatTimer(ev.seconds)}`
        : `${actor} turned off disappearing messages`;
    case "call": {
      const kind = ev.video ? "video call" : "voice call";
      const mine = ev.actor === meId;
      if (ev.outcome === "completed") return `${ev.video ? "Video" : "Voice"} call · ${mmss(ev.duration ?? 0)}`;
      if (ev.outcome === "declined") return mine ? "Call declined" : `You declined a ${kind}`;
      return mine ? "No answer" : `Missed ${kind}`;
    }
    default:
      return "";
  }
}

/** One-line preview for the conversation list. */
export function previewText(item: ConversationListItem, meId: string | undefined, members?: Member[]): string {
  const m: LastMessage | null = item.last_message;
  if (!m) return item.type === "GROUP" ? "No messages yet" : "";
  if (m.type === "SYSTEM") return m.system_event ? systemText(m.system_event, members ?? [], meId) || "Group updated" : "";
  if (m.deleted_at) return m.sender_id === meId ? "You deleted this message" : "This message was deleted";
  const voice = m.attachments?.some(isVoice);
  const body = m.body?.trim() || (m.type === "IMAGE" ? "📷 Photo" : voice ? "🎤 Voice message" : m.type === "FILE" ? "📎 File" : "");
  if (m.sender_id === meId) return `You: ${body}`;
  if (item.type === "GROUP" && m.sender_name) return `${m.sender_name.split(" ")[0]}: ${body}`;
  return body;
}

export function messageSnippet(m: Message): string {
  if (m.deleted_at) return "Deleted message";
  return m.body?.trim() || (m.type === "IMAGE" ? "Photo" : m.attachments?.some(isVoice) ? "Voice message" : m.type === "FILE" ? "File" : "");
}

export function conversationOnline(c: Pick<ConversationDetail, "peer">, presence: Record<string, { online: boolean }>): boolean {
  if (!c.peer) return false;
  return presence[c.peer.id]?.online ?? !!c.peer.is_online;
}

/** Deterministic, non-cryptographic stand-in for Signal's safety number (demo only). */
export function mockSafetyNumber(a: string, b: string): string[] {
  const seed = [a, b].sort().join(":");
  const groups: string[] = [];
  let h = 2166136261;
  for (let g = 0; g < 12; g++) {
    let digits = "";
    for (let i = 0; i < 5; i++) {
      h = Math.imul(h ^ (seed.charCodeAt((g * 5 + i) % seed.length) + g + i), 16777619) >>> 0;
      digits += String(h % 10);
    }
    groups.push(digits);
  }
  return groups;
}
