"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { uuid } from "@/lib/actions";
import { api, errorMessage } from "@/lib/api";
import { convTitle } from "@/lib/format";
import { useConversationList } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { Message } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** Forwards the text of a message to one or more chats as a brand-new message from you. */
export function ForwardModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useConversationList(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const list = (data ?? []).filter((c) => convTitle(c).toLowerCase().includes(q.trim().toLowerCase()));

  async function send() {
    setBusy(true);
    const results = await Promise.allSettled(
      picked.map((id) => api.post(`/conversations/${id}/messages`, { client_message_id: uuid(), body: message.body })),
    );
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    qc.invalidateQueries({ queryKey: keys.conversationsAll });
    if (failed.length) useUi.getState().toast(`Couldn't forward to ${failed.length} chat(s): ${errorMessage(failed[0].reason)}`, "error");
    else useUi.getState().toast("Message forwarded", "success");
    onClose();
  }

  return (
    <Modal title="Forward to" onClose={onClose} footer={<Button variant="primary" disabled={picked.length === 0} loading={busy} onClick={send}>Forward{picked.length ? ` (${picked.length})` : ""}</Button>}>
      <div className="field" style={{ marginBottom: 8 }}><input autoFocus placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" /></div>
      <div className="card muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{message.body}</div>
      {isLoading && <p className="muted">Loading…</p>}
      {list.map((c) => (
        <label key={c.id} className="pick-row">
          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
          <Avatar id={c.peer?.id ?? c.id} name={convTitle(c)} src={c.type === "GROUP" ? c.avatar_url : c.peer?.avatar_url} size={36} />
          {convTitle(c)}
        </label>
      ))}
    </Modal>
  );
}
