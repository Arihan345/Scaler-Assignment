"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Lock } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { retrySend } from "@/lib/actions";
import { convTitle, dayKey, dayLabel, systemText } from "@/lib/format";
import { keys, markDeleted, mergeOlder, removeMessages } from "@/lib/query";
import { scheduleRead } from "@/lib/realtime";
import { computeStatus } from "@/lib/status";
import type { ConversationDetail, DisplayStatus, Message, MessagesPage, OutboxItem } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmDialog } from "@/components/ui/Modal";
import { ErrorState } from "@/components/ui/EmptyState";
import { ThreadSkeleton } from "@/components/ui/Skeleton";
import { MessageInfo } from "@/components/dialogs/MessageInfo";
import { ForwardModal } from "@/components/dialogs/ForwardModal";
import { MessageBubble } from "./MessageBubble";

const GROUP_WINDOW_MS = 5 * 60_000;
const PENDING_SEQ = 1e12;

type Row = { key: string; msg: Message; pending?: OutboxItem };

function pendingToMessage(o: OutboxItem, i: number, meId: string): Message {
  return {
    id: -(i + 1), conversation_id: o.conversation_id, seq: PENDING_SEQ + i, sender_id: meId, client_message_id: o.client_message_id,
    type: "TEXT", body: o.body || null, system_event: null, reply_to: o.reply_to ? { id: o.reply_to.id, seq: o.reply_to.seq, sender_id: o.reply_to.sender_id, snippet: o.reply_to.body ?? "", deleted: false } : null,
    attachments: [], reactions: [], created_at: o.created_at, expires_at: null, deleted_at: null, edited_at: null, status: null,
  };
}

export type JumpTarget = { id: number; seq: number; n: number };

export function MessageList({ convId, detail, meId, jump }: { convId: string; detail: ConversationDetail; meId: string; jump: JumpTarget | null }) {
  const qc = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [visible, setVisible] = useState(true);
  const [toDelete, setToDelete] = useState<Message | null>(null);
  const [info, setInfo] = useState<Message | null>(null);
  const [forward, setForward] = useState<Message | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const prevLast = useRef<{ key: string; count: number } | null>(null);
  const lastAcked = useRef(0);
  const dividerSeq = useRef<number | null | undefined>(undefined);
  const outbox = useUi((s) => s.outbox[convId]);
  const typing = useUi((s) => s.typing[convId]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: keys.messages(convId),
    queryFn: () => api.get<MessagesPage>(`/conversations/${convId}/messages?limit=50`),
    staleTime: Infinity,
  });

  const members = detail.members;
  const byId = useMemo(() => new Map(members.map((m) => [m.user.id, m.user] as const)), [members]);
  const me = members.find((m) => m.user.id === meId);

  const rows: Row[] = useMemo(() => {
    const msgs = data?.messages ?? [];
    const known = new Set(msgs.map((m) => m.client_message_id).filter(Boolean));
    const pend = (outbox ?? []).filter((o) => !known.has(o.client_message_id));
    return [...msgs.map((m) => ({ key: `m${m.id}`, msg: m })), ...pend.map((o, i) => ({ key: `p${o.client_message_id}`, msg: pendingToMessage(o, i, meId), pending: o }))];
  }, [data, outbox, meId]);

  // The "New messages" divider is decided once, from the read position at the moment the chat was opened.
  if (dividerSeq.current === undefined && data) {
    const readAtOpen = me?.last_read_seq ?? 0;
    const first = data.messages.find((m) => m.seq > readAtOpen && m.sender_id !== meId && m.type !== "SYSTEM");
    dividerSeq.current = first?.seq ?? null;
  }

  // Keep scroll stable when older pages are prepended.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    }
  }, [data?.messages[0]?.id]);

  // Stick to bottom for own messages / when already at bottom; otherwise count unseen arrivals.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || rows.length === 0) return;
    const last = rows[rows.length - 1];
    const prev = prevLast.current;
    prevLast.current = { key: last.key, count: rows.length };
    const toBottom = () => { el.scrollTop = el.scrollHeight; };
    if (!prev) { toBottom(); return; }
    if (last.key !== prev.key && rows.length >= prev.count) {
      if (last.msg.sender_id === meId || atBottom) toBottom();
      else setNewCount((n) => n + 1);
    }
  }, [rows, atBottom, meId]);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Read ack: only when the newest message is actually on screen in a focused tab.
  useEffect(() => {
    if (!data || !atBottom || !visible || data.has_more_after) return;
    const lastSeq = data.messages.length ? data.messages[data.messages.length - 1].seq : 0;
    const cursor = Math.max(me?.last_read_seq ?? 0, lastAcked.current);
    if (lastSeq > cursor) {
      lastAcked.current = lastSeq;
      scheduleRead(qc, convId, lastSeq);
    }
  }, [data, atBottom, visible, me?.last_read_seq, qc, convId]);

  const loadOlder = useCallback(async () => {
    const first = data?.messages[0];
    const el = box.current;
    if (!first || !el || loadingOlder || !data?.has_more_before) return;
    setLoadingOlder(true);
    anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    try {
      const page = await api.get<MessagesPage>(`/conversations/${convId}/messages?before_seq=${first.seq}&limit=50`);
      mergeOlder(qc, convId, page);
    } catch (e) {
      anchor.current = null;
      useUi.getState().toast(errorMessage(e), "error");
    } finally {
      setLoadingOlder(false);
    }
  }, [data, convId, loadingOlder, qc]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(near);
    if (near) setNewCount(0);
    if (el.scrollTop < 120) void loadOlder();
  }

  const scrollBottom = async () => {
    const el = box.current;
    if (data?.has_more_after) {
      // We're viewing an older window (after a search jump): reload the latest page first.
      try { qc.setQueryData(keys.messages(convId), await api.get<MessagesPage>(`/conversations/${convId}/messages?limit=50`)); } catch (e) { useUi.getState().toast(errorMessage(e), "error"); return; }
      requestAnimationFrame(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; });
      return;
    }
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // Jump to a search result: if it isn't loaded, load the window around it first.
  useEffect(() => {
    if (!jump) return;
    let cancelled = false;
    (async () => {
      if (!document.getElementById(`m-${jump.id}`)) {
        try {
          qc.setQueryData(keys.messages(convId), await api.get<MessagesPage>(`/conversations/${convId}/messages?around_seq=${jump.seq}&limit=50`));
        } catch (e) { useUi.getState().toast(errorMessage(e), "error"); return; }
        await new Promise((r) => setTimeout(r, 80));
      }
      if (cancelled) return;
      const el = document.getElementById(`m-${jump.id}`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      setNewCount(0);
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1700);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n]);

  async function hideForMe(m: Message) {
    try {
      await api.post(`/messages/${m.id}/hide`);
      removeMessages(qc, convId, [m.id]);
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  const jumpToReply = (id: number) => {
    const el = document.getElementById(`m-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    else useUi.getState().toast("That message is further back. Scroll up to load it.");
  };

  async function react(m: Message, emoji: string) {
    const mine = m.reactions.find((r) => r.emoji === emoji)?.user_ids.includes(meId);
    try {
      if (mine) await api.del(`/messages/${m.id}/reaction`);
      else await api.put(`/messages/${m.id}/reaction`, { emoji });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  async function doDelete(m: Message) {
    try {
      await api.del(`/messages/${m.id}`);
      markDeleted(qc, convId, m.id);
      qc.invalidateQueries({ queryKey: keys.conversationsAll });
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  }

  if (isLoading) return <div className="timeline"><ThreadSkeleton /></div>;
  if (error || !data) return <ErrorState message="Couldn't load messages." onRetry={() => refetch()} />;

  const others = Object.keys(typing ?? {}).filter((u) => u !== meId);
  const isGroup = detail.type === "GROUP";

  return (
    <div className="timeline-wrap">
      <div className="timeline" ref={box} onScroll={onScroll}>
        <div className="timeline__inner">
          {data.has_more_before ? (
            <button className="btn btn--ghost" onClick={loadOlder} disabled={loadingOlder} style={{ alignSelf: "center" }}>
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          ) : (
            <>
              <div className="intro-card">
                <Avatar id={detail.peer?.id ?? detail.id} name={convTitle(detail)} src={isGroup ? detail.avatar_url : detail.peer?.avatar_url} size={96} />
                <h2>{convTitle(detail)}</h2>
                <div className="muted">
                  {isGroup ? `${detail.members.filter((m) => m.is_active && !m.user.is_bot).length} members` : detail.peer?.about || (detail.peer?.username ? `@${detail.peer.username}` : detail.peer?.phone_number)}
                </div>
              </div>
              <div className="enc-notice"><Lock size={14} /> Encryption is simulated in this demo. Messages are not actually end-to-end encrypted.</div>
            </>
          )}
          {rows.map((r, i) => {
            const m = r.msg;
            const prev = rows[i - 1]?.msg;
            const next = rows[i + 1]?.msg;
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const isSys = m.type === "SYSTEM";
            const sameAsPrev = !!prev && !newDay && prev.type !== "SYSTEM" && !isSys && prev.sender_id === m.sender_id && +new Date(m.created_at) - +new Date(prev.created_at) < GROUP_WINDOW_MS;
            const sameAsNext = !!next && next.type !== "SYSTEM" && !isSys && next.sender_id === m.sender_id && dayKey(next.created_at) === dayKey(m.created_at) && +new Date(next.created_at) - +new Date(m.created_at) < GROUP_WINDOW_MS;
            const mine = m.sender_id === meId;
            const sender = m.sender_id ? byId.get(m.sender_id) : undefined;
            let status: DisplayStatus = "sent";
            if (r.pending) status = r.pending.status;
            else if (mine) status = detail.members.length ? computeStatus(m.seq, m.sender_id, members) : (m.status ?? "sent");
            return (
              <Fragment key={r.key}>
                {newDay && <div className="date-sep">{dayLabel(m.created_at)}</div>}
                {dividerSeq.current === m.seq && <div className="new-divider">New messages</div>}
                {isSys ? (
                  <div id={`m-${m.id}`} className="sys-msg">{m.system_event ? systemText(m.system_event, members, meId) : ""}</div>
                ) : (
                  <MessageBubble
                    msg={m} mine={mine} meId={meId} status={status} pending={r.pending}
                    senderName={sender?.display_name} showSender={isGroup && !sameAsPrev} showAvatar={isGroup && !sameAsNext}
                    avatar={sender && <Avatar id={sender.id} name={sender.display_name} src={sender.avatar_url} size={28} />}
                    gap={!sameAsPrev && !newDay && !!prev}
                    onReply={(x) => useUi.getState().setReplyTo(convId, x)}
                    onReact={react} onDelete={(x, scope) => (scope === "me" ? void hideForMe(x) : setToDelete(x))} onInfo={setInfo} onForward={setForward} onEdit={(x) => useUi.getState().setEditing(convId, x)}
                    onRetry={(cid) => retrySend(qc, convId, cid)} onJump={jumpToReply} onImage={setLightbox}
                  />
                )}
              </Fragment>
            );
          })}
          {others.length > 0 && (
            <div className="msg-row msg-row--in msg-row--gap" aria-label="Typing">
              <div className="bubble bubble--in typing-bubble"><span /><span /><span /></div>
            </div>
          )}
        </div>
      </div>
      {(!atBottom || data.has_more_after) && (
        <button className="scroll-bottom-btn" aria-label="Scroll to latest message" onClick={scrollBottom}>
          <ArrowDown size={20} />
          {newCount > 0 && <span className="badge">{newCount}</span>}
        </button>
      )}
      {toDelete && (
        <ConfirmDialog title="Delete for everyone?" message="This message will be removed for everyone in the chat and replaced with a note that it was deleted." confirmLabel="Delete for everyone" danger onConfirm={() => doDelete(toDelete)} onClose={() => setToDelete(null)} />
      )}
      {forward && <ForwardModal message={forward} onClose={() => setForward(null)} />}
      {info && <MessageInfo message={info} onClose={() => setInfo(null)} />}
      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview"><img src={lightbox} alt="" /></div>}
    </div>
  );
}
