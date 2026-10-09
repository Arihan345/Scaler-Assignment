"use client";
import { ArrowLeft, Check, UserPlus, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useContacts, useUserSearch } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { ConversationDetail, User } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** Step 1: pick a person (or "New group"). Step 2 (group): choose members + name. */
export function NewChatModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"direct" | "group" | "name">("direct");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<User[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contacts = useContacts();
  const search = useUserSearch(q);

  const term = q.trim().toLowerCase();
  const people = useMemo(() => {
    const byId = new Map<string, User>();
    for (const u of contacts.data ?? []) if (!term || u.display_name.toLowerCase().includes(term) || u.username?.toLowerCase().includes(term)) byId.set(u.id, { ...u, is_contact: true });
    for (const u of search.data ?? []) if (!byId.has(u.id)) byId.set(u.id, u);
    return [...byId.values()];
  }, [contacts.data, search.data, term]);

  async function openDirect(u: User) {
    setBusy(true);
    try {
      const conv = await api.post<ConversationDetail>("/conversations/direct", { user_id: u.id });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      onClose();
      router.push(`/c/${conv.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function addContact(u: User) {
    try {
      await api.post("/contacts", { user_id: u.id });
      qc.invalidateQueries({ queryKey: keys.contacts });
      qc.invalidateQueries({ queryKey: ["user-search"] });
      useUi.getState().toast(`${u.display_name} added to contacts`, "success");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function createGroup() {
    if (!title.trim()) return setError("Give the group a name");
    setBusy(true);
    setError("");
    try {
      const conv = await api.post<ConversationDetail>("/conversations/groups", { title: title.trim(), member_ids: picked.map((p) => p.id) });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      onClose();
      router.push(`/c/${conv.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const toggle = (u: User) => setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));

  if (mode === "name") {
    return (
      <Modal
        title="New group"
        onClose={onClose}
        footer={<>
          <Button onClick={() => setMode("group")}><ArrowLeft size={16} /> Back</Button>
          <Button variant="primary" loading={busy} onClick={createGroup}>Create</Button>
        </>}
      >
        <div className="field">
          <label htmlFor="gname">Group name</label>
          <input id="gname" autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createGroup()} />
          {error && <span className="field__error">{error}</span>}
        </div>
        <p className="muted">{picked.length} member{picked.length === 1 ? "" : "s"}: {picked.map((p) => p.display_name).join(", ")}</p>
      </Modal>
    );
  }

  const isGroup = mode === "group";
  return (
    <Modal
      title={isGroup ? "Add members" : "New chat"}
      onClose={onClose}
      footer={isGroup ? <Button variant="primary" disabled={picked.length === 0} onClick={() => { setError(""); setMode("name"); }}>Next</Button> : undefined}
    >
      <div className="field" style={{ marginBottom: 8 }}>
        <input autoFocus placeholder="Search name, username or phone number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      </div>
      {!isGroup && (
        <button className="pick-row" onClick={() => { setMode("group"); setPicked([]); }}>
          <span className="avatar" style={{ width: 40, height: 40, background: "var(--blue)" }}><Users size={20} /></span>
          <b>New group</b>
        </button>
      )}
      {error && <span className="field__error">{error}</span>}
      {people.length === 0 && <p className="muted" style={{ textAlign: "center" }}>{term.length >= 2 ? "No people found." : "Add contacts to see them here, or search to find people."}</p>}
      {people.map((u) => (
        <div key={u.id} className="pick-row" role="button" tabIndex={0} onClick={() => (isGroup ? toggle(u) : !busy && openDirect(u))} onKeyDown={(e) => e.key === "Enter" && (isGroup ? toggle(u) : openDirect(u))}>
          <Avatar id={u.id} name={u.display_name} src={u.avatar_url} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{u.display_name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{u.username ? `@${u.username}` : u.phone_number}</div>
          </div>
          {isGroup && picked.some((p) => p.id === u.id) && <Check size={18} color="var(--blue)" />}
          {!isGroup && !u.is_contact && (
            <button className="icon-btn" aria-label="Add to contacts" title="Add to contacts" onClick={(e) => { e.stopPropagation(); void addContact(u); }}>
              <UserPlus size={18} />
            </button>
          )}
        </div>
      ))}
    </Modal>
  );
}
