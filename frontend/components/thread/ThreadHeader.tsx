"use client";
import { ChevronLeft, Info } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { convTitle, conversationOnline, lastSeen } from "@/lib/format";
import type { ConversationDetail } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";

export function ThreadHeader({ detail, onDetails }: { detail: ConversationDetail; onDetails: () => void }) {
  const meId = useAuth((s) => s.user!.id);
  const presence = useUi((s) => s.presence);
  const typing = useUi((s) => s.typing[detail.id]);
  const title = convTitle(detail);

  const typers = useMemo(() => {
    const ids = Object.keys(typing ?? {}).filter((u) => u !== meId);
    return ids.map((id) => detail.members.find((m) => m.user.id === id)?.user.display_name.split(" ")[0] ?? "Someone");
  }, [typing, detail.members, meId]);

  let sub: string;
  if (typers.length) sub = detail.type === "GROUP" ? `${typers.join(", ")} ${typers.length > 1 ? "are" : "is"} typing…` : "typing…";
  else if (detail.type === "GROUP") {
    const active = detail.members.filter((m) => m.is_active);
    sub = `${active.length} members`;
  } else if (conversationOnline(detail, presence)) sub = "Online";
  else sub = lastSeen(presence[detail.peer?.id ?? ""]?.last_seen_at ?? detail.peer?.last_seen_at ?? null);

  return (
    <header className="thread-header">
      <Link href="/" className="icon-btn back-btn" aria-label="Back"><ChevronLeft size={22} /></Link>
      <button className="thread-header__who" onClick={onDetails} aria-label="Conversation details">
        <Avatar id={detail.peer?.id ?? detail.id} name={title} src={detail.type === "GROUP" ? detail.avatar_url : detail.peer?.avatar_url} size={40} online={conversationOnline(detail, presence)} />
        <span style={{ minWidth: 0 }}>
          <div className="thread-header__title">{title}</div>
          <div className="thread-header__sub">{sub}</div>
        </span>
      </button>
      <IconButton label="Conversation details" onClick={onDetails}><Info size={20} /></IconButton>
    </header>
  );
}
