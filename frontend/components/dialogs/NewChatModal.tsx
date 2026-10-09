"use client";
import { ArrowLeft, AtSign, BadgeCheck, Check, ChevronLeft, Hash, Search, UserPlus, Users } from "lucide-react";
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
  const showNote = !isGroup && (!term || "note to self".includes(term));
  const seed = (v: string) => { setQ(v); document.getElementById("nc-search")?.focus(); };
  return (
    <>
      <div className="nc-head">
        <button className="icon-btn" aria-label="Back" onClick={() => (isGroup ? setMode("direct") : onClose())}><ChevronLeft size={22} /></button>
        <h1>{isGroup ? "Add members" : "New chat"}</h1>
        {isGroup && <button className="btn btn--primary" style={{ marginLeft: "auto", position: "relative" }} disabled={picked.length === 0} onClick={() => { setError(""); setMode("name"); }}>Next</button>}
      </div>
      <div className="search-row">
        <div className="search">
          <Search size={18} />
          <input id="nc-search" autoFocus placeholder="Name, username, or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </div>
      </div>
      <div className="list-scroll">
        {!isGroup && !term && (
          <>
            <button className="nc-row" onClick={() => { setMode("group"); setPicked([]); }}><span className="nc-row__icon"><Users size={20} /></span><span className="nc-row__name">New group</span></button>
            <button className="nc-row" onClick={() => seed("@")}><span className="nc-row__icon"><AtSign size={20} /></span><span className="nc-row__name">Find by username</span></button>
            <button className="nc-row" onClick={() => seed("+")}><span className="nc-row__icon"><Hash size={20} /></span><span className="nc-row__name">Find by phone number</span></button>
          </>
        )}
        {error && <span className="field__error" style={{ padding: "0 16px" }}>{error}</span>}
        {(people.length > 0 || showNote) && <div className="list-section">Contacts</div>}
        {showNote && (
          <button className="nc-row" onClick={async () => {
            try {
              const conv = await api.post<ConversationDetail>("/conversations/note-to-self");
              qc.invalidateQueries({ queryKey: keys.conversationsAll });
              onClose();
              router.push(`/c/${conv.id}`);
            } catch (e) { setError(errorMessage(e)); }
          }}>
            <Avatar note id="note" name="Note to Self" size={40} />
            <span className="nc-row__name">Note to Self</span>
            <BadgeCheck size={16} color="var(--blue-solid)" aria-label="Verified" />
          </button>
        )}
        {people.length === 0 && !showNote && <p className="muted" style={{ textAlign: "center" }}>{term.length >= 2 ? "No people found." : "Type a name, username or number."}</p>}
        {people.map((u) => (
          <div key={u.id} className="nc-row" role="button" tabIndex={0} onClick={() => (isGroup ? toggle(u) : !busy && openDirect(u))} onKeyDown={(e) => e.key === "Enter" && (isGroup ? toggle(u) : openDirect(u))}>
            <Avatar id={u.id} name={u.display_name} src={u.avatar_url} size={40} />
            <span className="nc-row__name">{u.display_name}</span>
            {isGroup && picked.some((x) => x.id === u.id) && <Check size={18} color="var(--blue-solid)" />}
            {!isGroup && !u.is_contact && (
              <button className="icon-btn" aria-label="Add to contacts" title="Add to contacts" onClick={(e) => { e.stopPropagation(); void addContact(u); }}><UserPlus size={18} /></button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
