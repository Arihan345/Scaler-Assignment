// Optimistic send: bubble appears immediately as "sending", is reconciled by client_message_id.
import type { QueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "./api";
import { keys, upsertMessage } from "./query";
import type { Message, OutboxItem } from "./types";
import { useUi } from "@/store/ui";

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export type PendingAttachment = { id: string; name: string; mime: string; url: string | null };

export function sendMessage(
  qc: QueryClient,
  convId: string,
  input: { body: string; replyTo: Message | null; attachments: PendingAttachment[]; mentions?: string[] },
) {
  const item: OutboxItem = {
    client_message_id: uuid(),
    conversation_id: convId,
    body: input.body,
    reply_to: input.replyTo,
    attachment_ids: input.attachments.map((a) => a.id),
    mentions: input.mentions ?? [],
    attachment_previews: input.attachments,
    status: "sending",
    created_at: new Date().toISOString(),
  };
  const ui = useUi.getState();
  ui.addOutbox(item);
  ui.setReplyTo(convId, null);
  void post(qc, item);
}

async function post(qc: QueryClient, item: OutboxItem) {
  const ui = useUi.getState();
  try {
    const msg = await api.post<Message>(`/conversations/${item.conversation_id}/messages`, {
      client_message_id: item.client_message_id,
      body: item.body,
      reply_to_id: item.reply_to?.id ?? null,
      attachment_ids: item.attachment_ids,
      mentions: item.mentions ?? [],
    });
    upsertMessage(qc, item.conversation_id, msg);
    ui.removeOutbox(item.conversation_id, item.client_message_id);
    qc.invalidateQueries({ queryKey: keys.conversationsAll });
  } catch (e) {
    ui.patchOutbox(item.conversation_id, item.client_message_id, { status: "failed", error: errorMessage(e) });
  }
}

/** Retry reuses the SAME client_message_id, so a message that actually landed is never duplicated. */
export function retrySend(qc: QueryClient, convId: string, clientId: string) {
  const ui = useUi.getState();
  const item = (ui.outbox[convId] ?? []).find((o) => o.client_message_id === clientId);
  if (!item) return;
  ui.patchOutbox(convId, clientId, { status: "sending", error: undefined });
  void post(qc, { ...item, status: "sending" });
}
