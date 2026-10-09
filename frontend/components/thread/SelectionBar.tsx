"use client";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Forward, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { keys, markDeleted, removeMessages } from "@/lib/query";
import type { Message, MessagesPage } from "@/lib/types";
import { useUi } from "@/store/ui";
import { ForwardModal } from "@/components/dialogs/ForwardModal";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";

/** Replaces the composer while messages are being multi-selected. */
export function SelectionBar({ convId, meId }: { convId: string; meId: string }) {
  const qc = useQueryClient();
  const selection = useUi((s) => s.selection);
  const [forward, setForward] = useState<Message[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  if (!selection || selection.conv !== convId) return null;

  const all = qc.getQueryData<MessagesPage>(keys.messages(convId))?.messages ?? [];
  const chosen = all.filter((m) => selection.ids.includes(m.id)).sort((a, b) => a.seq - b.seq);
  const allMine = chosen.length > 0 && chosen.every((m) => m.sender_id === meId && !m.deleted_at);
  const clear = () => useUi.getState().clearSelection();

  async function deleteForMe() {
    const results = await Promise.allSettled(chosen.map((m) => api.post(`/messages/${m.id}/hide`)));
    removeMessages(qc, convId, chosen.filter((_, i) => results[i].status === "fulfilled").map((m) => m.id));
    qc.invalidateQueries({ queryKey: keys.conversationsAll });
    if (results.some((r) => r.status === "rejected")) useUi.getState().toast("Some messages couldn't be deleted", "error");
    clear();
  }

  async function deleteForEveryone() {
    const results = await Promise.allSettled(chosen.map((m) => api.del(`/messages/${m.id}`)));
    chosen.forEach((m, i) => results[i].status === "fulfilled" && markDeleted(qc, convId, m.id));
    qc.invalidateQueries({ queryKey: keys.conversationsAll });
    if (results.some((r) => r.status === "rejected")) useUi.getState().toast("Some messages couldn't be deleted", "error");
    setConfirmAll(false);
    clear();
  }

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected messages">
      <button className="icon-btn" aria-label="Cancel selection" onClick={clear}><X size={20} /></button>
      <b>{chosen.length} selected</b>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(chosen.filter((m) => m.body).map((m) => m.body).join("\n")); useUi.getState().toast("Copied", "success"); clear(); }}><Copy size={16} /> Copy</Button>
      <Button variant="ghost" onClick={() => setForward(chosen)}><Forward size={16} /> Forward</Button>
      <Button variant="ghost" onClick={deleteForMe}><Trash2 size={16} /> Delete for me</Button>
      {allMine && <Button variant="danger" onClick={() => setConfirmAll(true)}><Trash2 size={16} /> Delete for everyone</Button>}
      {forward && <ForwardModal messages={forward} onClose={() => { setForward(null); clear(); }} />}
      {confirmAll && (
        <ConfirmDialog title="Delete for everyone?" message={`${chosen.length} message(s) will be removed for everyone in the chat.`} confirmLabel="Delete for everyone" danger onConfirm={deleteForEveryone} onClose={() => setConfirmAll(false)} />
      )}
    </div>
  );
}
