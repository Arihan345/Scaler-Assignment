"use client";
import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const { token, user, hydrated, setSession } = useAuth();
  const [step, setStep] = useState<"id" | "otp">("id");
  const [identifier, setIdentifier] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (hydrated && token && user) router.replace("/");
  }, [hydrated, token, user, router]);

  async function requestOtp(e?: React.FormEvent, id = identifier) {
    e?.preventDefault();
    if (!id.trim()) return setError("Enter your phone number or username");
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/request-otp", { identifier: id.trim() });
      setIdentifier(id.trim());
      setStep("otp");
      setTimeout(() => boxes.current[0]?.focus(), 50);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ token: string; user: User; is_new_user: boolean }>("/auth/verify-otp", { identifier, otp: code });
      setSession(res.token, res.user);
      const me = await api.get<User>("/users/me"); // includes `onboarded`
      useAuth.getState().setUser(me);
      router.replace(res.is_new_user || !me.onboarded ? "/onboarding" : "/");
    } catch (err) {
      setError(errorMessage(err));
      setDigits(Array(6).fill(""));
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      const filled = [...next, ...Array(6 - next.length).fill("")];
      setDigits(filled);
      if (next.length === 6) void verify(next.join(""));
      return;
    }
    const next = digits.slice();
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) boxes.current[i + 1]?.focus();
    if (next.every(Boolean)) void verify(next.join(""));
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo"><MessageCircle size={34} /></div>
        {step === "id" ? (
          <form onSubmit={requestOtp} style={{ display: "grid", gap: 16 }}>
            <h1>Welcome to Signal</h1>
            <p className="muted" style={{ textAlign: "center", margin: 0 }}>Enter your phone number or username to continue.</p>
            <div className="field">
              <label htmlFor="identifier">Phone number or username</label>
              <input id="identifier" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="+91 98100 00001 or priya" autoComplete="username" />
              {error && <span className="field__error" role="alert">{error}</span>}
            </div>
            <Button variant="primary" type="submit" loading={busy}>Continue</Button>
            <div className="demo-hint">Demo mode: use code <b>123456</b>. No SMS is sent.</div>
            <div className="demo-chips">
              {["priya", "rohan"].map((u) => (
                <Button key={u} type="button" onClick={() => requestOtp(undefined, u)}>Sign in as {u}</Button>
              ))}
            </div>
          </form>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <h1>Enter your code</h1>
            <p className="muted" style={{ textAlign: "center", margin: 0 }}>Verification code for <b>{identifier}</b></p>
            <div className="otp-boxes">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { boxes.current[i] = el; }}
                  value={d}
                  inputMode="numeric"
                  aria-label={`Digit ${i + 1}`}
                  maxLength={6}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => e.key === "Backspace" && !digits[i] && i > 0 && boxes.current[i - 1]?.focus()}
                />
              ))}
            </div>
            {error && <span className="field__error" role="alert" style={{ textAlign: "center" }}>{error}</span>}
            <div className="demo-hint">Demo mode: use code <b>123456</b>. No SMS is sent.</div>
            <Button type="button" variant="ghost" onClick={() => { setStep("id"); setError(""); setDigits(Array(6).fill("")); }} disabled={busy}>
              Use a different number
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
