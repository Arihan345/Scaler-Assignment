"use client";
import { Archive, LogOut, Menu as MenuIcon, MessageCircle, Settings, Webhook } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useConversationList } from "@/lib/hooks";
import { useAuth } from "@/store/auth";
import { Menu } from "@/components/ui/Menu";

export function NavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useAuth((s) => s.logout);
  const { data } = useConversationList(false);
  const unread = (data ?? []).reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0);
  const chatsActive = pathname === "/" || pathname.startsWith("/c/");

  async function signOut() {
    try { await api.post("/auth/logout"); } catch { /* token may already be invalid */ }
    logout();
    qc.clear();
    router.replace("/login");
  }

  return (
    <nav className="nav-rail" aria-label="Main">
      <Menu
        align="left"
        trigger={<span className="icon-btn nav-btn" role="button" aria-label="Menu" tabIndex={0}><MenuIcon size={24} /></span>}
        items={[
          { label: "Settings", icon: <Settings size={16} />, onClick: () => router.push("/settings") },
          { label: "Archived chats", icon: <Archive size={16} />, onClick: () => router.push("/?archived=1") },
          { label: "Webhooks", icon: <Webhook size={16} />, onClick: () => router.push("/webhooks") },
          { label: "Log out", icon: <LogOut size={16} />, danger: true, separatorBefore: true, onClick: signOut },
        ]}
      />
      <Link href="/" className={`icon-btn nav-btn ${chatsActive ? "is-active" : ""}`} aria-label="Chats" title="Chats">
        <MessageCircle size={24} fill={chatsActive ? "currentColor" : "none"} />
        {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <div className="nav-rail__spacer" />
      <Link href="/settings" className={`icon-btn nav-btn ${pathname.startsWith("/settings") ? "is-active" : ""}`} aria-label="Settings" title="Settings">
        <Settings size={24} />
      </Link>
    </nav>
  );
}
