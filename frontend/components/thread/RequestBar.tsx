"use client";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { convTitle } from "@/lib/format";
import { keys } from "@/lib/query";
import type { ConversationDetail } from "@/lib/types";
import { useUi } from "@/store/ui";
import { ConfirmDialog } from "@/components/ui/Modal";

/** Shown instead of the composer for a message request: nothing is shared (no read receipts) until you accept. */
export function RequestBar({ detail }: { detail: ConversationDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | "accept" | "report">(null);
  const name = convTitle(detail);

  async function resolve(action: "accept" | "delete", block = false) {
    setBusy(true);
    try {
      if (block && detail.peer) await api.post(`/blocks/${detail.peer.id}`);
      await api.post(`/conversations/${detail.id}/request/${action}`);
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      qc.invalidateQueries({ queryKey: keys.conversation(detail.id) });
      qc.invalidateQueries({ queryKey: keys.blocked });
      if (action === "delete") router.push("/");
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  return (
    <div className="request-bar" role="region" aria-label="Message request">
      <div className="request-bar__warn"><AlertTriangle size={15} /> Review requests carefully</div>
      <p>Let <b>{name}</b> message you and share your name and photo with them? They won't know you've seen their messages until you accept.</p>
      <div className="request-bar__actions">
        <button className="pill-btn pill-btn--danger" disabled={busy} onClick={() => resolve("delete", true)}>Block</button>
        <button className="pill-btn pill-btn--danger" disabled={busy} onClick={() => setAsk("report")}>Report…</button>
        <button className="pill-btn pill-btn--primary" disabled={busy} onClick={() => setAsk("accept")}>Accept</button>
      </div>
      {ask === "accept" && (
        <ConfirmDialog title="Accept request?" message="Only accept requests from people you trust. Signal will never message you for a registration code, PIN, or recovery key." confirmLabel="Accept"
          onClose={() => setAsk(null)} onConfirm={() => resolve("accept")} />
      )}
      {ask === "report" && (
        <ConfirmDialog title="Report spam and block?" message={`${name} will be blocked and this request removed. (In this demo nothing is sent to Signal.)`} confirmLabel="Report" danger
          onClose={() => setAsk(null)} onConfirm={() => resolve("delete", true)} />
      )}
    </div>
  );
}
