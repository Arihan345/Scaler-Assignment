"use client";
import { startCall } from "@/lib/calls";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Bell, BellOff, Ban, MailOpen, ChevronLeft, Images, MoreHorizontal, Pin, PinOff, Search, Settings2, Timer, UserCheck, Phone, Video, BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { convTitle, conversationOnline, formatTimer, isMuted, lastSeen } from "@/lib/format";
import { keys } from "@/lib/query";
import type { ConversationDetail } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { ProfileDialog } from "@/components/dialogs/ProfileDialog";

const TIMER_CHOICES = [0, 2419200, 604800, 86400, 28800, 3600, 300, 30];
const hours = (h: number) => () => new Date(Date.now() + h * 3600_000).toISOString();
const MUTE_CHOICES = [
  { label: "1 hour", until: hours(1) },
  { label: "8 hours", until: hours(8) },
  { label: "1 day", until: hours(24) },
  { label: "1 week", until: hours(168) },
  { label: "Always", until: () => "2999-01-01T00:00:00.000Z" },
];

export function ThreadHeader({ detail, onDetails, onSearch, onMedia }: { detail: ConversationDetail; onDetails: () => void; onSearch: () => void; onMedia: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [profile, setProfile] = useState(false);
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

  const canSetTimer = detail.type !== "GROUP" || detail.my_role === "ADMIN";
  async function setTimer(seconds: number) {
    try {
      await api.patch(`/conversations/${detail.id}`, { disappearing_seconds: seconds });
      qc.invalidateQueries({ queryKey: keys.conversation(detail.id) });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  const canCall = detail.type === "DIRECT" && !note && !!detail.peer && !detail.blocked && !detail.is_request;
  return (
    <>
    <header className="thread-header">
      <Link href="/" className="icon-btn back-btn" aria-label="Back"><ChevronLeft size={22} /></Link>
      <button className="thread-header__who" onClick={note ? undefined : onDetails} aria-label="Conversation details" style={note ? { cursor: "default" } : undefined}>
        <span role="button" tabIndex={0} aria-label="View profile photo" onClick={(e) => { e.stopPropagation(); setProfile(true); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setProfile(true); } }}>
          <Avatar note={note} id={detail.peer?.id ?? detail.id} name={title} src={detail.type === "GROUP" ? detail.avatar_url : detail.peer?.avatar_url} size={44} online={conversationOnline(detail, presence)} />
        </span>
        <span style={{ minWidth: 0 }}>
          <div className="thread-header__title"><span className="ellipsis">{title}</span>{note && <BadgeCheck size={18} className="verified" aria-label="Verified: only you can read this chat" />}</div>
          <div className="thread-header__sub">{sub}</div>
        </span>
      </button>
      {canCall && <IconButton label="Start video call" onClick={() => void startCall(detail.id, detail.peer!, true)}><Video size={22} /></IconButton>}
      {canCall && <IconButton label="Start voice call" onClick={() => void startCall(detail.id, detail.peer!, false)}><Phone size={22} /></IconButton>}
      <IconButton label="Search in chat" className="hide-xs" onClick={onSearch}><Search size={22} /></IconButton>
      <Menu trigger={<span className="icon-btn" role="button" tabIndex={0} aria-label="Chat options"><MoreHorizontal size={22} /></span>} items={[
        { label: "Search in chat", icon: <Search size={17} />, onClick: onSearch },
        {
          label: "Disappearing messages", icon: <Timer size={17} />, hidden: note || !canSetTimer, onClick: () => {},
          children: TIMER_CHOICES.map((t) => ({ label: t === 0 ? "Off" : formatTimer(t), checked: detail.disappearing_seconds === t, onClick: () => setTimer(t) })),
        },
        muted
          ? { label: "Unmute notifications", icon: <Bell size={17} />, onClick: () => patchMe({ muted_until: null }) }
          : {
              label: "Mute notifications", icon: <BellOff size={17} />, onClick: () => {},
              children: [
                { label: "Mute this chat for…", caption: true, onClick: () => {} },
                ...MUTE_CHOICES.map((m) => ({ label: m.label, onClick: () => patchMe({ muted_until: m.until() }) })),
              ],
            },
        { label: detail.type === "GROUP" ? "Group settings" : "Chat settings", icon: <Settings2 size={17} />, hidden: note, onClick: onDetails },
        { label: "All media", icon: <Images size={17} />, onClick: onMedia },
        { label: "Mark as unread", icon: <MailOpen size={17} />, separatorBefore: true, onClick: () => patchMe({ marked_unread: true }, () => router.push("/")) },
        { label: detail.is_pinned ? "Unpin chat" : "Pin chat", icon: detail.is_pinned ? <PinOff size={17} /> : <Pin size={17} />, onClick: () => patchMe({ is_pinned: !detail.is_pinned }) },
        { label: detail.is_archived ? "Unarchive" : "Archive", icon: <Archive size={17} />, onClick: () => patchMe({ is_archived: !detail.is_archived }, () => !detail.is_archived && router.push("/")) },
        { label: detail.blocked ? "Unblock" : "Block", icon: detail.blocked ? <UserCheck size={17} /> : <Ban size={17} />, hidden: detail.type !== "DIRECT" || note || !detail.peer, onClick: toggleBlock },
      ]} />
    </header>
    {profile && <ProfileDialog detail={detail} onClose={() => setProfile(false)} />}
    </>
  );
}
