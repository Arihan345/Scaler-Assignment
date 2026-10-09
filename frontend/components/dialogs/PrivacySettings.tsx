"use client";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBlocked } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { Privacy, User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";

const ROWS: { key: keyof Privacy; label: string; sub: string }[] = [
  { key: "read_receipts", label: "Read receipts", sub: "Let people see when you've read their messages. Turn off and they only see Delivered." },
  { key: "typing_indicators", label: "Typing indicators", sub: "Let people see when you're typing." },
  { key: "show_online", label: "Show online status", sub: "Let people see when you're online and your last seen time." },
];

/** Privacy toggles are stored on the server because they change what OTHER people see; the server enforces them. */
export function PrivacySettings() {
  const qc = useQueryClient();
  const { user, setUser } = useAuth();
  const blocked = useBlocked();
  const p: Privacy = user?.privacy ?? { read_receipts: true, typing_indicators: true, show_online: true };

  async function set(key: keyof Privacy, v: boolean) {
    const prev = user;
    if (user) setUser({ ...user, privacy: { ...p, [key]: v } }); // optimistic
    try {
      setUser(await api.patch<User>("/users/me/privacy", { [key]: v }));
    } catch (e) {
      if (prev) setUser(prev);
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  async function unblock(u: User) {
    try {
      await api.del(`/blocks/${u.id}`);
      qc.invalidateQueries({ queryKey: keys.blocked });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      qc.invalidateQueries({ queryKey: ["conversation"] });
      useUi.getState().toast(`${u.display_name} unblocked`, "success");
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <h3 className="settings__h">Messaging</h3>
      <div className="card">
        {ROWS.map((r) => (
          <div className="setting-row" key={r.key}>
            <div>{r.label}<small>{r.sub}</small></div>
            <Toggle label={r.label} checked={p[r.key]} onChange={(v) => set(r.key, v)} />
          </div>
        ))}
      </div>
      <h3 className="settings__h">Blocked</h3>
      <div className="card">
        {blocked.isLoading && <p className="muted" style={{ padding: "12px 0" }}>Loading…</p>}
        {!blocked.isLoading && (blocked.data?.length ?? 0) === 0 && <div className="setting-row"><div>Blocked<small>No users or groups</small></div></div>}
        {(blocked.data ?? []).map((u) => (
          <div className="member-row" key={u.id}>
            <Avatar id={u.id} name={u.display_name} src={u.avatar_url} size={40} />
            <div><b>{u.display_name}</b><div className="muted" style={{ fontSize: 12 }}>{u.username ? `@${u.username}` : u.phone_number}</div></div>
            <Button onClick={() => unblock(u)}>Unblock</Button>
          </div>
        ))}
      </div>
    </>
  );
}
