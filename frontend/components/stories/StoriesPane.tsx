"use client";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import { keys } from "@/lib/query";
import type { Story, StoryFeed, User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { StoryComposer } from "./StoryComposer";
import { StoryViewer } from "./StoryViewer";

type Open = { user: User; stories: Story[]; mine: boolean } | null;

/** Left pane of the Stories tab: my story on top, then everyone's, unviewed first. */
export function StoriesPane() {
  const me = useAuth((s) => s.user)!;
  const { data, isLoading } = useQuery({ queryKey: keys.stories, queryFn: () => api.get<StoryFeed>("/stories"), refetchInterval: 30000 });
  const [compose, setCompose] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const mine = data?.mine ?? [];

  return (
    <>
      <div className="list-header"><h1>Stories</h1></div>
      <div className="list-scroll">
        <div className="conv-row" role="button" tabIndex={0} onClick={() => (mine.length ? setOpen({ user: me, stories: mine, mine: true }) : setCompose(true))} onKeyDown={(e) => e.key === "Enter" && (mine.length ? setOpen({ user: me, stories: mine, mine: true }) : setCompose(true))}>
          <span className={`story-ring ${mine.length ? "story-ring--mine" : ""}`}><Avatar id={me.id} name={me.display_name} src={me.avatar_url} size={44} /></span>
          <div className="conv-row__body">
            <div className="conv-row__title">My story</div>
            <div className="conv-row__preview">{mine.length ? `${mine.length} ${mine.length === 1 ? "story" : "stories"} · ${clock(mine[mine.length - 1].created_at)}` : "Tap to add a story"}</div>
          </div>
          <button className="icon-btn" aria-label="Add story" onClick={(e) => { e.stopPropagation(); setCompose(true); }}><Plus size={22} /></button>
        </div>
        {isLoading && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
        {(data?.others ?? []).length > 0 && <div className="list-section">Recent updates</div>}
        {(data?.others ?? []).map((g) => (
          <div key={g.user.id} className="conv-row" role="button" tabIndex={0} onClick={() => setOpen({ user: g.user, stories: g.stories, mine: false })} onKeyDown={(e) => e.key === "Enter" && setOpen({ user: g.user, stories: g.stories, mine: false })}>
            <span className={`story-ring ${g.all_viewed ? "story-ring--seen" : ""}`}><Avatar id={g.user.id} name={g.user.display_name} src={g.user.avatar_url} size={44} /></span>
            <div className="conv-row__body">
              <div className="conv-row__title">{g.user.display_name}</div>
              <div className="conv-row__preview">{clock(g.stories[g.stories.length - 1].created_at)}</div>
            </div>
          </div>
        ))}
        {!isLoading && (data?.others ?? []).length === 0 && (
          <EmptyState title="No recent updates">Stories from your contacts and chat partners show up here for 24 hours.</EmptyState>
        )}
      </div>
      {compose && <StoryComposer onClose={() => setCompose(false)} />}
      {open && <StoryViewer key={open.user.id} user={open.user} stories={open.stories} mine={open.mine} onClose={() => setOpen(null)} />}
    </>
  );
}
