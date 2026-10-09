"use client";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { clock, dayLabel } from "@/lib/format";
import type { ConversationDetail, Message } from "@/lib/types";
import { IconButton } from "@/components/ui/Button";

/** In-chat search: server-side match over messages you're allowed to see; picking one jumps to it in the thread. */
export function SearchPanel({ detail, meId, onPick, onClose }: { detail: ConversationDetail; meId: string; onPick: (m: Message) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["chat-search", detail.id, dq],
    queryFn: () => api.get<{ messages: Message[] }>(`/conversations/${detail.id}/search?q=${encodeURIComponent(dq)}`),
    enabled: dq.length >= 2,
  });
  const name = (id: string | null) => (id === meId ? "You" : detail.members.find((m) => m.user.id === id)?.user.display_name ?? "Someone");
  return (
    <div className="chat-search">
      <div className="chat-search__bar">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this chat" aria-label="Search in this chat" onKeyDown={(e) => e.key === "Escape" && onClose()} />
        <IconButton label="Close search" onClick={onClose}><X size={18} /></IconButton>
      </div>
      {dq.length >= 2 && (
        <div className="chat-search__results">
          {isFetching && <div className="muted" style={{ padding: 12 }}>Searching…</div>}
          {!isFetching && data && data.messages.length === 0 && <div className="muted" style={{ padding: 12 }}>No messages found.</div>}
          {(data?.messages ?? []).map((m) => (
            <button key={m.id} className="chat-search__item" onClick={() => onPick(m)}>
              <span><b>{name(m.sender_id)}</b> <span className="muted">{dayLabel(m.created_at)}, {clock(m.created_at)}</span></span>
              <span className="chat-search__snippet">{m.body}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
