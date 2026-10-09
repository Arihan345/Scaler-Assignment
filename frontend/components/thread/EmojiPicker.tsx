"use client";
import { Clock, Coffee, Flag, Hash, Lightbulb, PawPrint, Search, Smile, Trophy, Plane } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_EMOJI, EMOJI_CATEGORIES, STICKERS } from "@/lib/emojiData";

const RECENT_KEY = "signal.emoji.recent";
const ICONS: Record<string, React.ReactNode> = {
  recent: <Clock size={20} />, smileys: <Smile size={20} />, nature: <PawPrint size={20} />, food: <Coffee size={20} />,
  activity: <Trophy size={20} />, travel: <Plane size={20} />, objects: <Lightbulb size={20} />, symbols: <Hash size={20} />, flags: <Flag size={20} />,
};
type Tab = "emoji" | "stickers" | "gifs";

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; }
}
function pushRecent(e: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...loadRecent().filter((x) => x !== e)].slice(0, 24))); } catch { /* storage unavailable */ }
}

/** Signal-style picker: Emoji (search, categories, recents) / Stickers (sent as a big emoji) / GIFs (needs an online service). */
export function EmojiPicker({ onPick, onSticker, onClose }: { onPick: (e: string) => void; onSticker: (e: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("emoji");
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState("smileys");
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setRecent(loadRecent()), []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-emoji-toggle]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => (term ? ALL_EMOJI.filter((x) => x.q.includes(term)).map((x) => x.e) : []), [term]);

  function pick(e: string) {
    pushRecent(e);
    setRecent(loadRecent());
    onPick(e);
  }
  function jump(id: string) {
    setActive(id);
    scroller.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`)?.scrollIntoView({ block: "start" });
  }

  const grid = (list: string[]) => list.map((e) => <button key={e} className="emoji-btn" onClick={() => pick(e)} aria-label={e}>{e}</button>);

  return (
    <div className="emoji-panel" ref={root} role="dialog" aria-label="Emoji, stickers and GIFs">
      <div className="emoji-tabs" role="tablist">
        {(["emoji", "stickers", "gifs"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{t === "gifs" ? "GIFs" : t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {tab === "emoji" && (
        <>
          <label className="emoji-search"><Search size={18} /><input autoFocus placeholder="Search emoji" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search emoji" /></label>
          <div className="emoji-scroll" ref={scroller} onScroll={(e) => {
            if (term) return;
            const top = e.currentTarget.getBoundingClientRect().top;
            const cur = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-cat]")].filter((n) => n.getBoundingClientRect().top - top <= 8).pop();
            if (cur?.dataset.cat) setActive(cur.dataset.cat);
          }}>
            {term ? (
              results.length ? <div className="emoji-grid">{grid(results)}</div> : <p className="muted emoji-empty">No emoji found</p>
            ) : (
              <>
                {recent.length > 0 && <section data-cat="recent"><h4>Recent</h4><div className="emoji-grid">{grid(recent)}</div></section>}
                {EMOJI_CATEGORIES.map((c) => (
                  <section key={c.id} data-cat={c.id}><h4>{c.label}</h4><div className="emoji-grid">{grid(ALL_EMOJI.filter((x) => x.cat === c.id).map((x) => x.e))}</div></section>
                ))}
              </>
            )}
          </div>
          {!term && (
            <div className="emoji-cats">
              {[...(recent.length ? [{ id: "recent", label: "Recent" }] : []), ...EMOJI_CATEGORIES].map((c) => (
                <button key={c.id} className={active === c.id ? "is-on" : ""} aria-label={c.label} title={c.label} onClick={() => jump(c.id)}>{ICONS[c.id]}</button>
              ))}
            </div>
          )}
        </>
      )}
      {tab === "stickers" && (
        <div className="emoji-scroll"><div className="sticker-grid">{STICKERS.map((s) => <button key={s} className="sticker-btn" aria-label={`Send ${s} sticker`} onClick={() => onSticker(s)}>{s}</button>)}</div></div>
      )}
      {tab === "gifs" && (
        <div className="emoji-scroll emoji-empty-state"><b>GIFs need an online GIF service</b><span className="muted">This demo has no GIF provider connected, so search is unavailable.</span></div>
      )}
    </div>
  );
}
