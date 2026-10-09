"use client";
import { Circle, MessageSquare, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConversationList } from "@/lib/hooks";
import { useAuth } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";

export function NavRail() {
  const pathname = usePathname();
  const user = useAuth((s) => s.user);
  const { data } = useConversationList(false);
  const unread = (data ?? []).reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0);
  const active = (p: string) => (p === "/" ? pathname === "/" || pathname.startsWith("/c/") : pathname.startsWith(p));
  const item = (href: string, label: string, icon: React.ReactNode, badge?: number) => (
    <Link key={href} href={href} className={`icon-btn ${active(href) ? "is-active" : ""}`} aria-label={label} title={label}>
      {icon}
      {!!badge && <span className="badge">{badge > 99 ? "99+" : badge}</span>}
    </Link>
  );
  return (
    <nav className="nav-rail" aria-label="Main">
      {item("/", "Chats", <MessageSquare size={22} />, unread)}
      {item("/coming-soon/stories", "Stories", <Circle size={22} />)}
      {item("/webhooks", "Webhooks", <Webhook size={22} />)}
      <div className="nav-rail__spacer" />
      {item("/settings", "Settings", <Settings size={22} />)}
      {user && <Link href="/settings/general" aria-label="Profile" className="icon-btn"><Avatar id={user.id} name={user.display_name} src={user.avatar_url} size={32} /></Link>}
    </nav>
  );
}
