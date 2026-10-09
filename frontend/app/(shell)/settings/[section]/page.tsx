"use client";
import { ChevronLeft, Contrast, LogOut, Pencil, User as UserIcon } from "lucide-react";
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

function PrefRow({ label, sub, k }: { label: string; sub: string; k: "linkPreviews" | "sendWithEnter" | "incomingCalls" | "notifyToasts" | "notifyContent" | "sounds" | "desktopNotify" }) {
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

  const title = section === "profile" ? "Profile" : meta?.label ?? "Settings";
  return (
    <div className="settings has-section">
      <div className="settings__content">
        <div className="settings__title">
          <Link href="/settings" className="icon-btn back-btn" aria-label="Back to settings"><ChevronLeft size={22} /></Link>
          <h2>{title}</h2>
        </div>
        <div className="settings__inner">
        {section === "profile" && user && (
          <>
            <div className="profile-hero"><Avatar id={user.id} name={user.display_name} src={user.avatar_url} size={108} /></div>
            <div className="card">
              <label className="field-row" htmlFor="n"><UserIcon size={20} /><input id="n" placeholder="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field-row" htmlFor="a"><Pencil size={20} /><input id="a" placeholder="About" value={about} maxLength={140} onChange={(e) => setAbout(e.target.value)} /></label>
            </div>
            <p className="card-note">Your profile and changes to it will be visible to people you message, contacts and groups.</p>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <Button variant="primary" loading={busy} onClick={save} disabled={!name.trim() || (name.trim() === user.display_name && about.trim() === (user.about ?? ""))}>Save</Button>
            </div>
          </>
        )}
        {section === "contacts" && <ContactsSettings />}
        {section === "appearance" && (
          <div className="card">
            <div className="setting-row">
              <span className="setting-row__icon"><Contrast size={20} /></span>
              <div>Theme</div>
              <select className="pill-select" aria-label="Theme" value={theme} onChange={(e) => useUi.getState().setTheme(e.target.value as ThemePref)}>
                {(["system", "light", "dark"] as ThemePref[]).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
        )}
        {section === "chats" && (
          <div className="card">
            <PrefRow k="linkPreviews" label="Generate link previews" sub="Retrieve link previews directly from websites for messages you send." />
            <PrefRow k="sendWithEnter" label="Send with Enter" sub="On: Enter sends and Shift+Enter adds a line. Off: Ctrl/Cmd+Enter sends." />
          </div>
        )}
        {section === "calls" && (
          <div className="card">
            <PrefRow k="incomingCalls" label="Enable incoming calls" sub="When off, incoming calls are declined automatically." />
          </div>
        )}
        {section === "notifications" && (
          <>
            <div className="card">
              <PrefRow k="notifyToasts" label="Enable notifications" sub="Show a banner when a message arrives in a chat you're not looking at." />
              <DesktopNotifyRow />
              <PrefRow k="notifyContent" label="Show message content" sub="Include the message text in the banner." />
            </div>
            <h3 className="settings__h">Sounds</h3>
            <div className="card">
              <PrefRow k="sounds" label="In-chat message sounds" sub="Hear a notification sound for sent and received messages while in the chat." />
            </div>
          </>
        )}
        {section === "privacy" && <PrivacySettings />}
        {section === "devices" && (
          <>
            <div className="card"><button className="setting-row setting-row--btn is-danger" onClick={signOut}><LogOut size={20} /><div>Log out</div></button></div>
            <h3 className="settings__h">Linked devices</h3>
            <div className="card"><DevicesSettings /></div>
          </>
        )}
        {section === "general" && (
          <div className="card"><div className="setting-row"><div>Language<small>English</small></div></div></div>
        )}
        {(section === "donate" || section === "data" || section === "backups") && (
          <div className="card"><div className="setting-row"><div>Not available in this demo<small>
            {section === "donate" ? "Donations go through Signal's real service, which this clone doesn't connect to." : section === "data" ? "Media auto-download and quality settings aren't implemented; images and files are always fetched on demand." : "Messages live in this app's own database, so there's nothing to back up to a device."}
          </small></div></div></div>
        )}
        {!meta && <p className="muted">Unknown section.</p>}
        </div>
      </div>
    </div>
  );
}
