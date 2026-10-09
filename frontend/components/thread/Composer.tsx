"use client";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Paperclip, Plus, Send, Smile, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { PendingAttachment, sendMessage } from "@/lib/actions";
import { convTitle, messageSnippet } from "@/lib/format";
import { keys, patchMessage } from "@/lib/query";
import type { ConversationDetail, Message } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { useSocket } from "@/components/shell/SocketProvider";
import { IconButton } from "@/components/ui/Button";

const EMOJI = ["😀","😂","😊","😍","😘","😎","🤔","😢","😭","😡","👍","👎","🙏","👏","🎉","🔥","❤️","💯","✅","👀","🙌","😅","🤝","🥳"];
const draftKey = (id: string) => `signal.draft.${id}`;
function loadDraft(id: string): string {
  try { return localStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; }
}
function saveDraft(id: string, v: string) {
  try { if (v) localStorage.setItem(draftKey(id), v); else localStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ }
}
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain";

export function Composer({ convId, detail, canSend }: { convId: string; detail: ConversationDetail; canSend: boolean }) {
  const qc = useQueryClient();
  const { send } = useSocket();
  const meId = useAuth((s) => s.user!.id);
  const replyTo = useUi((s) => s.replyTo[convId] ?? null);
  const editing = useUi((s) => s.editing[convId] ?? null);
  const [text, setText] = useState(() => loadDraft(convId)); // unsent text survives reloads and switching chats
  const stashed = useRef("");
  const wasEditing = useRef<number | null>(null);
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [emoji, setEmoji] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const typingState = useRef<{ on: boolean; lastSent: number; timer?: ReturnType<typeof setTimeout> }>({ on: false, lastSent: 0 });

  const stopTyping = useCallback(() => {
    const t = typingState.current;
    if (t.timer) clearTimeout(t.timer);
    if (t.on) send({ event: "typing.stop", conversation_id: convId });
    t.on = false;
  }, [send, convId]);

  useEffect(() => () => stopTyping(), [stopTyping]);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);
  useEffect(() => { area.current?.focus(); }, [convId]);
  useEffect(() => {
    const el = area.current;
    if (editing && wasEditing.current !== editing.id) {
      stashed.current = text;
      setText(editing.body ?? "");
      el?.focus();
    } else if (!editing && wasEditing.current !== null) {
      setText(stashed.current);
    }
    wasEditing.current = editing?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);
  useEffect(() => {
    const el = area.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }
  }, [text]);

  function onChange(v: string) {
    setText(v);
    if (!editing) saveDraft(convId, v);
    const t = typingState.current;
    if (!v.trim()) return stopTyping();
    const now = Date.now();
    if (!t.on || now - t.lastSent > 3000) { send({ event: "typing.start", conversation_id: convId }); t.on = true; t.lastSent = now; }
    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(stopTyping, 2500);
  }

  async function upload(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      if (files.length + uploading >= 10) { useUi.getState().toast("You can attach up to 10 files", "error"); break; }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append("conversation_id", convId);
        form.append("file", file);
        const res = await api.upload<{ attachment_id: string; file_name: string; mime_type: string }>("/attachments", form);
        setFiles((f) => [...f, { id: res.attachment_id, name: res.file_name, mime: res.mime_type, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }]);
      } catch (e) {
        useUi.getState().toast(errorMessage(e), "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (picker.current) picker.current.value = "";
  }

  async function saveEdit() {
    const body = text.trim();
    if (!editing || !body) return;
    const target: Message = editing;
    useUi.getState().setEditing(convId, null);
    if (body === (target.body ?? "")) return;
    try {
      const upd = await api.patch<Message>(`/messages/${target.id}`, { body });
      patchMessage(qc, convId, target.id, { body: upd.body, edited_at: upd.edited_at });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  function submit() {
    if (editing) return void saveEdit();
    const body = text.trim();
    if ((!body && files.length === 0) || uploading > 0) return;
    stopTyping();
    sendMessage(qc, convId, { body, replyTo, attachments: files });
    setText("");
    saveDraft(convId, "");
    setFiles([]);
    setEmoji(false);
    if (area.current) area.current.style.height = "auto";
  }

  if (!canSend) return <div className="composer composer__notice">You can't send messages to this group because you're no longer a member.</div>;

  const replyAuthor = replyTo ? (replyTo.sender_id === meId ? "You" : detail.members.find((m) => m.user.id === replyTo.sender_id)?.user.display_name ?? convTitle(detail)) : "";
  return (
    <div className="composer" style={{ position: "relative" }}>
      {editing && (
        <div className="reply-bar">
          <div><b>Editing message</b><span>{editing.body}</span></div>
          <IconButton label="Cancel edit" onClick={() => useUi.getState().setEditing(convId, null)}><X size={16} /></IconButton>
        </div>
      )}
      {replyTo && !editing && (
        <div className="reply-bar">
          <div><b>Replying to {replyAuthor}</b><span>{messageSnippet(replyTo)}</span></div>
          <IconButton label="Cancel reply" onClick={() => useUi.getState().setReplyTo(convId, null)}><X size={16} /></IconButton>
        </div>
      )}
      {(files.length > 0 || uploading > 0) && (
        <div className="attach-preview">
          {files.map((f) => (
            <div key={f.id} className="attach-chip">
              {f.url ? <img src={f.url} alt="" /> : <Paperclip size={14} />}
              <span>{f.name}</span>
              <button aria-label={`Remove ${f.name}`} onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))}><X size={14} /></button>
            </div>
          ))}
          {uploading > 0 && <div className="attach-chip muted">Uploading…</div>}
        </div>
      )}
      {emoji && (
        <div className="emoji-pop" role="dialog" aria-label="Emoji">
          {EMOJI.map((e) => (
            <button key={e} onClick={() => { onChange(text + e); area.current?.focus(); }}>{e}</button>
          ))}
        </div>
      )}
      <div className="composer__row">
        <IconButton label="Emoji" onClick={() => setEmoji((v) => !v)}><Smile size={24} /></IconButton>
        <input ref={picker} type="file" hidden multiple accept={ACCEPT} onChange={(e) => upload(e.target.files)} />
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder="Message"
          aria-label="Message"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === "Escape") {
              if (editing) useUi.getState().setEditing(convId, null);
              else if (replyTo) useUi.getState().setReplyTo(convId, null);
            }
          }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void upload(e.clipboardData.files); } }}
        />
        {text.trim() || files.length > 0 || editing ? (
          <button className="composer__send" aria-label={editing ? "Save edit" : "Send"} disabled={uploading > 0} onClick={submit}>
            {editing ? <Check size={20} /> : <Send size={20} />}
          </button>
        ) : (
          <IconButton label="Attach file" onClick={() => picker.current?.click()}><Plus size={26} /></IconButton>
        )}
      </div>
    </div>
  );
}
