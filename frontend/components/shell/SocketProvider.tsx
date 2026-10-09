"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { WS_URL, api } from "@/lib/api";
import { applyEvent, scheduleDelivered } from "@/lib/realtime";
import { keys } from "@/lib/query";
import type { ConversationListItem, WsEnvelope } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";

type SocketApi = { send: (payload: object) => void };
const Ctx = createContext<SocketApi>({ send: () => {} });
export const useSocket = () => useContext(Ctx);

/** One authenticated socket per tab. REST creates data; this only pushes live events and carries typing/ping.
 *  Flow: POST /auth/ws-ticket (single-use, 30s) -> open /ws?ticket=... -> reconnect with backoff + jitter,
 *  and after every reconnect re-sync from the database (never from replayed events) before acking. */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const meId = useAuth((s) => s.user?.id);
  const wsRef = useRef<WebSocket | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!token || !meId) return;
    const ui = useUi.getState();
    let stopped = false;
    let attempt = 0;
    let everOpen = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const resync = async (isReconnect: boolean) => {
      if (isReconnect) {
        qc.invalidateQueries({ queryKey: ["messages"] });
        qc.invalidateQueries({ queryKey: ["conversation"] });
      }
      await qc.refetchQueries({ queryKey: keys.conversationsAll });
      const lists = qc.getQueriesData<ConversationListItem[]>({ queryKey: keys.conversationsAll });
      for (const [, items] of lists) {
        for (const i of items ?? []) if (i.last_message) scheduleDelivered(i.id, i.last_message.seq);
      }
    };

    const schedule = () => {
      if (stopped) return;
      ui.setSocketStatus("reconnecting");
      const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt += 1;
      retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      ui.setSocketStatus(everOpen ? "reconnecting" : "connecting");
      try {
        const { ticket } = await api.post<{ ticket: string }>("/auth/ws-ticket");
        if (stopped) return;
        const ws = new WebSocket(`${WS_URL}/ws?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;
        ws.onopen = () => {
          attempt = 0;
          const wasOpen = everOpen;
          everOpen = true;
          ui.setSocketStatus("open");
          heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ event: "ping" })), 25_000);
          void resync(wasOpen);
        };
        ws.onmessage = (e) => {
          try {
            applyEvent(qc, JSON.parse(e.data) as WsEnvelope, { meId, navigate: (p) => routerRef.current.push(p) });
          } catch {
            /* ignore malformed frames */
          }
        };
        ws.onclose = (ev) => {
          console.warn("[ws] closed", ev.code, ev.reason || "(no reason)");
          if (heartbeat) clearInterval(heartbeat);
          if (wsRef.current === ws) wsRef.current = null;
          schedule();
        };
        ws.onerror = () => ws.close();
      } catch {
        schedule();
      }
    };

    void connect();
    const prune = setInterval(() => useUi.getState().pruneTyping(), 1500);
    // Fallback: while the socket is down, poll so the app still updates (REST is the source of truth).
    const poll = setInterval(() => {
      const st = useUi.getState().socketStatus;
      if (st === "open" || st === "idle") return;
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
    }, 5000);
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (heartbeat) clearInterval(heartbeat);
      clearInterval(prune);
      clearInterval(poll);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      ui.setSocketStatus("idle");
    };
  }, [token, meId, qc]);

  const send = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  return <Ctx.Provider value={{ send }}>{children}</Ctx.Provider>;
}
