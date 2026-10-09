"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useConversation } from "@/lib/hooks";
import { useUi } from "@/store/ui";
import { useAuth } from "@/store/auth";
import { DetailsPanel } from "@/components/dialogs/DetailsPanel";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ThreadSkeleton } from "@/components/ui/Skeleton";
import { Composer } from "./Composer";
import { MessageList, type JumpTarget } from "./MessageList";
import { SearchPanel } from "./SearchPanel";
import { ThreadHeader } from "./ThreadHeader";

export function Thread({ id }: { id: string }) {
  const router = useRouter();
  const meId = useAuth((s) => s.user!.id);
  const { data: detail, error, isLoading, refetch } = useConversation(id);
  const [details, setDetails] = useState(false);
  const [searching, setSearching] = useState(false);
  const [jump, setJump] = useState<JumpTarget | null>(null);

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
      <ThreadHeader detail={detail} onDetails={() => setDetails(true)} onSearch={() => setSearching((s) => !s)} />
      {searching && <SearchPanel detail={detail} meId={meId} onClose={() => setSearching(false)} onPick={(m) => setJump({ id: m.id, seq: m.seq, n: Date.now() })} />}
      <MessageList convId={id} detail={detail} meId={meId} jump={jump} />
      <Composer convId={id} detail={detail} canSend={canSend} />
      {details && <DetailsPanel convId={id} onClose={() => setDetails(false)} />}
    </div>
  );
}
