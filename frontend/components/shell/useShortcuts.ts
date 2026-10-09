"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export const OPEN_NEW_CHAT = "signal:new-chat";

/** Ctrl/Cmd+K focuses search, Ctrl/Cmd+N opens New chat, Esc leaves the open thread (when no dialog is open). */
export function useShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (document.getElementById("chat-search") as HTMLInputElement | null)?.focus();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        window.dispatchEvent(new Event(OPEN_NEW_CHAT));
      } else if (e.key === "Escape" && pathname !== "/" && !document.querySelector(".modal-backdrop, .menu-overlay, .lightbox")) {
        const t = e.target as HTMLElement;
        if (t.id === "chat-search") (t as HTMLInputElement).blur();
        else router.push("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);
}
