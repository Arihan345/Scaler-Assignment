"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { formatTimer } from "@/lib/format";
import { keys } from "@/lib/query";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/EmptyState";

const EVENTS = ["message.new", "message.deleted", "member.added", "member.removed", "conversation.updated"];
void formatTimer;

function Deliveries({ id }: { id: string }) {
  const { data, isLoading } = useQuery({ queryKey: keys.deliveries(id), queryFn: () => api.get<WebhookDelivery[]>(`/webhooks/${id}/deliveries`), refetchInterval: 5000 });
  if (isLoading) return <p className="muted">Loading…</p>;
  if (!data?.length) return <p className="muted">No deliveries yet. Use “Send test”.</p>;
  return (
    <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
      {data.slice(0, 8).map((d) => (
        <div key={d.id} className="mono">
          {d.status} · {d.event} · attempts {d.attempts}{d.response_code ? ` · HTTP ${d.response_code}` : ""}{d.last_error ? ` · ${d.last_error}` : ""}
        </div>
      ))}
    </div>
  );
}

export default function WebhooksPage() {
  const qc = useQueryClient();
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: keys.webhooks, queryFn: () => api.get<WebhookEndpoint[]>("/webhooks") });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.new"]);
  const [open, setOpen] = useState<string | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: keys.webhooks });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); reload(); if (ok) useUi.getState().toast(ok, "success"); } catch (e) { useUi.getState().toast(errorMessage(e), "error"); }
  };

  return (
    <div className="settings">
      <div className="settings__content" style={{ maxWidth: 760 }}>
        <h2>Webhooks</h2>
        <p className="muted">Outbound webhooks POST signed-by-token JSON to your URL when events happen. Deliveries retry with backoff. For a quick demo, point one at <span className="mono">{apiBase}/api/dev/webhook-echo</span>.</p>
        <form className="card" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.post("/webhooks", { url: url.trim(), events }); setUrl(""); }, "Webhook created"); }}>
          <div className="field"><label htmlFor="wu">Endpoint URL</label><input id="wu" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" /></div>
          <div className="chips" style={{ padding: "10px 0" }}>
            {EVENTS.map((ev) => (
              <button type="button" key={ev} className={`chip ${events.includes(ev) ? "is-on" : ""}`} onClick={() => setEvents((l) => (l.includes(ev) ? l.filter((x) => x !== ev) : [...l, ev]))}>{ev}</button>
            ))}
          </div>
          <Button type="submit" variant="primary" disabled={!url.trim() || events.length === 0}>Create webhook</Button>
        </form>
        {isLoading && <p className="muted">Loading…</p>}
        {isError && <ErrorState message="Couldn't load webhooks." onRetry={() => refetch()} />}
        {(data ?? []).map((w) => (
          <div className="card" key={w.id}>
            <div className="mono">{w.url}</div>
            <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>{w.events.join(", ")} · {w.is_active ? "active" : "paused"}</div>
            <div className="mono" style={{ margin: "4px 0" }}>X-Webhook-Token: {w.token}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => run(() => api.post(`/webhooks/${w.id}/test`), "Test event queued")}>Send test</Button>
              <Button onClick={() => run(() => api.patch(`/webhooks/${w.id}`, { is_active: !w.is_active }))}>{w.is_active ? "Pause" : "Resume"}</Button>
              <Button onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? "Hide deliveries" : "Deliveries"}</Button>
              <Button variant="danger" onClick={() => run(() => api.del(`/webhooks/${w.id}`))}>Delete</Button>
            </div>
            {open === w.id && <div style={{ marginTop: 10 }}><Deliveries id={w.id} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}
