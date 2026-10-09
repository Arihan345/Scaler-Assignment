"use client";
import { Bell, ChevronLeft, CircleUser, Heart, History, Lock, MessageCircle, Palette, Phone, PieChart, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { useAuth } from "@/store/auth";

// Same order as Signal Desktop. "general" is the profile page (reached from the profile card), "devices" is Account.
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: CircleUser, group: -1 },
  { id: "devices", label: "Account", icon: CircleUser, group: 0 },
  { id: "donate", label: "Donate to Signal", icon: Heart, group: 0 },
  { id: "general", label: "General", icon: Settings, group: 1 },
  { id: "appearance", label: "Appearance", icon: Palette, group: 1 },
  { id: "chats", label: "Chats", icon: MessageCircle, group: 1 },
  { id: "calls", label: "Calls", icon: Phone, group: 1 },
  { id: "notifications", label: "Notifications", icon: Bell, group: 1 },
  { id: "privacy", label: "Privacy", icon: Lock, group: 1 },
  { id: "data", label: "Data usage", icon: PieChart, group: 1 },
  { id: "backups", label: "Backups", icon: History, group: 1 },
  { id: "contacts", label: "Contacts", icon: Users, group: 2 },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const me = useAuth((s) => s.user);
  const href = (id: string) => `/settings/${id}`;
  const active = (id: string) => pathname === href(id);
  const items = SETTINGS_SECTIONS.filter((s) => s.id !== "profile");
  return (
    <>
      <div className="list-header">
        <Link href="/" className="icon-btn only-xs" aria-label="Back to chats"><ChevronLeft size={22} /></Link>
        <h1>Settings</h1>
      </div>
      <nav className="settings__nav" style={{ width: "auto", border: 0 }}>
        {me && (
          <Link href="/settings/profile" className={`settings__profile ${active("profile") ? "is-active" : ""}`}>
            <Avatar id={me.id} name={me.display_name} src={me.avatar_url} size={56} />
            <span><b>{me.display_name}</b><small>{me.phone_number ?? (me.username ? `@${me.username}` : "")}</small></span>
          </Link>
        )}
        {items.map(({ id, label, icon: Icon, group }, i) => (
          <div key={id} style={{ display: "contents" }}>
            {i > 0 && group !== items[i - 1].group && <div className="settings__sep" />}
            <Link href={href(id)} className={active(id) ? "is-active" : ""}><Icon size={22} /> {label}</Link>
          </div>
        ))}
      </nav>
    </>
  );
}
