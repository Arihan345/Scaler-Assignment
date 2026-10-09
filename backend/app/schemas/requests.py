from pydantic import BaseModel, Field


class OtpRequest(BaseModel):
    identifier: str = Field(max_length=64)


class VerifyOtp(BaseModel):
    identifier: str = Field(max_length=64)
    otp: str = Field(max_length=16)
    device_label: str | None = None


class ProfilePatch(BaseModel):
    display_name: str | None = None
    about: str | None = None


class ContactCreate(BaseModel):
    user_id: str | None = None
    identifier: str | None = None


class DirectCreate(BaseModel):
    user_id: str


class GroupCreate(BaseModel):
    title: str
    member_ids: list[str]


class ConversationPatch(BaseModel):
    title: str | None = None
    disappearing_seconds: int | None = None


class MySettingsPatch(BaseModel):
    is_pinned: bool | None = None
    is_archived: bool | None = None
    muted_until: str | None = None


class AddMembers(BaseModel):
    user_ids: list[str]


class RoleBody(BaseModel):
    role: str


class SendMessage(BaseModel):
    client_message_id: str | None = Field(default=None, max_length=64)
    body: str | None = None
    reply_to_id: int | None = None
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)


class EditBody(BaseModel):
    body: str


class AckBody(BaseModel):
    up_to_seq: int = Field(ge=0)


class ReactionBody(BaseModel):
    emoji: str


class WebhookCreate(BaseModel):
    url: str
    events: list[str]
    conversation_id: str | None = None


class WebhookPatch(BaseModel):
    url: str | None = None
    events: list[str] | None = None
    is_active: bool | None = None


class InboundCreate(BaseModel):
    name: str


class InboundPost(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
