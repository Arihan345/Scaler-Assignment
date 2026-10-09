"use client";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/query";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

const COLORS = ["#2c6bed", "#8e44ad", "#d35400", "#16a085", "#c0392b", "#2c3e50"];

/** New story: text on a coloured background, or a photo with an optional caption. Visible for 24 hours. */
export function StoryComposer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [bg, setBg] = useState(COLORS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : null;

  async function post() {
    setBusy(true);
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file);
        if (text.trim()) form.append("caption", text.trim());
        await api.upload("/stories/image", form);
      } else {
        await api.post("/stories", { body: text, bg });
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
    <Modal title="New story" onClose={onClose} footer={<Button variant="primary" loading={busy} disabled={!file && !text.trim()} onClick={post}>Post story</Button>}>
      <div className="story-compose" style={file ? undefined : { background: bg }}>
        {preview && <img src={preview} alt="Story preview" />}
        <textarea autoFocus maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder={file ? "Add a caption" : "Type a story"} aria-label="Story text" />
      </div>
      <div className="story-compose__tools">
        {!file && COLORS.map((c) => <button key={c} className={`swatch ${c === bg ? "is-on" : ""}`} style={{ background: c }} aria-label={`Background ${c}`} onClick={() => setBg(c)} />)}
        <span style={{ flex: 1 }} />
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? <Button variant="ghost" onClick={() => setFile(null)}>Remove photo</Button> : <Button variant="ghost" onClick={() => input.current?.click()}><ImagePlus size={16} /> Add photo</Button>}
      </div>
    </Modal>
  );
}
