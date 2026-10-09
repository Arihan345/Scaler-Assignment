"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { convTitle } from "@/lib/format";
import { keys } from "@/lib/query";
import type { ConversationDetail } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";

/** Shown instead of the composer for a message request: nothing is shared (no read receipts) until you accept. */
export function RequestBar({ detail }: { detail: ConversationDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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
    }
  }

  return (
    <div className="composer composer__notice request-bar" role="region" aria-label="Message request">
      <p>{convTitle(detail)} wants to chat with you. They won't see when you read their messages until you accept.</p>
      <div className="request-bar__actions">
        <Button variant="ghost" disabled={busy} onClick={() => resolve("delete", true)}>Block</Button>
        <Button variant="ghost" disabled={busy} onClick={() => resolve("delete")}>Delete</Button>
        <Button variant="primary" loading={busy} onClick={() => resolve("accept")}>Accept</Button>
      </div>
    </div>
  );
}
