"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/query";
import type { DeviceSession } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Every signed-in browser/device is a session; "linking" a device means signing in with the same number there. */
export function DevicesSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: keys.sessions, queryFn: () => api.get<DeviceSession[]>("/auth/sessions"), refetchInterval: 30000 });
  const others = (data ?? []).filter((d) => !d.current);

  async function unlink(id: string) {
    try {
      await api.del(`/auth/sessions/${id}`);
      qc.invalidateQueries({ queryKey: keys.sessions });
      useUi.getState().toast("Device unlinked", "success");
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }
  async function unlinkAll() {
    try {
      await api.post("/auth/sessions/revoke-others");
      qc.invalidateQueries({ queryKey: keys.sessions });
      useUi.getState().toast("All other devices unlinked", "success");
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <p className="muted">Devices where you're signed in. To link a new device, open this app there and sign in with your phone number. Unlinking signs that device out immediately.</p>
      {isLoading && <p className="muted">Loading…</p>}
      {(data ?? []).map((d) => (
        <div className="setting-row device-row" key={d.id}>
          <Monitor size={22} />
          <div style={{ flex: 1 }}>{d.device}{d.current && <span className="chip is-on" style={{ marginLeft: 8 }}>This device</span>}
            <small>Linked {new Date(d.created_at).toLocaleDateString()} · active {ago(d.last_used_at)}</small></div>
          {!d.current && <Button variant="ghost" onClick={() => unlink(d.id)}>Unlink</Button>}
        </div>
      ))}
      {others.length > 1 && <div style={{ marginTop: 16 }}><Button variant="danger" onClick={unlinkAll}>Unlink all other devices</Button></div>}
    </>
  );
}
