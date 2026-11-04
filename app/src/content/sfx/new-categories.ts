/**
 * Collections added after auditing what the big libraries actually shelve.
 *
 * The original taxonomy in `categories.ts` was built around game and film
 * search terms, which covered the loudest half of the demand and missed the
 * half that professional libraries are mostly made of. Epidemic Sound's tree
 * devotes a whole branch to materials — glass, metal, wood, paper, cloth — and
 * ElevenLabs' directory lists them individually too, because that is how a
 * sound editor thinks: not "impact" but "which material hit which material".
 * The same audit turned up vehicles, human effort, and the trailer-design
 * family (riser, braam, drone) that Soundsnap puts on its own front page.
 *
 * Every category here is a real page with its own craft notes, not a slug with
 * a template behind it. The rule from `categories.ts` still holds: if nobody
 * wrote it, it does not ship.
 *
 * Structurally these are identical to the originals — same `SfxCategory` — and
 * they are concatenated onto the same exported list. They live apart only so
 * the diff that introduced two dozen collections is reviewable.
 */

import type { SfxCategory, SfxFaq, SfxSample } from "./types";

const MODEL = "audiocpp-stable-audio-3-sfx";

function s(slug: string, title: string, prompt: string, durationS: number): SfxSample {
  return { slug, title, prompt, source: "model", model: MODEL, durationS };
}

/**
 * The four questions every one of these pages gets asked.
 *
 * These answers are genuinely the same whatever the category is — licensing,
 * offline behaviour, hardware and agent access are properties of Konchi, not
 * of glass or of trains. Writing four slightly different paraphrases per page
 * would not make them more useful, it would just make the claims harder to keep
 * true when the facts change. The one category-specific question goes first,
 * where a reader will actually see it.
 */
function faqs(specific: SfxFaq): SfxFaq[] {
  return [
    specific,
    {
      question: "Can I use these sounds in a commercial video or game?",
      answer:
        "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The clips on this page were rendered with Stable Audio 3.0 Small SFX, which uses the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
    },
    {
      question: "Does this work offline?",
      answer:
        "Yes, once the weights are on disk. Generation, the library and the HTTP API all run locally against one SQLite file and one folder of WAVs under ~/.konchi. There is no account and no API key, and nothing is uploaded. The only step that uses the network is the initial model download.",
    },
    {
      question: "What hardware does it need?",
      answer:
        "The clips here were rendered on a consumer NVIDIA GPU at roughly ten seconds of wall time per clip, through audio.cpp's quantised GGUF runtime, which needs little VRAM. CPU-only generation is supported, but expect minutes per clip instead of seconds: fine for a handful of sounds, slow for a whole library.",
    },
    {
      question: "Can an agent generate these for me?",
      answer:
        "Yes. While the app is open, Konchi runs an MCP server at http://127.0.0.1:17494/mcp with tools for generating, listing and mixing sounds. Every generated file comes back as an absolute path, so a coding agent can render the sound a scene needs and put it straight into the project. The several hundred clips across these pages were made this way.",
    },
  ];
}

/* ==================================================== Foley & materials */

const GLASS: SfxCategory = {
  slug: "glass",
  name: "Glass",
  targetQuery: "glass sound effect",
  intent:
    "Editors and game developers who need a specific glass event — a bottle smashing, a window " +
    "failing, a wine glass ringing — and keep finding library clips that are the wrong size of " +
    "glass in the wrong room.",
  metaTitle: "Glass sound effects: break, clink, shatter | Konchi",
  metaDescription:
    "Generate glass breaking, shattering, clinking and cracking locally. Prompts for each thickness of glass and each room it breaks in.",
  h1: "Glass sound effects you generate yourself",
  intro:
    "Sound designers use glass constantly and often get it wrong, because \"glass breaking\" covers " +
    "at least six different sounds: a thin wine glass ringing itself apart, a bottle bursting on " +
    "concrete, a car window collapsing into pebbles, a pane failing all at once. Thickness matters " +
    "most, then what the glass lands on. Konchi runs the models on your own GPU, so you can render " +
    "all six, compare them against the picture, and regenerate the one that nearly worked.",
  content: {
    samples: [
      s("glass-bottle-smash-concrete", "Bottle on concrete", "glass bottle smashing on concrete, sharp initial burst with shards scattering and skittering away, outdoor alley reverb", 3),
      s("glass-window-pane-break", "Window pane", "large window pane breaking, cracking then collapsing inward with long shards falling and shattering on a wooden floor", 4),
      s("glass-wine-glass-ring", "Wine glass ring", "wet finger circling the rim of a wine glass, pure sustained crystalline tone slowly building, quiet room", 6),
      s("glass-cheers-clink", "Cheers clink", "two wine glasses clinking together in a toast, bright ringing chime with a short decay, close mic", 2),
      s("glass-car-window-shatter", "Car window", "car side window shattering into thousands of small tempered pebbles, dense granular collapse onto a road", 3),
      s("glass-crack-slow-spread", "Slow crack", "glass cracking slowly under pressure, fine splintering fractures spreading with tiny ticks, very close mic, quiet", 5),
      s("glass-jar-drop-floor", "Jar drop", "glass jar dropped onto a tiled kitchen floor, hard burst with a wet contents splash and shards spinning", 3),
      s("glass-lightbulb-pop", "Lightbulb pop", "lightbulb filament popping and the thin glass envelope bursting, delicate high shatter, close and dry", 1.5),
      s("glass-shard-sweep-up", "Sweeping shards", "broom sweeping broken glass across a tile floor, continuous granular scraping with shards tumbling", 6),
      s("glass-greenhouse-collapse", "Greenhouse collapse", "greenhouse roof collapsing, sequence of large panes failing one after another with a long debris tail", 6),
    ],
    recipes: [
      {
        label: "Thin glass, hard floor",
        prompt: "glass bottle smashing on concrete, sharp initial burst with shards scattering and skittering away, outdoor alley reverb",
        why: "The surface it hits and the aftermath do the work. \"Skittering away\" turns a single hit into a break.",
      },
      {
        label: "Tempered glass",
        prompt: "car side window shattering into thousands of small tempered pebbles, dense granular collapse onto a road",
        why: "Tempered glass breaks into small pebbles instead of shards. \"Pebbles\" and \"granular\" are what separate a car window from a house window.",
      },
      {
        label: "Ringing, not breaking",
        prompt: "wet finger circling the rim of a wine glass, pure sustained crystalline tone slowly building, quiet room",
        why: "Describe the physical action. The model breaks glass by default as soon as the word appears, and naming the finger on the rim keeps it intact.",
      },
      {
        label: "Pressure fracture",
        prompt: "glass cracking slowly under pressure, fine splintering fractures spreading with tiny ticks, very close mic, quiet",
        why: "\"Very close mic\" and \"quiet\" keep the small details audible. A fracture is a tiny sound and any room tone buries it.",
      },
    ],
    craft: [
      {
        heading: "Start with thickness",
        body: "Every glass sound depends on how thick the glass is. Thin glass (bulbs, wine glasses, picture frames) breaks bright, fast and high, with almost no low end. Thick glass (shopfronts, greenhouse panes, bottles) has real body and a lower initial crack before the debris starts. If a generation sounds like the wrong object, more adjectives about breaking rarely help. Name the object precisely enough that its thickness is implied.",
      },
      {
        heading: "Say what it lands on",
        body: "About half of a glass break is the surface receiving the debris. Shards on concrete skitter and ring; on carpet they thud and stop; on tile they bounce twice and scatter wide; in a sink they clatter metallically. If you leave the surface out, the model picks one, usually a vague dry nothing. One extra clause, such as \"onto a wooden floor\" or \"into a metal sink\", changes the result more than any tuning.",
      },
      {
        heading: "Breaks have three parts and you can ask for each",
        body: "A convincing break has an impact, a failure and a settle. Cheap library glass gives you the first two and cuts. If the clip has to sit under a shot without a second layer, write the settle into the prompt (\"shards scattering and skittering away\", \"debris tail\", \"small pieces still falling\") and give the render enough seconds to reach it. Two seconds holds an impact; a full break needs about four.",
      },
    ],
    faqs: faqs({
      question: "Why do my glass breaks sound small?",
      answer:
        "Usually the prompt named the action but not the object or the room. \"Glass breaking\" gives the model no thickness to work with, so it renders something mid-sized and dry. Name the object (a bottle, a windscreen, a greenhouse pane), say what it hits, and add the space. One regeneration usually fixes the size.",
    }),
    related: ["impact", "metal", "wood", "explosion", "door", "cartoon"],
  },
};

const METAL: SfxCategory = {
  slug: "metal",
  name: "Metal",
  targetQuery: "metal sound effect",
  intent:
    "Sound designers who need metallic hits, scrapes, groans and resonance for industrial, " +
    "horror or sci-fi work, and who care about the difference between a thin sheet and a thick beam.",
  metaTitle: "Metal sound effects: clang, scrape, groan | Konchi",
  metaDescription:
    "Generate metal impacts, scrapes, creaks and resonant clangs locally. Prompts that separate thin sheet from heavy steel, and dry hits from ringing rooms.",
  h1: "Metal sound effects you generate yourself",
  intro:
    "Metal is the most tonal material in a sound library. Struck wood or stone stops quickly; struck " +
    "metal keeps ringing, and the ring tells you the size of the object for as long as it lasts. " +
    "That makes metal the raw material for much of horror and most industrial sci-fi. These prompts " +
    "treat resonance as the main thing you specify.",
  content: {
    samples: [
      s("metal-sheet-wobble", "Sheet wobble", "large thin metal sheet being flexed and wobbled, deep warbling thunder-like resonance, close mic, dry", 4),
      s("metal-pipe-hit-ring", "Pipe strike", "steel pipe struck hard with a wrench, bright metallic clang with a long ringing sustain, empty warehouse", 4),
      s("metal-chain-drag", "Chain drag", "heavy iron chain dragged slowly across a concrete floor, dense clinking links, basement reverb", 6),
      s("metal-hull-groan", "Hull groan", "ship hull groaning under pressure, low metallic strain with creaking rivets, enormous enclosed space", 8),
      s("metal-scrape-rust", "Rust scrape", "rusted metal scraping against rusted metal, harsh grinding rasp with a squealing high edge, close mic", 4),
      s("metal-anvil-forge", "Forge hammering", "blacksmith hammering hot steel on an anvil, rhythmic bright strikes with a ringing tail, stone forge", 6),
      s("metal-can-crush", "Can crush", "aluminium can crushed in a fist, thin buckling metal with a crinkling collapse, very close mic, dry", 1.5),
      s("metal-girder-drop", "Girder drop", "steel girder dropped onto concrete, enormous low clang with a slow decaying wobble, construction site", 5),
      s("metal-wire-twang", "Wire twang", "taut steel wire plucked hard, sharp descending twang with a long metallic decay, close and dry", 3),
      s("metal-shutter-roll", "Shutter roll", "corrugated metal shop shutter rolled down fast and slamming, rattling ribs with a hard final clang, street", 4),
    ],
    recipes: [
      {
        label: "Thin and tonal",
        prompt: "large thin metal sheet being flexed and wobbled, deep warbling thunder-like resonance, close mic, dry",
        why: "Thin metal bends instead of ringing. \"Warbling\" gets you the bend; without it you get a clang.",
      },
      {
        label: "Thick and ringing",
        prompt: "steel pipe struck hard with a wrench, bright metallic clang with a long ringing sustain, empty warehouse",
        why: "Naming the striker as well as the object fixes the transient. The room then supplies the sustain.",
      },
      {
        label: "Metal under load",
        prompt: "ship hull groaning under pressure, low metallic strain with creaking rivets, enormous enclosed space",
        why: "\"Under pressure\" turns an impact into a groan: it tells the model the force is continuous.",
      },
      {
        label: "Friction, not impact",
        prompt: "rusted metal scraping against rusted metal, harsh grinding rasp with a squealing high edge, close mic",
        why: "Saying both surfaces are rusted doubles the texture. A scrape between two named materials is more specific than \"metal scrape\".",
      },
    ],
    craft: [
      {
        heading: "Resonance length is the size control",
        body: "You judge the size of a piece of metal by how long it rings after the hit more than by the attack. A small object rings for a fraction of a second; a girder or a hull rings for many seconds and wobbles as different modes decay at different rates. When a metal sound reads as the wrong size, change the tail and leave the hit alone: ask for \"a long ringing sustain\" or \"dead, no ring\", and give the render enough seconds for the tail to fit.",
      },
      {
        heading: "Rust is a texture word that works",
        body: "Clean and rusted metal sound different: clean surfaces slide and ring, corroded ones catch, rasp and squeal. \"Rusted\", \"corroded\" and \"old\" are among the few adjectives these models respond to reliably, because they map onto real spectral differences. If a metal scrape comes back too smooth and synthetic, add rust before you rewrite the action.",
      },
      {
        heading: "Metal for horror",
        body: "Many unsettling horror sounds are metal recorded in unusual ways: a sheet flexed slowly, a wire bowed, a hull straining. Metal produces inharmonic partials, which sound tonal without fitting any musical scale, and that makes a sound feel wrong. If you are building dread, generate the source here and pitch it down. You get the same kind of result as the horror collection, with more control over the source.",
      },
    ],
    faqs: faqs({
      question: "How do I stop every metal hit sounding like the same clang?",
      answer:
        "Vary the striker and the space independently. \"Struck with a wrench\", \"struck with a rubber mallet\" and \"struck with a bare hand\" give different transients from the same object, and moving the same hit from \"close mic, dry\" to \"empty warehouse\" changes the tail completely. Sample packs sound alike because every clip was recorded in one room with one striker; generating lets you change both.",
    }),
    related: ["impact", "machinery", "horror", "glass", "door", "sci-fi"],
  },
};

const WOOD: SfxCategory = {
  slug: "wood",
  name: "Wood",
  targetQuery: "wood sound effect",
  intent:
    "Editors needing wooden creaks, snaps, knocks and splintering for period drama, horror " +
    "interiors, or any game world built out of planks and furniture.",
  metaTitle: "Wood sound effects: creak, snap, splinter | Konchi",
  metaDescription:
    "Generate wood creaking, breaking, knocking and splintering locally. Prompts for dry timber, wet wood, old floorboards and furniture.",
  h1: "Wood sound effects you generate yourself",
  intro:
    "Wood is the sound of old buildings, and old buildings supply much of a scene's atmosphere. The " +
    "useful split is between wood under slow load, which creaks, groans and ticks, and wood under " +
    "sudden load, which snaps and splinters. Most wooden sounds are one of those two events at a " +
    "particular size and moisture. These prompts are organised around that split, because the " +
    "models respond to it.",
  content: {
    samples: [
      s("wood-floorboard-creak", "Floorboard creak", "old floorboard creaking under slow shifting weight, dry timber groaning with a small tick at the end, quiet empty house", 4),
      s("wood-branch-snap", "Branch snap", "dry tree branch snapping in half, sharp crack with splintering fibres tearing, forest floor, outdoor", 2),
      s("wood-plank-break-knee", "Plank break", "wooden plank broken over a knee, loud cracking split with long splinters tearing apart, close mic", 2),
      s("wood-knock-hollow-door", "Hollow knock", "knuckles knocking three times on a hollow wooden door, dull resonant thumps, hallway reverb", 2.5),
      s("wood-chopping-axe-log", "Axe chopping", "axe splitting a log on a chopping block, heavy bite into wood with fibres tearing and halves falling", 3),
      s("wood-furniture-drag", "Furniture drag", "heavy wooden chair dragged across a hardwood floor, juddering stick-slip scrape, medium room", 4),
      s("wood-ship-timbers", "Ship timbers", "wooden ship timbers creaking and working against each other in a swell, slow rhythmic groaning, enclosed hold", 10),
      s("wood-match-box-rattle", "Matchbox rattle", "small wooden matchbox shaken, dry rattling of matches inside cardboard and wood, very close mic", 2),
      s("wood-fence-collapse", "Fence collapse", "wooden fence panel collapsing, nails tearing free with planks clattering onto grass, outdoor garden", 3),
      s("wood-stairs-creak-ascend", "Creaking stairs", "someone climbing old wooden stairs slowly, each step producing a different creak, tense spacing, empty house", 8),
    ],
    recipes: [
      {
        label: "Slow load",
        prompt: "old floorboard creaking under slow shifting weight, dry timber groaning with a small tick at the end, quiet empty house",
        why: "\"Shifting weight\" implies a continuous force, which is what produces a creak instead of a knock.",
      },
      {
        label: "Sudden load",
        prompt: "dry tree branch snapping in half, sharp crack with splintering fibres tearing, forest floor, outdoor",
        why: "\"Fibres tearing\" separates wood from other snapping materials. Without it a break can sound like plastic.",
      },
      {
        label: "Hollow versus solid",
        prompt: "knuckles knocking three times on a hollow wooden door, dull resonant thumps, hallway reverb",
        why: "\"Hollow\" decides whether a knock has a boxy resonance or a dead thud, and the model honours it consistently.",
      },
      {
        label: "Stick-slip friction",
        prompt: "heavy wooden chair dragged across a hardwood floor, juddering stick-slip scrape, medium room",
        why: "Dragged wood grabs and releases. Naming that judder stops the result sounding like a synthesised sweep.",
      },
    ],
    craft: [
      {
        heading: "Dry and wet wood sound different",
        body: "Moisture changes how wood sounds more than size does. Dry timber is brittle, bright and loud; it cracks cleanly and rings a little. Wet or green wood is dull and thuddy; it bends before it breaks and the break is muffled. If a snap sounds rubbery, add \"dry\". If a break sounds too bright for a rain-soaked exterior, add \"damp\" or \"green\". That one word moves the result further than most rewrites.",
      },
      {
        heading: "Give creaks enough time",
        body: "A creak is slow, and the most common mistake is rendering it into a clip too short to hold it. A floorboard under a shifting foot takes two to four seconds to complete its arc (rise, sustain, tick, release), and a one-second render truncates the interesting part. Give creaks room and ask for the ending explicitly. The small settling tick at the end is what tells an audience someone is standing there.",
      },
      {
        heading: "Empty rooms are part of the prompt",
        body: "Wooden interiors are usually heard in a room with no furniture and no people, which is why \"quiet empty house\" appears in so many of these prompts. It tells the model to give you a long, slightly boxy reflection with a low noise floor. That is how an unfurnished room sounds, and it places the creak in a real space.",
      },
    ],
    faqs: faqs({
      question: "How do I get the classic haunted-house creak?",
      answer:
        "Combine dry timber, a slow continuous load and an empty reflective room. \"Old floorboard creaking under slow shifting weight, dry timber groaning, quiet empty house\" gets you most of the way, and a four-second render instead of a one-second one gets you the rest. The horror collection layers this under drones. On its own it is more useful, because you can place it wherever the footstep falls.",
    }),
    related: ["door", "footsteps", "horror", "impact", "metal", "ambience"],
  },
};

const PAPER: SfxCategory = {
  slug: "paper",
  name: "Paper",
  targetQuery: "paper sound effect",
  intent:
    "Editors and UI designers who need page turns, tears, crumples and rustles — small, close, " +
    "detailed foley that almost never exists at the right length in a library.",
  metaTitle: "Paper sound effects: page turn, tear, crumple | Konchi",
  metaDescription:
    "Generate paper rustles, page turns, tears and crumples locally. Close-mic foley prompts for books, documents, cardboard and newsprint.",
  h1: "Paper sound effects you generate yourself",
  intro:
    "Paper foley is small, quiet and very specific, so library versions rarely fit: the page turn " +
    "you need is a particular weight of paper at a particular speed with a particular amount of hand " +
    "in it. It is also one of the easiest things to generate well. Everything that matters " +
    "(thickness, speed, dryness) can be described in plain words, and none of it depends on a room.",
  content: {
    samples: [
      s("paper-page-turn-book", "Page turn", "single page of a hardback book turned at reading speed, soft paper flutter with a light settle, very close mic, quiet room", 2),
      s("paper-tear-slow", "Slow tear", "sheet of paper torn slowly in half, fibres separating with a continuous ragged rip, very close mic, dry", 3),
      s("paper-crumple-ball", "Crumple", "sheet of paper crushed into a ball in one hand, dense crackling collapse, very close mic, dry", 2.5),
      s("paper-newspaper-rustle", "Newspaper", "large newspaper being folded and shaken open, broad thin rustling with sharp snaps, close mic", 3),
      s("paper-stack-shuffle", "Shuffling a stack", "stack of loose documents tapped square on a desk then shuffled, crisp edges sliding, office room tone", 3),
      s("paper-envelope-open", "Envelope", "paper envelope torn open along the top and a letter pulled out, close mic, quiet interior", 3),
      s("paper-cardboard-box-open", "Cardboard box", "cardboard box flaps pulled apart, packing tape peeling away with a stretching rip, close mic", 3),
      s("paper-scroll-unroll", "Scroll unroll", "old parchment scroll unrolled across a table, stiff dry crackling as it flattens, medieval interior", 4),
      s("paper-money-count", "Counting notes", "stack of paper banknotes counted rapidly by hand, rhythmic flicking snaps, very close mic, dry", 3),
      s("paper-shredder-feed", "Shredder", "office paper shredder pulling in a sheet, motor loading then cutting into strips, close mic, office", 4),
    ],
    recipes: [
      {
        label: "Page turn",
        prompt: "single page of a hardback book turned at reading speed, soft paper flutter with a light settle, very close mic, quiet room",
        why: "\"At reading speed\" sets the tempo. Without it the model tends to render a fast flick, which sounds like searching instead of reading.",
      },
      {
        label: "Tear",
        prompt: "sheet of paper torn slowly in half, fibres separating with a continuous ragged rip, very close mic, dry",
        why: "Speed decides how a tear sounds: slow gives a continuous rip, fast gives a single snap. Say which you want.",
      },
      {
        label: "Crumple",
        prompt: "sheet of paper crushed into a ball in one hand, dense crackling collapse, very close mic, dry",
        why: "\"In one hand\" fixes the scale. Without it the model can render something the size of a bin bag.",
      },
      {
        label: "Stiff old paper",
        prompt: "old parchment scroll unrolled across a table, stiff dry crackling as it flattens, medieval interior",
        why: "For paper, age and stiffness go together. Naming both gets a crackle instead of a rustle.",
      },
    ],
    craft: [
      {
        heading: "Everything here is a close-mic sound",
        body: "Paper is so quiet that in a real room the room tone dominates. Every prompt in this collection says \"very close mic\" or \"close mic\" for that reason. Drop it and you get a wash of ambience with some paper somewhere inside it. If the paper needs to sit in a space, generate it dry and close and add the space yourself, so you control how much room there is.",
      },
      {
        heading: "Thickness maps onto brightness",
        body: "Thin paper (newsprint, tracing paper, receipts) is bright and fast with very little body. Thick paper (card, parchment, a hardback's pages) is duller and slower, with a real low mid. Cardboard behaves like a different material, closer to wood. These differences are spectral, so naming the specific stock works better here than writing \"paper\".",
      },
      {
        heading: "Hands are half the sound",
        body: "Most paper foley is skin on paper. A page turn includes a thumb sliding; a crumple includes a fist closing; counting notes is mostly fingertips. Prompts that mention the hand (\"in one hand\", \"counted rapidly by hand\", \"pulled out\") come back more convincing than ones that describe only the paper, because the recordings the model learned from have people in them.",
      },
    ],
    faqs: faqs({
      question: "Why does my paper sound like static or rain?",
      answer:
        "Paper, static and rain are all broadband noise, and without structural cues the model cannot tell them apart. Give the sound an event shape with a beginning, a movement and an end (\"turned\", \"torn in half\", \"crushed into a ball\") in place of a texture word like \"rustling\". Adding \"very close mic\" also helps, because it pushes the result toward a single nearby object.",
    }),
    related: ["ui", "cloth", "wood", "ambience", "keyboard", "transition"],
  },
};

const CLOTH: SfxCategory = {
  slug: "cloth",
  name: "Cloth",
  targetQuery: "cloth sound effect",
  intent:
    "Game and film editors covering character movement — clothing rustle, leather, zips, capes " +
    "and armour straps — the layer that makes a body feel present rather than sliding.",
  metaTitle: "Cloth sound effects: rustle, zip, leather | Konchi",
  metaDescription:
    "Generate fabric rustles, clothing movement, zips and leather creaks locally. Close foley prompts for character movement layers.",
  h1: "Cloth and fabric sound effects you generate yourself",
  intro:
    "Audiences notice cloth only when it is missing. Footsteps put a character on the ground; cloth " +
    "movement gives them a body. It is also hard to source, because you need a specific garment " +
    "moving at a specific speed, and no library indexes that. Generating it lets you match the " +
    "costume.",
  content: {
    samples: [
      s("cloth-jacket-movement", "Jacket movement", "person shifting in a cotton jacket, soft fabric friction with seams stretching, very close mic, quiet room", 3),
      s("cloth-leather-creak", "Leather creak", "leather jacket flexing as someone turns, taut creaking with a dry grain, very close mic", 3),
      s("cloth-zip-fast", "Zip", "metal zip pulled quickly up a jacket, rapid buzzing teeth engaging with a stop at the top, close mic, dry", 1.5),
      s("cloth-cape-swirl", "Cape swirl", "heavy woollen cape swept around, broad low fabric whoosh with a settling drape, medium room", 2.5),
      s("cloth-sheet-flap-line", "Sheet on a line", "bedsheet flapping on a washing line in a breeze, sharp fabric cracks with a continuous flutter, outdoor garden", 6),
      s("cloth-armour-strap", "Armour strap", "leather armour straps tightened and buckled, creaking leather with metal buckle clicks, close mic", 3),
      s("cloth-backpack-shift", "Backpack shift", "hiking backpack shifted on shoulders, nylon straps sliding with buckles knocking, close mic, outdoor", 3),
      s("cloth-curtain-draw", "Curtain draw", "heavy curtains drawn across a rail, fabric sliding with rings clicking along metal, medium room", 3),
      s("cloth-towel-snap", "Towel snap", "damp towel snapped hard through the air, sharp cracking whip with an airy tail, tiled room", 1.5),
      s("cloth-tent-canvas-wind", "Canvas in wind", "canvas tent walls buffeting in strong wind, deep fabric booming with rope creaks, outdoor, seamless loop", 8),
    ],
    recipes: [
      {
        label: "Body movement",
        prompt: "person shifting in a cotton jacket, soft fabric friction with seams stretching, very close mic, quiet room",
        why: "\"Person shifting\" gives the model a body to move. \"Fabric rustle\" alone gives it a texture with nobody inside it.",
      },
      {
        label: "Leather",
        prompt: "leather jacket flexing as someone turns, taut creaking with a dry grain, very close mic",
        why: "Leather creaks where cotton rustles. \"Taut\" and \"grain\" push the result away from cotton, the model's default fabric.",
      },
      {
        label: "Heavy drape",
        prompt: "heavy woollen cape swept around, broad low fabric whoosh with a settling drape, medium room",
        why: "\"Settling drape\" adds the tail that makes heavy fabric sound heavy. Without it a cape sounds like a tea towel.",
      },
      {
        label: "Wind-loaded fabric",
        prompt: "canvas tent walls buffeting in strong wind, deep fabric booming with rope creaks, outdoor, seamless loop",
        why: "Large fabric under wind load booms at low frequencies. \"Booming\" finds that register instead of the surface rustle.",
      },
    ],
    craft: [
      {
        heading: "Name the garment",
        body: "\"Cotton\" on its own tells the model very little; \"a cotton jacket\" tells it a lot, because a jacket implies seams, a lining, a size and a person wearing it. The same goes for canvas and a tent, leather and a leather jacket, wool and a cape. For cloth, naming the object almost always works better than naming the material, because garments are what the training data contains.",
      },
      {
        heading: "Give cloth a movement",
        body: "Static fabric makes no sound. Every prompt here has a verb with an arc: shifting, flexing, swept, pulled, drawn, snapped. If a cloth generation comes back as a formless hiss, the prompt probably described a state instead of an action. Add a direction (up, across, around) and an endpoint (\"with a stop at the top\", \"with a settling drape\") to get an event you can cut to picture.",
      },
      {
        heading: "Add the hardware",
        body: "What makes clothing foley identifiable is usually the zip, the buckle, the curtain ring or the strap. These are small metallic events on top of a broadband bed. Calling them out individually (\"metal buckle clicks\", \"rings clicking along metal\") gives you something that cuts through a mix. A cloth layer with no hardware tends to disappear once music comes in.",
      },
    ],
    faqs: faqs({
      question: "How do I build a full character movement layer?",
      answer:
        "Generate it in pieces and stack them. A convincing move is usually three renders: the cloth from this collection, the footfall from the footsteps collection, and one hardware detail such as a buckle, a zip or a strap. Generating each separately lets you time them to the animation independently, which a single library \"character move\" clip cannot do.",
    }),
    related: ["footsteps", "paper", "weapon", "ambience", "whoosh", "impact"],
  },
};

const KEYBOARD: SfxCategory = {
  slug: "keyboard",
  name: "Keyboard & office",
  targetQuery: "keyboard typing sound effect",
  intent:
    "Video editors, app demo makers and game developers who need typing, mouse clicks and desk " +
    "foley — one of the highest-volume searches on every free library and almost always needed " +
    "at a specific length.",
  metaTitle: "Keyboard typing sound effects | Konchi",
  metaDescription:
    "Generate keyboard typing, mouse clicks, mechanical key presses and office desk foley locally. Prompts for laptop, mechanical and vintage typewriters.",
  h1: "Keyboard and office sound effects you generate yourself",
  intro:
    "Typing is one of the most-searched sounds on free libraries and one of the most annoying to " +
    "source, because you usually need something like exactly eleven seconds of typing that stops on " +
    "the beat. Generating gets you the length you asked for, and the right keyboard: a membrane " +
    "laptop, a heavy mechanical board and a 1960s typewriter sound completely different, and a " +
    "search for \"typing\" mixes them together.",
  content: {
    samples: [
      s("keyboard-mechanical-typing", "Mechanical typing", "typing steadily on a mechanical keyboard with tactile switches, distinct clacking key presses, close mic, quiet office", 8),
      s("keyboard-laptop-typing", "Laptop typing", "typing on a laptop membrane keyboard, soft muted key taps at a steady pace, close mic, quiet room", 8),
      s("keyboard-single-key-press", "Single key", "single mechanical keyboard key pressed and released, crisp click with a bottom-out thock, very close mic, dry", 1),
      s("keyboard-enter-slam", "Enter key", "enter key struck hard on a mechanical keyboard, deep decisive clack, very close mic, dry", 1),
      s("keyboard-typewriter-line", "Typewriter", "vintage manual typewriter typing a line then the carriage return bell and lever, close mic, small office", 6),
      s("keyboard-mouse-click-double", "Mouse click", "computer mouse clicked twice in quick succession, tiny sharp plastic clicks, very close mic, dry", 1),
      s("keyboard-mouse-scroll", "Scroll wheel", "mouse scroll wheel turned through its detents, fine ratcheting ticks, very close mic, dry", 2),
      s("keyboard-desk-pen-click", "Pen click", "retractable ballpoint pen clicked repeatedly, sharp plastic snaps, very close mic, quiet room", 3),
      s("keyboard-frantic-typing", "Frantic typing", "someone typing very fast and erratically on a mechanical keyboard, dense overlapping key presses, close mic", 6),
      s("keyboard-office-desk-ambience", "Desk ambience", "quiet open-plan office ambience, distant typing, a phone ringing far away and low ventilation hum, seamless loop", 12),
    ],
    recipes: [
      {
        label: "Mechanical board",
        prompt: "typing steadily on a mechanical keyboard with tactile switches, distinct clacking key presses, close mic, quiet office",
        why: "\"Tactile switches\" is a real spec with a real sound. It gets the click without the mushiness of a membrane board.",
      },
      {
        label: "Laptop board",
        prompt: "typing on a laptop membrane keyboard, soft muted key taps at a steady pace, close mic, quiet room",
        why: "\"Membrane\" and \"muted\" together stop the model reaching for the louder mechanical recordings it has more of.",
      },
      {
        label: "Pace as a control",
        prompt: "someone typing very fast and erratically on a mechanical keyboard, dense overlapping key presses, close mic",
        why: "Pace carries the character's state: steady sounds like work, erratic sounds like panic. Set it in the prompt instead of in the edit.",
      },
      {
        label: "Single event",
        prompt: "single mechanical keyboard key pressed and released, crisp click with a bottom-out thock, very close mic, dry",
        why: "\"Pressed and released\" gets both halves of the key travel, which makes a UI click sound physical.",
      },
    ],
    craft: [
      {
        heading: "Render the length of the shot",
        body: "A cut needs typing that runs for the exact duration of a shot and stops cleanly. A library gives you fourteen seconds when you needed nine, so you fade it and it sounds faded. Set the render length to the shot length. Every prompt here carries an explicit duration for this reason.",
      },
      {
        heading: "Choose the keyboard",
        body: "A hacker scene, an office comedy and a period drama need three different keyboards. Mechanical boards are bright, clicky and percussive, with an audible bottom-out. Membrane laptops are dull, fast and close to silent. Typewriters are loud and mechanical, and the carriage return is a beat of its own. Pick one and name it in the prompt; that does more for a scene than processing.",
      },
      {
        heading: "Add desk foley",
        body: "A room with only typing in it sounds like a sound effect. Real desks have pens, mice, mugs, chairs and a ventilation hum, and the small items make the space sound inhabited. Generate two or three of them separately and lay them under the typing at a low level. The pen click and the scroll wheel in this collection are meant for this, and they work better as a bed than in the foreground.",
      },
    ],
    faqs: faqs({
      question: "Can I get typing that matches a specific words-per-minute?",
      answer:
        "Not precisely. The models respond to pace words like \"steady\", \"fast\", \"erratic\" and \"hunt and peck\", and not to a number. That is usually enough, because a scene needs the character's state more than a measurement. If you need exact sync to what is on screen, generate a single key press and place it per keystroke. That gives you full control for one render.",
    }),
    related: ["ui", "notification", "ambience", "paper", "clock", "machinery"],
  },
};

const CLOCK: SfxCategory = {
  slug: "clock",
  name: "Clocks & timers",
  targetQuery: "clock ticking sound effect",
  intent:
    "Editors building tension or marking time — ticking beds, alarm clocks, countdown timers and " +
    "chiming grandfather clocks, usually needed as a seamless loop.",
  metaTitle: "Clock ticking sound effects | Konchi",
  metaDescription:
    "Generate clock ticking, alarm clocks, countdown timers and chimes locally. Loopable tension beds and one-shot alarms, with the prompts that made them.",
  h1: "Clock and timer sound effects you generate yourself",
  intro:
    "A ticking clock is the cheapest tension device in film. It works because it is metronomic: the " +
    "audience starts counting without deciding to. That also makes it unforgiving, because a loop " +
    "that does not line up is obvious immediately. Generating your own lets you render a tick at the " +
    "tempo your scene needs, without time-stretching someone else's and hearing the artefacts.",
  content: {
    samples: [
      s("clock-wall-tick-loop", "Wall clock tick", "wall clock ticking steadily once per second, dry mechanical tick with a small internal rattle, quiet room, seamless loop", 10),
      s("clock-grandfather-pendulum", "Grandfather clock", "large grandfather clock pendulum swinging, heavy slow wooden tock every second, hallway reverb, seamless loop", 10),
      s("clock-grandfather-chime", "Hour chime", "grandfather clock striking the hour, deep resonant chimes with a long decay in a wood-panelled hall", 10),
      s("clock-alarm-bell-ringing", "Alarm clock", "vintage twin-bell alarm clock ringing violently, hammer striking metal bells, bedside close mic", 5),
      s("clock-digital-alarm-beep", "Digital alarm", "digital alarm clock beeping in short insistent triplets, thin piezo tone, close mic, quiet bedroom", 5),
      s("clock-stopwatch-click", "Stopwatch", "mechanical stopwatch button clicked to start, then fine rapid ticking, very close mic, dry", 5),
      s("clock-kitchen-timer-wind", "Kitchen timer", "mechanical kitchen timer wound up and released, ratcheting then a fine ticking countdown, close mic", 6),
      s("clock-timer-final-bell", "Timer bell", "kitchen timer reaching zero and striking a single bright bell, close mic, kitchen reverb", 2),
      s("clock-tick-accelerating", "Accelerating tick", "clock ticking and gradually accelerating in tempo, mechanical ticks growing frantic, dry and close", 10),
      s("clock-bomb-countdown", "Countdown timer", "digital countdown timer beeping once per second with a rising pitch as it nears zero, tense and dry", 10),
    ],
    recipes: [
      {
        label: "Loopable tension bed",
        prompt: "wall clock ticking steadily once per second, dry mechanical tick with a small internal rattle, quiet room, seamless loop",
        why: "\"Once per second\" fixes the tempo, and \"seamless loop\" tells the model to keep it even end to end, so it holds up under a long scene.",
      },
      {
        label: "Weight and age",
        prompt: "large grandfather clock pendulum swinging, heavy slow wooden tock every second, hallway reverb, seamless loop",
        why: "\"Tock\" in place of \"tick\" lands the sound about an octave lower, so it reads as a much bigger mechanism.",
      },
      {
        label: "Rising urgency",
        prompt: "digital countdown timer beeping once per second with a rising pitch as it nears zero, tense and dry",
        why: "Writing the escalation into the prompt saves an automation pass, and the model's version drifts smoothly instead of in even steps.",
      },
      {
        label: "Mechanical alarm",
        prompt: "vintage twin-bell alarm clock ringing violently, hammer striking metal bells, bedside close mic",
        why: "Describing the mechanism (a hammer between two bells) produces the characteristic stutter that a plain \"alarm\" prompt lacks.",
      },
    ],
    craft: [
      {
        heading: "Set the tempo in the prompt",
        body: "Clocks are one of the few sound families where these models follow an explicit rate, because \"once per second\" is a common phrase in the training captions and an unambiguous physical description. Use it. For other rates, write the interval in words (\"twice per second\", \"a slow tick every two seconds\") and do not try to correct the timing afterwards: time-stretching a tick audibly changes its timbre.",
      },
      {
        heading: "Change the room before the clock",
        body: "The same tick sounds ordinary in a kitchen and menacing in an empty hallway; the only difference is the reflection. Long, hard, empty spaces let each tick ring slightly and leave a gap of silence that the audience fills. If a ticking bed is not working, change the space first (\"hallway reverb\", \"large empty room\", \"wood-panelled hall\") and keep the tick itself dry and simple.",
      },
      {
        heading: "Generate the ending too",
        body: "Most ticking beds end with something: a bell, a stop, an alarm, a cut to silence. Libraries sell the loop and leave you to find the ending elsewhere, which is why so many countdowns end with an obvious splice. Render the ending as its own short clip in the same session (the timer bell in this collection is one) so the two share a character and cut together cleanly.",
      },
    ],
    faqs: faqs({
      question: "Will a generated tick actually loop seamlessly?",
      answer:
        "Close, but check it. Asking for a seamless loop makes the model keep level and tempo even end to end, which removes the usual reason loops fail. It does not guarantee a sample-accurate join, so trim to a zero crossing on a tick boundary in your editor. For a metronomic sound that takes seconds, and you would do the same with a purchased loop.",
    }),
    related: ["ambience", "horror", "notification", "cinematic", "keyboard", "alarm"],
  },
};

const BELL: SfxCategory = {
  slug: "bell",
  name: "Bells & chimes",
  targetQuery: "bell sound effect",
  intent:
    "Editors needing bells of a specific size and purpose — church bells, service bells, bicycle " +
    "bells, wind chimes, boxing bells — where the size of the bell is the whole character.",
  metaTitle: "Bell sound effects: church, chime, ding | Konchi",
  metaDescription:
    "Generate church bells, service bells, wind chimes, bicycle bells and boxing bells locally. Prompts that control size, metal and decay.",
  h1: "Bell and chime sound effects you generate yourself",
  intro:
    "Bells are pure resonance, which makes them forgiving to generate and easy to get subtly wrong. " +
    "Most of a bell's identity is in its decay: how long it rings, how the partials beat against " +
    "each other as it fades, and whether the room joins in. With the decay right, even a rough " +
    "render is convincing. With it wrong, extra brightness does not help.",
  content: {
    samples: [
      s("bell-church-tower-single", "Church bell", "single large church bell tolling, deep bronze strike with a long beating decay, stone tower and open air", 10),
      s("bell-church-peal", "Full peal", "full peal of church bells ringing changes, overlapping bronze tones in a village, open air, distant", 12),
      s("bell-service-desk-ding", "Service bell", "hotel reception desk bell struck once, bright short ding with a clean metallic decay, lobby reverb", 3),
      s("bell-bicycle-ring", "Bicycle bell", "bicycle bell thumbed twice, bright thin metallic trill, close mic, outdoor street", 2),
      s("bell-wind-chimes-breeze", "Wind chimes", "metal wind chimes moving in a light breeze, random overlapping tuned tones, outdoor porch, seamless loop", 10),
      s("bell-boxing-round", "Boxing bell", "boxing ring bell struck three times to end a round, harsh bright clang, arena reverb with crowd behind", 5),
      s("bell-hand-bell-shake", "Hand bell", "brass hand bell shaken vigorously, rapid clapper strikes with a bright ringing wash, close mic", 3),
      s("bell-ship-bell-strike", "Ship's bell", "ship's bell struck twice on deck, bright brass ring with sea and wind behind, open outdoor", 4),
      s("bell-tibetan-singing-bowl", "Singing bowl", "Tibetan singing bowl struck once and left to ring, pure sustained tone with slow beating partials, quiet room", 12),
      s("bell-tubular-chime-strike", "Tubular chime", "orchestral tubular bell struck with a mallet, bright metallic strike with a very long shimmering decay, concert hall", 10),
    ],
    recipes: [
      {
        label: "Big bell",
        prompt: "single large church bell tolling, deep bronze strike with a long beating decay, stone tower and open air",
        why: "\"Beating decay\" names the slow interference between partials that only large bells produce. It is the strongest size cue available.",
      },
      {
        label: "Small bell",
        prompt: "hotel reception desk bell struck once, bright short ding with a clean metallic decay, lobby reverb",
        why: "\"Short\" and \"clean\" do the same job for a small bell: no beating, no wobble, gone in a second.",
      },
      {
        label: "Many bells at once",
        prompt: "full peal of church bells ringing changes, overlapping bronze tones in a village, open air, distant",
        why: "\"Ringing changes\" is the term for the pattern English peals use. It produces overlapping, non-repeating tones instead of a chord.",
      },
      {
        label: "Sustained tone",
        prompt: "Tibetan singing bowl struck once and left to ring, pure sustained tone with slow beating partials, quiet room",
        why: "\"Left to ring\" tells the model not to cut the tail, and the tail carries this sound's character.",
      },
    ],
    craft: [
      {
        heading: "Decay length is size",
        body: "A hand bell rings for under a second and a church bell for ten or more, and nothing else in the sound shows scale as clearly. So give the render enough seconds for the tail to finish. A large bell rendered into a three-second clip loses the part that makes it sound large. Every big-bell prompt here asks for ten seconds or more for that reason.",
      },
      {
        heading: "Ask for beating",
        body: "Real bells are not perfectly tuned. Their partials sit slightly apart, and as they decay they interfere and produce a slow wobble in the tail, which campanologists call beating. Synthetic bells lack it and sound sterile. \"Beating decay\" and \"slow beating partials\" reliably produce it, and it moves a generation from sampled keyboard toward cast bronze faster than anything else.",
      },
      {
        heading: "Place the bell somewhere",
        body: "Bells are usually heard through their surroundings: a tower, a hall, a village across fields. Distance matters as much as size. The same bell is bright and metallic up close, and at two hundred metres it is a warm low tone with most of the attack gone. If a bell sounds too aggressive, move it instead of filtering it: add \"distant\" or \"heard across fields\" and the model handles the air absorption.",
      },
    ],
    faqs: faqs({
      question: "How do I get a bell that is clearly enormous?",
      answer:
        "Combine a long render, an explicitly large object, and beating in the decay. \"Single large church bell tolling, deep bronze strike with a long beating decay, stone tower and open air\" at ten or twelve seconds gets there. If it still sounds small, the render is usually too short: the size is in the tail, and a short clip cuts it off.",
    }),
    related: ["clock", "notification", "ambience", "metal", "crowd", "magic"],
  },
};

/* ================================================== Vehicles & transport */

const CAR: SfxCategory = {
  slug: "car",
  name: "Cars",
  targetQuery: "car sound effect",
  intent:
    "Editors and game developers covering road vehicles — doors, starts, skids, horns, passes — " +
    "where the specific event matters more than the make of car.",
  metaTitle: "Car sound effects: engine, door, skid, horn | Konchi",
  metaDescription:
    "Generate car engine starts, door slams, tyre skids, horns and pass-bys locally. Prompts for interior and exterior perspectives.",
  h1: "Car sound effects you generate yourself",
  intro:
    "Car audio has two parts: what the car does, and where you are standing when it does it. The " +
    "same engine heard from the pavement, the driver's seat or a hundred metres down the road gives " +
    "you three different assets, and choosing the perspective is most of the work. These prompts " +
    "name it every time, because library clips rarely say which one you are getting.",
  content: {
    samples: [
      s("car-engine-start-idle", "Start and idle", "petrol car engine starting from cold, starter motor cranking then catching and settling into a rough idle, exterior close", 8),
      s("car-door-close-solid", "Door close", "car door closing solidly, dense thunk with a rubber seal compressing and a latch click, exterior, street", 2),
      s("car-tyre-skid-stop", "Tyre skid", "car braking hard on dry tarmac, tyres screeching and locking into a stop, outdoor street, wide", 4),
      s("car-horn-single-blast", "Horn", "car horn blasted once in city traffic, dual-tone honk with a street reverb tail, outdoor", 2),
      s("car-pass-by-fast", "Fast pass-by", "car passing the listener at speed on a wet road, doppler engine and tyre roar sweeping past, roadside", 5),
      s("car-interior-driving", "Interior driving", "interior of a car driving at motorway speed, muffled engine drone with tyre roar and wind, seamless loop", 12),
      s("car-gear-shift-rev", "Rev and shift", "sports car revving hard and shifting up through two gears, throaty exhaust bark, exterior close", 6),
      s("car-indicator-tick", "Indicator", "car indicator relay ticking steadily, dry mechanical clicks, interior close mic, seamless loop", 6),
      s("car-crash-head-on", "Crash", "car crashing head-on into a barrier, huge metal impact with glass shattering and debris scattering, street", 4),
      s("car-engine-fail-start", "Failing to start", "car engine failing to start, starter motor cranking repeatedly and dying, battery weakening, exterior close", 8),
    ],
    recipes: [
      {
        label: "Cold start",
        prompt: "petrol car engine starting from cold, starter motor cranking then catching and settling into a rough idle, exterior close",
        why: "Describing the three stages (crank, catch, settle) gets you a complete event instead of an engine that is already running.",
      },
      {
        label: "Perspective as a control",
        prompt: "interior of a car driving at motorway speed, muffled engine drone with tyre roar and wind, seamless loop",
        why: "\"Interior\" and \"muffled\" together put the listener inside the cabin. Without them the model renders the exterior every time.",
      },
      {
        label: "Pass-by",
        prompt: "car passing the listener at speed on a wet road, doppler engine and tyre roar sweeping past, roadside",
        why: "The road surface changes the tyre noise more than the speed does: wet tarmac hisses, dry tarmac roars, gravel crunches.",
      },
      {
        label: "Door weight",
        prompt: "car door closing solidly, dense thunk with a rubber seal compressing and a latch click, exterior, street",
        why: "The rubber seal makes a modern car door sound expensive. Leave it out and you get a tinny older one.",
      },
    ],
    craft: [
      {
        heading: "Decide where the microphone is first",
        body: "Interior, exterior close and exterior distant are three different assets, and EQ does not convincingly turn one into another. The cabin is a small sealed space that removes the top end and adds its own resonance; distance removes the transients more than the treble. Write the perspective into every vehicle prompt. A missing perspective is the most common reason a car sound will not sit in a scene.",
      },
      {
        heading: "Engine and tyres are separate layers",
        body: "Most driving audio is two independent layers. The engine tells you what the driver is doing (idling, accelerating, labouring, shifting) and the tyres tell you what the road is. You can specify them separately: \"revving hard\" plus \"on a wet road\" gives you an aggressive car in the rain, a combination no single library clip is likely to have.",
      },
      {
        heading: "Add the small mechanical details",
        body: "Indicator relays, seatbelt reels, handbrake ratchets, key fobs and latch clicks are small and instantly recognisable, and each costs one short render. A scene built from these plus one interior bed sounds more real than a single long drive-by, and gives you events to cut on. The indicator loop here is meant to sit under dialogue and mark time.",
      },
    ],
    faqs: faqs({
      question: "Can I get a specific make and model of engine?",
      answer:
        "Not reliably. These models respond well to descriptions of behaviour and character (\"throaty exhaust bark\", \"rough idle\", \"high-revving four cylinder\", \"heavy diesel clatter\") and poorly to brand names, which have no consistent acoustic meaning in the training captions. Describe how the engine behaves.",
    }),
    related: ["engine", "machinery", "ambience", "impact", "explosion", "train"],
  },
};

const ENGINE: SfxCategory = {
  slug: "engine",
  name: "Engines & motors",
  targetQuery: "engine sound effect",
  intent:
    "Designers who need the motor itself rather than the vehicle around it — idles, revs, diesel " +
    "clatter, electric whine, outboards, generators — usually as a loopable bed.",
  metaTitle: "Engine sound effects: idle, rev, diesel, electric | Konchi",
  metaDescription:
    "Generate engine idles, revs, diesel clatter and electric motor whine locally. Loopable beds and one-shot starts with prompts that control the character.",
  h1: "Engine and motor sound effects you generate yourself",
  intro:
    "An engine is a rhythm at a pitch. Cylinder count sets the pattern, load sets the pitch and " +
    "strain, and fuel type sets the texture: petrol is smooth, diesel clatters, electric hums with " +
    "no rhythm at all. Everything in this collection is a combination of those three, which is why " +
    "one page covers motorbikes, boats and generators.",
  content: {
    samples: [
      s("engine-diesel-idle-loop", "Diesel idle", "heavy diesel truck engine idling, rhythmic clattering combustion with a low rumble, exterior close, seamless loop", 10),
      s("engine-motorcycle-rev", "Motorcycle rev", "motorcycle engine revved hard twice then dropping back to idle, sharp exhaust bark, exterior close", 6),
      s("engine-electric-motor-whine", "Electric motor", "electric vehicle motor accelerating, smooth rising harmonic whine with no combustion, close exterior", 6),
      s("engine-outboard-boat", "Outboard motor", "small outboard boat motor running at speed, buzzing two-stroke with water slapping the hull, open water", 8),
      s("engine-lawnmower-cut", "Lawnmower", "petrol lawnmower engine running and bogging down as it cuts thick grass, exterior, garden", 8),
      s("engine-v8-muscle-idle", "V8 idle", "large V8 muscle car engine idling with a lumpy uneven cam, deep burbling exhaust, exterior close, seamless loop", 10),
      s("engine-start-cold-crank", "Cold crank", "large engine cranking on a weak battery, slow laboured turns before catching roughly, exterior close", 8),
      s("engine-jet-turbine-spool", "Turbine spool-up", "jet turbine spooling up from rest to full power, rising harmonic whine into a roaring blast, tarmac, distant", 10),
      s("engine-generator-load", "Generator under load", "portable petrol generator running steadily then dipping as load is applied, exterior, seamless loop", 10),
      s("engine-two-stroke-chainsaw-idle", "Two-stroke idle", "two-stroke engine idling unevenly, high buzzing exhaust note with irregular misfires, close mic, outdoor", 6),
    ],
    recipes: [
      {
        label: "Diesel",
        prompt: "heavy diesel truck engine idling, rhythmic clattering combustion with a low rumble, exterior close, seamless loop",
        why: "\"Clattering combustion\" is the diesel tell: mechanical noise on top of the exhaust note. Naming it separates diesel from petrol.",
      },
      {
        label: "Electric",
        prompt: "electric vehicle motor accelerating, smooth rising harmonic whine with no combustion, close exterior",
        why: "\"No combustion\" is a negative instruction that works. It removes the rhythmic pulsing the model otherwise adds.",
      },
      {
        label: "Load and strain",
        prompt: "petrol lawnmower engine running and bogging down as it cuts thick grass, exterior, garden",
        why: "\"Bogging down\" gives you the drop in pitch and rise in effort of an engine doing work.",
      },
      {
        label: "Lumpy idle",
        prompt: "large V8 muscle car engine idling with a lumpy uneven cam, deep burbling exhaust, exterior close, seamless loop",
        why: "An uneven cam is why muscle cars burble. Asking for the cause produces a more characterful idle than describing the effect.",
      },
    ],
    craft: [
      {
        heading: "Cylinder count sets the rhythm",
        body: "An engine's identity is its firing pattern. A single-cylinder thumper is slow and uneven, a four is a smooth buzz, a V8 is a deep uneven burble, and a turbine has no pattern at all, only tone. You can prompt this directly, and it is more reliable than describing the vehicle: \"single-cylinder\", \"four cylinder\", \"V8\" and \"turbine\" each give a distinct result from otherwise identical prompts.",
      },
      {
        heading: "Put the engine under load",
        body: "A free-revving engine has little drama. Under load, the pitch drops, mechanical noise rises and the engine sounds strained, and a single phrase such as \"bogging down\", \"labouring\", \"under load\" or \"straining uphill\" produces all three. If a vehicle scene feels flat, the engine is probably running free when it should be working.",
      },
      {
        heading: "Keep loops at a steady level",
        body: "An engine bed under a scene has to stay even end to end, or the loop point shows up as a level jump. \"Seamless loop\" plus \"idling steadily\" gets you that. A rev inside a loop breaks it, because a rev is a change. Keep loops steady and generate the events (starts, revs, shifts, stops) as separate one-shots to place on top.",
      },
    ],
    faqs: faqs({
      question: "Can I generate a full acceleration from idle to top speed?",
      answer:
        "Yes. Write it as a sequence of stages, for example \"engine starting from idle, accelerating hard through three gear changes, settling at cruise\", and give it ten or twelve seconds so each stage has room. You will not get frame-accurate sync to a specific animation. For that, generate the stages separately and place them, as a game engine would.",
    }),
    related: ["car", "machinery", "aircraft", "train", "sci-fi", "ambience"],
  },
};

const TRAIN: SfxCategory = {
  slug: "train",
  name: "Trains",
  targetQuery: "train sound effect",
  intent:
    "Editors covering rail — steam locomotives, modern trains, subway platforms, level crossings — " +
    "where period and perspective decide everything.",
  metaTitle: "Train sound effects: steam, subway, crossing | Konchi",
  metaDescription:
    "Generate steam locomotives, modern trains, subway ambience and level crossings locally. Prompts for interior, platform and trackside perspectives.",
  h1: "Train sound effects you generate yourself",
  intro:
    "Trains mark a period. A steam locomotive, a diesel express and a modern electric metro each " +
    "place a scene in a different decade before any dialogue, and audiences read them immediately. " +
    "Trains are also large, so perspective matters more than usual: trackside, on the platform and " +
    "inside the carriage are three different sounds from the same train.",
  content: {
    samples: [
      s("train-steam-chuff-departing", "Steam departure", "steam locomotive departing a station, slow chuffing accelerating with wheel slip and a whistle, trackside, open air", 12),
      s("train-steam-whistle", "Steam whistle", "steam locomotive whistle blowing long and mournful, multi-tone brass with a valley echo, distant outdoor", 6),
      s("train-modern-passby-platform", "Platform pass-by", "modern electric train passing through a station without stopping, rising roar and doppler, platform perspective", 8),
      s("train-subway-interior", "Subway interior", "inside a subway carriage between stations, rhythmic rail clatter with motor whine and rattling panels, seamless loop", 12),
      s("train-level-crossing-bells", "Level crossing", "railway level crossing bells ringing and barriers lowering, roadside, outdoor, traffic waiting", 10),
      s("train-freight-slow-rumble", "Freight train", "long freight train rolling slowly past, endless wheel clatter and couplings knocking, trackside, distant horn", 12),
      s("train-brakes-squeal-stop", "Brakes squeal", "train braking into a station, steel wheels squealing sharply and grinding to a stop, platform reverb", 8),
      s("train-announcement-station", "Station ambience", "railway station concourse ambience, echoing announcements, footsteps and distant train movement, large hall", 12),
      s("train-doors-hiss-close", "Doors closing", "modern train doors beeping then hissing closed with a pneumatic thump, platform, close", 5),
      s("train-track-clatter-rhythm", "Track rhythm", "steady rhythmic clatter of wheels over rail joints at speed, trackside close, seamless loop", 10),
    ],
    recipes: [
      {
        label: "Steam",
        prompt: "steam locomotive departing a station, slow chuffing accelerating with wheel slip and a whistle, trackside, open air",
        why: "\"Wheel slip\" makes a steam departure believable. The moment of lost traction is in the real recordings and missing from generic prompts.",
      },
      {
        label: "Modern electric",
        prompt: "modern electric train passing through a station without stopping, rising roar and doppler, platform perspective",
        why: "\"Without stopping\" implies speed, and \"platform perspective\" puts the listener beside the track.",
      },
      {
        label: "Interior bed",
        prompt: "inside a subway carriage between stations, rhythmic rail clatter with motor whine and rattling panels, seamless loop",
        why: "\"Between stations\" keeps the bed steady. Otherwise the model adds a stop, which breaks the loop.",
      },
      {
        label: "The rhythm alone",
        prompt: "steady rhythmic clatter of wheels over rail joints at speed, trackside close, seamless loop",
        why: "Isolating the rail joints gives you a rhythmic layer that works under any train, which makes it more reusable than a whole train.",
      },
    ],
    craft: [
      {
        heading: "Period is set by propulsion",
        body: "Steam chuffs and whistles; diesel clatters and sounds a horn; electric hums and whines. That choice places a scene in a decade more reliably than set dressing, and the models handle it well because the three families are distinct in the training data. State it: \"steam locomotive\", \"diesel locomotive\", \"modern electric train\". Plain \"train\" leaves the choice to the model.",
      },
      {
        heading: "Rail joints set the rhythm",
        body: "The classic train rhythm comes from wheels crossing gaps in the rail, which is why modern continuously welded track sounds much smoother than older jointed track. For the clackety rhythm, ask for \"rail joints\". For a modern high-speed line, ask for a smooth continuous roar. Each fits a different decade.",
      },
      {
        heading: "Stations have reverb, open track has almost none",
        body: "A station is a large hard enclosure with a long reverb tail and echoing announcements. Open track has almost no reflection beyond ground bounce. Moving the same train between them changes it completely, and it takes one word in the prompt. When a train sound feels wrong for a shot, check the space first. Most mismatches are a trackside recording under a platform shot, or the reverse.",
      },
    ],
    faqs: faqs({
      question: "How do I build a whole station scene?",
      answer:
        "Layer three renders: a station concourse bed for the room and the crowd, one train event for the action (an arrival, a pass-by, doors closing), and one small detail near the microphone, such as a case wheeling past or an announcement. Generating them separately lets you control the balance and the timing, the same way a production mixer works with location recordings.",
    }),
    related: ["engine", "ambience", "crowd", "machinery", "car", "aircraft"],
  },
};

const AIRCRAFT: SfxCategory = {
  slug: "aircraft",
  name: "Aircraft",
  targetQuery: "airplane sound effect",
  intent:
    "Editors needing aviation — jets, propellers, helicopters, cabin interiors and flyovers — " +
    "usually at a specific distance, which is the hardest thing to find in a library.",
  metaTitle: "Airplane sound effects: jet, prop, helicopter | Konchi",
  metaDescription:
    "Generate jet engines, propeller aircraft, helicopters, cabin interiors and flyovers locally. Prompts that control distance and doppler.",
  h1: "Aircraft sound effects you generate yourself",
  intro:
    "Aircraft audio depends mostly on distance. The same jet is a shriek on the tarmac, a roar at " +
    "five hundred metres, and a soft rumble overhead at altitude. A volume change does not turn one " +
    "into another: air absorption removes high frequencies as distance grows, and doppler shift only " +
    "happens when the aircraft is passing. These prompts treat distance as the main parameter.",
  content: {
    samples: [
      s("aircraft-jet-takeoff-close", "Jet takeoff", "commercial jet taking off from close beside the runway, enormous rising turbine roar with a ground rumble, outdoor", 12),
      s("aircraft-jet-overhead-cruise", "High overhead", "jet airliner passing high overhead at cruise altitude, soft distant rumble with no transient detail, open sky", 12),
      s("aircraft-prop-plane-flyby", "Propeller flyby", "small propeller aircraft flying low past the listener, buzzing engine with a clear doppler drop, open countryside", 8),
      s("aircraft-helicopter-hover", "Helicopter hover", "helicopter hovering overhead, heavy rhythmic rotor thump with a turbine whine underneath, outdoor, seamless loop", 10),
      s("aircraft-helicopter-approach-depart", "Helicopter pass", "helicopter approaching from a distance, passing overhead loudly and receding, full doppler arc, open field", 12),
      s("aircraft-cabin-interior-cruise", "Cabin interior", "inside a passenger aircraft cabin at cruise, steady broadband air rush with a low engine drone, seamless loop", 12),
      s("aircraft-landing-gear-touchdown", "Touchdown", "aircraft landing gear touching down on a runway, tyre chirp and rumble with reverse thrust roaring, exterior", 8),
      s("aircraft-fighter-jet-lowpass", "Fighter jet", "military fighter jet passing low and fast, tearing afterburner roar arriving late with a violent doppler, open sky", 8),
      s("aircraft-drone-quadcopter", "Quadcopter", "small quadcopter drone hovering close then moving away, high buzzing rotors, outdoor, quiet park", 8),
      s("aircraft-airport-tarmac-ambience", "Tarmac ambience", "airport tarmac ambience, distant jets, ground vehicles and radio chatter, wide open outdoor, seamless loop", 12),
    ],
    recipes: [
      {
        label: "Close and violent",
        prompt: "commercial jet taking off from close beside the runway, enormous rising turbine roar with a ground rumble, outdoor",
        why: "\"Ground rumble\" is the low-frequency component you only hear near the aircraft, and it is what makes close sound close.",
      },
      {
        label: "Distant and soft",
        prompt: "jet airliner passing high overhead at cruise altitude, soft distant rumble with no transient detail, open sky",
        why: "\"No transient detail\" is a negative instruction that models air absorption. Distance removes the top end, and saying so works better than filtering afterwards.",
      },
      {
        label: "Full doppler arc",
        prompt: "helicopter approaching from a distance, passing overhead loudly and receding, full doppler arc, open field",
        why: "Naming all three stages gets a complete pass in one render, so you do not have to automate a hover into a flyby.",
      },
      {
        label: "Rotor rhythm",
        prompt: "helicopter hovering overhead, heavy rhythmic rotor thump with a turbine whine underneath, outdoor, seamless loop",
        why: "A helicopter is two sounds stacked: a slow blade thump and a fast turbine whine. Naming both stops it sounding like a fan.",
      },
    ],
    craft: [
      {
        heading: "Put the distance in the prompt",
        body: "Air absorbs high frequencies far more than low ones, so a distant aircraft has a different spectrum from a close one, with the attack smeared by travel time. Prompting the distance gets you that physics. Rolling off the top of a close recording sounds muffled instead of far away, which is the usual reason a stock flyby will not sit behind a wide shot.",
      },
      {
        heading: "Doppler needs a pass",
        body: "A hovering helicopter has no pitch shift; a passing one has a pronounced one. Confusing the two is the most common aviation error in edits: a hover loop panned across the stereo field still sounds stationary because the pitch never moves. If the aircraft crosses frame, ask for the doppler and render the whole arc in one clip so the shift is continuous.",
      },
      {
        heading: "Cabin interiors are mostly air noise",
        body: "Inside a cruising airliner, the dominant sound is boundary-layer air rushing over the fuselage: broad, smooth, close to pink noise, with the engine drone well below it. \"Steady broadband air rush with a low engine drone\" reads as a cabin immediately. Prompting the engines gives you something that sounds like standing outside one.",
      },
    ],
    faqs: faqs({
      question: "Why does my flyby sound like it never moves?",
      answer:
        "The prompt described a state, with no trajectory. \"Helicopter flying\" gives the model a steady loop; \"approaching from a distance, passing overhead loudly and receding, full doppler arc\" gives it a path. Length matters too: a pass needs eight to twelve seconds to be legible, and a three-second render gives you the middle of the arc without the approach and departure.",
    }),
    related: ["engine", "ambience", "wind", "machinery", "sci-fi", "train"],
  },
};

export const FOLEY_AND_TRANSPORT: SfxCategory[] = [
  GLASS,
  METAL,
  WOOD,
  PAPER,
  CLOTH,
  KEYBOARD,
  CLOCK,
  BELL,
  CAR,
  ENGINE,
  TRAIN,
  AIRCRAFT,
];
