"use client";
import { AlertCircle, Check, CheckCheck, Clock, Copy, FileText, Forward, Info, MoreHorizontal, Pencil, Reply, Smile, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { clock, formatBytes } from "@/lib/format";
import { colorFor } from "@/lib/colors";
import { downloadAttachment, useAuthedMedia } from "@/lib/media";
import type { Attachment, DisplayStatus, Message, OutboxItem } from "@/lib/types";
import { MenuPopup, type MenuItem } from "@/components/ui/Menu";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type BubbleProps = {
  msg: Message;
  mine: boolean;
  senderName?: string;
  showSender: boolean;
  showAvatar: boolean;
  avatar?: React.ReactNode;
  gap: boolean;
  status: DisplayStatus;
  pending?: OutboxItem;
  meId: string;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onDelete: (m: Message) => void;
  onEdit: (m: Message) => void;
  onForward: (m: Message) => void;
  onInfo: (m: Message) => void;
  onRetry: (clientId: string) => void;
  onJump: (id: number) => void;
  onImage: (url: string) => void;
};

function StatusIcon({ status }: { status: DisplayStatus }) {
  switch (status) {
    case "sending": return <Clock size={12} aria-label="Sending" />;
    case "failed": return <AlertCircle size={12} aria-label="Failed" />;
    case "sent": return <Check size={13} aria-label="Sent" />;
    case "delivered": return <CheckCheck size={13} aria-label="Delivered" />;
    case "read": return <CheckCheck size={13} strokeWidth={3} aria-label="Read" />;
  }
}

function ImageAttachment({ att, onOpen }: { att: Attachment; onOpen: (url: string) => void }) {
  const { url, error } = useAuthedMedia(att.id);
  const w = att.width && att.height ? Math.min(320, att.width) : 240;
  const h = att.width && att.height ? Math.round((w * att.height) / att.width) : 180;
  if (error) return <div className="bubble__file muted">Couldn't load image</div>;
  if (!url) return <span className="skeleton" style={{ width: w, height: Math.min(h, 320), borderRadius: 14 }} />;
  return <img className="bubble__img" src={url} alt={att.file_name ?? "Image"} onClick={() => onOpen(url)} />;
}

export function MessageBubble(p: BubbleProps) {
  const { msg, mine, pending } = p;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [react, setReact] = useState(false);
  const deleted = !!msg.deleted_at;
  const images = msg.attachments.filter((a) => a.mime_type?.startsWith("image/"));
  const others = msg.attachments.filter((a) => !a.mime_type?.startsWith("image/"));
  const mediaOnly = !deleted && !msg.body && images.length > 0 && others.length === 0 && !msg.reply_to;

  const canEdit = mine && !pending && !deleted && !!msg.body && Date.now() - new Date(msg.created_at).getTime() < 3 * 3600_000;
  const items: MenuItem[] = [
    { label: "Reply", icon: <Reply size={16} />, onClick: () => p.onReply(msg) },
    { label: "Forward", icon: <Forward size={16} />, hidden: !msg.body, onClick: () => p.onForward(msg) },
    { label: "Copy text", icon: <Copy size={16} />, hidden: !msg.body, onClick: () => navigator.clipboard?.writeText(msg.body ?? "") },
    { label: "Edit", icon: <Pencil size={16} />, hidden: !canEdit, onClick: () => p.onEdit(msg) },
    { label: "Message info", icon: <Info size={16} />, hidden: !mine, onClick: () => p.onInfo(msg) },
    { label: "Delete", icon: <Trash2 size={16} />, danger: true, separatorBefore: true, onClick: () => p.onDelete(msg) },
  ];
  const canAct = !pending && !deleted;

  const actions = canAct && (
    <div className="msg-actions">
      <button className="icon-btn" aria-label="React" onClick={() => setReact((v) => !v)}><Smile size={16} /></button>
      <button className="icon-btn" aria-label="Reply" onClick={() => p.onReply(msg)}><Reply size={16} /></button>
      <button className="icon-btn" aria-label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom }); }}><MoreHorizontal size={16} /></button>
    </div>
  );

  return (
    <div id={`m-${msg.id}`} className={`msg-row msg-row--${mine ? "out" : "in"} ${p.gap ? "msg-row--gap" : ""}`} onContextMenu={(e) => { if (canAct) { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); } }}>
      {!mine && <div className="msg-row__avatar">{p.showAvatar && p.avatar}</div>}
      {actions}
      <div className={`bubble bubble--${mine ? "out" : "in"} ${mediaOnly ? "bubble--media" : ""}`} style={{ position: "relative" }}>
        {react && (
          <div className="emoji-pop" style={{ position: "absolute", bottom: "100%", [mine ? "right" : "left"]: 0, gridTemplateColumns: "repeat(6,auto)", whiteSpace: "normal" }}>
            {QUICK.map((e) => <button key={e} onClick={() => { setReact(false); p.onReact(msg, e); }}>{e}</button>)}
          </div>
        )}
        {p.showSender && !mine && p.senderName && <div className="bubble__sender" style={{ color: colorFor(msg.sender_id ?? "") }}>{p.senderName}</div>}
        {msg.reply_to && !deleted && (
          <button className="reply-quote" onClick={() => p.onJump(msg.reply_to!.id)}>
            <b>{msg.reply_to.sender_id === p.meId ? "You" : "Reply"}</b>
            <span>{msg.reply_to.deleted ? "Deleted message" : msg.reply_to.snippet}</span>
          </button>
        )}
        {deleted ? (
          <span className="bubble__deleted">{mine ? "You deleted this message" : "This message was deleted"}</span>
        ) : (
          <>
            {images.map((a) => <ImageAttachment key={a.id} att={a} onOpen={p.onImage} />)}
            {pending?.attachment_previews.filter((a) => a.url).map((a) => <img key={a.id} className="bubble__img" src={a.url!} alt="" />)}
            {others.map((a) => (
              <button key={a.id} className="bubble__file" onClick={() => downloadAttachment(a.id, a.file_name ?? "file")}>
                <FileText size={28} />
                <span><div>{a.file_name}</div><small>{formatBytes(a.size_bytes)}</small></span>
              </button>
            ))}
            {pending?.attachment_previews.filter((a) => !a.url).map((a) => <div key={a.id} className="bubble__file"><FileText size={28} />{a.name}</div>)}
            {msg.body && <span>{msg.body}</span>}
          </>
        )}
        {!deleted && msg.reactions.length > 0 && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button key={r.emoji} className={`reaction ${r.user_ids.includes(p.meId) ? "is-mine" : ""}`} onClick={() => p.onReact(msg, r.emoji)} title={`${r.count}`}>
                {r.emoji} {r.count > 1 ? r.count : ""}
              </button>
            ))}
          </div>
        )}
        <div className="bubble__meta">
          {msg.expires_at && !deleted && <Timer size={11} aria-label="Disappearing message" />}
          {msg.edited_at && !deleted && <span>Edited</span>}
          <span>{clock(msg.created_at)}</span>
          {mine && !deleted && <StatusIcon status={p.status} />}
        </div>
        {p.status === "failed" && pending && (
          <div className="bubble__failed" role="alert">
            Failed to send. <button style={{ textDecoration: "underline" }} onClick={() => p.onRetry(pending.client_message_id)}>Retry</button>
          </div>
        )}
      </div>
      {menu && <MenuPopup x={menu.x} y={menu.y} alignRight={mine} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}
