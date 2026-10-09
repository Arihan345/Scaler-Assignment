// Canonical DTOs: these mirror backend/app/services/serializers.py and conversation_service.py.

export type User = {
  id: string;
  display_name: string;
  username: string | null;
  phone_number: string | null;
  about: string;
  avatar_url: string | null;
  last_seen_at: string | null;
  is_bot: boolean;
  is_online?: boolean;
  onboarded?: boolean;
  is_contact?: boolean;
  nickname?: string | null;
};

export type Reaction = { emoji: string; count: number; user_ids: string[] };

export type Attachment = {
  id: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
};

export type SystemEvent = {
  kind:
    | "group_created"
    | "member_added"
    | "member_removed"
    | "member_left"
    | "title_changed"
    | "disappearing_changed";
  actor?: string;
  target?: string;
  title?: string;
  seconds?: number;
};

export type ReplyTo = { id: number; seq: number; sender_id: string | null; snippet: string; deleted: boolean };

export type ServerStatus = "sent" | "delivered" | "read";
// "sending" and "failed" are client-only states that live in the outbox and are never stored.
export type DisplayStatus = "sending" | "failed" | ServerStatus;

export type Message = {
  id: number;
  conversation_id: string;
  seq: number;
  sender_id: string | null;
  client_message_id: string | null;
  type: "TEXT" | "IMAGE" | "FILE" | "SYSTEM";
  body: string | null;
  system_event: SystemEvent | null;
  reply_to: ReplyTo | null;
  attachments: Attachment[];
  reactions: Reaction[];
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
  edited_at: string | null;
  status: ServerStatus | null;
};

export type LastMessage = Message & { sender_name: string | null };

export type ConversationListItem = {
  id: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  avatar_url: string | null;
  member_count: number;
  last_message: LastMessage | null;
  unread_count: number;
  my_last_read_seq: number;
  last_activity_at: string;
  is_pinned: boolean;
  is_archived: boolean;
  muted_until: string | null;
  disappearing_seconds: number;
  my_role: "ADMIN" | "MEMBER";
  peer: User | null;
};

export type Member = {
  user: User;
  role: "ADMIN" | "MEMBER";
  joined_seq: number;
  left_seq: number | null;
  is_active: boolean;
  last_delivered_seq: number;
  last_read_seq: number;
};

export type ConversationDetail = ConversationListItem & {
  description: string | null;
  created_at: string;
  last_seq: number;
  members: Member[];
};

export type MessagesPage = { messages: Message[]; has_more_before: boolean; has_more_after: boolean };

export type WsEnvelope = {
  event: string;
  event_id: string;
  conversation_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
};

export type OutboxItem = {
  client_message_id: string;
  conversation_id: string;
  body: string;
  reply_to: Message | null;
  attachment_ids: string[];
  attachment_previews: { id: string; name: string; mime: string; url: string | null }[];
  status: "sending" | "failed";
  created_at: string;
  error?: string;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  token: string;
  events: string[];
  conversation_id: string | null;
  is_active: boolean;
  created_at: string;
};

export type WebhookDelivery = {
  id: number;
  event_id: string;
  event: string;
  status: "PENDING" | "DELIVERED" | "FAILED";
  attempts: number;
  response_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  next_attempt_at: string;
};

export type InboundHook = {
  id: string;
  conversation_id: string;
  name: string;
  token: string;
  path: string;
  bot_user_id: string;
  is_active: boolean;
};
