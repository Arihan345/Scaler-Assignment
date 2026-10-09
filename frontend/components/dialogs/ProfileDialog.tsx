"use client";
import { ChevronRight, ShieldCheck, User as UserIcon, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { convTitle } from "@/lib/format";
import type { ConversationDetail } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";

/** Signal's profile card: the large photo, with name, connection status and groups in common underneath. */
export function ProfileDialog({ detail, onClose }: { detail: ConversationDetail; onClose: () => void }) {
  const [explain, setExplain] = useState(false);
  const isGroup = detail.type === "GROUP";
  const title = convTitle(detail);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const common = detail.groups_in_common ?? 0;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="profile-card" role="dialog" aria-modal="true" aria-label={`${title} profile`}>
        <button className="profile-card__close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="profile-card__photo">
          <Avatar note={detail.is_note_to_self} id={detail.peer?.id ?? detail.id} name={title} src={isGroup ? detail.avatar_url : detail.peer?.avatar_url} size={300} />
        </div>
        <div className="profile-card__rows">
          <div className="profile-card__row"><span className="profile-card__icon">{isGroup ? <Users size={20} /> : <UserIcon size={20} />}</span>{title}</div>
          {isGroup ? (
            <div className="profile-card__row"><span className="profile-card__icon"><Users size={20} /></span>{detail.members.length} members</div>
          ) : (
            <>
              <button className="profile-card__row" onClick={() => setExplain((v) => !v)} aria-expanded={explain}>
                <span className="profile-card__icon"><ShieldCheck size={20} /></span><span style={{ flex: 1, textAlign: "left" }}>Signal Connection</span><ChevronRight size={16} className="muted" />
              </button>
              {explain && <p className="profile-card__note muted">{detail.is_request || !detail.peer?.is_contact ? "You haven't added this person to your contacts, so they are not a Signal connection yet." : "This person is in your contacts, so you are connected on Signal."}</p>}
              {!detail.is_note_to_self && <div className="profile-card__row"><span className="profile-card__icon"><Users size={20} /></span>{common ? `${common} ${common === 1 ? "group" : "groups"} in common` : "No groups in common"}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
