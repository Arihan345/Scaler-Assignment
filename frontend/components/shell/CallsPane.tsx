"use client";
import { useQuery } from "@tanstack/react-query";
import { Link2, ListFilter, MoreHorizontal, PhoneCall, Search, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatTimer, listTime } from "@/lib/format";
import { keys } from "@/lib/query";
import type { CallEntry } from "@/lib/types";
import { useUi } from "@/store/ui";
import { startCall } from "@/lib/calls";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { NewChatModal } from "@/components/dialogs/NewChatModal";

function subtitle(c: CallEntry) {
  const missed = !c.outgoing && c.outcome !== "completed" && c.outcome !== "declined";
  const label = missed ? "Missed" : c.outgoing ? (c.outcome === "completed" ? "Outgoing" : "Unanswered") : c.outcome === "declined" ? "Declined" : "Incoming";
  return `${label} · ${listTime(c.created_at)}`;
}

/** Signal Desktop's Calls tab: call history built from the call entries logged in each chat. */
export function CallsPane() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [picker, setPicker] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: keys.calls, queryFn: () => api.get<CallEntry[]>("/calls"), refetchInterval: 20000 });

  const rows = useMemo(() => {
    let items = data ?? [];
    if (missedOnly) items = items.filter((c) => !c.outgoing && c.outcome !== "completed" && c.outcome !== "declined");
    const t = q.trim().toLowerCase();
    if (t) items = items.filter((c) => c.peer?.display_name.toLowerCase().includes(t));
    return items;
  }, [data, q, missedOnly]);

  if (picker) return <NewChatModal onClose={() => setPicker(false)} />;

  return (
    <>
      <div className="list-header">
        <h1>Calls</h1>
        <IconButton label="New call" onClick={() => setPicker(true)}><PhoneCall size={22} /></IconButton>
        <Menu trigger={<span className="icon-btn" role="button" aria-label="More options" tabIndex={0}><MoreHorizontal size={22} /></span>} items={[
          { label: "Settings", onClick: () => router.push("/settings/calls") },
        ]} />
      </div>
      <div className="search-row">
        <div className="search"><Search size={18} /><input type="search" placeholder={missedOnly ? "Search missed calls" : "Search"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" /></div>
        <button className={`icon-btn ${missedOnly ? "is-on" : ""}`} aria-label="Filter by missed" title="Filter by missed" onClick={() => setMissedOnly((v) => !v)}><ListFilter size={22} /></button>
      </div>
      <div className="list-scroll">
        {missedOnly && <div className="filter-note filter-note--bold">Filtered by missed</div>}
        <div className="conv-row" role="button" tabIndex={0} onClick={() => useUi.getState().toast("Call links aren't available in this demo.", "info")}>
          <span className="avatar avatar--icon"><Link2 size={22} /></span>
          <div className="conv-row__body"><div className="conv-row__title" style={{ fontWeight: 400 }}>Create a Call Link</div></div>
        </div>
        {isLoading ? null : rows.length === 0 ? (
          <div className="empty empty--center">
            <h3>{missedOnly ? "No missed calls" : q ? "No results" : "No calls"}</h3>
            <p>{missedOnly || q ? "" : "Recent calls will appear here."}</p>
            {(missedOnly || q) && <button className="btn btn--secondary" onClick={() => { setMissedOnly(false); setQ(""); }}>Clear filter</button>}
          </div>
        ) : rows.map((c) => {
          const missed = !c.outgoing && c.outcome !== "completed" && c.outcome !== "declined";
                    return (
            <div key={c.id} className="conv-row" role="button" tabIndex={0} onClick={() => router.push(`/c/${c.conversation_id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/c/${c.conversation_id}`)}>
              {c.peer && <Avatar id={c.peer.id} name={c.peer.display_name} src={c.peer.avatar_url} />}
              <div className="conv-row__body">
                <div className="conv-row__title" style={missed ? { color: "var(--danger)" } : undefined}>{c.peer?.display_name ?? "Unknown"}</div>
                <div className="conv-row__preview" style={missed ? { color: "var(--danger)" } : undefined}>{subtitle(c)}</div>
              </div>
              <button className="icon-btn" aria-label={c.video ? "Video call" : "Voice call"} onClick={(e) => { e.stopPropagation(); if (c.peer) void startCall(c.conversation_id, c.peer, c.video); }}>
                {c.video ? <Video size={20} /> : <PhoneCall size={20} />}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
