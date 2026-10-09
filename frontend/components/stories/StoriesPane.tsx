"use client";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Plus, Search, Type } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { listTime } from "@/lib/format";
import { keys } from "@/lib/query";
import type { Story, StoryFeed, User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { StoryComposer } from "./StoryComposer";
import { StoryViewer } from "./StoryViewer";

type Open = { user: User; stories: Story[]; mine: boolean } | null;

/** Small square preview on the right of a row: the story's colour and first words, or a photo glyph. */
function Thumb({ s }: { s: Story }) {
  if (s.kind === "IMAGE") return <span className="story-thumb story-thumb--img"><ImageIcon size={18} /></span>;
  return <span className="story-thumb" style={{ background: s.bg ?? "#2c6bed" }}>{(s.body ?? "").slice(0, 14)}</span>;
}

/** Left pane of the Stories tab, laid out like Signal Desktop: My Story on top, then everyone's, unviewed first. */
export function StoriesPane() {
  const me = useAuth((s) => s.user)!;
  const { data, isLoading } = useQuery({ queryKey: keys.stories, queryFn: () => api.get<StoryFeed>("/stories"), refetchInterval: 30000 });
  const [compose, setCompose] = useState<"text" | "photo" | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [q, setQ] = useState("");
  const mine = data?.mine ?? [];
  const others = useMemo(() => (data?.others ?? []).filter((g) => g.user.display_name.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  const openMine = () => (mine.length ? setOpen({ user: me, stories: mine, mine: true }) : setCompose("text"));

  return (
    <>
      <div className="list-header">
        <h1>Stories</h1>
        <Menu trigger={<span className="icon-btn" role="button" aria-label="Add a story" tabIndex={0}><Plus size={22} /></span>} items={[
          { label: "Photo or video", icon: <ImageIcon size={18} />, onClick: () => setCompose("photo") },
          { label: "Text story", icon: <Type size={18} />, onClick: () => setCompose("text") },
        ]} />
      </div>
      <div className="search-row">
        <div className="search"><Search size={18} /><input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stories" /></div>
      </div>
      <div className="list-scroll">
        <div className="conv-row" role="button" tabIndex={0} onClick={openMine} onKeyDown={(e) => e.key === "Enter" && openMine()}>
          <span className="avatar-badge">
            <Avatar id={me.id} name={me.display_name} src={me.avatar_url} size={48} />
            <button className="avatar-badge__plus" aria-label="Add a story" onClick={(e) => { e.stopPropagation(); setCompose("text"); }}><Plus size={12} strokeWidth={3} /></button>
          </span>
          <div className="conv-row__body">
            <div className="conv-row__title">My Story</div>
            <div className="conv-row__preview">{mine.length ? listTime(mine[mine.length - 1].created_at) : "Add a story"}</div>
          </div>
          {mine.length > 0 && <Thumb s={mine[mine.length - 1]} />}
        </div>
        {isLoading && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
        {others.map((g) => (
          <div key={g.user.id} className="conv-row" role="button" tabIndex={0} onClick={() => setOpen({ user: g.user, stories: g.stories, mine: false })} onKeyDown={(e) => e.key === "Enter" && setOpen({ user: g.user, stories: g.stories, mine: false })}>
            <span className={`story-ring ${g.all_viewed ? "story-ring--seen" : ""}`}><Avatar id={g.user.id} name={g.user.display_name} src={g.user.avatar_url} size={44} /></span>
            <div className="conv-row__body">
              <div className="conv-row__title">{g.user.display_name}</div>
              <div className="conv-row__preview">{listTime(g.stories[g.stories.length - 1].created_at)}</div>
            </div>
            <Thumb s={g.stories[g.stories.length - 1]} />
          </div>
        ))}
      </div>
      {compose && <StoryComposer mode={compose} onClose={() => setCompose(null)} />}
      {open && <StoryViewer key={open.user.id} user={open.user} stories={open.stories} mine={open.mine} onClose={() => setOpen(null)} />}
    </>
  );
}
