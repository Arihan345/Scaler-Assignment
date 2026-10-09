"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/query";
import { useUi } from "@/store/ui";

const COLORS = ["#2c6bed", "#8e44ad", "#d35400", "#16a085", "#c0392b", "#2c3e50"];

/** Full-screen story editor like Signal's: a portrait card with centred text (or a photo and caption). Visible for 24 hours. */
export function StoryComposer({ mode, onClose }: { mode: "text" | "photo"; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [ci, setCi] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { if (mode === "photo") input.current?.click(); }, [mode]);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function post() {
    setBusy(true);
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file);
        if (text.trim()) form.append("caption", text.trim());
        await api.upload("/stories/image", form);
      } else {
        await api.post("/stories", { body: text, bg: COLORS[ci] });
      }
      qc.invalidateQueries({ queryKey: keys.stories });
      useUi.getState().toast("Story posted for 24 hours", "success");
      onClose();
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  return (
    <div className="story-composer" role="dialog" aria-label="New story">
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); else if (!text) onClose(); }} />
      <div className="story-composer__card" style={file ? undefined : { background: COLORS[ci] }}>
        {preview && <img src={preview} alt="Story preview" />}
        <textarea autoFocus={!file} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder={file ? "Add a caption" : "Add text"} aria-label="Story text" />
      </div>
      <div className="story-composer__bar">
        <button className="btn btn--secondary" onClick={onClose}>Discard</button>
        {!file && <button className="story-composer__dot" style={{ background: COLORS[ci] }} aria-label="Change background colour" onClick={() => setCi((ci + 1) % COLORS.length)} />}
        <button className="btn btn--primary" disabled={busy || (!file && !text.trim())} onClick={post}>{busy ? "Posting…" : "Post"}</button>
      </div>
    </div>
  );
}
