"use client";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";

export default function OnboardingPage() {
  const router = useRouter();
  const { token, user, hydrated, setUser } = useAuth();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) router.replace("/login");
    else if (user?.onboarded) router.replace("/");
  }, [hydrated, token, user, router]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name");
    setBusy(true);
    setError("");
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await api.upload<User>("/users/me/avatar", form);
      }
      const updated = await api.patch<User>("/users/me", { display_name: name.trim(), about: about.trim() });
      setUser(updated);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Your profile</h1>
        <p className="muted" style={{ textAlign: "center", margin: 0 }}>Signal profiles are visible to people you message.</p>
        <button type="button" onClick={() => input.current?.click()} aria-label="Choose profile photo" style={{ justifySelf: "center", position: "relative" }}>
          {preview ? <img src={preview} alt="" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover" }} /> : <Avatar id={user?.id ?? "me"} name={name || "?"} size={96} />}
          <span className="icon-btn" style={{ position: "absolute", right: -4, bottom: -4, background: "var(--bg-pane)", border: "1px solid var(--border)" }}><Camera size={16} /></span>
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) { setFile(f); setPreview(URL.createObjectURL(f)); }
        }} />
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="about">About (optional)</label>
          <input id="about" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={140} placeholder="Say something about yourself" />
        </div>
        {error && <span className="field__error" role="alert">{error}</span>}
        <Button variant="primary" type="submit" loading={busy}>Finish</Button>
      </form>
    </main>
  );
}
