"use client";
import { Archive, AtSign, BellOff, MailCheck, MailOpen, MoreHorizontal, Pin, PinOff, Bell } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { convTitle, isMuted, listTime, previewText } from "@/lib/format";
import { keys } from "@/lib/query";
import type { ConversationListItem } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { MenuPopup, type MenuItem } from "@/components/ui/Menu";

export function ConversationRow({ item, active, onOpen }: { item: ConversationListItem; active: boolean; onOpen: () => void }) {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  const presence = useUi((s) => s.presence);
  const typing = useUi((s) => s.typing[item.id]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const muted = isMuted(item.muted_until);
  const title = convTitle(item);
  const online = item.peer ? (presence[item.peer.id]?.online ?? !!item.peer.is_online) : false;
  const isTyping = !!typing && Object.keys(typing).some((u) => u !== meId);

  async function patch(body: object) {
    try {
      await api.patch(`/conversations/${item.id}/me`, body);
    } catch {
      useUi.getState().toast("Couldn't update chat", "error");
    }
    qc.invalidateQueries({ queryKey: keys.conversationsAll });
  }

  const items: MenuItem[] = [
    { label: item.is_pinned ? "Unpin chat" : "Pin chat", icon: item.is_pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: () => patch({ is_pinned: !item.is_pinned }) },
    muted
      ? { label: "Unmute", icon: <Bell size={16} />, onClick: () => patch({ muted_until: null }) }
      : { label: "Mute for 8 hours", icon: <BellOff size={16} />, onClick: () => patch({ muted_until: new Date(Date.now() + 8 * 3600_000).toISOString() }) },
    { label: "Mute always", icon: <BellOff size={16} />, hidden: muted, onClick: () => patch({ muted_until: "2999-01-01T00:00:00.000Z" }) },
    item.unread_count > 0 || item.marked_unread
      ? { label: "Mark as read", icon: <MailCheck size={16} />, onClick: async () => {
          try {
            if (item.unread_count > 0 && item.last_message) await api.post(`/conversations/${item.id}/read`, { up_to_seq: item.last_message.seq });
            await api.patch(`/conversations/${item.id}/me`, { marked_unread: false });
          } catch { useUi.getState().toast("Couldn't update chat", "error"); }
          qc.invalidateQueries({ queryKey: keys.conversationsAll });
        } }
      : { label: "Mark as unread", icon: <MailOpen size={16} />, onClick: () => patch({ marked_unread: true }) },
    { label: item.is_archived ? "Unarchive" : "Archive", icon: <Archive size={16} />, onClick: () => patch({ is_archived: !item.is_archived }) },
  ];

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={`conv-row ${active ? "is-active" : ""} ${item.unread_count > 0 || item.marked_unread ? "is-unread" : ""}`}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <Avatar note={item.is_note_to_self} id={item.peer?.id ?? item.id} name={title} src={item.type === "GROUP" ? item.avatar_url : item.peer?.avatar_url} online={online} />
        <div className="conv-row__body">
          <div className="conv-row__top">
            <span className="conv-row__title">{title}</span>
            {item.last_message && <span className="conv-row__time">{listTime(item.last_message.created_at)}</span>}
          </div>
          <div className="conv-row__bottom">
            <span className="conv-row__preview">{isTyping ? <i>typing…</i> : previewText(item, meId)}</span>
            <span className="conv-row__icons">
              {item.is_pinned && <Pin size={13} />}
              {muted && <BellOff size={13} />}
              {item.has_unread_mention && item.unread_count > 0 && <span className="badge badge--mention" title="You were mentioned"><AtSign size={12} /></span>}
              {item.unread_count > 0 ? (
                <span className={`badge ${muted ? "badge--muted" : ""}`}>{item.unread_count > 99 ? "99+" : item.unread_count}</span>
              ) : item.marked_unread ? (
                <span className="badge badge--dot" aria-label="Marked as unread" />
              ) : (
                item.last_message && item.last_message.sender_id === meId && !item.last_message.deleted_at && item.last_message.type !== "SYSTEM" && (
                  <span className="row-tick"><StatusIcon status={item.last_message.status ?? "sent"} size={17} /></span>
                )
              )}
              <button className="icon-btn row-more" style={{ width: 24, height: 24 }} aria-label="Chat options" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom }); }}>
                <MoreHorizontal size={16} />
              </button>
            </span>
          </div>
        </div>
      </div>
      {menu && <MenuPopup x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}
