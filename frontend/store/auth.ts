import { create } from "zustand";
import type { User } from "@/lib/types";

const TOKEN_KEY = "signal.token";
const USER_KEY = "signal.user";

type AuthState = {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  hydrate: () => void;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: () => void;
};

const safe = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable (private mode): session just won't persist */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const useAuth = create<AuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  hydrate: () => {
    const token = safe.get(TOKEN_KEY);
    let user: User | null = null;
    try {
      const raw = safe.get(USER_KEY);
      user = raw ? (JSON.parse(raw) as User) : null;
    } catch {
      user = null;
    }
    set({ token, user: token ? user : null, hydrated: true });
  },
  setSession: (token, user) => {
    safe.set(TOKEN_KEY, token);
    safe.set(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  setUser: (user) => {
    safe.set(USER_KEY, JSON.stringify(user));
    set({ user });
  },
  logout: () => {
    safe.del(TOKEN_KEY);
    safe.del(USER_KEY);
    set({ token: null, user: null });
  },
}));
