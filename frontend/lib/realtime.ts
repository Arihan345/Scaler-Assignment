// Applies one WebSocket envelope to the React Query cache + UI store.
// The socket never owns data: every event either patches the cache or invalidates it.
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { convTitle, isMuted } from "./format";
import { applyReceipt, keys, markDeleted, patchMessage, removeMessages, setReactions, upsertMessage } from "./query";
import type { ConversationListItem, Message, WsEnvelope } from "./types";
import { useUi } from "@/store/ui";

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
      break;
    }
    case "message.edited": {
      const m = ev.payload as Message;
      patchMessage(qc, m.conversation_id, m.id, { body: m.body, edited_at: m.edited_at });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      break;
    }
    case "message.deleted":
      if (conv) {
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
      if (conv) ui.setTyping(conv, ev.payload.user_id, true);
      break;
    case "typing.stop":
      if (conv) ui.setTyping(conv, ev.payload.user_id, false);
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
  const who = item ? convTitle(item) : "New message";
  const body = m.deleted_at ? "deleted a message" : m.body?.trim() || (m.type === "IMAGE" ? "📷 Photo" : "📎 File");
  ui.toast(`${who}: ${body}`, "info", { label: "Open", href: `/c/${m.conversation_id}` });
}
