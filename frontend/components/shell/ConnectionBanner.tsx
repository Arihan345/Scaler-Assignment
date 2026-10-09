"use client";
import { useEffect, useState } from "react";
import { useUi } from "@/store/ui";

/** Quiet by design: only appears if the socket has been down for a few seconds (brief reconnects stay invisible). */
export function ConnectionBanner() {
  const status = useUi((s) => s.socketStatus);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === "open" || status === "idle") { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(t);
  }, [status]);
  if (!show) return null;
  return <div className="banner" role="status">Reconnecting… messages still send, live updates are delayed.</div>;
}
