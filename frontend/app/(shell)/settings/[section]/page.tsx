"use client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi, type ThemePref } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { SETTINGS_SECTIONS } from "@/components/shell/SettingsNav";
import { ContactsSettings } from "@/components/dialogs/ContactsSettings";
import { DevicesSettings } from "@/components/dialogs/DevicesSettings";
import { PrivacySettings } from "@/components/dialogs/PrivacySettings";
import { usePrefs } from "@/store/prefs";

function PrefRow({ label, sub, k }: { label: string; sub: string; k: "linkPreviews" | "sendWithEnter" | "notifyToasts" | "notifyContent" | "sounds" | "desktopNotify" }) {
  const on = usePrefs((s) => s[k]);
  return (
    <div className="setting-row">
      <div>{label}<small>{sub}</small></div>
      <Toggle label={label} checked={on} onChange={(v) => usePrefs.getState().set({ [k]: v })} />
    </div>
  );
}

/** Browser (OS-level) notifications: needs the browser's permission, asked only when the user turns this on. */
function DesktopNotifyRow() {
  const on = usePrefs((s) => s.desktopNotify);
  const supported = typeof Notification !== "undefined";
  const denied = supported && Notification.permission === "denied";
  async function change(v: boolean) {
    if (!v) return usePrefs.getState().set({ desktopNotify: false });
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm === "granted") usePrefs.getState().set({ desktopNotify: true });
    else useUi.getState().toast("Notifications are blocked in your browser settings for this site.", "error");
  }
  return (
    <div className="setting-row">
      <div>Desktop notifications<small>{!supported ? "This browser doesn't support notifications." : denied ? "Blocked in your browser settings for this site." : "Show a system notification when a message arrives while this tab is in the background."}</small></div>
      <Toggle label="Desktop notifications" checked={on && !denied} onChange={(v) => void change(v)} />
    </div>
  );
}

export default function SettingsSection() {
  const { section } = useParams<{ section: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, setUser, logout } = useAuth();
  const theme = useUi((s) => s.theme);
  const [name, setName] = useState(user?.display_name ?? "");
  const [about, setAbout] = useState(user?.about ?? "");
  const [busy, setBusy] = useState(false);
  const meta = SETTINGS_SECTIONS.find((s) => s.id === section);

  async function save() {
    setBusy(true);
    try {
      setUser({ ...(await api.patch<User>("/users/me", { display_name: name.trim(), about: about.trim() })) });
      useUi.getState().toast("Profile saved", "success");
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try { await api.post("/auth/logout"); } catch { /* token may already be invalid */ }
    logout();
    qc.clear();
    router.replace("/login");
  }

  return (
    <div className="settings has-section">
      <div className="settings__content">
        <Link href="/settings" className="icon-btn back-btn" aria-label="Back to settings"><ChevronLeft size={22} /></Link>
        <h2>{meta?.label ?? "Settings"}</h2>
        {section === "general" && user && (
          <>
            <div className="detail-hero"><Avatar id={user.id} name={user.display_name} src={user.avatar_url} size={80} /><div className="muted">{user.username ? `@${user.username}` : user.phone_number}</div></div>
            <div className="field"><label htmlFor="n">Name</label><input id="n" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field" style={{ marginTop: 12 }}><label htmlFor="a">About</label><input id="a" value={about} maxLength={140} onChange={(e) => setAbout(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <Button variant="primary" loading={busy} onClick={save} disabled={!name.trim()}>Save</Button>
              <Button variant="danger" onClick={signOut}>Log out</Button>
            </div>
          </>
        )}
        {section === "contacts" && <ContactsSettings />}
        {section === "appearance" && (
          <div className="setting-row">
            <div>Theme<small>Choose light, dark, or follow your system.</small></div>
            <div className="seg" role="group" aria-label="Theme">
              {(["system", "light", "dark"] as ThemePref[]).map((t) => (
                <button key={t} className={theme === t ? "is-on" : ""} onClick={() => useUi.getState().setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </div>
        )}
        {section === "chats" && (
          <>
            <PrefRow k="linkPreviews" label="Generate link previews" sub="Show a card for the first link in a message. The preview is fetched by the server, never by the sender's device." />
            <PrefRow k="sendWithEnter" label="Send with Enter" sub="On: Enter sends and Shift+Enter adds a line. Off: Ctrl/Cmd+Enter sends." />
          </>
        )}
        {section === "notifications" && (
          <>
            <PrefRow k="notifyToasts" label="Message notifications" sub="Show a banner when a message arrives in a chat you're not looking at." />
            {<DesktopNotifyRow />}
            <PrefRow k="notifyContent" label="Show message content" sub="Include the message text in the banner." />
            <PrefRow k="sounds" label="Play sounds" sub="Play a short chime for new messages." />
          </>
        )}
        {section === "privacy" && <PrivacySettings />}
        {section === "devices" && <DevicesSettings />}
        {!meta && <p className="muted">Unknown section.</p>}
      </div>
    </div>
  );
}
