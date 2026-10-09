"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";
import type { CallEntry } from "@/lib/types";
import { Menu as MenuIcon, MessageCircle, Phone, RectangleVertical, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConversationList } from "@/lib/hooks";
import { useUi } from "@/store/ui";

/** Signal Desktop's left rail: a menu button that shows/hides the tabs, then Chats, Calls, Stories, and Settings at the bottom. */
export function NavRail() {
  const pathname = usePathname();
  const collapsed = useUi((s) => s.navCollapsed);
  const toggle = useUi((s) => s.toggleNav);
  const { data } = useConversationList(false);
  const unread = (data ?? []).reduce((n, c) => n + (c.unread_count > 0 || c.marked_unread ? 1 : 0), 0);
  const calls = useQuery({ queryKey: keys.calls, queryFn: () => api.get<CallEntry[]>("/calls"), refetchInterval: 20000 });
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem("signal.callsSeen") ?? ""; } catch { return ""; } });
  const onCalls = pathname.startsWith("/calls");
  useEffect(() => {
    if (!onCalls) return;
    const now = new Date().toISOString();
    setSeen(now);
    try { localStorage.setItem("signal.callsSeen", now); } catch { /* storage unavailable */ }
  }, [onCalls, calls.data]);
  // Red badge on Calls: incoming calls I missed since I last had the Calls tab open.
  const missed = (calls.data ?? []).filter((c) => !c.outgoing && c.outcome === "missed" && c.created_at > seen).length;
  const chatsActive = pathname === "/" || pathname.startsWith("/c/");
  const callsActive = pathname.startsWith("/calls");
  const storiesActive = pathname.startsWith("/stories");
  const settingsActive = pathname.startsWith("/settings") || pathname.startsWith("/webhooks");

  return (
    <nav className={`nav-rail ${collapsed ? "is-collapsed" : ""}`} aria-label="Main">
      <button className="icon-btn nav-btn nav-menu" aria-label={collapsed ? "Show tabs" : "Hide tabs"} data-tip={collapsed ? "Show Tabs" : undefined} onClick={toggle}>
        <MenuIcon size={22} />
      </button>
      <Link href="/" className={`icon-btn nav-btn ${chatsActive ? "is-active" : ""}`} aria-label="Chats" data-tip="Chats">
        <span className="nav-btn__icon"><MessageCircle size={24} fill={chatsActive ? "currentColor" : "none"} /></span>
        <span className="nav-btn__label">Chats</span>
        {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <Link href="/calls" className={`icon-btn nav-btn ${callsActive ? "is-active" : ""}`} aria-label="Calls" data-tip="Calls">
        <span className="nav-btn__icon"><Phone size={24} fill={callsActive ? "currentColor" : "none"} /></span>
        <span className="nav-btn__label">Calls</span>
        {missed > 0 && !onCalls && <span className="badge badge--red">{missed > 99 ? "99+" : missed}</span>}
      </Link>
      <Link href="/stories" className={`icon-btn nav-btn ${storiesActive ? "is-active" : ""}`} aria-label="Stories" data-tip="Stories">
        <span className="nav-btn__icon"><RectangleVertical size={24} fill={storiesActive ? "currentColor" : "none"} /></span>
        <span className="nav-btn__label">Stories</span>
      </Link>
      <div className="nav-rail__spacer" />
      <Link href="/settings" className={`icon-btn nav-btn nav-settings ${settingsActive ? "is-active" : ""}`} aria-label="Settings" data-tip="Settings">
        <Settings size={24} />
      </Link>
    </nav>
  );
}
