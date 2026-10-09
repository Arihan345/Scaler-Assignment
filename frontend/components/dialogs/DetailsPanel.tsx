"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Camera, LogOut, Pencil, ShieldCheck, Timer, UserPlus, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { convTitle, formatTimer, isMuted } from "@/lib/format";
import { useConversation, useContacts } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { ConversationDetail, InboundHook, Member, User } from "@/lib/types";
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

export function DetailsPanel({ convId, onClose }: { convId: string; onClose: () => void }) {
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

      <div className="setting-row">
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}><BellOff size={18} /> Mute notifications</span>
        <Toggle label="Mute notifications" checked={muted} onChange={(on) => run(() => api.patch(`/conversations/${convId}/me`, { muted_until: on ? "2999-01-01T00:00:00.000Z" : null }))} />
      </div>
      <div className="setting-row">
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}><Timer size={18} /> Disappearing messages</span>
        <select value={c.disappearing_seconds} disabled={!canSetTimer} aria-label="Disappearing messages timer" onChange={(e) => run(() => api.patch(`/conversations/${convId}`, { disappearing_seconds: Number(e.target.value) }))}>
          {TIMERS.map((t) => <option key={t} value={t}>{formatTimer(t)}</option>)}
        </select>
      </div>
      {!isGroup && peer && (
        <>
          <button className="setting-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setSafety(true)}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}><ShieldCheck size={18} /> View safety number</span>
          </button>
          {!peerIsContact && (
            <button className="setting-row" style={{ width: "100%", textAlign: "left" }} onClick={() => run(async () => { await api.post("/contacts", { user_id: peer.id }); qc.invalidateQueries({ queryKey: keys.contacts }); })}>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}><UserPlus size={18} /> Add to contacts</span>
            </button>
          )}
        </>
      )}

      {isGroup && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3>Members</h3>
            {admin && <Button variant="ghost" onClick={() => setAdding(true)}><UserPlus size={16} /> Add</Button>}
          </div>
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
        </section>
      )}

      <InboundHooks convId={convId} canManage={!isGroup || admin} />

      {isGroup && (
        <Button variant="danger" style={{ marginTop: 20, width: "100%" }} onClick={() => setConfirm({ kind: "leave" })}>
          <LogOut size={16} /> Leave group
        </Button>
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
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const inGroup = new Set(conv.members.filter((m) => m.is_active).map((m) => m.user.id));
  const candidates = (contacts.data ?? []).filter((u: User) => !inGroup.has(u.id));
  return (
    <Modal title="Add members" onClose={onClose} footer={
      <Button variant="primary" disabled={picked.length === 0} onClick={async () => {
        try { await api.post(`/conversations/${conv.id}/members`, { user_ids: picked }); onClose(); } catch (e) { setError(errorMessage(e)); }
      }}>Add</Button>
    }>
      {candidates.length === 0 && <p className="muted">All your contacts are already in this group. Add more contacts from New chat.</p>}
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

function InboundHooks({ convId, canManage }: { convId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data } = useQuery({ queryKey: ["inbound", convId], queryFn: () => api.get<InboundHook[]>(`/conversations/${convId}/inbound-hooks`) });
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  if (!canManage && !(data?.length)) return null;
  const reload = () => qc.invalidateQueries({ queryKey: ["inbound", convId] });
  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}><Webhook size={16} /> Incoming webhooks</h3>
      <p className="muted" style={{ fontSize: 12 }}>External services can POST <span className="mono">{`{"text": "..."}`}</span> to a hook URL and it appears in this chat as a bot.</p>
      {(data ?? []).map((h) => (
        <div className="card" key={h.id}>
          <b>{h.name}</b>
          <div className="mono" style={{ margin: "6px 0" }}>{apiBase}/api/hooks/in/{h.token}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => navigator.clipboard?.writeText(`${apiBase}/api/hooks/in/${h.token}`)}>Copy URL</Button>
            {canManage && <Button variant="danger" onClick={async () => { try { await api.del(`/inbound-hooks/${h.id}`); reload(); qc.invalidateQueries({ queryKey: keys.conversation(convId) }); } catch (e) { useUi.getState().toast(errorMessage(e), "error"); } }}>Delete</Button>}
          </div>
        </div>
      ))}
      {canManage && (
        <form style={{ display: "flex", gap: 8 }} onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try { await api.post(`/conversations/${convId}/inbound-hooks`, { name: name.trim() }); setName(""); reload(); qc.invalidateQueries({ queryKey: keys.conversation(convId) }); }
          catch (err) { useUi.getState().toast(errorMessage(err), "error"); }
        }}>
          <div className="field" style={{ flex: 1 }}><input placeholder="Hook name (e.g. CI)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Hook name" /></div>
          <Button type="submit" variant="primary">Create</Button>
        </form>
      )}
    </section>
  );
}
