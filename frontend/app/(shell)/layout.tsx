"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/store/auth";
import { SocketProvider } from "@/components/shell/SocketProvider";
import { CallOverlay } from "@/components/shell/CallOverlay";
import { NavRail } from "@/components/shell/NavRail";
import { ListPane } from "@/components/shell/ListPane";
import { ConnectionBanner } from "@/components/shell/ConnectionBanner";
import { useShortcuts } from "@/components/shell/useShortcuts";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, hydrated } = useAuth();

  useEffect(() => {
    if (!hydrated) return;
    if (!token || !user) router.replace("/login");
    else if (!user.onboarded) router.replace("/onboarding");
  }, [hydrated, token, user, router]);

  useShortcuts();

  if (!hydrated || !token || !user || !user.onboarded) return <div className="auth-screen" aria-busy="true" />;

  const hasMain = pathname !== "/" && pathname !== "/settings" && pathname !== "/stories";
  return (
    <SocketProvider>
      <div className={`app ${hasMain ? "has-thread" : ""}`}>
        <NavRail />
        <ListPane />
        <main className="main-pane">
          <ConnectionBanner />
          <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
        </main>
      </div>
      <CallOverlay />
    </SocketProvider>
  );
}
