"use client";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mmss, voiceSeconds } from "@/lib/format";
import { useAuthedMedia } from "@/lib/media";
import type { Attachment } from "@/lib/types";

/** Voice-note player: the file is fetched with auth as a blob (an <audio src> can't send a bearer token). */
export function AudioPlayer({ att }: { att: Attachment }) {
  const { url, error } = useAuthedMedia(att.id);
  const audio = useRef<HTMLAudioElement>(null);
  const total = voiceSeconds(att.file_name);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const tick = () => setPos(a.currentTime);
    const end = () => { setPlaying(false); setPos(0); };
    a.addEventListener("timeupdate", tick);
    a.addEventListener("ended", end);
    return () => { a.removeEventListener("timeupdate", tick); a.removeEventListener("ended", end); };
  }, [url]);

  if (error) return <div className="voice voice--error">Couldn't load voice message</div>;
  const pct = total ? Math.min(100, (pos / total) * 100) : 0;
  return (
    <div className="voice">
      <button className="voice__btn" disabled={!url} aria-label={playing ? "Pause voice message" : "Play voice message"} onClick={() => {
        const a = audio.current;
        if (!a) return;
        if (playing) { a.pause(); setPlaying(false); } else { void a.play(); setPlaying(true); }
      }}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="voice__bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      <span className="voice__time">{mmss(playing || pos ? pos : total)}</span>
      {url && <audio ref={audio} src={url} preload="metadata" />}
    </div>
  );
}
