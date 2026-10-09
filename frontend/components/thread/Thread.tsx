"use client";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";
import { ApiError } from "@/lib/api";
import { useConversation } from "@/lib/hooks";
import { useUi } from "@/store/ui";
import { useAuth } from "@/store/auth";
import { DetailsPanel } from "@/components/dialogs/DetailsPanel";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ThreadSkeleton } from "@/components/ui/Skeleton";
import { Composer } from "./Composer";
import { RequestBar } from "./RequestBar";
import { MessageList, type JumpTarget } from "./MessageList";
import { SearchPanel } from "./SearchPanel";
import { PinnedBar } from "./PinnedBar";
import { SelectionBar } from "./SelectionBar";
import { MediaPanel } from "@/components/dialogs/MediaPanel";
import { ThreadHeader } from "./ThreadHeader";

export function Thread({ id }: { id: string }) {
  const router = useRouter();
  const meId = useAuth((s) => s.user!.id);
  const { data: detail, error, isLoading, refetch } = useConversation(id);
  const [details, setDetails] = useState(false);
  const [searching, setSearching] = useState(false);
  const [jump, setJump] = useState<JumpTarget | null>(null);
  const [media, setMedia] = useState(false);
  const qc = useQueryClient();
  const selecting = useUi((s) => s.selection?.conv === id);
  const clearedFor = useRef<string | null>(null);

  // Opening a chat that was manually "marked as unread" clears that flag (once per open).
  useEffect(() => {
    if (detail?.marked_unread && clearedFor.current !== id) {
      clearedFor.current = id;
      api.patch(`/conversations/${id}/me`, { marked_unread: false }).then(() => {
        qc.invalidateQueries({ queryKey: keys.conversationsAll });
        qc.invalidateQueries({ queryKey: keys.conversation(id) });
      }).catch(() => {});
    }
  }, [detail?.marked_unread, id, qc]);
  useEffect(() => () => useUi.getState().clearSelection(), [id]);
  useEffect(() => {
    const open = () => setDetails(true); // the intro card's "name ›" asks for the details panel
    window.addEventListener("signal:open-details", open);
    return () => window.removeEventListener("signal:open-details", open);
  }, []);

  useEffect(() => {
    useUi.getState().setOpenConversation(id);
    return () => useUi.getState().setOpenConversation(null);
  }, [id]);

  if (isLoading) return <div className="thread"><div className="thread-header" /><ThreadSkeleton /></div>;
  if (error || !detail) {
    const gone = error instanceof ApiError && (error.status === 403 || error.status === 404);
    return gone ? (
      <EmptyState title="Chat not available">You're not part of this conversation, or it no longer exists.
        <br /><button className="btn btn--secondary" style={{ marginTop: 12 }} onClick={() => router.push("/")}>Back to chats</button>
      </EmptyState>
    ) : (
      <ErrorState message="Couldn't load this chat." onRetry={() => refetch()} />
    );
  }

  const me = detail.members.find((m) => m.user.id === meId);
  const canSend = detail.type === "DIRECT" || !!me?.is_active;
  return (
    <div className="thread">
      <ThreadHeader detail={detail} onDetails={() => setDetails(true)} onSearch={() => setSearching((s) => !s)} onMedia={() => setMedia(true)} />
      {searching && <SearchPanel detail={detail} meId={meId} onClose={() => setSearching(false)} onPick={(m) => setJump({ id: m.id, seq: m.seq, n: Date.now() })} />}
      <PinnedBar detail={detail} meId={meId} onJump={(m) => setJump({ id: m.id, seq: m.seq, n: Date.now() })} />
      <MessageList convId={id} detail={detail} meId={meId} jump={jump} />
      {detail.is_request ? <RequestBar detail={detail} /> : selecting ? <SelectionBar convId={id} meId={meId} /> : <Composer convId={id} detail={detail} canSend={canSend} />}
      {details && <DetailsPanel convId={id} onClose={() => setDetails(false)} onSearch={() => { setDetails(false); setSearching(true); }} />}
      {media && <MediaPanel convId={id} onClose={() => setMedia(false)} onJump={(m) => setJump({ id: m.id, seq: m.seq, n: Date.now() })} />}
    </div>
  );
}
