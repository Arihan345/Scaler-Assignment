"use client";
import { useState } from "react";
import { mediaUrl } from "@/lib/api";
import { colorFor } from "@/lib/colors";
import { initials } from "@/lib/format";

type Props = { name: string; id: string; src?: string | null; size?: number; online?: boolean };

export function Avatar({ name, id, src, size = 48, online }: Props) {
  const url = mediaUrl(src);
  const [broken, setBroken] = useState(false);
  const showImg = !!url && !broken;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: showImg ? undefined : colorFor(id) }}
      aria-hidden="true"
    >
      {showImg ? <img src={url!} alt="" onError={() => setBroken(true)} /> : initials(name)}
      {online && <span className="avatar__online" style={{ width: Math.max(10, size * 0.24), height: Math.max(10, size * 0.24) }} />}
    </span>
  );
}
