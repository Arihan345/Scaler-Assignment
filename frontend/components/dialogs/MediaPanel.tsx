"use client";
import { useQuery } from "@tanstack/react-query";
import { FileText, Link2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { clock, dayLabel, formatBytes, mmss, voiceSeconds } from "@/lib/format";
import { downloadAttachment, useAuthedMedia } from "@/lib/media";
import { keys } from "@/lib/query";
import type { MediaItem, MediaKind } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";

const TABS: { id: MediaKind; label: string }[] = [
  { id: "media", label: "Media" },
  { id: "files", label: "Files" },
  { id: "audio", label: "Audio" },
  { id: "links", label: "Links" },
];

function Thumb({ item, onOpen }: { item: MediaItem; onOpen: (url: string) => void }) {
  const { url } = useAuthedMedia(item.attachment!.id);
  return url ? <button className="media-thumb" onClick={() => onOpen(url)} aria-label="Open image"><img src={url} alt="" /></button> : <span className="media-thumb skeleton" />;
}

/** "All media": everything shared in this chat, grouped into Media / Files / Audio / Links. */
export function MediaPanel({ convId, onClose, onJump }: { convId: string; onClose: () => void; onJump: (m: { id: number; seq: number }) => void }) {
  const [tab, setTab] = useState<MediaKind>("media");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: keys.media(convId, tab),
    queryFn: async () => (await api.get<{ items: MediaItem[] }>(`/conversations/${convId}/media?kind=${tab}`)).items,
  });
  const go = (it: MediaItem) => { onJump({ id: it.message_id, seq: it.seq }); onClose(); };

  return (
    <Modal title="All media" variant="drawer" onClose={onClose}>
      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && <p className="muted">Nothing here yet.</p>}
      {tab === "media" && <div className="media-grid">{(data ?? []).map((it) => <Thumb key={it.attachment!.id} item={it} onOpen={setLightbox} />)}</div>}
      {tab === "files" && (data ?? []).map((it) => (
        <div className="media-row" key={it.attachment!.id}>
          <FileText size={26} />
          <button className="media-row__main" onClick={() => downloadAttachment(it.attachment!.id, it.attachment!.file_name ?? "file")}>
            <b>{it.attachment!.file_name}</b><small>{formatBytes(it.attachment!.size_bytes)} · {dayLabel(it.created_at)}</small>
          </button>
          <button className="btn btn--ghost" onClick={() => go(it)}>Show</button>
        </div>
      ))}
      {tab === "audio" && (data ?? []).map((it) => (
        <div className="media-row" key={it.attachment!.id}>
          <span style={{ fontSize: 22 }}>🎤</span>
          <div className="media-row__main"><b>Voice message {mmss(voiceSeconds(it.attachment!.file_name))}</b><small>{dayLabel(it.created_at)} · {clock(it.created_at)}</small></div>
          <button className="btn btn--ghost" onClick={() => go(it)}>Show</button>
        </div>
      ))}
      {tab === "links" && (data ?? []).map((it, i) => (
        <div className="media-row" key={`${it.message_id}-${i}`}>
          <Link2 size={24} />
          <a className="media-row__main" href={it.url} target="_blank" rel="noopener noreferrer nofollow"><b>{it.url}</b><small>{dayLabel(it.created_at)}</small></a>
          <button className="btn btn--ghost" onClick={() => go(it)}>Show</button>
        </div>
      ))}
      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview"><img src={lightbox} alt="" /></div>}
    </Modal>
  );
}
