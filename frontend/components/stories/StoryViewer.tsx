"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { API_URL, api, errorMessage } from "@/lib/api";
import { clock, dayLabel } from "@/lib/format";
import { keys } from "@/lib/query";
import type { Story, User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";

const DURATION_MS = 5000;

/** Fetch a story photo with the bearer token (an <img> can't send headers) and expose it as an object URL. */
function useStoryImage(id: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return setUrl(null);
    let alive = true;
    let obj: string | null = null;
    const token = useAuth.getState().token;
    fetch(`${API_URL}/api/stories/${id}/media`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { obj = URL.createObjectURL(b); if (alive) setUrl(obj); })
      .catch(() => alive && setUrl(null));
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [id, enabled]);
  return url;
}

type ViewRow = { user: User; viewed_at: string };

export function StoryViewer({ user, stories, mine, onClose }: { user: User; stories: Story[]; mine: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [i, setI] = useState(() => Math.max(0, stories.findIndex((s) => !s.viewed)));
  const [paused, setPaused] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [progress, setProgress] = useState(0);
  const story = stories[Math.min(i, stories.length - 1)];
  const img = useStoryImage(story.id, story.kind === "IMAGE");
  const startedAt = useRef(0);
  const elapsed = useRef(0);

  const views = useQuery({
    queryKey: ["story-views", story.id],
    queryFn: async () => (await api.get<{ views: ViewRow[] }>(`/stories/${story.id}/views`)).views,
    enabled: mine,
  });

  const next = () => (i < stories.length - 1 ? setI(i + 1) : onClose());
  const prev = () => setI(Math.max(0, i - 1));

  useEffect(() => {
    if (!mine) api.post(`/stories/${story.id}/view`).then(() => qc.invalidateQueries({ queryKey: keys.stories })).catch(() => {});
    elapsed.current = 0;
    setProgress(0);
  }, [story.id, mine, qc]);

  useEffect(() => {
    if (paused || showViews || (story.kind === "IMAGE" && !img)) return;
    startedAt.current = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const e = elapsed.current + (t - startedAt.current);
      setProgress(Math.min(1, e / DURATION_MS));
      if (e >= DURATION_MS) return next();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); elapsed.current += performance.now() - startedAt.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, showViews, story.id, img]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  async function remove() {
    try {
      await api.del(`/stories/${story.id}`);
      qc.invalidateQueries({ queryKey: keys.stories });
      useUi.getState().toast("Story deleted", "success");
      if (stories.length <= 1) onClose(); else setI(Math.max(0, i - 1));
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="story-viewer" role="dialog" aria-label={`${user.display_name}'s story`}>
      <div className="story-viewer__frame" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onMouseLeave={() => setPaused(false)}>
        <div className="story-progress">
          {stories.map((s, n) => <i key={s.id}><b style={{ width: n < i ? "100%" : n === i ? `${progress * 100}%` : "0%" }} /></i>)}
        </div>
        <div className="story-head">
          <span style={{ flex: 1 }} />
          {mine && <button className="icon-btn" aria-label="Delete story" onClick={remove}><Trash2 size={18} /></button>}
          <button className="icon-btn" aria-label="Close story" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="story-body" style={story.kind === "TEXT" ? { background: story.bg ?? "#2c6bed" } : undefined}>
          {story.kind === "IMAGE" && (img ? <img src={img} alt="Story" /> : <span className="muted">Loading…</span>)}
          {story.body && <p className={story.kind === "TEXT" ? "story-text" : "story-caption"}>{story.body}</p>}
        </div>
        <div className="story-who">
          <Avatar id={user.id} name={user.display_name} src={user.avatar_url} size={36} />
          <div><b>{mine ? "My Story" : user.display_name}</b><small>{dayLabel(story.created_at)} · {clock(story.created_at)}</small></div>
        </div>
        <button className="story-nav story-nav--prev" aria-label="Previous story" onClick={(e) => { e.stopPropagation(); prev(); }}><ChevronLeft size={26} /></button>
        <button className="story-nav story-nav--next" aria-label="Next story" onClick={(e) => { e.stopPropagation(); next(); }}><ChevronRight size={26} /></button>
        {mine && (
          <button className="story-views-btn" onClick={() => setShowViews((v) => !v)}><Eye size={16} /> {views.data?.length ?? 0} {views.data?.length === 1 ? "view" : "views"}</button>
        )}
        {mine && showViews && (
          <div className="story-views">
            {(views.data ?? []).length === 0 && <p className="muted">No views yet.</p>}
            {(views.data ?? []).map((v) => (
              <div className="member-row" key={v.user.id}>
                <Avatar id={v.user.id} name={v.user.display_name} src={v.user.avatar_url} size={32} />
                <div>{v.user.display_name}<small className="muted" style={{ display: "block" }}>{clock(v.viewed_at)}</small></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
