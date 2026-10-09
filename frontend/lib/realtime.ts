import { useAuth } from "@/store/auth";
import { handleCallEvent } from "./calls";
// Applies one WebSocket envelope to the React Query cache + UI store.
// The socket never owns data: every event either patches the cache or invalidates it.
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { convTitle, isMuted } from "./format";
import { applyReceipt, keys, markDeleted, patchMessage, removeMessages, setReactions, upsertMessage } from "./query";
import type { ConversationListItem, Message, WsEnvelope } from "./types";
import { useUi } from "@/store/ui";
import { usePrefs } from "@/store/prefs";

// ---- delivered acks: debounced per conversation, highest seq wins ---------------------------
const pendingAcks = new Map<string, { seq: number; timer: ReturnType<typeof setTimeout> }>();

export function scheduleDelivered(convId: string, seq: number) {
  const cur = pendingAcks.get(convId);
  if (cur) {
    cur.seq = Math.max(cur.seq, seq);
    return;
  }
  const entry = { seq, timer: setTimeout(() => flush(convId), 300) };
  pendingAcks.set(convId, entry);
}

function flush(convId: string) {
  const entry = pendingAcks.get(convId);
  pendingAcks.delete(convId);
  if (!entry) return;
  api.post(`/conversations/${convId}/delivered`, { up_to_seq: entry.seq }).catch(() => {});
}

// ---- read acks: same debounce ------------------------------------------------------------
const pendingReads = new Map<string, { seq: number; timer: ReturnType<typeof setTimeout> }>();

export function scheduleRead(qc: QueryClient, convId: string, seq: number) {
  const cur = pendingReads.get(convId);
  if (cur) {
    cur.seq = Math.max(cur.seq, seq);
    return;
  }
  pendingReads.set(convId, {
    seq,
    timer: setTimeout(() => {
      const e = pendingReads.get(convId);
      pendingReads.delete(convId);
      if (!e) return;
      api
        .post(`/conversations/${convId}/read`, { up_to_seq: e.seq })
        .then(() => qc.invalidateQueries({ queryKey: keys.conversationsAll }))
        .catch(() => {});
    }, 300),
  });
}

type Ctx = { meId: string; navigate: (path: string) => void };

export function applyEvent(qc: QueryClient, ev: WsEnvelope, ctx: Ctx) {
  const ui = useUi.getState();
  const conv = ev.conversation_id;

  switch (ev.event) {
    case "message.new": {
      const m = ev.payload as Message;
      upsertMessage(qc, m.conversation_id, m);
      qc.invalidateQueries({ queryKey: keys.conversationsAll }); // preview, ordering, unread badge
      if (m.sender_id) ui.setTyping(m.conversation_id, m.sender_id, false);
      if (m.sender_id !== ctx.meId) {
        scheduleDelivered(m.conversation_id, m.seq);
        notify(qc, m, ctx);
      }
      if (m.type === "SYSTEM") qc.invalidateQueries({ queryKey: keys.conversation(m.conversation_id) });
      if (m.type === "SYSTEM" && m.system_event?.kind === "call") qc.invalidateQueries({ queryKey: keys.calls }); // Calls tab list and missed-call badge update instantly
      break;
    }
    case "message.edited": {
      const m = ev.payload as Message;
      patchMessage(qc, m.conversation_id, m.id, { body: m.body, edited_at: m.edited_at, pinned_at: m.pinned_at });
      qc.invalidateQueries({ queryKey: keys.pinned(m.conversation_id) }); // pin/unpin arrives as an edit event
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      break;
    }
    case "message.deleted":
      if (conv) {
        qc.invalidateQueries({ queryKey: keys.pinned(conv) });
        qc.invalidateQueries({ queryKey: ["media", conv] });
        markDeleted(qc, conv, ev.payload.message_id);
        qc.invalidateQueries({ queryKey: keys.conversationsAll });
      }
      break;
    case "message.expired":
      if (conv) {
        removeMessages(qc, conv, ev.payload.message_ids);
        qc.invalidateQueries({ queryKey: keys.conversationsAll });
      }
      break;
    case "receipt.updated":
      if (conv) {
        const p = ev.payload as { user_id: string; delivered_seq: number; read_seq: number };
        applyReceipt(qc, conv, p.user_id, p.delivered_seq, p.read_seq);
        if (p.user_id === ctx.meId) qc.invalidateQueries({ queryKey: keys.conversationsAll });
      }
      break;
    case "reaction.updated":
      if (conv) setReactions(qc, conv, ev.payload.message_id, ev.payload.reactions);
      break;
    case "conversation.updated":
    case "member.added":
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      if (conv) qc.invalidateQueries({ queryKey: keys.conversation(conv) });
      break;
    case "member.removed":
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      if (conv) {
        qc.invalidateQueries({ queryKey: keys.conversation(conv) });
        if (ev.payload.user_id === ctx.meId) {
          ui.toast("You are no longer in a group");
          if (ui.openConversationId === conv) ctx.navigate("/");
        }
      }
      break;
    case "presence.updated":
      ui.setPresence(ev.payload.user_id, ev.payload.online, ev.payload.last_seen_at);
      break;
    case "typing.start":
      if (conv && useAuth.getState().user?.privacy?.typing_indicators !== false) ui.setTyping(conv, ev.payload.user_id, true); // reciprocal: typing off => I don't see others'
      break;
    case "typing.stop":
      if (conv) ui.setTyping(conv, ev.payload.user_id, false);
      break;
    case "call.incoming":
    case "call.ringing":
    case "call.accepted":
    case "call.signal":
    case "call.ended":
      void handleCallEvent(ev.event, ev.payload, conv ?? null);
      break;
    default:
      break;
  }
}

function notify(qc: QueryClient, m: Message, ctx: Ctx) {
  const ui = useUi.getState();
  if (m.type === "SYSTEM") return;
  const viewing = ui.openConversationId === m.conversation_id && document.visibilityState === "visible";
  if (viewing) return;
  const list = (qc.getQueryData(keys.conversations(false)) as ConversationListItem[] | undefined) ?? [];
  const item = list.find((c) => c.id === m.conversation_id);
  if (item && isMuted(item.muted_until)) return;
  const prefs = usePrefs.getState();
  if (prefs.sounds) beep();
  const who0 = item ? convTitle(item) : "New message";
  if (prefs.desktopNotify && document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
    // OS-level notification for a tab that's in the background (works while the app is open; not a closed-browser web push)
    const text = !prefs.notifyContent ? "New message" : m.body?.trim() || (m.type === "IMAGE" ? "📷 Photo" : "📎 Attachment");
    try {
      const n = new Notification(who0, { body: text, tag: `conv-${m.conversation_id}`, icon: "/favicon.ico" });
      n.onclick = () => { window.focus(); window.location.assign(`/c/${m.conversation_id}`); n.close(); };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
  if (!prefs.notifyToasts) return;
  const who = item ? convTitle(item) : "New message";
  const mentioned = (m.mentions ?? []).includes(ctx.meId);
  const voice = m.attachments?.some((a) => a.mime_type?.startsWith("audio/"));
  const body = !prefs.notifyContent
    ? "New message"
    : m.deleted_at ? "deleted a message" : m.body?.trim() || (m.type === "IMAGE" ? "📷 Photo" : voice ? "🎤 Voice message" : "📎 File");
  ui.toast(`${who}: ${mentioned && prefs.notifyContent ? "(mentioned you) " : ""}${body}`, "info", { label: "Open", href: `/c/${m.conversation_id}` });
}

/** Short two-tone chime via WebAudio (no audio asset to ship). Browsers may block it until the user has interacted. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.22);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* audio unavailable */ }
}
