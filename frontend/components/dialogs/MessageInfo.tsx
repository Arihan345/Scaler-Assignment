"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { clock, dayLabel } from "@/lib/format";
import type { Message, User } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";

type Recipient = { user: User; state: "sent" | "delivered" | "read" };

export function MessageInfo({ message, onClose }: { message: Message; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["receipts", message.id],
    queryFn: () => api.get<{ recipients: Recipient[] }>(`/messages/${message.id}/receipts`),
  });
  const group = (s: Recipient["state"]) => (data?.recipients ?? []).filter((r) => r.state === s);
  const section = (label: string, s: Recipient["state"], icon: React.ReactNode) =>
    group(s).length > 0 && (
      <div key={s}>
        <div className="list-section" style={{ padding: "12px 0 4px" }}>{icon} {label}</div>
        {group(s).map((r) => (
          <div className="member-row" key={r.user.id}>
            <Avatar id={r.user.id} name={r.user.display_name} src={r.user.avatar_url} size={32} />
            <div>{r.user.display_name}</div>
          </div>
        ))}
      </div>
    );
  return (
    <Modal title="Message info" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Sent {dayLabel(message.created_at)} at {clock(message.created_at)}</p>
      {isLoading && <p className="muted">Loading…</p>}
      {isError && <p className="field__error">Couldn't load delivery details.</p>}
      {data && data.recipients.length === 0 && <p className="muted">No recipients yet.</p>}
      {section("Read", "read", <CheckCheck size={12} />)}
      {section("Delivered", "delivered", <CheckCheck size={12} />)}
      {section("Sent", "sent", <Check size={12} />)}
    </Modal>
  );
}
