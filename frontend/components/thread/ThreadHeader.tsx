"use client";
import { startCall } from "@/lib/calls";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, BellOff, Ban, ChevronLeft, Images, MoreHorizontal, Pin, PinOff, Search, Settings2, Timer, UserCheck, Phone, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { api, errorMessage } from "@/lib/api";
import { convTitle, conversationOnline, isMuted, lastSeen } from "@/lib/format";
import { keys } from "@/lib/query";
import type { ConversationDetail } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";

export function ThreadHeader({ detail, onDetails, onSearch, onMedia }: { detail: ConversationDetail; onDetails: () => void; onSearch: () => void; onMedia: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const meId = useAuth((s) => s.user!.id);
  const presence = useUi((s) => s.presence);
  const typing = useUi((s) => s.typing[detail.id]);
  const title = convTitle(detail);
  const muted = isMuted(detail.muted_until);

  const typers = useMemo(() => {
    const ids = Object.keys(typing ?? {}).filter((u) => u !== meId);
    return ids.map((id) => detail.members.find((m) => m.user.id === id)?.user.display_name.split(" ")[0] ?? "Someone");
  }, [typing, detail.members, meId]);

  const note = detail.is_note_to_self;
  let sub: string;
  if (note) sub = "Message yourself";
  else if (typers.length) sub = detail.type === "GROUP" ? `${typers.join(", ")} ${typers.length > 1 ? "are" : "is"} typing…` : "typing…";
  else if (detail.type === "GROUP") sub = `${detail.members.filter((m) => m.is_active && !m.user.is_bot).length} members`;
  else if (conversationOnline(detail, presence)) sub = "Online";
  else sub = lastSeen(presence[detail.peer?.id ?? ""]?.last_seen_at ?? detail.peer?.last_seen_at ?? null);

  async function patchMe(body: object, then?: () => void) {
    try {
      await api.patch(`/conversations/${detail.id}/me`, body);
      qc.invalidateQueries({ queryKey: keys.conversation(detail.id) });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      then?.();
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  async function toggleBlock() {
    try {
      if (detail.blocked) await api.del(`/blocks/${detail.peer!.id}`);
      else await api.post(`/blocks/${detail.peer!.id}`);
      qc.invalidateQueries({ queryKey: keys.conversation(detail.id) });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      qc.invalidateQueries({ queryKey: keys.blocked });
      useUi.getState().toast(detail.blocked ? `${title} unblocked` : `${title} blocked`, "success");
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  const canCall = detail.type === "DIRECT" && !note && !!detail.peer && !detail.blocked && !detail.is_request;
  return (
    <header className="thread-header">
      <Link href="/" className="icon-btn back-btn" aria-label="Back"><ChevronLeft size={22} /></Link>
      <button className="thread-header__who" onClick={note ? undefined : onDetails} aria-label="Conversation details" style={note ? { cursor: "default" } : undefined}>
        <Avatar note={note} id={detail.peer?.id ?? detail.id} name={title} src={detail.type === "GROUP" ? detail.avatar_url : detail.peer?.avatar_url} size={44} online={conversationOnline(detail, presence)} />
        <span style={{ minWidth: 0 }}>
          <div className="thread-header__title">{title}</div>
          <div className="thread-header__sub">{sub}</div>
        </span>
      </button>
      {canCall && <IconButton label="Start voice call" onClick={() => void startCall(detail.id, detail.peer!, false)}><Phone size={22} /></IconButton>}
      {canCall && <IconButton label="Start video call" onClick={() => void startCall(detail.id, detail.peer!, true)}><Video size={22} /></IconButton>}
      <IconButton label="Search in chat" onClick={onSearch}><Search size={22} /></IconButton>
      <Menu trigger={<span className="icon-btn" role="button" tabIndex={0} aria-label="Chat options"><MoreHorizontal size={22} /></span>} items={[
        { label: "All media", icon: <Images size={17} />, onClick: onMedia },
        { label: "Disappearing messages", icon: <Timer size={17} />, hidden: note, onClick: onDetails },
        { label: muted ? "Unmute notifications" : "Mute notifications", icon: <BellOff size={17} />, onClick: () => patchMe({ muted_until: muted ? null : "2999-01-01T00:00:00.000Z" }) },
        { label: detail.type === "GROUP" ? "Group settings" : "Chat settings", icon: <Settings2 size={17} />, hidden: note, onClick: onDetails },
        { label: detail.is_pinned ? "Unpin chat" : "Pin chat", icon: detail.is_pinned ? <PinOff size={17} /> : <Pin size={17} />, separatorBefore: true, onClick: () => patchMe({ is_pinned: !detail.is_pinned }) },
        { label: detail.is_archived ? "Unarchive" : "Archive", icon: <Archive size={17} />, onClick: () => patchMe({ is_archived: !detail.is_archived }, () => !detail.is_archived && router.push("/")) },
        { label: detail.blocked ? "Unblock" : "Block", icon: detail.blocked ? <UserCheck size={17} /> : <Ban size={17} />, danger: !detail.blocked, hidden: detail.type !== "DIRECT" || note || !detail.peer, separatorBefore: true, onClick: toggleBlock },
      ]} />
    </header>
  );
}
