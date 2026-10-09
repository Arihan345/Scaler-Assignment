import { create } from "zustand";
import type { Message, OutboxItem } from "@/lib/types";

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting";
export type ThemePref = "light" | "dark" | "system";
export type Toast = { id: number; text: string; kind: "info" | "error" | "success"; action?: { label: string; href: string } };

const THEME_KEY = "signal.theme";
let toastId = 1;

type UiState = {
  socketStatus: SocketStatus;
  setSocketStatus: (s: SocketStatus) => void;

  openConversationId: string | null;
  setOpenConversation: (id: string | null) => void;

  /** conversationId -> userId -> expiry timestamp (ms) */
  typing: Record<string, Record<string, number>>;
  setTyping: (conv: string, user: string, on: boolean) => void;
  pruneTyping: () => void;

  presence: Record<string, { online: boolean; last_seen_at: string | null }>;
  setPresence: (user: string, online: boolean, last_seen_at: string | null) => void;

  outbox: Record<string, OutboxItem[]>;
  addOutbox: (item: OutboxItem) => void;
  patchOutbox: (conv: string, clientId: string, patch: Partial<OutboxItem>) => void;
  removeOutbox: (conv: string, clientId: string) => void;

  replyTo: Record<string, Message | null>;
  setReplyTo: (conv: string, m: Message | null) => void;

  editing: Record<string, Message | null>;
  setEditing: (conv: string, m: Message | null) => void;

  /** Multi-select mode ("Select messages"): the open conversation and the chosen message ids. */
  selection: { conv: string; ids: number[] } | null;
  startSelection: (conv: string, firstId: number) => void;
  toggleSelected: (id: number) => void;
  clearSelection: () => void;

  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;

  theme: ThemePref;
  initTheme: () => void;
  setTheme: (t: ThemePref) => void;
};

export const useUi = create<UiState>((set, get) => ({
  socketStatus: "idle",
  setSocketStatus: (socketStatus) => set({ socketStatus }),

  openConversationId: null,
  setOpenConversation: (openConversationId) => set({ openConversationId }),

  typing: {},
  setTyping: (conv, user, on) =>
    set((s) => {
      const forConv = { ...(s.typing[conv] ?? {}) };
      if (on) forConv[user] = Date.now() + 6000; // client-side expiry; the server also sends typing.stop
      else delete forConv[user];
      return { typing: { ...s.typing, [conv]: forConv } };
    }),
  pruneTyping: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const next: UiState["typing"] = {};
      for (const [conv, users] of Object.entries(s.typing)) {
        const kept = Object.fromEntries(Object.entries(users).filter(([, exp]) => exp > now));
        if (Object.keys(kept).length !== Object.keys(users).length) changed = true;
        next[conv] = kept;
      }
      return changed ? { typing: next } : s;
    }),

  presence: {},
  setPresence: (user, online, last_seen_at) =>
    set((s) => ({ presence: { ...s.presence, [user]: { online, last_seen_at } } })),

  outbox: {},
  addOutbox: (item) =>
    set((s) => ({ outbox: { ...s.outbox, [item.conversation_id]: [...(s.outbox[item.conversation_id] ?? []), item] } })),
  patchOutbox: (conv, clientId, patch) =>
    set((s) => ({
      outbox: {
        ...s.outbox,
        [conv]: (s.outbox[conv] ?? []).map((o) => (o.client_message_id === clientId ? { ...o, ...patch } : o)),
      },
    })),
  removeOutbox: (conv, clientId) =>
    set((s) => ({ outbox: { ...s.outbox, [conv]: (s.outbox[conv] ?? []).filter((o) => o.client_message_id !== clientId) } })),

  replyTo: {},
  setReplyTo: (conv, m) => set((s) => ({ replyTo: { ...s.replyTo, [conv]: m } })),

  editing: {},
  setEditing: (conv, m) => set((s) => ({ editing: { ...s.editing, [conv]: m } })),

  selection: null,
  startSelection: (conv, firstId) => set({ selection: { conv, ids: [firstId] } }),
  toggleSelected: (id) =>
    set((s) => {
      if (!s.selection) return {};
      const ids = s.selection.ids.includes(id) ? s.selection.ids.filter((x) => x !== id) : [...s.selection.ids, id];
      return { selection: ids.length ? { ...s.selection, ids } : null };
    }),
  clearSelection: () => set({ selection: null }),

  toasts: [],
  toast: (text, kind = "info", action) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  theme: "system",
  initTheme: () => {
    let t: ThemePref = "system";
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === "light" || v === "dark" || v === "system") t = v;
    } catch {
      /* ignore */
    }
    set({ theme: t });
  },
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
}));
