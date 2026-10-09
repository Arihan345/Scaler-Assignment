"""Idempotent demo data: runs only when the users table is empty, so a redeploy or a wiped disk
never leaves a blank app. Demo logins use OTP 123456 (usernames: priya, rohan, ...)."""
import random
from datetime import timedelta

from sqlalchemy import func, select

from app.core.ids import direct_key, new_id
from app.core.time import now_iso, parse_iso, to_iso, utcnow
from app.db.engine import session_scope
from app.db.models import (
    Contact, Conversation, ConversationMember, Message, MessageReaction, User,
)
from app.services import message_service

USERS = [
    ("priya", "+919810000001", "Priya Sharma", "Designing things. Coffee first."),
    ("rohan", "+919810000002", "Rohan Mehta", "Busy, but reply eventually."),
    ("ananya", "+919810000003", "Ananya Iyer", "Hey there! I am using Signal."),
    ("karan", "+919810000004", "Karan Singh", "Gym, code, repeat."),
    ("meera", "+919810000005", "Meera Nair", "Hey there! I am using Signal."),
    ("vikram", "+919810000006", "Vikram Rao", "Out of office until Monday"),
    ("sara", "+919810000007", "Sara Khan", "Hey there! I am using Signal."),
    ("dev", "+919810000008", "Dev Patel", "Available"),
]

DM_LINES = [
    "Hey, how's it going?", "Did you see the match last night?", "Running a bit late, start without me",
    "Sounds good to me 👍", "Can you send me the notes from yesterday?", "Just reached home",
    "Let's catch up this weekend", "Haha that's hilarious", "On my way!", "Can we move the call to 5?",
    "Thanks, that helps a lot", "Which restaurant did you pick?", "I'll check and let you know", "Great idea",
    "Did you get my last email?", "Almost done, give me ten minutes", "Good morning!",
    "Good night, talk tomorrow", "Please share the file when you can", "That works for me",
    "Okay, booking it now", "Send me the location", "Lol no way", "Be right back",
]
GROUP_LINES = [
    "Morning everyone!", "Has anyone booked the tickets yet?", "I can drive if we leave before 8",
    "Sharing the doc in a minute", "Count me in 🙌", "Can someone confirm the budget?",
    "Rain forecast for Saturday, carry jackets", "I'll handle the hotel", "Photos from yesterday are up",
    "Let's finalise by Friday", "Works for me", "Who's bringing snacks?", "Updated the plan, please check",
    "Sorry, missed the earlier messages", "Haha 😂", "Great, thanks for sorting this out",
    "Meeting at 6 sharp", "Reminder: bring your ID", "Done ✅", "Let me know if anything changes",
]


def _populate(db, conv, senders, n, start, end, rng, lines):
    """Insert n messages with increasing timestamps between start and end."""
    step = (end - start) / max(n, 1)
    t = start
    last = None
    for i in range(n):
        t = t + step * rng.uniform(0.4, 1.6)
        if t > end:
            t = end - timedelta(seconds=(n - i))
        last = message_service.insert_message(
            db, conv.id, rng.choice(senders), to_iso(t), "TEXT", rng.choice(lines)
        )
    return last


def _cursor(db, conv_id, user_id, *, read, delivered=None):
    m = db.get(ConversationMember, (conv_id, user_id))
    m.last_read_seq = max(0, read)
    m.last_delivered_seq = max(0, read if delivered is None else delivered)


def _seed(db) -> None:
    rng = random.Random(42)
    now = utcnow()
    created = to_iso(now - timedelta(days=30))
    users: dict[str, User] = {}
    for i, (username, phone, name, about) in enumerate(USERS):
        users[username] = User(
            id=new_id(), username=username, phone_number=phone, display_name=name, about=about,
            onboarded_at=created, created_at=created,
            last_seen_at=to_iso(now - timedelta(minutes=7 + 40 * i)),
        )
        db.add(users[username])
    db.flush()
    U = {k: v.id for k, v in users.items()}

    for owner, others in {"priya": ["rohan", "ananya", "karan", "meera"], "rohan": ["priya", "karan", "vikram"]}.items():
        for o in others:
            db.add(Contact(owner_id=U[owner], contact_id=U[o], created_at=created))

    def make_dm(a: str, b: str) -> Conversation:
        conv = Conversation(
            id=new_id(), type="DIRECT", direct_key=direct_key(U[a], U[b]), created_by=U[a],
            created_at=created, last_activity_at=created,
        )
        db.add(conv)
        db.flush()
        for x in (a, b):
            db.add(ConversationMember(conversation_id=conv.id, user_id=U[x], joined_at=created))
        db.flush()
        return conv

    def make_group(title: str, admin: str, members: list[str]) -> Conversation:
        conv = Conversation(id=new_id(), type="GROUP", title=title, created_by=U[admin], created_at=created, last_activity_at=created)
        db.add(conv)
        db.flush()
        db.add(ConversationMember(conversation_id=conv.id, user_id=U[admin], role="ADMIN", joined_at=created))
        for x in members:
            db.add(ConversationMember(conversation_id=conv.id, user_id=U[x], joined_at=created))
        db.flush()
        message_service.insert_message(
            db, conv.id, None, created, "SYSTEM", None, system_event='{"kind": "group_created", "actor": "%s"}' % U[admin]
        )
        return conv

    # --- direct chats ------------------------------------------------------------------------
    dm_pr = make_dm("priya", "rohan")
    last = _populate(db, dm_pr, [U["priya"], U["rohan"]], 80, now - timedelta(days=6), now - timedelta(minutes=40), rng, DM_LINES)
    a = message_service.insert_message(db, dm_pr.id, U["priya"], to_iso(now - timedelta(minutes=30)), "TEXT", "Are we still on for Saturday?")
    reply_target = a
    message_service.insert_message(db, dm_pr.id, U["rohan"], to_iso(now - timedelta(minutes=12)), "TEXT",
                                   "Yes! I'll send the plan in a bit", reply_to_id=reply_target.id)
    message_service.insert_message(db, dm_pr.id, U["rohan"], to_iso(now - timedelta(minutes=11)), "TEXT", "Also bring the charger 🔌")
    db.add(MessageReaction(message_id=reply_target.id, user_id=U["rohan"], emoji="👍", created_at=to_iso(now - timedelta(minutes=29))))
    db.flush()
    seq = dm_pr.last_seq
    _cursor(db, dm_pr.id, U["priya"], read=seq - 2, delivered=seq)       # priya has 2 unread
    _cursor(db, dm_pr.id, U["rohan"], read=seq - 5, delivered=seq - 1)   # mix of delivered/read ticks for rohan's side

    dm_pa = make_dm("priya", "ananya")
    _populate(db, dm_pa, [U["priya"], U["ananya"]], 30, now - timedelta(days=4), now - timedelta(hours=3), rng, DM_LINES)
    message_service.insert_message(db, dm_pa.id, U["ananya"], to_iso(now - timedelta(hours=2)), "TEXT", "Call me when you're free 📞")
    seq = dm_pa.last_seq
    _cursor(db, dm_pa.id, U["priya"], read=seq - 1, delivered=seq)       # 1 unread
    _cursor(db, dm_pa.id, U["ananya"], read=seq, delivered=seq)

    dm_rk = make_dm("rohan", "karan")
    _populate(db, dm_rk, [U["rohan"], U["karan"]], 30, now - timedelta(days=3), now - timedelta(hours=5), rng, DM_LINES)
    message_service.insert_message(db, dm_rk.id, U["rohan"], to_iso(now - timedelta(hours=4)), "TEXT", "Pushed the fix, take a look")
    seq = dm_rk.last_seq
    _cursor(db, dm_rk.id, U["rohan"], read=seq, delivered=seq)
    _cursor(db, dm_rk.id, U["karan"], read=seq - 2, delivered=seq - 1)   # karan hasn't read the last messages

    # --- groups ------------------------------------------------------------------------------
    trip = make_group("Weekend Trip 🏔️", "priya", ["rohan", "ananya", "karan", "meera"])
    _populate(db, trip, [U[x] for x in ("priya", "rohan", "ananya", "karan", "meera")], 90,
              now - timedelta(days=5), now - timedelta(hours=1), rng, GROUP_LINES)
    anchor = message_service.insert_message(db, trip.id, U["meera"], to_iso(now - timedelta(minutes=50)), "TEXT", "I found a great homestay near the river")
    message_service.insert_message(db, trip.id, U["ananya"], to_iso(now - timedelta(minutes=45)), "TEXT", "Send the link please!", reply_to_id=anchor.id)
    db.add(MessageReaction(message_id=anchor.id, user_id=U["ananya"], emoji="❤️", created_at=to_iso(now - timedelta(minutes=44))))
    db.add(MessageReaction(message_id=anchor.id, user_id=U["karan"], emoji="🔥", created_at=to_iso(now - timedelta(minutes=43))))
    db.flush()
    seq = trip.last_seq
    for x in ("rohan", "ananya", "karan", "meera"):
        _cursor(db, trip.id, U[x], read=seq, delivered=seq)
    _cursor(db, trip.id, U["priya"], read=seq - 5, delivered=seq)        # 5 unread for priya
    _cursor(db, trip.id, U["karan"], read=seq - 1, delivered=seq)

    alpha = make_group("Project Alpha", "rohan", ["priya", "vikram", "sara"])
    _populate(db, alpha, [U[x] for x in ("rohan", "priya", "vikram", "sara")], 70,
              now - timedelta(days=2), now - timedelta(hours=6), rng, GROUP_LINES)
    message_service.insert_message(db, alpha.id, U["vikram"], to_iso(now - timedelta(hours=5)), "TEXT", "Standup moved to 10:30 tomorrow")
    seq = alpha.last_seq
    for x in ("priya", "vikram", "sara"):
        _cursor(db, alpha.id, U[x], read=seq, delivered=seq)
    _cursor(db, alpha.id, U["rohan"], read=seq - 3, delivered=seq)       # 3 unread for rohan
    _cursor(db, alpha.id, U["sara"], read=seq - 1, delivered=seq)

    # the creator of each group has read their own history
    for conv, admin in ((trip, "priya"), (alpha, "rohan")):
        m = db.get(ConversationMember, (conv.id, U[admin]))
        m.joined_seq = 0
    db.commit()


def seed_if_empty() -> bool:
    with session_scope() as db:
        if db.execute(select(func.count()).select_from(User)).scalar_one() > 0:
            return False
        _seed(db)
        return True
