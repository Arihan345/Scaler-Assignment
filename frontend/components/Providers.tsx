"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { configureApi } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Toasts } from "@/components/ui/Toasts";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
    });
    configureApi({
      getToken: () => useAuth.getState().token,
      onUnauthorized: () => {
        useAuth.getState().logout();
        client.clear();
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
      },
    });
    return client;
  });
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    useAuth.getState().hydrate();
    useUi.getState().initTheme();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toasts />
    </QueryClientProvider>
  );
}
