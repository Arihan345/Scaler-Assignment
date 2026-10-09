"use client";
import { useEffect, useState } from "react";
import { API_URL } from "./api";
import { useAuth } from "@/store/auth";

// Attachments sit behind authorization, and <img> can't send a bearer header, so we fetch them
// as blobs and hand the browser an object URL. A small in-memory cache avoids refetching.
const cache = new Map<string, Promise<string>>();

export function fetchAttachmentUrl(id: string): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    const token = useAuth.getState().token;
    p = fetch(`${API_URL}/api/attachments/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error("download failed");
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function useAuthedMedia(id: string | null): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    let alive = true;
    if (!id) return;
    fetchAttachmentUrl(id)
      .then((url) => alive && setState({ url, error: false }))
      .catch(() => alive && setState({ url: null, error: true }));
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

export async function downloadAttachment(id: string, name: string) {
  const url = await fetchAttachmentUrl(id);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
