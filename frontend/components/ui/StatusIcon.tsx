import { AlertCircle, Clock } from "lucide-react";
import type { DisplayStatus } from "@/lib/types";

const CHECK = "M5.4 9.1l2.3 2.3 4.4-4.6";

/** Message state glyphs in the style of Signal Desktop: outlined check (sent), two outlined circles (delivered),
 *  two filled circles (read). Colour comes from `currentColor`; the tick on filled circles is cut out via --tick-cut. */
export function StatusIcon({ status, size = 16 }: { status: DisplayStatus; size?: number }) {
  if (status === "sending") return <Clock size={size - 3} aria-label="Sending" />;
  if (status === "failed") return <AlertCircle size={size - 2} aria-label="Failed to send" />;
  const label = status === "sent" ? "Sent" : status === "delivered" ? "Delivered" : "Read";
  const filled = status === "read";
  const double = status !== "sent";
  const w = double ? 22 : 18;
  return (
    <svg width={(size * w) / 18} height={size} viewBox={`0 0 ${w} 18`} role="img" aria-label={label} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {double && <circle cx="8" cy="9" r="6.6" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />}
      <g transform={double ? "translate(4 0)" : undefined}>
        <circle cx="9" cy="9" r="6.6" fill={filled ? "currentColor" : "var(--tick-bg, transparent)"} stroke={filled ? "var(--tick-cut, #000)" : "currentColor"} strokeWidth={filled ? 1.8 : 1.5} />
        <path d={CHECK} stroke={filled ? "var(--tick-cut, #000)" : "currentColor"} strokeWidth="1.5" />
      </g>
    </svg>
  );
}
