// Compact emoji set for the picker: "<emoji> <search words>". Hand-picked (no dependency) — enough for search by name.
export type EmojiCategory = { id: string; label: string; items: string[] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: "smileys", label: "Smileys & People", items: [
    "😀 grinning happy", "😃 smile open mouth", "😄 smile happy eyes", "😁 beaming grin", "😆 laughing squint", "😅 sweat smile nervous", "😂 joy tears laugh lol", "🤣 rofl rolling laugh", "🙂 slight smile", "😉 wink", "😊 blush smile", "😇 angel innocent halo", "🥰 love hearts face", "😍 heart eyes love", "🤩 star struck wow", "😘 kiss blow", "😋 yum tasty", "😛 tongue", "😜 wink tongue crazy", "🤪 zany goofy", "🤗 hug", "🤭 giggle hand mouth", "🤫 shush secret quiet", "🤔 thinking hmm", "😐 neutral", "😑 expressionless", "😶 no mouth silent", "🙄 eye roll", "😏 smirk", "😬 grimace", "😌 relieved calm", "😔 pensive sad", "😴 sleeping zzz", "🤒 sick thermometer", "🤧 sneeze", "🥵 hot", "🥶 cold freezing", "😵 dizzy", "🤯 mind blown exploding", "🥳 party celebrate", "😎 cool sunglasses", "🤓 nerd glasses", "😕 confused", "😟 worried", "😮 surprised open mouth", "😲 astonished", "🥺 pleading puppy eyes", "😢 cry tear sad", "😭 sob loudly crying", "😱 scream fear", "😖 confounded", "😞 disappointed", "😓 downcast sweat", "😩 weary", "😫 tired", "🥱 yawn", "😤 triumph huff", "😡 angry mad rage", "😠 angry", "🤬 cursing swearing", "😈 devil smiling", "💀 skull dead", "💩 poop", "🤡 clown", "👻 ghost", "👽 alien", "🤖 robot",
    "👋 wave hello", "🤚 raised back hand", "✋ raised hand stop", "👌 ok perfect", "✌️ peace victory", "🤞 fingers crossed luck", "🤟 love you gesture", "🤘 rock horns", "👈 point left", "👉 point right", "👆 point up", "👇 point down", "👍 thumbs up like yes", "👎 thumbs down dislike no", "✊ fist", "👊 punch fist bump", "👏 clap applause", "🙌 raised hands celebrate", "🤝 handshake deal", "🙏 pray thanks please folded hands", "💪 muscle strong flex", "👀 eyes look", "🧠 brain", "👶 baby", "🧑 person", "👨 man", "👩 woman",
  ] },
  { id: "nature", label: "Animals & Nature", items: [
    "🐶 dog puppy", "🐱 cat kitten", "🐭 mouse", "🐹 hamster", "🐰 rabbit bunny", "🦊 fox", "🐻 bear", "🐼 panda", "🐨 koala", "🐯 tiger", "🦁 lion", "🐮 cow", "🐷 pig", "🐸 frog", "🐵 monkey", "🙈 see no evil monkey", "🐔 chicken", "🐧 penguin", "🐦 bird", "🦆 duck", "🦉 owl", "🦄 unicorn", "🐝 bee honey", "🦋 butterfly", "🐌 snail", "🐞 ladybug", "🐢 turtle", "🐍 snake", "🐙 octopus", "🐬 dolphin", "🐳 whale", "🦈 shark", "🐘 elephant", "🦒 giraffe", "🐎 horse",
    "🌸 cherry blossom flower", "🌹 rose", "🌻 sunflower", "🌷 tulip", "🌲 evergreen tree", "🌳 tree", "🌴 palm tree", "🌵 cactus", "🍀 clover luck", "🍁 maple leaf autumn", "🌈 rainbow", "☀️ sun sunny", "🌙 moon night", "⭐ star", "🌟 glowing star", "⚡ lightning bolt", "🔥 fire hot lit", "💧 droplet water", "🌊 wave ocean", "❄️ snowflake", "☁️ cloud", "🌧️ rain",
  ] },
  { id: "food", label: "Food & Drink", items: [
    "🍎 apple red", "🍌 banana", "🍇 grapes", "🍓 strawberry", "🍉 watermelon", "🍊 orange tangerine", "🍋 lemon", "🍍 pineapple", "🥭 mango", "🍑 peach", "🍒 cherries", "🥑 avocado", "🍅 tomato", "🥕 carrot", "🌽 corn", "🥔 potato", "🍞 bread", "🥐 croissant", "🧀 cheese", "🥚 egg", "🥓 bacon", "🍔 burger hamburger", "🍟 fries", "🍕 pizza", "🌭 hot dog", "🌮 taco", "🌯 burrito", "🍝 spaghetti pasta", "🍜 noodles ramen", "🍣 sushi", "🍛 curry rice", "🍚 rice", "🍪 cookie", "🍩 donut", "🍰 cake slice", "🎂 birthday cake", "🍫 chocolate", "🍿 popcorn", "🍦 ice cream", "☕ coffee tea hot", "🍵 green tea", "🥤 cup straw soda", "🍺 beer", "🍷 wine", "🥂 cheers champagne", "🍹 cocktail",
  ] },
  { id: "activity", label: "Activities", items: [
    "⚽ soccer football", "🏀 basketball", "🏈 american football", "⚾ baseball", "🎾 tennis", "🏐 volleyball", "🏉 rugby", "🎱 pool billiards 8 ball", "🏓 ping pong table tennis", "🏸 badminton", "🏏 cricket", "🥊 boxing glove", "⛳ golf", "🎯 dart target bullseye", "🏆 trophy winner", "🥇 gold medal first", "🥈 silver medal", "🥉 bronze medal", "🎮 video game controller", "🕹️ joystick", "🎲 dice game", "🧩 puzzle", "♟️ chess", "🎨 art palette paint", "🎬 clapper movie film", "🎤 microphone sing karaoke", "🎧 headphones music", "🎸 guitar", "🎹 piano keyboard", "🥁 drum", "🎺 trumpet", "🎻 violin", "🎉 party popper tada", "🎊 confetti ball", "🎈 balloon", "🎁 gift present", "🏋️ weight lifting", "🚴 cycling bike", "🏊 swimming", "🧘 yoga meditate",
  ] },
  { id: "travel", label: "Travel & Places", items: [
    "🚗 car", "🚕 taxi", "🚌 bus", "🏎️ race car", "🚓 police car", "🚑 ambulance", "🚒 fire truck", "🚲 bicycle", "🛵 scooter", "🏍️ motorcycle", "🚆 train", "🚇 metro subway", "✈️ airplane flight", "🚀 rocket", "🛸 ufo", "🚁 helicopter", "⛵ sailboat", "🚢 ship", "⚓ anchor", "🏠 house home", "🏢 office building", "🏥 hospital", "🏫 school", "🏰 castle", "🗼 tower", "🗽 statue of liberty", "⛰️ mountain", "🏔️ snow mountain", "🏕️ camping", "🏖️ beach", "🏝️ island", "🌋 volcano", "🗺️ map world", "🧭 compass", "🌍 earth globe", "🌆 city sunset", "🌃 night city", "🎡 ferris wheel", "🎢 roller coaster",
  ] },
  { id: "objects", label: "Objects", items: [
    "⌚ watch", "📱 phone mobile", "💻 laptop computer", "🖥️ desktop", "⌨️ keyboard", "🖱️ mouse", "🖨️ printer", "📷 camera", "📸 camera flash", "📹 video camera", "📺 tv television", "📻 radio", "🔋 battery", "🔌 plug electric", "💡 light bulb idea", "🔦 flashlight", "📚 books", "📖 open book", "📝 memo note write", "✏️ pencil", "🖊️ pen", "📎 paperclip", "📌 pushpin", "✂️ scissors", "🔒 lock", "🔓 unlock", "🔑 key", "🔨 hammer", "🔧 wrench", "⚙️ gear settings", "🧲 magnet", "💰 money bag", "💵 dollar cash", "💳 credit card", "📦 package box", "📅 calendar", "⏰ alarm clock", "⏳ hourglass", "🔔 bell notification", "🔕 bell off mute", "📢 loudspeaker", "🛒 shopping cart", "💊 pill medicine", "🧸 teddy bear", "🪄 magic wand", "🔮 crystal ball",
  ] },
  { id: "symbols", label: "Symbols", items: [
    "❤️ red heart love", "🧡 orange heart", "💛 yellow heart", "💚 green heart", "💙 blue heart", "💜 purple heart", "🖤 black heart", "🤍 white heart", "💔 broken heart", "💕 two hearts", "💖 sparkling heart", "💗 growing heart", "💯 hundred perfect", "✨ sparkles", "💫 dizzy star", "💥 boom collision", "💢 anger", "💤 zzz sleep", "💬 speech bubble chat", "💭 thought bubble", "✅ check mark done", "❌ cross wrong", "❎ cross mark button", "❓ question", "❗ exclamation", "⚠️ warning", "🚫 prohibited no", "⭕ circle", "➕ plus", "➖ minus", "➡️ right arrow", "⬅️ left arrow", "⬆️ up arrow", "⬇️ down arrow", "🔄 refresh arrows", "🔁 repeat", "▶️ play", "⏸️ pause", "⏹️ stop", "🔊 loud speaker volume", "🔇 muted", "♻️ recycle", "✔️ check", "™️ trademark", "©️ copyright",
  ] },
  { id: "flags", label: "Flags", items: [
    "🏁 chequered flag race finish", "🚩 red flag", "🏳️ white flag", "🏴 black flag", "🏳️‍🌈 rainbow flag pride", "🇮🇳 india", "🇺🇸 united states usa america", "🇬🇧 united kingdom uk britain", "🇨🇦 canada", "🇦🇺 australia", "🇩🇪 germany", "🇫🇷 france", "🇮🇹 italy", "🇪🇸 spain", "🇯🇵 japan", "🇰🇷 south korea", "🇨🇳 china", "🇧🇷 brazil", "🇲🇽 mexico", "🇷🇺 russia", "🇿🇦 south africa", "🇦🇪 uae emirates", "🇸🇬 singapore", "🇳🇵 nepal", "🇱🇰 sri lanka", "🇧🇩 bangladesh", "🇵🇰 pakistan",
  ] },
];

export const STICKERS = ["🎉","👍","❤️","😂","🔥","👏","🙏","😎","🥳","😭","😡","🤝","💯","✨","🚀","☕","🍕","🎂","🌈","🐶","🐱","🌸","🎵","🤗"];

/** [emoji, searchText] pairs, flattened once. */
export const ALL_EMOJI: { e: string; q: string; cat: string }[] = EMOJI_CATEGORIES.flatMap((c) =>
  c.items.map((s) => {
    const i = s.indexOf(" ");
    return { e: s.slice(0, i), q: s.slice(i + 1).toLowerCase(), cat: c.id };
  }),
);

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u;
/** A message that is only 1-3 emoji renders large with no bubble, like Signal. */
export function jumboEmojiCount(body: string | null | undefined): number {
  const t = (body ?? "").trim();
  if (!t || t.length > 40 || !EMOJI_ONLY.test(t)) return 0;
  const n = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].length;
  return n <= 3 ? n : 0;
}
