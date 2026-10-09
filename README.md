# Signal Clone

A Signal Messenger–style chat app: Next.js (TypeScript) frontend, FastAPI + SQLite backend, WebSockets for live events.

> **Mocked on purpose (per the brief):** authentication uses a fixed OTP (`123456`, no SMS) and there is **no real encryption**.
> Any lock icons, "safety numbers" and encryption notices are visual only and say so in the UI.

## Demo accounts
Login is by phone number only, then code `123456` (a bare 10-digit number is treated as +91).
Seeded users: Priya `+919810000001` and Rohan `+919810000002` (with existing chats, groups and ~300 messages), plus ananya, karan, meera, vikram and others.
Open two browsers (or one normal and one private window) as Priya and Rohan (the login page has one-click buttons) to see real-time delivery, read receipts, typing and presence.
Any new phone number signs up a new user and goes through onboarding (name, about, avatar).

## Run locally
```bash
# backend (Python 3.11+)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000      # seeds demo data when the DB is empty
pytest                                          # 101 tests

# frontend (Node 20+)
cd frontend
cp .env.example .env.local                      # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev                                     # http://localhost:3000
npm run typecheck && npm test
```

## Features
- Mock OTP login/logout (phone number only), persistent sessions, onboarding with profile photo
- Chat list sorted by activity, unread badges, last-message preview, pin/mute/archive, search over chats and people, contacts
- Real-time direct and group messaging, typing indicators, online/last-seen
- Sent / delivered / read ticks (per-member cursors; group status = slowest eligible recipient)
- Groups: create, rename, photo, add/remove members, admin roles, leave
- Bonus: attachments (images/PDF/text), reactions, replies, edit (3-hour window), forward, delete for me / for everyone, in-chat search, saved drafts, disappearing messages, dark mode, responsive layout, keyboard shortcuts (Ctrl/Cmd+K search, Ctrl/Cmd+N new chat, Esc close)
- Signal-style extras: block/unblock (direct chats), Note to Self, mark as unread, pinned messages (up to 3, any member), multi-select (copy / forward / delete), All media gallery (Media / Files / Audio / Links), @mentions in groups, voice notes (MediaRecorder), link previews (server-side fetch with an SSRF guard)
- Message requests (first message from a non-contact waits in a separate list until you Accept, Delete or Block; no read receipts are sent before you accept), Stories (24-hour text/photo posts for contacts and chat partners, with view tracking), Linked devices (list and unlink signed-in sessions), 1:1 voice and video calls (WebRTC; the backend only relays signaling over the WebSocket), forwarding of images/files, browser (OS-level) notifications
- Settings: General, Appearance, Chats (link previews, Enter-to-send), Notifications (toasts, content, sound) and Privacy (read receipts, typing indicators, online status, blocked list) are all functional; calls are one-to-one only
- Extra: outbound webhooks (retries with backoff, delivery log) and inbound webhooks that post as a bot

## Architecture
Modular monolith: `api (routes) → services (rules, transactions) → db (SQLAlchemy models)`; `realtime/` pushes events, `tasks/` runs the expiry sweeper and webhook worker.

```
backend/app/{api,services,db,realtime,tasks,core,schemas}   frontend/{app,components,lib,store,styles}
```
Key decisions (all explainable and tested):
- **REST writes, WebSocket pushes.** Messages and acks go over REST; the socket only delivers events, typing and ping. After a reconnect the client re-syncs from the database rather than trusting replayed events.
- **Per-conversation `seq`.** Allocated in the insert transaction (`BEGIN IMMEDIATE`), never reused, gaps allowed. Pagination and sync use `seq`, not timestamps.
- **Idempotent send.** `UNIQUE(sender_id, conversation_id, client_message_id)`; a retry returns the original message, so the optimistic outbox never duplicates.
- **Receipts as cursors.** Each member has `last_delivered_seq` / `last_read_seq` (forward-only, clamped; read implies delivered). Status is derived, never stored. A message's recipients are the members whose window `joined_seq < seq ≤ left_seq` covers it. The same function exists in Python and TypeScript and both are tested against `shared/status_fixtures.json`.
- **Auth.** Opaque session token, stored only as a SHA-256 hash. WebSocket uses a single-use 30-second ticket (kept out of logs); every typing event re-checks membership.
- **Disappearing messages.** `expires_at` is filtered on every read path; a sweeper hard-deletes later.
- **SQLite.** WAL, foreign keys on, busy timeout, one writer process.
- **Frontend.** TanStack Query is the server-state cache; WebSocket events patch it. Zustand holds UI state (outbox, typing, presence, theme).

### Data model
`users, sessions (one row per signed-in device), contacts, blocks, conversations, conversation_members (role, joined_seq, left_seq, cursors, pin/mute/archive, `request_pending` for message requests), messages (SYSTEM rows carry a `system_event` JSON, which is also how call outcomes are stored), message_hidden (delete for me), message_reactions, attachments, stories (24-hour TTL), story_views, webhook_endpoints, webhook_deliveries, inbound_webhooks`.

### API (prefix `/api`)
| Area | Endpoints |
|---|---|
| Auth | `POST /auth/request-otp`, `/auth/verify-otp`, `/auth/logout`, `/auth/ws-ticket`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `POST /auth/sessions/revoke-others` |
| Users | `GET/PATCH /users/me`, `POST /users/me/avatar`, `GET /users/search`, `GET/POST /contacts`, `DELETE /contacts/{id}` |
| Conversations | `GET /conversations`, `POST /conversations/direct`, `/groups`, `GET/PATCH /conversations/{id}`, `PATCH .../me`, `POST .../avatar`, `.../members`, `.../leave`, member role/remove |
| Messages | `GET/POST /conversations/{id}/messages`, `POST .../read`, `.../delivered`, `PUT/DELETE /messages/{id}/reaction`, `PATCH /messages/{id}` (edit), `POST /messages/{id}/hide` (delete for me), `DELETE /messages/{id}`, `GET /conversations/{id}/search`, `GET /messages/{id}/receipts`, `POST /attachments`, `GET /attachments/{id}` |
| Privacy | `GET /blocks`, `POST/DELETE /blocks/{user_id}` |
| Stories | `GET/POST /stories`, `POST /stories/image`, `GET /stories/{id}/media`, `POST /stories/{id}/view`, `GET /stories/{id}/views`, `DELETE /stories/{id}` |
| Calls | `GET /calls` (history, derived from the call entries logged in each chat) |
| Webhooks (Settings → Webhooks) | `/webhooks` CRUD + `/test` + `/deliveries`, `/conversations/{id}/inbound-hooks`, `POST /hooks/in/{token}`, `POST /dev/webhook-echo` |

WebSocket `/ws?ticket=…` events: `message.new|edited|deleted|expired`, `receipt.updated`, `reaction.updated`, `conversation.updated`, `member.added|removed`, `presence.updated`, `typing.start|stop`, `pong`. Call signaling (WebRTC offer/answer/ICE is only relayed, never stored): client sends `call.invite|accept|decline|end|signal`; server pushes `call.incoming|accepted|ended|signal`. Envelope: `{event, event_id, conversation_id, payload}`.

## Deployment
- **Frontend → Vercel.** Root directory `frontend`. Set `NEXT_PUBLIC_API_URL` to the backend URL (add `NEXT_PUBLIC_WS_URL` only if it differs).
- **Backend → Render** via `render.yaml` (single worker, `--no-access-log`). Set `CORS_ORIGINS` to the Vercel URL.
- Render's free tier sleeps after idle (first request is slow) and its disk is ephemeral, so data resets on redeploy or restart; the app re-seeds demo data when the DB is empty. For durable data use a paid plan with a persistent disk and point `DATABASE_URL` / `UPLOAD_DIR` at it.

## Known limitations / trade-offs
- No real encryption or SMS. Notifications use the browser Notification API while the app is open; true Web Push (closed browser) would need a service worker and VAPID keys.
- Calls are 1:1 only, with STUN but no TURN relay, so they can fail behind strict NATs; call state is in memory (one backend process) and one tab per user should answer a call.
- "Linked devices" means signed-in sessions: sign in with the same number elsewhere to link, unlink from Settings (no QR pairing).
- Message list is paged (older messages load on scroll) rather than virtualized.
- Read receipts and typing indicators are reciprocal, as in Signal: turning them off hides yours and also hides other people's from you. Blocking applies to direct chats only; the blocked sender just sees a generic "couldn't be delivered".
- Link previews fetch server-side with http(s)-only, public-IP-only, redirect re-validation, size and time caps. A DNS-rebinding race is the residual risk, documented in `services/link_preview.py`. Previews need outbound internet from the backend.
- Voice notes need microphone permission and a secure origin (localhost or https).
- Single backend process: presence and typing state are in memory, so horizontal scaling would need a shared pub/sub.
- Visual tokens in `frontend/styles/tokens.css` approximate Signal Desktop and can be tuned against screenshots.
