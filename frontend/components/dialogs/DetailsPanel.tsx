"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Bell, BellOff, Camera, LogOut, Pencil, Search, ShieldCheck, Timer, UserPlus, Video } from "lucide-react";
import { startCall } from "@/lib/calls";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { convTitle, formatTimer, isMuted } from "@/lib/format";
import { useConversation, useContacts, useUserSearch } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { ConversationDetail, Member, User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { Menu } from "@/components/ui/Menu";
import { Toggle } from "@/components/ui/Toggle";
import { SafetyNumber } from "./SafetyNumber";
import { MoreHorizontal } from "lucide-react";

const TIMERS = [0, 30, 300, 3600, 28800, 86400, 604800, 2419200];

export function DetailsPanel({ convId, onClose, onSearch }: { convId: string; onClose: () => void; onSearch: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const meId = useAuth((s) => s.user!.id);
  const { data: c } = useConversation(convId);
  const contacts = useContacts();
  const [safety, setSafety] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "leave" } | { kind: "remove"; m: Member }>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  if (!c) return null;

  const isGroup = c.type === "GROUP";
  const admin = c.my_role === "ADMIN";
  const canSetTimer = !isGroup || admin;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.conversation(convId) });
    qc.invalidateQueries({ queryKey: keys.conversationsAll });
  };
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); refresh(); } catch (e) { useUi.getState().toast(errorMessage(e), "error"); }
  };
  const active = c.members.filter((m) => m.is_active && !m.user.is_bot);
  const muted = isMuted(c.muted_until);
  const peer = c.peer;
  const peerIsContact = peer ? (contacts.data ?? []).some((u) => u.id === peer.id) : false;

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    await run(() => api.upload(`/conversations/${convId}/avatar`, form));
  }

  return (
    <Modal title={isGroup ? "Group info" : "Chat info"} variant="drawer" onClose={onClose}>
      <div className="detail-hero">
        <div style={{ position: "relative" }}>
          <Avatar id={peer?.id ?? c.id} name={convTitle(c)} src={isGroup ? c.avatar_url : peer?.avatar_url} size={96} />
          {isGroup && admin && (
            <>
              <button className="icon-btn" aria-label="Change group photo" style={{ position: "absolute", right: -6, bottom: -6, background: "var(--bg-pane)", border: "1px solid var(--border)" }} onClick={() => avatarInput.current?.click()}><Camera size={16} /></button>
              <input ref={avatarInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
            </>
          )}
        </div>
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(() => api.patch(`/conversations/${convId}`, { title: title.trim() })); setEditing(false); }}>
            <div className="field"><input autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} aria-label="Group name" /></div>
          </form>
        ) : (
          <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {convTitle(c)}
            {isGroup && admin && <button className="icon-btn" aria-label="Edit group name" onClick={() => { setTitle(c.title ?? ""); setEditing(true); }}><Pencil size={15} /></button>}
          </h2>
        )}
        {!isGroup && peer && <div className="muted">{peer.username ? `@${peer.username}` : peer.phone_number}</div>}
        {!isGroup && peer?.about && <div>{peer.about}</div>}
        {isGroup && <div className="muted">{active.length} members</div>}
      </div>

      <div className="info-actions">
        {!isGroup && peer && !c.blocked && !c.is_request && (
          <button onClick={() => { onClose(); void startCall(c.id, peer, true); }}><span><Video size={20} /></span>Video</button>
        )}
        <button onClick={() => run(() => api.patch(`/conversations/${convId}/me`, { muted_until: muted ? null : "2999-01-01T00:00:00.000Z" }))}>
          <span>{muted ? <Bell size={20} /> : <BellOff size={20} />}</span>{muted ? "Unmute" : "Mute"}
        </button>
        <button onClick={() => { onClose(); onSearch(); }}><span><Search size={20} /></span>Search</button>
      </div>

      <div className="card">
        <div className="setting-row">
          <span style={{ display: "flex", gap: 12, alignItems: "center", whiteSpace: "nowrap" }}><Timer size={20} /> Disappearing</span>
          <select className="pill-select" value={c.disappearing_seconds} disabled={!canSetTimer} aria-label="Disappearing messages timer" onChange={(e) => run(() => api.patch(`/conversations/${convId}`, { disappearing_seconds: Number(e.target.value) }))}>
            {TIMERS.map((t) => <option key={t} value={t}>{formatTimer(t)}</option>)}
          </select>
        </div>
        {!isGroup && peer && (
          <button className="setting-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setSafety(true)}>
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}><ShieldCheck size={20} /> View safety number</span>
          </button>
        )}
        {!isGroup && peer && !peerIsContact && (
          <button className="setting-row" style={{ width: "100%", textAlign: "left" }} onClick={() => run(async () => { await api.post("/contacts", { user_id: peer.id }); qc.invalidateQueries({ queryKey: keys.contacts }); })}>
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}><UserPlus size={20} /> Add to contacts</span>
          </button>
        )}
      </div>

      {isGroup && (
        <div className="card">
          <div className="setting-row">
            <b>{active.length} {active.length === 1 ? "member" : "members"}</b>
          </div>
          {admin && (
            <button className="setting-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setAdding(true)}>
              <span style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="avatar avatar--icon" style={{ width: 40, height: 40 }}><UserPlus size={18} /></span> Add members</span>
            </button>
          )}
          {active.map((m) => (
            <div className="member-row" key={m.user.id}>
              <Avatar id={m.user.id} name={m.user.display_name} src={m.user.avatar_url} size={40} />
              <div>
                <div style={{ fontWeight: 600 }}>{m.user.id === meId ? "You" : m.user.display_name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{m.user.username ? `@${m.user.username}` : m.user.phone_number}</div>
              </div>
              {m.role === "ADMIN" && <span className="pill">Admin</span>}
              {admin && m.user.id !== meId && (
                <Menu trigger={<span className="icon-btn" role="button" aria-label={`Options for ${m.user.display_name}`}><MoreHorizontal size={18} /></span>} items={[
                  { label: m.role === "ADMIN" ? "Remove admin" : "Make admin", onClick: () => run(() => api.post(`/conversations/${convId}/members/${m.user.id}/role`, { role: m.role === "ADMIN" ? "MEMBER" : "ADMIN" })) },
                  { label: "Remove from group", danger: true, onClick: () => setConfirm({ kind: "remove", m }) },
                ]} />
              )}
            </div>
          ))}
        </div>
      )}


      {(isGroup || (peer && !c.is_note_to_self)) && (
        <div className="card card--danger">
          {isGroup && <button className="setting-row" onClick={() => setConfirm({ kind: "leave" })}><span style={{ display: "flex", gap: 12, alignItems: "center" }}><LogOut size={20} /> Leave group</span></button>}
          {!isGroup && peer && (
            <button className="setting-row" onClick={() => run(async () => { if (c.blocked) await api.del(`/blocks/${peer.id}`); else await api.post(`/blocks/${peer.id}`); qc.invalidateQueries({ queryKey: keys.blocked }); })}>
              <span style={{ display: "flex", gap: 12, alignItems: "center" }}><Ban size={20} /> {c.blocked ? "Unblock" : "Block"}</span>
            </button>
          )}
        </div>
      )}

      {safety && peer && <SafetyNumber a={meId} b={peer.id} name={peer.display_name} onClose={() => setSafety(false)} />}
      {adding && <AddMembers conv={c} onClose={() => { setAdding(false); refresh(); }} />}
      {confirm?.kind === "leave" && (
        <ConfirmDialog title="Leave group?" message="You won't be able to send or receive messages in this group." confirmLabel="Leave" danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(async () => { await api.post(`/conversations/${convId}/leave`); onClose(); router.push("/"); })} />
      )}
      {confirm?.kind === "remove" && (
        <ConfirmDialog title="Remove member?" message={`${confirm.m.user.display_name} will be removed from this group.`} confirmLabel="Remove" danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api.del(`/conversations/${convId}/members/${confirm.m.user.id}`))} />
      )}
    </Modal>
  );
}

function AddMembers({ conv, onClose }: { conv: ConversationDetail; onClose: () => void }) {
  const contacts = useContacts();
  const [q, setQ] = useState("");
  const search = useUserSearch(q);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const inGroup = new Set(conv.members.filter((m) => m.is_active).map((m) => m.user.id));
  const term = q.trim().toLowerCase();
  // Contacts first (filtered locally), then anyone found by name / username / phone, so non-contacts can be added too.
  const candidates = useMemo(() => {
    const byId = new Map<string, User>();
    for (const u of contacts.data ?? []) if (!term || u.display_name.toLowerCase().includes(term) || u.username?.toLowerCase().includes(term)) byId.set(u.id, u);
    for (const u of search.data ?? []) if (!byId.has(u.id)) byId.set(u.id, u);
    return [...byId.values()].filter((u) => !inGroup.has(u.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.data, search.data, term, conv.members]);
  return (
    <Modal title="Add members" onClose={onClose} footer={
      <Button variant="primary" disabled={picked.length === 0} onClick={async () => {
        try { await api.post(`/conversations/${conv.id}/members`, { user_ids: picked }); onClose(); } catch (e) { setError(errorMessage(e)); }
      }}>Add</Button>
    }>
      <div className="search" style={{ margin: "0 0 10px" }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, username or phone number" aria-label="Search people" />
      </div>
      {candidates.length === 0 && <p className="muted">{term ? "No one found." : "All your contacts are already in this group. Search by phone number to add someone else."}</p>}
      {candidates.map((u) => (
        <label key={u.id} className="pick-row">
          <input type="checkbox" checked={picked.includes(u.id)} onChange={() => setPicked((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id]))} />
          <Avatar id={u.id} name={u.display_name} src={u.avatar_url} size={36} /> {u.display_name}
        </label>
      ))}
      {error && <span className="field__error">{error}</span>}
    </Modal>
  );
}
