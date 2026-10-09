"""Relational schema. Timestamps are ISO-8601 UTC strings; booleans are 0/1 integers."""
from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    phone_number: Mapped[str | None] = mapped_column(String, unique=True)
    username: Mapped[str | None] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)  # placeholder until onboarding
    about: Mapped[str] = mapped_column(String, default="", server_default="")
    avatar_url: Mapped[str | None] = mapped_column(String)
    is_bot: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    onboarded_at: Mapped[str | None] = mapped_column(String)  # NULL => route to onboarding
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    last_seen_at: Mapped[str | None] = mapped_column(String)
    # Privacy settings (1 = on). They change what OTHER people can see about this user.
    read_receipts: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    typing_indicators: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    show_online: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        CheckConstraint("phone_number IS NOT NULL OR username IS NOT NULL", name="ck_users_identity"),
    )


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True)  # sha256 of opaque token
    device_label: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[str] = mapped_column(String, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(String)
    last_used_at: Mapped[str | None] = mapped_column(String)


class Contact(Base):
    __tablename__ = "contacts"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    contact_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    nickname: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (CheckConstraint("owner_id <> contact_id", name="ck_contacts_not_self"),)


class Block(Base):
    """`blocker_id` has blocked `blocked_id`: no direct messages in either direction."""
    __tablename__ = "blocks"
    blocker_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    blocked_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (CheckConstraint("blocker_id <> blocked_id", name="ck_blocks_not_self"),)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    direct_key: Mapped[str | None] = mapped_column(String, unique=True)  # 'minId:maxId' for DIRECT
    title: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    avatar_url: Mapped[str | None] = mapped_column(String)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    last_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_activity_at: Mapped[str] = mapped_column(String, nullable=False)
    disappearing_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    __table_args__ = (
        CheckConstraint("type IN ('DIRECT','GROUP')", name="ck_conv_type"),
        CheckConstraint(
            "(type='DIRECT' AND direct_key IS NOT NULL) OR (type='GROUP' AND title IS NOT NULL)",
            name="ck_conv_shape",
        ),
    )


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="MEMBER", server_default="MEMBER")
    joined_at: Mapped[str] = mapped_column(String, nullable=False)
    joined_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    left_at: Mapped[str | None] = mapped_column(String)
    left_seq: Mapped[int | None] = mapped_column(Integer)
    last_delivered_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_read_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_pinned: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_archived: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    muted_until: Mapped[str | None] = mapped_column(String)
    marked_unread: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # What *I* have read. last_read_seq is the PUBLIC cursor other people see as read receipts; with read receipts
    # turned off it stops advancing while own_read_seq keeps tracking my unread count.
    own_read_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # 1 = a first message from someone who isn't my contact: hidden from the main list until I accept (Signal's "message request").
    request_pending: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    __table_args__ = (
        CheckConstraint("role IN ('MEMBER','ADMIN')", name="ck_member_role"),
        Index("idx_members_user", "user_id", sqlite_where=text("left_at IS NULL")),
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    sender_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))  # NULL for SYSTEM
    client_message_id: Mapped[str | None] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, nullable=False, default="TEXT", server_default="TEXT")
    body: Mapped[str | None] = mapped_column(Text)
    system_event: Mapped[str | None] = mapped_column(Text)  # JSON for SYSTEM messages
    reply_to_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"))
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    deleted_at: Mapped[str | None] = mapped_column(String)
    expires_at: Mapped[str | None] = mapped_column(String)
    edited_at: Mapped[str | None] = mapped_column(String)
    pinned_at: Mapped[str | None] = mapped_column(String)
    mentions: Mapped[str | None] = mapped_column(Text)  # JSON list of mentioned user ids
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_messages_conv_seq"),
        UniqueConstraint("sender_id", "conversation_id", "client_message_id", name="uq_messages_dedupe"),
        CheckConstraint("type IN ('TEXT','IMAGE','FILE','SYSTEM')", name="ck_msg_type"),
        Index("idx_msgs_expiry", "expires_at", sqlite_where=text("expires_at IS NOT NULL")),
        {"sqlite_autoincrement": True},
    )


class MessageHidden(Base):
    """'Delete for me': hides one message from one user only."""
    __tablename__ = "message_hidden"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)  # one reaction per user
    emoji: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    uploader_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), nullable=False)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))  # NULL until bound
    file_name: Mapped[str | None] = mapped_column(String)
    mime_type: Mapped[str | None] = mapped_column(String)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False)  # shared token sent as X-Webhook-Token
    events: Mapped[str] = mapped_column(String, nullable=False)  # JSON array
    conversation_id: Mapped[str | None] = mapped_column(ForeignKey("conversations.id"))  # NULL = all mine
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String, nullable=False)  # receivers dedupe on this
    endpoint_id: Mapped[str] = mapped_column(ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False)
    event: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="PENDING", server_default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[str] = mapped_column(String, nullable=False)
    response_code: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    delivered_at: Mapped[str | None] = mapped_column(String)
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','DELIVERED','FAILED')", name="ck_delivery_status"),
        Index("idx_deliveries_due", "next_attempt_at", sqlite_where=text("status = 'PENDING'")),
    )


class InboundWebhook(Base):
    __tablename__ = "inbound_webhooks"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    bot_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Story(Base):
    """A 24-hour status post (text on a coloured background, or a photo). Visible to the author's contacts and DM partners."""
    __tablename__ = "stories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # TEXT | IMAGE
    body: Mapped[str | None] = mapped_column(String)
    bg: Mapped[str | None] = mapped_column(String)
    file_path: Mapped[str | None] = mapped_column(String)
    mime_type: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        CheckConstraint("kind IN ('TEXT','IMAGE')", name="ck_story_kind"),
        Index("ix_stories_user_expires", "user_id", "expires_at"),
    )


class StoryView(Base):
    __tablename__ = "story_views"
    story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True)
    viewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    viewed_at: Mapped[str] = mapped_column(String, nullable=False)
    shared: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")  # 0 = viewer has receipts off
