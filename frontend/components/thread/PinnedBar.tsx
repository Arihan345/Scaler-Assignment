"use client";
import { useQuery } from "@tanstack/react-query";
import { Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { messageSnippet } from "@/lib/format";
import { keys } from "@/lib/query";
import type { ConversationDetail, Message } from "@/lib/types";
import { useUi } from "@/store/ui";
import { useQueryClient } from "@tanstack/react-query";

/** Pinned messages banner above the timeline. Click to jump to the message; with several pins it cycles through them. */
export function PinnedBar({ detail, meId, onJump }: { detail: ConversationDetail; meId: string; onJump: (m: Message) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: keys.pinned(detail.id), queryFn: async () => (await api.get<{ messages: Message[] }>(`/conversations/${detail.id}/pinned`)).messages });
  const [i, setI] = useState(0);
  if (!data || data.length === 0) return null;
  const idx = i % data.length;
  const m = data[idx];
  const author = m.sender_id === meId ? "You" : detail.members.find((x) => x.user.id === m.sender_id)?.user.display_name.split(" ")[0] ?? "";

  async function unpin() {
    try {
      await api.del(`/messages/${m.id}/pin`);
      qc.invalidateQueries({ queryKey: keys.pinned(detail.id) });
      qc.invalidateQueries({ queryKey: keys.messages(detail.id) });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="pinned-bar">
      <Pin size={16} />
      <button className="pinned-bar__body" onClick={() => { onJump(m); setI(idx + 1); }} aria-label="Go to pinned message">
        <b>{data.length > 1 ? `Pinned message ${idx + 1} of ${data.length}` : "Pinned message"}</b>
        <span>{author ? `${author}: ` : ""}{messageSnippet(m)}</span>
      </button>
      <button className="icon-btn" aria-label="Unpin message" title="Unpin" onClick={unpin}><PinOff size={16} /></button>
    </div>
  );
}
