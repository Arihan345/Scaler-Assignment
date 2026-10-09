"use client";
import { Archive, ListFilter, MoreHorizontal, Search, Settings, SquarePen, UserPlus, X, MailQuestion } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { convTitle, previewText } from "@/lib/format";
import { useContacts, useConversationList, useUserSearch } from "@/lib/hooks";
import { keys } from "@/lib/query";
import type { ConversationDetail, User } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { ConversationRow } from "@/components/list/ConversationRow";
import { NewChatModal } from "@/components/dialogs/NewChatModal";
import { SettingsNav } from "@/components/shell/SettingsNav";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { StoriesPane } from "@/components/stories/StoriesPane";
import { CallsPane } from "@/components/shell/CallsPane";
import { OPEN_NEW_CHAT } from "./useShortcuts";

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function ListPane() {
  const pathname = usePathname();
  if (pathname.startsWith("/settings") || pathname.startsWith("/webhooks")) return <aside className="list-pane"><SettingsNav /></aside>;
  if (pathname.startsWith("/calls")) return <aside className="list-pane"><CallsPane /></aside>;
  if (pathname.startsWith("/stories")) return <aside className="list-pane"><StoriesPane /></aside>;
  return <aside className="list-pane"><Suspense fallback={null}><ChatList /></Suspense></aside>;
}

function ChatList() {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = usePathname();
  const me = useAuth((s) => s.user);
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const params = useSearchParams();
  const archived = params.get("archived") === "1";
  const showRequests = params.get("requests") === "1";
  const [newChat, setNewChat] = useState(false);
  const dq = useDebounced(q, 250);
  const list = useConversationList(archived, showRequests);
  const requests = useConversationList(false, true);
  const requestCount = requests.data?.length ?? 0;
  const contacts = useContacts();
  const found = useUserSearch(dq);
  const activeId = pathname.startsWith("/c/") ? pathname.split("/")[2] : null;

  useEffect(() => {
    const open = () => setNewChat(true);
    window.addEventListener(OPEN_NEW_CHAT, open);
    return () => window.removeEventListener(OPEN_NEW_CHAT, open);
  }, []);

  const term = q.trim().toLowerCase();
  const rows = useMemo(() => {
    let items = list.data ?? [];
    if (unreadOnly) items = items.filter((c) => c.unread_count > 0);
    if (term) items = items.filter((c) => convTitle(c).toLowerCase().includes(term) || previewText(c, me?.id).toLowerCase().includes(term));
    return items;
  }, [list.data, unreadOnly, term, me?.id]);

  const people = useMemo(() => {
    if (!term) return [] as User[];
    const byId = new Map<string, User>();
    for (const u of contacts.data ?? []) if (u.display_name.toLowerCase().includes(term) || u.username?.toLowerCase().includes(term)) byId.set(u.id, { ...u, is_contact: true });
    for (const u of found.data ?? []) if (!byId.has(u.id)) byId.set(u.id, u);
    // people you already chat with directly are shown above as conversations
    const direct = new Set((list.data ?? []).filter((c) => c.peer).map((c) => c.peer!.id));
    return [...byId.values()].filter((u) => !direct.has(u.id));
  }, [term, contacts.data, found.data, list.data]);

  async function openPerson(u: User) {
    try {
      const conv = await api.post<ConversationDetail>("/conversations/direct", { user_id: u.id });
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
      setQ("");
      router.push(`/c/${conv.id}`);
    } catch {
      useUi.getState().toast("Couldn't open chat", "error");
    }
  }

  async function addContact(u: User) {
    try {
      await api.post("/contacts", { user_id: u.id });
      qc.invalidateQueries({ queryKey: keys.contacts });
      qc.invalidateQueries({ queryKey: ["user-search"] });
      useUi.getState().toast(`${u.display_name} added to contacts`, "success");
    } catch {
      useUi.getState().toast("Couldn't add contact", "error");
    }
  }

  if (newChat) return <NewChatModal onClose={() => setNewChat(false)} />;

  return (
    <>
      <div className="list-header">
        {me && <button className="only-xs phone-avatar" aria-label="Settings" onClick={() => router.push("/settings")}><Avatar id={me.id} name={me.display_name} src={me.avatar_url} size={34} /></button>}
        <h1>{archived ? "Archived chats" : showRequests ? "Message requests" : "Chats"}</h1>
        <IconButton label="New chat (Ctrl+N)" onClick={() => setNewChat(true)}><SquarePen size={22} /></IconButton>
        <Menu trigger={<span className="icon-btn" role="button" aria-label="More options" tabIndex={0}><MoreHorizontal size={22} /></span>} items={[
          archived || showRequests
            ? { label: "Back to chats", icon: <X size={16} />, onClick: () => router.push("/") }
            : { label: "View Archive", icon: <Archive size={16} />, onClick: () => router.push("/?archived=1") },
          { label: "Settings", icon: <Settings size={16} />, onClick: () => router.push("/settings") },
        ]} />
      </div>
      <div className="search-row">
        <div className="search">
          <Search size={18} />
          <input id="chat-search" type="search" placeholder={unreadOnly ? "Search unread chats" : "Search"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats and contacts (Ctrl+K)" />
        </div>
        {!archived && (
          <button className={`icon-btn ${unreadOnly ? "is-on" : ""}`} aria-label="Filter by unread" aria-pressed={unreadOnly} data-tip="Filter by unread" onClick={() => setUnreadOnly((u) => !u)}><ListFilter size={22} /></button>
        )}
      </div>
      {unreadOnly && !archived && <div className="filter-note filter-note--bold">Filtered by unread</div>}
      <div className="list-scroll">
        {list.isLoading ? (
          <ListSkeleton />
        ) : list.isError ? (
          <ErrorState message="Couldn't load your chats." onRetry={() => list.refetch()} />
        ) : (
          <>
            {!archived && !showRequests && !term && requestCount > 0 && (
              <div className="conv-row request-row" role="button" tabIndex={0} onClick={() => router.push("/?requests=1")} onKeyDown={(e) => e.key === "Enter" && router.push("/?requests=1")}>
                <span className="avatar request-row__icon"><MailQuestion size={22} /></span>
                <div className="conv-row__body">
                  <div className="conv-row__title">Message requests</div>
                  <div className="conv-row__preview">{requestCount} {requestCount === 1 ? "person wants" : "people want"} to chat with you</div>
                </div>
                <span className="badge">{requestCount}</span>
              </div>
            )}
            {term && rows.length > 0 && <div className="list-section">Chats</div>}
            {rows.map((c) => (
              <ConversationRow key={c.id} item={c} active={c.id === activeId} onOpen={() => router.push(`/c/${c.id}`)} />
            ))}
            {term && people.length > 0 && <div className="list-section">Contacts</div>}
            {people.map((u) => (
              <div key={u.id} className="conv-row" role="button" tabIndex={0} onClick={() => openPerson(u)} onKeyDown={(e) => e.key === "Enter" && openPerson(u)}>
                <Avatar id={u.id} name={u.display_name} src={u.avatar_url} />
                <div className="conv-row__body">
                  <div className="conv-row__title">{u.display_name}</div>
                  <div className="conv-row__preview">{u.username ? `@${u.username}` : u.phone_number}</div>
                </div>
                {!u.is_contact && <IconButton label="Add to contacts" onClick={(e) => { e.stopPropagation(); void addContact(u); }}><UserPlus size={18} /></IconButton>}
              </div>
            ))}
            {rows.length === 0 && people.length === 0 && (
              <EmptyState title={term ? (unreadOnly ? `No results for "${q.trim()}" in unread chats` : "No results") : unreadOnly ? "No unread chats" : archived ? "No archived chats" : showRequests ? "No message requests" : "No chats"}>
                {term ? (unreadOnly ? undefined : `Nothing matches “${q}”.`) : !unreadOnly && !archived && !showRequests ? "Recent chats will appear here." : undefined}
                {unreadOnly && <div style={{ marginTop: 14 }}><button className="btn btn--secondary" onClick={() => setUnreadOnly(false)}>Clear filter</button></div>}
              </EmptyState>
            )}
          </>
        )}
      </div>
    </>
  );
}
