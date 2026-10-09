"use client";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useContacts } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { ConversationDetail, User } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

/** Contacts management: add a contact by phone number, message them, or remove them. */
export function ContactsSettings() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useContacts();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<User | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setError("");
    try {
      const u = await api.post<User>("/contacts", { identifier: phone.trim() });
      setPhone("");
      qc.invalidateQueries({ queryKey: keys.contacts });
      useUi.getState().toast(`${u.display_name} added to contacts`, "success");
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg === "User not found" || msg.toLowerCase().includes("not found") ? "No one is registered with that phone number." : msg);
    } finally {
      setBusy(false);
    }
  }

  async function message(u: User) {
    try {
      const conv = await api.post<ConversationDetail>("/conversations/direct", { user_id: u.id });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      router.push(`/c/${conv.id}`);
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  async function remove(u: User) {
    try {
      await api.del(`/contacts/${u.id}`);
      qc.invalidateQueries({ queryKey: keys.contacts });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <form onSubmit={add} className="card">
        <div className="field">
          <label htmlFor="cp">Add a contact by phone number</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="cp" type="tel" style={{ flex: 1 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98100 00002 or +91 98100 00002" />
            <Button type="submit" variant="primary" loading={busy} disabled={!phone.trim()}>Add</Button>
          </div>
          {error && <span className="field__error" role="alert">{error}</span>}
        </div>
      </form>
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && !data?.length && <EmptyState title="No contacts yet">Add someone by phone number above.</EmptyState>}
      {(data ?? []).map((u) => (
        <div className="member-row" key={u.id}>
          <Avatar id={u.id} name={u.display_name} src={u.avatar_url} size={44} />
          <div>
            <div style={{ fontWeight: 600 }}>{u.display_name}</div>
            <div className="muted" style={{ fontSize: 13 }}>{u.phone_number ?? (u.username ? `@${u.username}` : "")}</div>
          </div>
          <IconButton label={`Message ${u.display_name}`} onClick={() => message(u)}><MessageSquare size={20} /></IconButton>
          <IconButton label={`Remove ${u.display_name}`} onClick={() => setRemoving(u)}><UserMinus size={20} /></IconButton>
        </div>
      ))}
      {removing && <ConfirmDialog title="Remove contact?" message={`${removing.display_name} will be removed from your contacts. Existing chats stay.`} confirmLabel="Remove" danger onConfirm={() => remove(removing)} onClose={() => setRemoving(null)} />}
    </>
  );
}
