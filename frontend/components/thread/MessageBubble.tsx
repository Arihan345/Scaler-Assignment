"use client";
import { jumboEmojiCount } from "@/lib/emojiData";
import { EmojiPicker } from "./EmojiPicker";
import { Plus, CheckSquare, Copy, FileText, Forward, Info, MoreHorizontal, Pencil, Pin, PinOff, Reply, HeartPlus, Timer, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { shortAgo, formatBytes, isVoice } from "@/lib/format";
import { usePrefs } from "@/store/prefs";
import { colorFor } from "@/lib/colors";
import { downloadAttachment, useAuthedMedia } from "@/lib/media";
import type { Attachment, DisplayStatus, Message, OutboxItem } from "@/lib/types";
import { MenuPopup, type MenuItem } from "@/components/ui/Menu";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { AudioPlayer } from "./AudioPlayer";
import { LinkCard } from "./LinkCard";
import { RichText, firstUrl } from "./RichText";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type BubbleProps = {
  msg: Message;
  mine: boolean;
  senderName?: string;
  showSender: boolean;
  showAvatar: boolean;
  last?: boolean;
  inGroup?: boolean;
  avatar?: React.ReactNode;
  gap: boolean;
  status: DisplayStatus;
  pending?: OutboxItem;
  meId: string;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onDelete: (m: Message, scope: "me" | "all") => void;
  onEdit: (m: Message) => void;
  onForward: (m: Message) => void;
  onInfo: (m: Message) => void;
  onRetry: (clientId: string) => void;
  onJump: (id: number) => void;
  onImage: (url: string) => void;
  onPin: (m: Message) => void;
  onSelect: (m: Message) => void;
  mentionNames: string[];
  selecting: boolean;
  selected: boolean;
};

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
  const [askDelete, setAskDelete] = useState(false);
  const [react, setReact] = useState(false);
  const [fullReact, setFullReact] = useState(false);
  const deleted = !!msg.deleted_at;
  const images = msg.attachments.filter((a) => a.mime_type?.startsWith("image/"));
  const voices = msg.attachments.filter(isVoice);
  const others = msg.attachments.filter((a) => !a.mime_type?.startsWith("image/") && !isVoice(a));
  const linkPreviews = usePrefs((s) => s.linkPreviews);
  const url = !deleted && linkPreviews ? firstUrl(msg.body) : null;
  const jumbo = !deleted && !msg.reply_to && msg.attachments.length === 0 ? jumboEmojiCount(msg.body) : 0;
  const mediaOnly = !deleted && !msg.body && images.length > 0 && others.length === 0 && !msg.reply_to;

  const canEdit = mine && !pending && !deleted && !!msg.body && Date.now() - new Date(msg.created_at).getTime() < 3 * 3600_000;
  const items: MenuItem[] = [
    { label: "Forward", icon: <Forward size={16} />, hidden: !msg.body && msg.attachments.length === 0, onClick: () => p.onForward(msg) },
    { label: "Edit", icon: <Pencil size={16} />, hidden: !canEdit, onClick: () => p.onEdit(msg) },
    { label: "Select", icon: <CheckSquare size={16} />, onClick: () => p.onSelect(msg) },
    { label: "Copy text", icon: <Copy size={16} />, hidden: !msg.body, onClick: () => navigator.clipboard?.writeText(msg.body ?? "") },
    { label: msg.pinned_at ? "Unpin" : "Pin", icon: msg.pinned_at ? <PinOff size={16} /> : <Pin size={16} />, onClick: () => p.onPin(msg) },
    { label: "Info", icon: <Info size={16} />, hidden: !mine, onClick: () => p.onInfo(msg) },
    { label: "Delete", icon: <Trash2 size={16} />, onClick: () => setAskDelete(true) },
  ];
  const canAct = !pending && !deleted;
  // Like Signal, only the last message of a run shows its time and ticks (unless it is still sending or failed).
  const showMeta = p.last !== false || p.status === "failed" || p.status === "sending" || !!msg.edited_at;

  // Signal mirrors the order: [more, reply, react] left of my bubbles, [react, reply, more] right of theirs.
  const btn: Record<string, React.ReactNode> = {
    more: <button key="more" className="icon-btn" aria-label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom }); }}><MoreHorizontal size={18} /></button>,
    reply: <button key="reply" className="icon-btn" aria-label="Reply" onClick={() => p.onReply(msg)}><Reply size={18} /></button>,
    react: <button key="react" className="icon-btn" aria-label="React" onClick={() => setReact((v) => !v)}><HeartPlus size={18} /></button>,
  };
  const actions = canAct && !p.selecting && (
    <div className="msg-actions">
      {(mine ? ["more", "reply", "react"] : ["react", "reply", "more"]).map((k) => btn[k])}
    </div>
  );

  return (
    <div id={`m-${msg.id}`} className={`msg-row msg-row--${mine ? "out" : "in"} ${p.gap ? "msg-row--gap" : ""} ${p.selecting ? "is-selecting" : ""} ${p.selected ? "is-selected" : ""}`}
      onClick={p.selecting ? () => p.onSelect(msg) : undefined}
      onContextMenu={(e) => { if (canAct && !p.selecting) { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); } }}>
      {p.selecting && <span className={`select-box ${p.selected ? "is-on" : ""}`} aria-hidden="true">{p.selected ? "✓" : ""}</span>}
      {!mine && p.inGroup && <div className="msg-row__avatar">{p.showAvatar && p.avatar}</div>}
      {actions}
      <div className={`bubble bubble--${mine ? "out" : "in"} ${mediaOnly ? "bubble--media" : ""} ${jumbo ? `bubble--jumbo bubble--jumbo-${jumbo}` : ""} ${deleted ? "bubble--deleted" : ""} ${!deleted && msg.reactions.length ? "bubble--reacted" : ""}`} style={{ position: "relative" }}>
        {react && (
          <div className={`react-picker react-picker--${mine ? "out" : "in"}`}>
            {QUICK.map((e) => <button key={e} onClick={() => { setReact(false); p.onReact(msg, e); }}>{e}</button>)}
            <button aria-label="More emoji" onClick={() => { setReact(false); setFullReact(true); }}><Plus size={20} /></button>
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
          <span className="bubble__deleted"><XCircle size={16} />{mine ? "You deleted this message" : "This message was deleted"}</span>
        ) : (
          <>
            {images.map((a) => <ImageAttachment key={a.id} att={a} onOpen={p.onImage} />)}
            {pending?.attachment_previews.filter((a) => a.url).map((a) => <img key={a.id} className="bubble__img" src={a.url!} alt="" />)}
            {voices.map((a) => <AudioPlayer key={a.id} att={a} />)}
            {others.map((a) => (
              <button key={a.id} className="bubble__file" onClick={() => downloadAttachment(a.id, a.file_name ?? "file")}>
                <FileText size={28} />
                <span><div>{a.file_name}</div><small>{formatBytes(a.size_bytes)}</small></span>
              </button>
            ))}
            {pending?.attachment_previews.filter((a) => !a.url).map((a) => <div key={a.id} className="bubble__file"><FileText size={28} />{a.name}</div>)}
            {msg.body && <RichText body={msg.body} mentionNames={p.mentionNames} />}
            {url && <LinkCard url={url} />}
          </>
        )}
        <div className="bubble__meta">
          {msg.pinned_at && !deleted && <Pin size={11} aria-label="Pinned" />}
          {msg.expires_at && !deleted && <Timer size={12} aria-label="Disappearing message" />}
          {msg.edited_at && !deleted && <span>Edited</span>}
          {showMeta && <span>{shortAgo(msg.created_at)}</span>}
          {mine && !deleted && showMeta && <StatusIcon status={p.status} size={16} />}
        </div>
        {!deleted && msg.reactions.length > 0 && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button key={r.emoji} className={`reaction ${r.user_ids.includes(p.meId) ? "is-mine" : ""}`} onClick={() => p.onReact(msg, r.emoji)} title={`${r.count}`}>
                {r.emoji} {r.count > 1 ? r.count : ""}
              </button>
            ))}
          </div>
        )}
        {p.status === "failed" && pending && (
          <div className="bubble__failed" role="alert">
            Failed to send. <button style={{ textDecoration: "underline" }} onClick={() => p.onRetry(pending.client_message_id)}>Retry</button>
          </div>
        )}
      </div>
      {fullReact && <EmojiPicker onClose={() => setFullReact(false)} onPick={(e) => { setFullReact(false); p.onReact(msg, e); }} onSticker={() => {}} />}
      {menu && <MenuPopup x={menu.x} y={menu.y} alignRight={mine} items={items} onClose={() => setMenu(null)} />}
      {askDelete && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAskDelete(false)}>
          <div className="dialog-card" role="alertdialog" aria-label="Delete selected message?">
            <h2>Delete selected message?</h2>
            <p>{mine ? "You can delete this message just for you, or for everyone in the chat." : "This message will be deleted from this device only. Other people in the chat will still see it."}</p>
            <div className="dialog-card__actions">
              <button className="btn btn--secondary" autoFocus onClick={() => setAskDelete(false)}>Cancel</button>
              <button className="btn btn--secondary is-danger" onClick={() => { setAskDelete(false); p.onDelete(msg, "me"); }}>Delete for me</button>
              {mine && <button className="btn btn--secondary is-danger" onClick={() => { setAskDelete(false); p.onDelete(msg, "all"); }}>Delete for everyone</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
