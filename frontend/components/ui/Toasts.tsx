"use client";
import Link from "next/link";
import { useUi } from "@/store/ui";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status" onClick={() => dismiss(t.id)}>
          <span>{t.text}</span>
          {t.action && (
            <Link href={t.action.href} className="toast__action" onClick={() => dismiss(t.id)}>
              {t.action.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
