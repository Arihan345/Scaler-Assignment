"use client";
import { create } from "zustand";

// Local, per-browser preferences (not synced). Privacy settings that affect other people live on the server instead.
const KEY = "signal.prefs";
export type Prefs = { linkPreviews: boolean; sendWithEnter: boolean; notifyToasts: boolean; notifyContent: boolean; sounds: boolean; desktopNotify: boolean };
const DEFAULTS: Prefs = { linkPreviews: true, sendWithEnter: true, notifyToasts: true, notifyContent: true, sounds: false, desktopNotify: false };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

type State = Prefs & { hydrated: boolean; hydrate: () => void; set: (p: Partial<Prefs>) => void };

export const usePrefs = create<State>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => set({ ...load(), hydrated: true }),
  set: (p) => {
    set(p);
    const { linkPreviews, sendWithEnter, notifyToasts, notifyContent, sounds, desktopNotify } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ linkPreviews, sendWithEnter, notifyToasts, notifyContent, sounds, desktopNotify })); } catch { /* storage unavailable */ }
  },
}));
