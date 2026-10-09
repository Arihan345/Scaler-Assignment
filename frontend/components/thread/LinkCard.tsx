"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";
import type { LinkPreview } from "@/lib/types";

/** Preview card for the first link in a message. The server fetches the page (SSRF-guarded); failures show nothing. */
export function LinkCard({ url }: { url: string }) {
  const { data } = useQuery({
    queryKey: keys.preview(url),
    queryFn: async () => (await api.get<{ preview: LinkPreview | null }>(`/link-preview?url=${encodeURIComponent(url)}`)).preview,
    staleTime: Infinity,
    retry: false,
  });
  if (!data) return null;
  return (
    <a className="link-card" href={data.url} target="_blank" rel="noopener noreferrer nofollow">
      {data.image && <img src={data.image} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />}
      <div className="link-card__text">
        <b>{data.title}</b>
        {data.description && <span>{data.description}</span>}
        <small>{data.site}</small>
      </div>
    </a>
  );
}
