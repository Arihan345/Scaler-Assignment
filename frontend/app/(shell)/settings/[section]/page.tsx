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

function Placeholder({ rows }: { rows: [string, string, boolean][] }) {
  return (
    <>
      <div className="banner banner--info" style={{ borderRadius: 8, marginBottom: 12 }}>These options are placeholders in this demo and don't change behavior.</div>
      {rows.map(([label, sub, on]) => (
        <div className="setting-row" key={label}>
          <div>{label}<small>{sub}</small></div>
          <Toggle label={label} checked={on} disabled />
        </div>
      ))}
    </>
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
        {section === "chats" && <Placeholder rows={[["Generate link previews", "Show previews for links in messages", true], ["Send with Enter", "Press Enter to send, Shift+Enter for a new line", true]]} />}
        {section === "notifications" && <Placeholder rows={[["Message notifications", "Show a notification for new messages", true], ["Show message content", "Include text in notifications", false], ["Play sounds", "Sound when a message arrives", false]]} />}
        {section === "privacy" && <Placeholder rows={[["Read receipts", "Let others see when you've read their messages", true], ["Typing indicators", "Let others see when you're typing", true], ["Screen lock", "Require a passcode to open the app", false]]} />}
        {!meta && <p className="muted">Unknown section.</p>}
      </div>
    </div>
  );
}
