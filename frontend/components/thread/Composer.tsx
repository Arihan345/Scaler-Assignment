"use client";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Mic, Paperclip, Plus, Send, Smile, Trash2, UserCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { PendingAttachment, sendMessage } from "@/lib/actions";
import { convTitle, messageSnippet } from "@/lib/format";
import { keys, patchMessage } from "@/lib/query";
import type { ConversationDetail, Message } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { usePrefs } from "@/store/prefs";
import { mmss } from "@/lib/format";
import { useSocket } from "@/components/shell/SocketProvider";
import { IconButton } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";

const EMOJI = ["😀","😂","😊","😍","😘","😎","🤔","😢","😭","😡","👍","👎","🙏","👏","🎉","🔥","❤️","💯","✅","👀","🙌","😅","🤝","🥳"];
const draftKey = (id: string) => `signal.draft.${id}`;
function loadDraft(id: string): string {
  try { return localStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; }
}
function saveDraft(id: string, v: string) {
  try { if (v) localStorage.setItem(draftKey(id), v); else localStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ }
}
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav";
const MAX_VOICE_S = 300;

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
  const sendWithEnter = usePrefs((s) => s.sendWithEnter);
  // @mentions (groups): the picker opens while typing "@name"; ids are remembered so the server knows who was mentioned.
  const mentioned = useRef(new Map<string, string>()); // user id -> display name
  const [mention, setMention] = useState<{ q: string; idx: number } | null>(null);
  const candidates = useMemo(() => {
    if (!mention || detail.type !== "GROUP") return [];
    const q = mention.q.toLowerCase();
    return detail.members.filter((m) => m.is_active && !m.user.is_bot && m.user.id !== meId && m.user.display_name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, detail.members, detail.type, meId]);
  // voice notes
  const rec = useRef<{ recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream; started: number; cancel: boolean } | null>(null);
  const [recording, setRecording] = useState<number | null>(null); // elapsed seconds while recording
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

  function detectMention(v: string, cursor: number) {
    if (detail.type !== "GROUP") return setMention(null);
    const m = /(?:^|\s)@([^\s@]{0,20})$/.exec(v.slice(0, cursor));
    setMention(m ? { q: m[1], idx: 0 } : null);
  }

  function pickMention(userId: string, name: string) {
    const el = area.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@[^\s@]{0,20}$/, `@${name} `);
    const next = before + text.slice(cursor);
    mentioned.current.set(userId, name);
    setMention(null);
    setText(next);
    saveDraft(convId, next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  }

  function onChange(v: string, cursor?: number) {
    detectMention(v, cursor ?? v.length);
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

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const state = { recorder, chunks: [] as Blob[], stream, started: Date.now(), cancel: false };
      recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        rec.current = null;
        if (!state.cancel && state.chunks.length) void uploadVoice(new Blob(state.chunks, { type: recorder.mimeType || "audio/webm" }), Math.max(1, Math.round((Date.now() - state.started) / 1000)));
      };
      rec.current = state;
      recorder.start();
      setRecording(0);
    } catch {
      useUi.getState().toast("Microphone access was denied", "error");
    }
  }

  const stopRecording = (cancel: boolean) => {
    const r = rec.current;
    if (!r) return;
    r.cancel = cancel;
    if (r.recorder.state !== "inactive") r.recorder.stop();
  };

  useEffect(() => {
    if (recording === null) return;
    const t = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const s = Math.round((Date.now() - r.started) / 1000);
      setRecording(s);
      if (s >= MAX_VOICE_S) stopRecording(false);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording === null]);
  useEffect(() => () => { if (rec.current) { rec.current.cancel = true; if (rec.current.recorder.state !== "inactive") rec.current.recorder.stop(); } }, []);

  async function uploadVoice(blob: Blob, seconds: number) {
    const base = (blob.type || "audio/webm").split(";")[0];
    const ext = base.includes("ogg") ? "ogg" : base.includes("mp4") ? "m4a" : "webm";
    const form = new FormData();
    form.append("conversation_id", convId);
    form.append("file", new File([blob], `voice-${seconds}s.${ext}`, { type: base }));
    try {
      const res = await api.upload<{ attachment_id: string; file_name: string; mime_type: string }>("/attachments", form);
      sendMessage(qc, convId, { body: "", replyTo: null, attachments: [{ id: res.attachment_id, name: res.file_name, mime: res.mime_type, url: null }] });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
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
    const mentions = [...mentioned.current].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
    mentioned.current.clear();
    setMention(null);
    sendMessage(qc, convId, { body, replyTo, attachments: files, mentions });
    setText("");
    saveDraft(convId, "");
    setFiles([]);
    setEmoji(false);
    if (area.current) area.current.style.height = "auto";
  }

  if (detail.blocked && detail.peer) {
    return (
      <div className="composer composer__notice">
        You blocked {detail.peer.display_name}.{" "}
        <button className="btn btn--ghost" onClick={async () => {
          try {
            await api.del(`/blocks/${detail.peer!.id}`);
            qc.invalidateQueries({ queryKey: keys.conversation(convId) });
            qc.invalidateQueries({ queryKey: keys.conversationsAll });
            qc.invalidateQueries({ queryKey: keys.blocked });
          } catch (e) { useUi.getState().toast(errorMessage(e), "error"); }
        }}><UserCheck size={16} /> Unblock</button>
      </div>
    );
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
      {mention && candidates.length > 0 && (
        <div className="mention-pop" role="listbox" aria-label="Mention someone">
          {candidates.map((c, i) => (
            <button key={c.user.id} role="option" aria-selected={i === mention.idx % candidates.length} className={i === mention.idx % candidates.length ? "is-on" : ""} onMouseDown={(e) => { e.preventDefault(); pickMention(c.user.id, c.user.display_name); }}>
              <Avatar id={c.user.id} name={c.user.display_name} src={c.user.avatar_url} size={28} /> {c.user.display_name}
            </button>
          ))}
        </div>
      )}
      {recording !== null ? (
        <div className="composer__row recording-bar" role="status" aria-label="Recording voice message">
          <IconButton label="Cancel recording" onClick={() => stopRecording(true)}><Trash2 size={22} /></IconButton>
          <span className="rec-dot" /> <b>{mmss(recording)}</b>
          <span className="muted" style={{ flex: 1 }}>Recording… (max {mmss(MAX_VOICE_S)})</span>
          <button className="composer__send" aria-label="Send voice message" onClick={() => stopRecording(false)}><Send size={20} /></button>
        </div>
      ) : (
      <div className="composer__row">
        <IconButton label="Emoji" onClick={() => setEmoji((v) => !v)}><Smile size={24} /></IconButton>
        <input ref={picker} type="file" hidden multiple accept={ACCEPT} onChange={(e) => upload(e.target.files)} />
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder="Message"
          aria-label="Message"
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? undefined)}
          onKeyDown={(e) => {
            if (mention && candidates.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = candidates.length;
                setMention({ ...mention, idx: (mention.idx + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const c = candidates[mention.idx % candidates.length]; pickMention(c.user.id, c.user.display_name); return; }
              if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
            }
            const wantsSend = e.key === "Enter" && !e.nativeEvent.isComposing && (sendWithEnter ? !e.shiftKey : e.ctrlKey || e.metaKey);
            if (wantsSend) { e.preventDefault(); submit(); }
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
          <>
            {canRecord && <IconButton label="Record voice message" onClick={startRecording}><Mic size={24} /></IconButton>}
            <IconButton label="Attach file" onClick={() => picker.current?.click()}><Plus size={26} /></IconButton>
          </>
        )}
      </div>
      )}
    </div>
  );
}
