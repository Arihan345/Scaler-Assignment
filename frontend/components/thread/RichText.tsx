"use client";
import type { ReactNode } from "react";

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** First http(s) link in a message, used for the link-preview card. */
export function firstUrl(body: string | null): string | null {
  const m = body ? body.match(URL_RE) : null;
  return m ? m[0].replace(/[.,);!?]+$/, "") : null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Message text with clickable links and highlighted @mentions (only names that were actually mentioned). */
export function RichText({ body, mentionNames = [] }: { body: string; mentionNames?: string[] }) {
  const names = mentionNames.filter(Boolean).sort((a, b) => b.length - a.length);
  const mentionRe = names.length ? new RegExp(`(@(?:${names.map(esc).join("|")}))`, "g") : null;
  const out: ReactNode[] = [];
  let key = 0;
  const pushText = (t: string) => {
    if (!mentionRe) return out.push(t);
    t.split(mentionRe).forEach((part, i) => {
      if (i % 2 === 1) out.push(<span key={key++} className="mention">{part}</span>);
      else if (part) out.push(part);
    });
  };
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const url = raw.replace(/[.,);!?]+$/, "");
    if (start > last) pushText(body.slice(last, start));
    out.push(<a key={key++} className="msg-link" href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>);
    last = start + url.length;
  }
  if (last < body.length) pushText(body.slice(last));
  return <span>{out}</span>;
}
