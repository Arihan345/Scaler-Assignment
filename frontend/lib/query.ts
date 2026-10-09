// Query keys and the pure cache-mutation helpers used by both REST responses and WebSocket events.
import type { QueryClient } from "@tanstack/react-query";
import type { ConversationDetail, Message, MessagesPage, Reaction } from "./types";

export const keys = {
  conversations: (archived = false, requests = false) => ["conversations", { archived, requests }] as const,
  conversationsAll: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  messages: (id: string) => ["messages", id] as const,
  contacts: ["contacts"] as const,
  blocked: ["blocked"] as const,
  pinned: (id: string) => ["pinned", id] as const,
  media: (id: string, kind: string) => ["media", id, kind] as const,
  preview: (url: string) => ["link-preview", url] as const,
  search: (q: string) => ["user-search", q] as const,
  stories: ["stories"] as const,
  calls: ["calls"] as const,
  sessions: ["sessions"] as const,
  webhooks: ["webhooks"] as const,
  deliveries: (id: string) => ["webhook-deliveries", id] as const,
};

const bySeq = (a: Message, b: Message) => a.seq - b.seq;

/** Insert or replace a message. Matches on id OR (client_message_id + sender) so an optimistic
 *  message, the REST response and the WebSocket push can never produce a duplicate bubble. */
export function upsertMessage(qc: QueryClient, convId: string, msg: Message) {
  qc.setQueryData<MessagesPage>(keys.messages(convId), (old) => {
    if (!old) return old; // thread never opened: it will load fresh from the server
    const idx = old.messages.findIndex(
      (m) =>
        m.id === msg.id ||
        (!!msg.client_message_id && m.client_message_id === msg.client_message_id && m.sender_id === msg.sender_id),
    );
    if (idx >= 0) {
      const next = old.messages.slice();
      next[idx] = { ...next[idx], ...msg };
      return { ...old, messages: next };
    }
    if (old.has_more_after) return old; // viewing an older window; the gap is fetched on demand
    return { ...old, messages: [...old.messages, msg].sort(bySeq) };
  });
}

export function patchMessage(qc: QueryClient, convId: string, id: number, patch: Partial<Message>) {
  qc.setQueryData<MessagesPage>(keys.messages(convId), (old) =>
    old ? { ...old, messages: old.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : old,
  );
}

export function markDeleted(qc: QueryClient, convId: string, id: number) {
  patchMessage(qc, convId, id, {
    deleted_at: new Date().toISOString(),
    body: null,
    attachments: [],
    reactions: [],
  });
}

export function setReactions(qc: QueryClient, convId: string, id: number, reactions: Reaction[]) {
  patchMessage(qc, convId, id, { reactions });
}

export function removeMessages(qc: QueryClient, convId: string, ids: number[]) {
  const set = new Set(ids);
  qc.setQueryData<MessagesPage>(keys.messages(convId), (old) =>
    old ? { ...old, messages: old.messages.filter((m) => !set.has(m.id)) } : old,
  );
}

export function mergeOlder(qc: QueryClient, convId: string, page: MessagesPage) {
  qc.setQueryData<MessagesPage>(keys.messages(convId), (old) => {
    if (!old) return page;
    const seen = new Set(old.messages.map((m) => m.id));
    const merged = [...page.messages.filter((m) => !seen.has(m.id)), ...old.messages].sort(bySeq);
    return { ...old, messages: merged, has_more_before: page.has_more_before };
  });
}

export function mergeNewer(qc: QueryClient, convId: string, page: MessagesPage) {
  qc.setQueryData<MessagesPage>(keys.messages(convId), (old) => {
    if (!old) return page;
    const seen = new Set(old.messages.map((m) => m.id));
    const merged = [...old.messages, ...page.messages.filter((m) => !seen.has(m.id))].sort(bySeq);
    return { ...old, messages: merged, has_more_after: page.has_more_after };
  });
}

/** Update one member's cursors inside the cached conversation detail (drives the read/delivered ticks). */
export function applyReceipt(
  qc: QueryClient,
  convId: string,
  userId: string,
  delivered: number,
  read: number,
): boolean {
  let found = false;
  qc.setQueryData<ConversationDetail>(keys.conversation(convId), (old) => {
    if (!old) return old;
    found = true;
    return {
      ...old,
      members: old.members.map((m) =>
        m.user.id === userId
          ? {
              ...m,
              last_delivered_seq: Math.max(m.last_delivered_seq, delivered),
              last_read_seq: Math.max(m.last_read_seq, read),
            }
          : m,
      ),
    };
  });
  return found;
}
