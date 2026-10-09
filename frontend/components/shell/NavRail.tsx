"use client";
import { Archive, LogOut, Menu as MenuIcon, CircleDashed, MessageCircle, Settings, Webhook } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useConversationList } from "@/lib/hooks";
import { useAuth } from "@/store/auth";
import { Menu } from "@/components/ui/Menu";
import { Avatar } from "@/components/ui/Avatar";

export function NavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useAuth((s) => s.logout);
  const me = useAuth((s) => s.user);
  const { data } = useConversationList(false);
  const unread = (data ?? []).reduce((n, c) => n + (c.unread_count > 0 || c.marked_unread ? 1 : 0), 0);
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
        trigger={<span className="icon-btn nav-btn nav-avatar" role="button" aria-label="Menu" tabIndex={0}>{me ? <Avatar name={me.display_name} id={me.id} src={me.avatar_url} size={40} /> : <MenuIcon size={24} />}</span>}
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
      <Link href="/stories" className={`icon-btn nav-btn ${pathname.startsWith("/stories") ? "is-active" : ""}`} aria-label="Stories" title="Stories">
        <CircleDashed size={24} />
      </Link>
      <div className="nav-rail__spacer" />
      <Link href="/settings" className={`icon-btn nav-btn ${pathname.startsWith("/settings") ? "is-active" : ""}`} aria-label="Settings" title="Settings">
        <Settings size={24} />
      </Link>
    </nav>
  );
}
