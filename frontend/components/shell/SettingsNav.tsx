"use client";
import { Bell, ChevronLeft, Lock, MessageSquare, Monitor, Palette, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: UserIcon },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "devices", label: "Linked devices", icon: Monitor },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <>
      <div className="list-header">
        <Link href="/" className="icon-btn" aria-label="Back to chats"><ChevronLeft size={22} /></Link>
        <h1>Settings</h1>
      </div>
      <nav className="settings__nav" style={{ width: "auto", border: 0 }}>
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
          <Link key={id} href={id === "devices" ? "/coming-soon/linked-devices" : `/settings/${id}`} className={pathname === `/settings/${id}` ? "is-active" : ""}>
            <Icon size={20} /> {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
