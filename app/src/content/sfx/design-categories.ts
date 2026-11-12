/**
 * The second half of the post-audit collections: human performance, trailer
 * design, and the creature/machine families.
 *
 * Split from `new-categories.ts` purely for file size. The design family —
 * riser, braam, drone — earns its own pages because that is how the trailer
 * houses index their own libraries and how Soundsnap shelves them on its front
 * page: nobody searching for a braam will find it under "cinematic", and
 * nobody building a tension bed wants to scroll past explosions to reach it.
 *
 * The same rule applies as everywhere else in `/sfx`: a page ships because
 * somebody wrote it. Nothing here is templated from a slug.
 */

import type { SfxCategory, SfxFaq, SfxSample } from "./types";

const MODEL = "audiocpp-stable-audio-3-sfx";

function s(slug: string, title: string, prompt: string, durationS: number): SfxSample {
  return { slug, title, prompt, source: "model", model: MODEL, durationS };
}

/** Shared tail questions — see the note in `new-categories.ts`. */
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

/* ======================================================= Human & voice */

const APPLAUSE: SfxCategory = {
  slug: "applause",
  name: "Applause",
  targetQuery: "applause sound effect",
  intent:
    "Editors who need clapping at a specific size and warmth — two people, a conference room, a " +
    "stadium — and keep getting a canned laugh-track crowd that dates the whole piece.",
  metaTitle: "Applause sound effects: clapping and cheers | Konchi",
  metaDescription:
    "Generate applause, clapping and ovations locally at any crowd size. Prompts for small rooms, theatres, stadiums and single claps.",
  h1: "Applause sound effects you generate yourself",
  intro:
    "Crowd size sets the sound of applause. Four people clapping in an office and four thousand in " +
    "an arena are different sounds: in the large crowd the individual claps merge into noise, and in " +
    "the small one you can count the hands. Choosing the wrong size makes a video sound canned, and " +
    "stock clips rarely let you control it.",
  content: {
    samples: [
      s("applause-small-room", "Small room", "six people applauding politely in a small meeting room, individual claps clearly audible, close and dry", 6),
      s("applause-theatre-warm", "Theatre applause", "theatre audience of several hundred applauding warmly, dense overlapping claps, wooden hall reverb", 8),
      s("applause-stadium-roar", "Stadium ovation", "stadium crowd of thousands applauding and cheering, applause merging into a continuous roar, vast open space", 10),
      s("applause-single-slow-clap", "Slow clap", "single person slow clapping sarcastically, deliberate spaced claps with a hard room echo, empty hall", 6),
      s("applause-building-ovation", "Building ovation", "audience applause starting scattered and building into a full standing ovation with whistles, large hall", 10),
      s("applause-conference-polite", "Conference", "conference audience applauding politely at the end of a talk, even and restrained, medium hall with air conditioning", 8),
      s("applause-fade-out-end", "Applause dying out", "applause tapering off and dying away to a few last claps, then room tone, medium hall", 8),
      s("applause-golf-clap", "Golf clap", "small polite golf gallery clapping quietly, soft muffled claps outdoors with birdsong behind", 6),
      s("applause-comedy-club-laugh", "Laughter and applause", "small comedy club audience laughing then breaking into applause, close intimate room, low ceiling", 8),
      s("applause-single-clap-slate", "Single clap", "one sharp hand clap in an empty room, bright transient with a clear slap-back echo, dry and close", 2),
    ],
    recipes: [
      {
        label: "Set the head count",
        prompt: "six people applauding politely in a small meeting room, individual claps clearly audible, close and dry",
        why: "A number plus \"individual claps clearly audible\" keeps the model from defaulting to a stadium, which it does on the word applause alone.",
      },
      {
        label: "Large and merged",
        prompt: "stadium crowd of thousands applauding and cheering, applause merging into a continuous roar, vast open space",
        why: "\"Merging into a continuous roar\" is the acoustic signature of a big crowd, and it separates size from volume.",
      },
      {
        label: "Applause with a shape",
        prompt: "audience applause starting scattered and building into a full standing ovation with whistles, large hall",
        why: "Applause usually has an arc. Describing it gives you something to cut against picture instead of a flat bed.",
      },
      {
        label: "Comic timing",
        prompt: "single person slow clapping sarcastically, deliberate spaced claps with a hard room echo, empty hall",
        why: "\"Deliberate spaced\" plus an empty room makes the joke: the echo between claps is what makes it sound sarcastic.",
      },
    ],
    craft: [
      {
        heading: "Density sets the size",
        body: "As a crowd grows, the gaps between claps fill in until the sound is continuous. That transition happens at around a hundred people, and it is the cue an audience uses. When applause sounds like the wrong size, change the density words and leave the level alone: \"individual claps clearly audible\" for small, \"dense overlapping\" for medium, \"merging into a continuous roar\" for large. A stadium turned down sounds like a distant stadium.",
      },
      {
        heading: "Give it a beginning and an end",
        body: "Applause that starts at full volume and stops dead sounds like a stock clip. Real applause ramps: a few hands, then the room joining, then the peak, then a ragged tail as people stop at different times. Ask for the shape you need, and generate the tail as its own clip if you want to control where the scene lands. The fade-out sample in this collection is for that.",
      },
      {
        heading: "Put the crowd in a room",
        body: "Dry, close, mid-sized applause with no room in it sounds like 1980s television, because that is what a laugh-track machine produced. For something contemporary, give it a specific space (a wooden hall, a low-ceilinged club, an outdoor gallery) and let the reflections place it. It costs a few words in the prompt.",
      },
    ],
    faqs: faqs({
      question: "How do I avoid the canned laugh-track sound?",
      answer:
        "Name a plausible crowd size, put the crowd in a real acoustic space, and give the applause an arc instead of a flat plateau. Canned applause fails all three: it is a mid-sized, roomless, shapeless loop. Fixing any one helps. With all three fixed, the result is usually hard to tell from a location recording.",
    }),
    related: ["crowd", "scream", "ambience", "notification", "cinematic", "cartoon"],
  },
};

const SCREAM: SfxCategory = {
  slug: "scream",
  name: "Screams & vocal effort",
  targetQuery: "scream sound effect",
  intent:
    "Game developers and horror editors needing human vocal reactions — screams, grunts, gasps, " +
    "pain and effort — which are the hardest thing to source cleanly and the most obvious when wrong.",
  metaTitle: "Scream sound effects: horror, pain, effort | Konchi",
  metaDescription:
    "Generate screams, gasps, grunts and vocal effort sounds locally. Prompts for horror reactions, combat effort and pain, with the room built in.",
  h1: "Scream and vocal effort sound effects you generate yourself",
  intro:
    "Vocal effort makes a character sound like a person. It is also the layer most likely to break " +
    "immersion, because listeners know human voices well and notice a wrong one immediately. Treat " +
    "a scream as a shape with an intake, a release and a collapse. Prompting the shape gives more " +
    "usable results than prompting the emotion.",
  content: {
    samples: [
      s("scream-terror-female", "Terror scream", "woman screaming in terror, sharp full-throated cry breaking at the top, medium reverberant interior", 4),
      s("scream-terror-male", "Male shout of fear", "man shouting in sudden fear, short sharp cry cutting off abruptly, close and dry", 3),
      s("scream-pain-grunt", "Pain grunt", "short pained grunt from a body taking an impact, air forced out with a strained edge, close mic, dry", 2),
      s("scream-effort-lift", "Effort grunt", "person straining to lift something heavy, low sustained effort grunt with a shaky release, close mic", 3),
      s("scream-gasp-startle", "Startled gasp", "sudden sharp intake of breath, startled gasp then held, very close mic, quiet room", 2),
      s("scream-breathing-panic", "Panicked breathing", "person breathing fast and shallow in panic, ragged inhales with a tight throat, very close mic", 8),
      s("scream-battle-cry", "Battle cry", "warrior roaring a battle cry, full chested and sustained, open outdoor space with a distant echo", 4),
      s("scream-distant-help", "Distant cry for help", "someone shouting for help from far away, thin and reverberant, echoing across a large empty space", 5),
      s("scream-crowd-terror", "Crowd screaming", "crowd of people screaming and panicking together, overlapping voices scattering, street reverb", 6),
      s("scream-dying-fall", "Falling scream", "long falling scream receding with a doppler drop as it disappears into the distance, open air", 5),
    ],
    recipes: [
      {
        label: "Full scream",
        prompt: "woman screaming in terror, sharp full-throated cry breaking at the top, medium reverberant interior",
        why: "\"Breaking at the top\" separates a real scream from a sung note. Voices distort at maximum effort, and listeners expect it.",
      },
      {
        label: "Effort, not pain",
        prompt: "person straining to lift something heavy, low sustained effort grunt with a shaky release, close mic",
        why: "Effort is sustained and low; pain is sudden and sharp. Naming which one you want stops the model blending them into something ambiguous.",
      },
      {
        label: "Breath as performance",
        prompt: "person breathing fast and shallow in panic, ragged inhales with a tight throat, very close mic",
        why: "\"Tight throat\" gives the constriction that sounds like fear. Without it, panicked breathing sounds like exercise.",
      },
      {
        label: "Distance and space",
        prompt: "someone shouting for help from far away, thin and reverberant, echoing across a large empty space",
        why: "Distance strips the body out of a voice and leaves the reflections. Asking for it directly works better than adding reverb to a close recording.",
      },
    ],
    craft: [
      {
        heading: "Prompt what the body does",
        body: "\"Scared scream\" gives the model an abstraction; \"sharp full-throated cry breaking at the top\" gives it a physical event. These models respond better to descriptions of what the body is doing (air forced out, throat tightening, voice cracking, breath held) than to the feeling behind it. The same rule runs through all of Konchi's prompting advice, and it makes the biggest difference with vocals.",
      },
      {
        heading: "Place the voice in a room",
        body: "The same voice screaming in a tiled bathroom, a forest and a cathedral gives three different scenes. The reflections arrive after the voice and tell the audience how far away the person is and how big the space is, which dialogue cannot. Always place the vocal somewhere. A dry scream sounds like a sound effect however good the performance.",
      },
      {
        heading: "Build the small sounds first",
        body: "Games and film use far more grunts, gasps and breaths than screams, and those small sounds keep a character present. They are cheap to generate and easy to vary: three renders of the same effort grunt give enough variation to avoid the repetition that makes game audio grating. Build that library first. You will use it constantly, and the scream rarely.",
      },
    ],
    faqs: faqs({
      question: "Can I generate actual dialogue this way?",
      answer:
        "No. The sound-effect models render vocal noise without words, and asking them for a line produces something that sounds like speech but is not. Konchi has a separate path for spoken audio: the speech models and the story tools, which cast lines to real voices and keep them as an arrangement you can re-read line by line. Use this collection for effort and reaction, and the speech path for anything with words.",
    }),
    related: ["horror", "crowd", "applause", "heartbeat", "creature", "impact"],
  },
};

const HEARTBEAT: SfxCategory = {
  slug: "heartbeat",
  name: "Heartbeat & body",
  targetQuery: "heartbeat sound effect",
  intent:
    "Editors building subjective tension — heartbeat beds, breathing, tinnitus, the inside-the-head " +
    "perspective that puts an audience inside a character rather than beside them.",
  metaTitle: "Heartbeat sound effects: pulse, breath, tension | Konchi",
  metaDescription:
    "Generate heartbeats, breathing, tinnitus tones and body sounds locally. Loopable tension beds and one-shot beats for subjective sequences.",
  h1: "Heartbeat and body sound effects you generate yourself",
  intro:
    "In film, a heartbeat signals subjectivity: when you hear one, you are inside a character " +
    "instead of watching them. Nobody hears a heartbeat externally, so its presence means the " +
    "camera has moved inward. Getting it right is mostly tempo and body. Too fast and it sounds like " +
    "a drum; with no chest resonance it sounds like a kick sample.",
  content: {
    samples: [
      s("heartbeat-calm-loop", "Calm heartbeat", "human heartbeat at rest, slow double thump about once per second, deep chest resonance, very close and internal, seamless loop", 10),
      s("heartbeat-accelerating", "Accelerating", "heartbeat accelerating steadily from calm to racing, deep internal thumps growing faster and harder", 10),
      s("heartbeat-racing-panic", "Racing", "heartbeat racing in panic, fast hard double thumps with blood rushing in the ears, internal perspective, seamless loop", 8),
      s("heartbeat-single-thump", "Single beat", "single deep heartbeat thump with a long low chest resonance, internal perspective, dry", 2),
      s("heartbeat-flatline-monitor", "Flatline", "hospital heart monitor beeping steadily then dropping to a continuous flat tone, clinical room, close", 8),
      s("heartbeat-monitor-steady", "Monitor beeping", "hospital heart monitor beeping steadily once per second, thin electronic tone, quiet ward, seamless loop", 10),
      s("heartbeat-breath-held-release", "Held breath", "person holding their breath then releasing it in a long shaky exhale, very close mic, quiet", 6),
      s("heartbeat-tinnitus-ring", "Tinnitus", "high pitched tinnitus ringing after an explosion, thin sine tone with all other sound muffled and distant", 8),
      s("heartbeat-underwater-pulse", "Underwater pulse", "heartbeat heard underwater, muffled low thumps with water pressure and no high frequencies, submerged", 8),
      s("heartbeat-slowing-to-stop", "Slowing to stop", "heartbeat slowing gradually and weakening until it stops, deep internal thumps spacing out, dark and quiet", 10),
    ],
    recipes: [
      {
        label: "Resting bed",
        prompt: "human heartbeat at rest, slow double thump about once per second, deep chest resonance, very close and internal, seamless loop",
        why: "\"Double thump\" is the anatomically correct shape: a heart makes two sounds per beat, and a single thump sounds like a drum.",
      },
      {
        label: "Escalation",
        prompt: "heartbeat accelerating steadily from calm to racing, deep internal thumps growing faster and harder",
        why: "Writing the acceleration into one render keeps the tempo curve smooth. Automating it afterwards produces audible steps.",
      },
      {
        label: "Inside the head",
        prompt: "high pitched tinnitus ringing after an explosion, thin sine tone with all other sound muffled and distant",
        why: "Naming what happens to everything else (muffled, distant) creates the subjective perspective. The tone alone is only a tone.",
      },
      {
        label: "Clinical, not internal",
        prompt: "hospital heart monitor beeping steadily once per second, thin electronic tone, quiet ward, seamless loop",
        why: "The monitor carries the same information from outside the body, and cutting between the two is a cheap, effective perspective change.",
      },
    ],
    craft: [
      {
        heading: "Tempo sets the emotion",
        body: "A resting heart is around one beat per second, a frightened one closer to two, and a racing one faster still, where it starts to lose its double-thump definition. That covers the whole emotional range without any other parameter. Prompt the rate (\"about once per second\", \"fast\", \"racing\"), and if a scene needs a change, render it as one continuous clip. Crossfading between two loops never quite hides the join.",
      },
      {
        heading: "Add chest resonance",
        body: "A heartbeat without low-frequency body is a kick drum, and audiences hear the difference even if they cannot name it. \"Deep chest resonance\" and \"internal perspective\" reliably produce it, and they matter more than volume: a quiet heartbeat with real body sits under dialogue well, while a loud thin one fights everything. If yours is not working, add body before level.",
      },
      {
        heading: "Change the outside world too",
        body: "The heartbeat alone does not put an audience inside a character; the contrast with the exterior does. Subjective sequences muffle the exterior, roll off its top end, and often add tinnitus or held breath, and the heartbeat sits in the space that clears. Generate the interior layer here and treat the exterior as a separate decision. If everything else stays normal, the heartbeat sounds like score.",
      },
    ],
    faqs: faqs({
      question: "Why does my heartbeat sound like a drum?",
      answer:
        "Usually one of two causes. The first is a single thump per beat instead of the double; ask for \"double thump\". The second is missing low-frequency body: without \"deep chest resonance\" and an internal perspective, you get the transient without the cavity around it, which is what a kick drum is. Fixing both in the prompt is faster than EQ afterwards.",
    }),
    related: ["horror", "cinematic", "scream", "ambience", "clock", "drone"],
  },
};

/* ================================================== Trailer & sound design */

const RISER: SfxCategory = {
  slug: "riser",
  name: "Risers",
  targetQuery: "riser sound effect",
  intent:
    "Video editors and trailer cutters who need tension builds of an exact length that land " +
    "precisely on a cut — the single most common request in the whole transition family.",
  metaTitle: "Riser sound effects: tension builds and uplifters | Konchi",
  metaDescription:
    "Generate risers, uplifters and tension builds locally at exactly the length your cut needs. Prompts for tonal, noise, metallic and orchestral builds.",
  h1: "Riser sound effects you generate yourself",
  intro:
    "A riser is built around its ending. The rate it climbs, the way it thins out at the top and the " +
    "silence it leaves all serve the cut it lands on. That is why library risers are frustrating: " +
    "you get a four-second build for a three-second gap and no clean way to fix it. Generating one " +
    "at the exact length you need is the clearest case in this library for making a sound instead " +
    "of searching for one.",
  content: {
    samples: [
      s("riser-noise-white-build", "White noise riser", "white noise riser building steadily in volume and brightness over four seconds and cutting off sharply, wide stereo", 4),
      s("riser-tonal-pitch-climb", "Tonal riser", "tonal riser, synthetic pitch climbing steadily upward with growing intensity, ending abruptly, wide stereo", 4),
      s("riser-metallic-scrape", "Metallic riser", "metallic riser built from scraping metal harmonics accelerating upward into a hard stop, harsh and wide", 5),
      s("riser-orchestral-strings", "Orchestral build", "orchestral string section building from soft tremolo to a full dissonant fortissimo, large hall, ending on a cut", 8),
      s("riser-shepard-infinite", "Endless rise", "shepard tone riser, layered octaves creating an endlessly rising illusion, smooth and unsettling, seamless loop", 10),
      s("riser-percussive-accelerando", "Accelerating drums", "percussive riser, drum hits accelerating from slow to a blur over six seconds then stopping dead, big room", 6),
      s("riser-vocal-choir-swell", "Choir swell", "choir swelling from a whisper to a full dissonant cluster over eight seconds, cathedral reverb", 8),
      s("riser-downlifter-reverse", "Downlifter", "downlifter, pitch and energy falling away steadily into a low settled hum, wide stereo, cinematic", 5),
      s("riser-glitch-digital-build", "Glitch riser", "digital riser built from stuttering glitch artefacts accelerating and rising in pitch, harsh, ending abruptly", 4),
      s("riser-long-twelve-second", "Long build", "very long cinematic riser building slowly over twelve seconds through noise, tone and low rumble to a hard cut", 12),
    ],
    recipes: [
      {
        label: "Cut-ready build",
        prompt: "white noise riser building steadily in volume and brightness over four seconds and cutting off sharply, wide stereo",
        why: "Put the length in the prompt and set the render to the same number so it lands. \"Cutting off sharply\" gives you a clean edit point.",
      },
      {
        label: "Tonal versus noise",
        prompt: "tonal riser, synthetic pitch climbing steadily upward with growing intensity, ending abruptly, wide stereo",
        why: "Tonal risers sit in the harmony and can clash with music; noise risers sit outside it. Choose on purpose to avoid a fight in the mix.",
      },
      {
        label: "The infinite one",
        prompt: "shepard tone riser, layered octaves creating an endlessly rising illusion, smooth and unsettling, seamless loop",
        why: "The Shepard tone is a named illusion the models know. Asking for it by name is more reliable than describing the effect.",
      },
      {
        label: "Falling instead",
        prompt: "downlifter, pitch and energy falling away steadily into a low settled hum, wide stereo, cinematic",
        why: "Downlifters cover the other half of a transition. You usually want a matched pair, and generating both in one session keeps them related.",
      },
    ],
    craft: [
      {
        heading: "Render the length of the gap",
        body: "A build that is even a quarter second too long has to be trimmed from the front, which removes the quiet beginning that made it feel long. One that is too short has to be stretched, which smears the top. Measure the gap in your timeline, set the render to that number, and say the number in the prompt as well. The round trip takes about fifteen seconds.",
      },
      {
        heading: "Decide what happens at the top",
        body: "Risers end in one of three ways: a hard cut into silence, a cut into an impact, or a spill of reverb that carries over the edit. The first is tense, the second violent, the third a reveal, and they are not interchangeable. Say which you want (\"ending abruptly\", \"cutting off sharply\", \"spilling into a long reverb tail\"). If you do not, the model tends to fade out, and a fade rarely works.",
      },
      {
        heading: "Layer several risers",
        body: "A big trailer build is usually three risers at once: noise for the top, a tonal element for the middle, and a low rumble for the weight. Generating them separately and stacking them lets you time each one and keeps the mix controllable. That is why this collection has a noise riser, a tonal riser and a long combined build instead of ten variations of one sound.",
      },
    ],
    faqs: faqs({
      question: "How do I make a riser land exactly on the cut?",
      answer:
        "Set the render duration to the exact gap in your timeline and ask for an abrupt ending. The model produces a clip of the requested length with the peak at the end, so it lines up with the cut without trimming. If you are a few frames out, trim from the front: losing the quiet start of a build is almost inaudible, while losing the top is obvious.",
    }),
    related: ["transition", "braam", "cinematic", "whoosh", "drone", "glitch"],
  },
};

const BRAAM: SfxCategory = {
  slug: "braam",
  name: "Trailer hits & braams",
  targetQuery: "braam trailer sound effect",
  intent:
    "Trailer editors after the specific brass-and-sub blast the form is built on, plus the impacts, " +
    "stingers and boom hits that punctuate a cut.",
  metaTitle: "Braam and trailer hit sound effects | Konchi",
  metaDescription:
    "Generate braams, trailer hits, boom impacts and stingers locally. Prompts for the brass blast, the sub drop and the tail that follows.",
  h1: "Braam and trailer hit sound effects you generate yourself",
  intro:
    "The braam is the most recognisable sound in modern film marketing: a distorted brass blast over " +
    "an enormous sub, placed on a cut and decaying for several seconds. Good ones are hard to buy, " +
    "because the library versions have already been used by everyone else. A generated braam is " +
    "yours alone, and you can render a version with a longer tail when the edit changes.",
  content: {
    samples: [
      s("braam-classic-brass", "Classic braam", "enormous distorted brass braam, low blaring horn blast with a huge sub underneath and a long decaying tail", 6),
      s("braam-double-hit", "Double braam", "two braam hits in succession, distorted brass blasts a beat apart with overlapping sub tails, enormous space", 8),
      s("braam-rising-into-hit", "Build into braam", "tension building for three seconds then landing on a massive distorted brass braam with a long tail", 8),
      s("braam-sub-drop-only", "Sub drop", "pure cinematic sub bass drop with no midrange, deep pitch falling and sustaining, felt more than heard", 6),
      s("braam-metallic-impact", "Metallic hit", "trailer impact with a bright metallic transient over a deep distorted boom, long shimmering decay", 5),
      s("braam-choir-hybrid", "Choir braam", "hybrid trailer hit blending a dark male choir with distorted brass and a sub drop, cathedral scale", 6),
      s("braam-percussive-boom", "Boom hit", "huge percussive trailer boom, gated drum-like impact with a compressed room and a fast tight decay", 4),
      s("braam-reverse-into-hit", "Reverse into hit", "reversed swell sucking backwards for two seconds then landing on a massive distorted trailer impact", 5),
      s("braam-stinger-short-sharp", "Short stinger", "short sharp trailer stinger, aggressive distorted stab with almost no tail, dry and violent", 2),
      s("braam-final-hit-long-tail", "Final hit", "final trailer hit, enormous impact with a twelve second decaying tail settling into a low drone", 12),
    ],
    recipes: [
      {
        label: "The braam itself",
        prompt: "enormous distorted brass braam, low blaring horn blast with a huge sub underneath and a long decaying tail",
        why: "Name all three components (brass, sub, tail). A braam missing any one of them becomes a different sound.",
      },
      {
        label: "Hit without brass",
        prompt: "huge percussive trailer boom, gated drum-like impact with a compressed room and a fast tight decay",
        why: "\"Gated\" and \"compressed room\" describe the production treatment, and these models respond well to that vocabulary.",
      },
      {
        label: "Weight only",
        prompt: "pure cinematic sub bass drop with no midrange, deep pitch falling and sustaining, felt more than heard",
        why: "\"No midrange\" keeps the sub out of the way of everything else, so you can stack it under an existing hit.",
      },
      {
        label: "Landing the ending",
        prompt: "final trailer hit, enormous impact with a twelve second decaying tail settling into a low drone",
        why: "The last hit of a trailer is defined by its tail. A tail that long needs a render length to match, or it gets cut off.",
      },
    ],
    craft: [
      {
        heading: "A braam has three layers",
        body: "Brass gives the identity, the sub gives the physical weight, and the tail gives the scale. Without brass you get a generic boom; without the sub, a horn; without the tail, something that sounds small however loud it is. You can prompt all three together, or generate them separately and stack them, which is useful when you want the brass from one take and the weight from another.",
      },
      {
        heading: "Give the tail enough time",
        body: "As with bells, the decay tells the audience how big the space is, and trailer hits are built to sound like they happen somewhere the size of a canyon. So give the render enough seconds. A braam with a six-second tail rendered into a three-second clip loses its scale, and adding reverb afterwards does not convincingly restore it.",
      },
      {
        heading: "Leave silence around hits",
        body: "Trailer hits land through contrast: near-silence before, and space for the tail to decay into afterwards. That is an edit decision, but it changes what you should generate: a hit with a clean start and a long uninterrupted decay, without padding of atmosphere. Ask for a dry start and a long tail, and leave the silence to the timeline.",
      },
    ],
    faqs: faqs({
      question: "Why do my trailer hits sound small?",
      answer:
        "Usually the tail. Big hits sound big because of the three to twelve seconds after the transient, and the two most common mistakes are rendering too short a clip and prompting only the impact. Ask for the decay, set the render length to contain it, and add a sub layer if the hit has no low end. Those three fixes cover most of the difference between a trailer hit and a drum sample.",
    }),
    related: ["cinematic", "riser", "impact", "explosion", "drone", "transition"],
  },
};

const DRONE: SfxCategory = {
  slug: "drone",
  name: "Drones & soundscapes",
  targetQuery: "dark drone sound effect",
  intent:
    "Editors and game developers who need a sustained tonal bed to sit under a scene — dread, awe, " +
    "unease, machinery — for minutes rather than seconds, and seamlessly.",
  metaTitle: "Drone sound effects: dark ambient beds | Konchi",
  metaDescription:
    "Generate dark drones, tension beds and evolving soundscapes locally. Loopable atmospheres for horror, sci-fi and cinematic scenes.",
  h1: "Drone and soundscape sound effects you generate yourself",
  intro:
    "A drone is the least noticeable element in a soundtrack and one of the most important. It sets " +
    "what a scene feels like before anything happens, and it holds a long take together when nothing " +
    "else does. A good drone moves slowly enough not to draw attention, but enough that the ear " +
    "keeps hearing it, and you can control that balance from the prompt.",
  content: {
    samples: [
      s("drone-dark-dread-low", "Dark dread", "dark sustained drone, low detuned tones slowly beating against each other, oppressive and airless, seamless loop", 12),
      s("drone-sci-fi-ship-hum", "Ship hum", "spacecraft interior drone, warm low mechanical hum with a faint high electrical shimmer, seamless loop", 12),
      s("drone-cathedral-awe", "Awe drone", "vast sustained drone suggesting enormous scale, slow swelling low strings and choir under a hall of air, seamless loop", 12),
      s("drone-industrial-throb", "Industrial throb", "industrial drone with a slow rhythmic throb, distant machinery pressure and metallic resonance, seamless loop", 12),
      s("drone-tension-rising-unease", "Rising unease", "tension drone slowly rising in pitch and density over twelve seconds without ever resolving, dissonant", 12),
      s("drone-underwater-pressure", "Underwater pressure", "deep underwater drone, immense low pressure with distant groaning hull creaks, submerged, seamless loop", 12),
      s("drone-desert-heat-shimmer", "Heat shimmer", "sparse arid drone, thin high shimmering tone over a warm low bed with occasional distant wind, seamless loop", 12),
      s("drone-electrical-hum-fault", "Faulty electrics", "electrical drone with an unstable mains hum, buzzing and intermittently flickering, close and claustrophobic", 10),
      s("drone-choral-ethereal", "Ethereal choir", "ethereal choral drone, wordless voices sustaining a slowly shifting consonant chord, huge reverberant space", 12),
      s("drone-sub-rumble-bed", "Sub rumble", "pure low frequency rumble bed with no midrange or top, slowly undulating, felt more than heard, seamless loop", 12),
    ],
    recipes: [
      {
        label: "Dread",
        prompt: "dark sustained drone, low detuned tones slowly beating against each other, oppressive and airless, seamless loop",
        why: "Detuned tones beating against each other create unease: a dissonance you feel as movement more than hear as a chord.",
      },
      {
        label: "Awe rather than fear",
        prompt: "vast sustained drone suggesting enormous scale, slow swelling low strings and choir under a hall of air, seamless loop",
        why: "Dread and awe differ in consonance and space. The technique is the same, with the opposite harmonic instruction.",
      },
      {
        label: "Movement without event",
        prompt: "tension drone slowly rising in pitch and density over twelve seconds without ever resolving, dissonant",
        why: "\"Without ever resolving\" keeps it a bed instead of a riser. It moves but never arrives, so it does not pull focus.",
      },
      {
        label: "Weight only",
        prompt: "pure low frequency rumble bed with no midrange or top, slowly undulating, felt more than heard, seamless loop",
        why: "A sub-only bed can sit under dialogue without masking any words, which makes it the most reusable drone in a library.",
      },
    ],
    craft: [
      {
        heading: "Keep it moving slowly",
        body: "A perfectly static tone fades from perception within about twenty seconds as the ear adapts. A drone that undulates, beats or drifts slowly stays present without becoming an event. Ask for the movement: \"slowly beating\", \"undulating\", \"slowly shifting\". Without it, the audience stops hearing the bed partway through the scene.",
      },
      {
        heading: "Stay out of the dialogue's frequency band",
        body: "Drones usually fail in the mix, and the cause is almost always that they share the midrange with the voices above them. A sub-only bed, or one with its energy high and airy, can sit loud without masking anything. Prompt the band directly (\"no midrange\", \"thin high shimmering tone\", \"low pressure\"). That works better than EQ afterwards, because the model produces a sound made for that register.",
      },
      {
        heading: "Generate long, loop carefully",
        body: "These render up to two minutes at a time, which is often long enough that a scene needs no loop, and an unlooped bed has no loop point to give away. When you do need a loop, ask for a seamless loop and keep the request steady, because a drone that swells inside its own clip cannot join to itself. Then cut at a zero crossing in the quietest moment, which for a drone takes seconds.",
      },
    ],
    faqs: faqs({
      question: "How long can a single drone render be?",
      answer:
        "Up to two minutes on the Stable Audio SFX model, which is the per-generation limit Konchi reports for it. The clips on this page are twelve seconds to keep the page practical. For real work, render the full length of the scene and skip looping. Longer renders take proportionally longer, so a two-minute bed is a coffee-break wait.",
    }),
    related: ["ambience", "horror", "cinematic", "sci-fi", "heartbeat", "braam"],
  },
};

const GUNSHOT: SfxCategory = {
  slug: "gunshot",
  name: "Gunshots",
  targetQuery: "gunshot sound effect",
  intent:
    "Game developers and film editors who need firearms specifically — the report, the mechanism, " +
    "the distance and the environment — rather than the generic weapon category.",
  metaTitle: "Gunshot sound effects: pistol, rifle, shotgun | Konchi",
  metaDescription:
    "Generate gunshots, reloads, ricochets and distant gunfire locally. Prompts that control calibre, mechanism, distance and the environment's tail.",
  h1: "Gunshot sound effects you generate yourself",
  intro:
    "A gunshot is two sounds: a very short, very loud report, and the environment's response to it. " +
    "The report tells you what the weapon is; the response tells you where you are standing. Most " +
    "unconvincing gunshots in an edit have a plausible report and no environment, so they sound like " +
    "samples. These prompts always name the space, because it is at least half of what the audience " +
    "hears.",
  content: {
    samples: [
      s("gunshot-pistol-indoor", "Pistol indoors", "9mm pistol fired once inside a concrete stairwell, sharp cracking report with hard slapping echoes, close", 4),
      s("gunshot-pistol-outdoor", "Pistol outdoors", "pistol fired once in an open field, sharp report with a fast dry crack and almost no reflection, distant treeline", 4),
      s("gunshot-rifle-distant-valley", "Distant rifle", "hunting rifle fired far away across a valley, delayed crack with a long rolling echo between hillsides", 6),
      s("gunshot-shotgun-blast-pump", "Shotgun and pump", "pump-action shotgun fired then racked, heavy blast with a shell ejecting onto concrete, alley reverb", 4),
      s("gunshot-automatic-burst-street", "Automatic burst", "automatic rifle firing a short burst in a city street, rapid overlapping reports with building echoes", 5),
      s("gunshot-suppressed-shot", "Suppressed shot", "suppressed pistol shot, muted mechanical thump with the slide cycling clearly audible, close and dry", 2),
      s("gunshot-revolver-single", "Revolver", "revolver fired once, deep booming report with a cylinder ring, open outdoor space with a rolling tail", 4),
      s("gunshot-reload-magazine", "Magazine reload", "pistol magazine released and dropped, a fresh one inserted and the slide released, very close mic, dry", 4),
      s("gunshot-ricochet-metal", "Ricochet", "bullet ricocheting off metal, sharp impact with a whining pitched departure, industrial space, echoing", 3),
      s("gunshot-distant-firefight", "Distant firefight", "distant firefight heard from several streets away, scattered muffled reports with long urban echoes", 10),
    ],
    recipes: [
      {
        label: "Indoors",
        prompt: "9mm pistol fired once inside a concrete stairwell, sharp cracking report with hard slapping echoes, close",
        why: "Hard enclosed spaces produce discrete slap-back echoes instead of smooth reverb, and naming the material gets you that reflection.",
      },
      {
        label: "Outdoors",
        prompt: "pistol fired once in an open field, sharp report with a fast dry crack and almost no reflection, distant treeline",
        why: "\"Almost no reflection\" makes an exterior shot sound exterior, and the treeline adds one distant return so it does not sound lifeless.",
      },
      {
        label: "Distance",
        prompt: "hunting rifle fired far away across a valley, delayed crack with a long rolling echo between hillsides",
        why: "At distance the echo becomes the main event and the report becomes small, so prompting the echo prompts the distance.",
      },
      {
        label: "Mechanism, not report",
        prompt: "pistol magazine released and dropped, a fresh one inserted and the slide released, very close mic, dry",
        why: "Weapon handling is used far more often than firing and is almost never in stock packs at usable length.",
      },
    ],
    craft: [
      {
        heading: "Always name the environment",
        body: "A gunshot's report lasts a few milliseconds; the rest is the room, the street or the valley responding. That is why the same weapon is unrecognisable indoors and outdoors, and why a dry stock shot never sits in a scene. Make the space a required part of every gunfire prompt. When a shot does not fit the picture, change the space before the weapon.",
      },
      {
        heading: "Generate the handling sounds first",
        body: "Slides racking, magazines dropping, hammers cocking and shells hitting concrete are quiet, specific and instantly readable. They carry tension because they signal intent, where a shot signals consequence. They are also short and cheap to generate. If you are building a weapon set, make the handling sounds first; scenes are often built entirely from them.",
      },
      {
        heading: "Distance delays and smears the crack",
        body: "Sound travels roughly a third of a kilometre per second, so a distant shot arrives noticeably after the muzzle flash, and smeared: the sharp transient has been absorbed and what is left is the rolling echo. Prompting \"delayed crack\" and \"long rolling echo\" gives you that, and it reads as distance immediately. A quiet close gunshot sounds like a quiet gunshot, not a distant one.",
      },
    ],
    faqs: faqs({
      question: "Will these pass for real firearm recordings?",
      answer:
        "For most game and video work, yes, especially the handling sounds and anything at distance, where the environment dominates. Close, dry, high-calibre reports are the hardest case for any generative model: the transient is extremely short and extremely loud, and an approximation has nowhere to hide. If you need that sound at feature-film scrutiny, layer a generated tail under a recorded crack. For everything else, a generated shot in a well-described space holds up.",
    }),
    related: ["weapon", "explosion", "impact", "alarm", "crowd", "cinematic"],
  },
};

const ALARM: SfxCategory = {
  slug: "alarm",
  name: "Alarms & sirens",
  targetQuery: "alarm sound effect",
  intent:
    "Editors and game developers needing warnings — sirens, klaxons, fire alarms, reversing beepers " +
    "— which have to be recognisable in half a second and loopable for as long as the scene lasts.",
  metaTitle: "Alarm sound effects: siren, klaxon, warning | Konchi",
  metaDescription:
    "Generate alarms, sirens, klaxons and warning beeps locally. Loopable emergency beds and one-shot alerts for games, film and interfaces.",
  h1: "Alarm and siren sound effects you generate yourself",
  intro:
    "Alarms are designed to be unmistakable, which makes them the most constrained sounds in a " +
    "library: they have to cut through noise, repeat indefinitely, and be identified before anyone " +
    "thinks about them. That helps when prompting, because only a few features matter: the pattern, " +
    "the pitch, and whether the listener is inside the building or outside it.",
  content: {
    samples: [
      s("alarm-fire-building", "Fire alarm", "building fire alarm sounding, harsh repeating electronic tone echoing down a corridor, seamless loop", 10),
      s("alarm-police-siren-pass", "Police siren", "police siren wailing and passing the listener at speed, doppler shift through the pass, city street", 8),
      s("alarm-air-raid-klaxon", "Air raid siren", "air raid siren winding up to a long mournful wail and falling away, distant across a city, outdoor", 12),
      s("alarm-submarine-dive", "Dive klaxon", "submarine dive klaxon, harsh two-tone mechanical horn repeating, enclosed metal interior, seamless loop", 8),
      s("alarm-car-alarm-street", "Car alarm", "car alarm going off in a quiet street at night, repeating cycle of chirps and horn blasts, echoing", 10),
      s("alarm-reverse-beeper", "Reversing beeper", "heavy vehicle reversing beeper, single high electronic beep repeating steadily, outdoor site, seamless loop", 8),
      s("alarm-smoke-detector-chirp", "Smoke detector", "smoke detector low battery chirp, single piercing beep every thirty seconds, quiet house at night", 6),
      s("alarm-sci-fi-red-alert", "Red alert", "spacecraft red alert klaxon, urgent synthetic two-tone alarm over a low warning drone, metal interior, seamless loop", 10),
      s("alarm-ambulance-siren-distant", "Ambulance distant", "ambulance siren wailing several streets away, muffled and echoing between buildings, night city", 10),
      s("alarm-industrial-warning-horn", "Warning horn", "industrial warning horn blasting three times before machinery starts, huge factory reverb", 8),
    ],
    recipes: [
      {
        label: "Interior alarm",
        prompt: "building fire alarm sounding, harsh repeating electronic tone echoing down a corridor, seamless loop",
        why: "The corridor places it in a building. Alarms are almost always heard through a lot of hard architecture.",
      },
      {
        label: "Moving siren",
        prompt: "police siren wailing and passing the listener at speed, doppler shift through the pass, city street",
        why: "A siren that does not move sounds parked. Asking for the pass and the doppler in one render gives you the whole event.",
      },
      {
        label: "Distance and muffling",
        prompt: "ambulance siren wailing several streets away, muffled and echoing between buildings, night city",
        why: "\"Between buildings\" produces the slapping urban reflections that place a siren in a city instead of open air.",
      },
      {
        label: "Mechanical, not electronic",
        prompt: "air raid siren winding up to a long mournful wail and falling away, distant across a city, outdoor",
        why: "\"Winding up\" names the spin-up of a rotating mechanical siren, which is what distinguishes it from an electronic tone.",
      },
    ],
    craft: [
      {
        heading: "Describe the pattern",
        body: "An alarm is recognised by its rhythm more than its timbre: the two-tone European siren, the American wail, the single repeating reversing beep, the three-blast industrial warning. Describe the pattern and the model gets the character right even if the tone is approximate. Describe only the tone and you tend to get a generic alarm that matches nothing in particular.",
      },
      {
        heading: "Decide inside or outside",
        body: "An alarm heard inside the building it protects is loud, hard and close, with corridor reflections. Heard from outside, it is muffled, distant and mixed with the street. These are different assets and filtering does not turn one into the other. Because the alarm itself is so repetitive, the space carries most of the information about where the scene is, which makes it the most valuable clause in the prompt.",
      },
      {
        heading: "Loop the alarm, generate the arrival separately",
        body: "An alarm scene usually has three parts: the moment it starts, the sustained state, and the moment it stops or is silenced. Make the sustained state a steady seamless loop you can run under the whole scene, and make the start and the stop one-shots. A single clip with all three cannot loop or be extended, which is what makes stock alarm clips awkward.",
      },
    ],
    faqs: faqs({
      question: "Are these safe to use for a real alert in an app?",
      answer:
        "For a product notification, yes; that is what the notification collection is for. For anything safety-critical, no. Real emergency and medical alarms follow standards that specify exact frequencies, patterns and levels so they cannot be confused, and a generated approximation should never stand in for a certified one. Use these for film, games and interfaces, and use the standard wherever somebody has to act on the sound.",
    }),
    related: ["notification", "clock", "sci-fi", "machinery", "crowd", "gunshot"],
  },
};

const ELECTRICITY: SfxCategory = {
  slug: "electricity",
  name: "Electricity",
  targetQuery: "electricity sound effect",
  intent:
    "Sound designers who need arcs, sparks, buzzes and surges — for sci-fi weapons, faulty " +
    "lighting, storms and anything that should feel dangerous to touch.",
  metaTitle: "Electricity sound effects: sparks, arcs, buzz | Konchi",
  metaDescription:
    "Generate electrical arcs, sparks, mains buzz, surges and tesla discharges locally. Prompts that separate clean hum from violent discharge.",
  h1: "Electricity sound effects you generate yourself",
  intro:
    "Electrical sound comes in two families that are often confused. The steady kind is hum and " +
    "buzz, from current doing what it should. The violent kind is arcing and sparking, from current " +
    "going where it should not. Both are useful and they need different prompts. Most disappointing " +
    "electrical generations describe one family in the other's words.",
  content: {
    samples: [
      s("electricity-arc-discharge", "Arc discharge", "high voltage electrical arc discharging, violent crackling snap with an ozone hiss, close and dry", 3),
      s("electricity-tesla-coil", "Tesla coil", "tesla coil firing repeatedly, rhythmic buzzing electrical discharges with a bright cracking edge, large room", 6),
      s("electricity-mains-hum-fault", "Faulty mains", "faulty mains electrical hum, low buzzing drone with intermittent crackling and flickering, close, seamless loop", 8),
      s("electricity-fluorescent-flicker", "Fluorescent flicker", "fluorescent tube failing, buzzing starter clicking repeatedly with the tube stuttering on and off, empty room", 6),
      s("electricity-power-surge-trip", "Surge and trip", "electrical power surge building then a breaker tripping with a hard clunk and everything falling silent", 4),
      s("electricity-sparks-shower", "Shower of sparks", "shower of electrical sparks from a severed cable, rapid crackling with sputtering bursts, industrial space", 4),
      s("electricity-taser-crackle", "Taser", "taser arcing between contacts, rapid harsh electrical crackle with a rising whine, close mic, dry", 3),
      s("electricity-substation-hum", "Substation", "electrical substation humming under load, deep mains drone with a metallic resonance, outdoor, seamless loop", 10),
      s("electricity-static-shock-zap", "Static shock", "sharp static electricity shock, single brief snapping zap, very close mic, completely dry", 1),
      s("electricity-lightning-arc-strike", "Lightning arc", "lightning arcing to ground, tearing electrical rip into a deep concussive crack, open outdoor space", 5),
    ],
    recipes: [
      {
        label: "Violent discharge",
        prompt: "high voltage electrical arc discharging, violent crackling snap with an ozone hiss, close and dry",
        why: "\"Ozone hiss\" is a useful cue. High voltage arcs produce a distinctive hiss alongside the crack, and naming it separates an arc from a spark.",
      },
      {
        label: "Steady fault",
        prompt: "faulty mains electrical hum, low buzzing drone with intermittent crackling and flickering, close, seamless loop",
        why: "\"Intermittent\" makes it a fault instead of a working hum. The irregularity carries the story.",
      },
      {
        label: "Rhythmic discharge",
        prompt: "tesla coil firing repeatedly, rhythmic buzzing electrical discharges with a bright cracking edge, large room",
        why: "A tesla coil discharges at an audio-rate rhythm. Asking for the rhythm stops it collapsing into undifferentiated noise.",
      },
      {
        label: "Tiny and dry",
        prompt: "sharp static electricity shock, single brief snapping zap, very close mic, completely dry",
        why: "Static shocks are among the shortest sounds in any library. Without \"very close\" and \"completely dry\", the room swallows them.",
      },
    ],
    craft: [
      {
        heading: "Hum is tonal, arcing is noise",
        body: "Mains hum is tonal: it sits at the supply frequency and its harmonics, which is why it can be notched out of a recording. Arcing is broadband and chaotic, closer to a crackling fire than a tone. Because they are spectrally opposite, mixing their vocabulary gives you mush: a prompt for a buzzing arc returns something halfway between that convinces as neither. Decide which family you need, then write the whole prompt in its terms.",
      },
      {
        heading: "Prompt the intermittency",
        body: "A working circuit has little drama. Electrical sound gets dramatic through intermittency: the flicker, the stutter, the sputter, the moment it cuts out and comes back. Prompt the irregularity with words like \"intermittent\", \"stuttering\", \"flickering\" and \"sputtering\", and give the render enough time for several cycles. Four seconds of a fault that repeats twice reads as a fault; one second reads as a click.",
      },
      {
        heading: "Use electricity as a source for sci-fi weapons",
        body: "Most energy-weapon sounds are electrical discharge, processed and pitched, so generating here and treating the result as source material often works better than prompting the laser collection directly. An arc gives the aggressive broadband texture, a tesla coil gives rhythm, and a rising hum gives the charge. Layer them and the result belongs to your project instead of sounding like a pack.",
      },
    ],
    faqs: faqs({
      question: "How do I get a convincing energy weapon out of this?",
      answer:
        "Build it in three layers, each its own render: a rising hum or whine for the charge, an arc or discharge for the shot, and a decaying crackle for the tail. Generating them separately lets you time the charge to the animation, which is the part that breaks when you use a single pre-made clip. The laser collection has finished versions; this one has the components.",
    }),
    related: ["sci-fi", "laser", "glitch", "machinery", "thunder", "horror"],
  },
};

/* ============================================================ Creatures */

const CARTOON: SfxCategory = {
  slug: "cartoon",
  name: "Cartoon & comedy",
  targetQuery: "cartoon sound effect",
  intent:
    "Animators, meme editors and casual game developers after the comedy vocabulary — boings, pops, " +
    "slide whistles, splats — a top-tier tag on every free library and almost absent from serious ones.",
  metaTitle: "Cartoon sound effects: boing, pop, splat | Konchi",
  metaDescription:
    "Generate cartoon boings, pops, slide whistles, splats and comedy stings locally. Prompts for classic animation and modern meme editing.",
  h1: "Cartoon sound effects you generate yourself",
  intro:
    "Cartoon sound has a fixed vocabulary (the boing, the pop, the slide whistle, the splat, the sad " +
    "trombone), and its job is to be read instantly as a joke. That reverses the usual rules of this " +
    "library: realism is wrong and exaggeration is correct. It is also one of the most searched tags " +
    "on free libraries.",
  content: {
    samples: [
      s("cartoon-boing-spring", "Boing", "cartoon boing, comedic metal spring twanging with a wobbling pitch bend, bright and dry", 1.5),
      s("cartoon-pop-bubble", "Pop", "cartoon pop, single bright mouth-like bubble pop with a hollow tone, very close mic, dry", 1),
      s("cartoon-slide-whistle-up", "Slide whistle up", "slide whistle sweeping quickly upward, bright comedic glissando, dry and close", 1.5),
      s("cartoon-slide-whistle-down", "Slide whistle down", "slide whistle sweeping downward like a falling body, comedic glissando ending in a splat, dry", 2),
      s("cartoon-splat-goo", "Splat", "cartoon splat, wet exaggerated goo impact with a comedic squelch, close and dry", 1.5),
      s("cartoon-running-feet-loop", "Running feet", "cartoon running feet, rapid comedic scampering with a rhythmic tumbling patter, dry, seamless loop", 3),
      s("cartoon-anvil-drop-clang", "Anvil drop", "cartoon anvil falling with a descending whistle and landing with a huge comedic clang and a wobble", 3),
      s("cartoon-sad-trombone", "Sad trombone", "comedic sad trombone, four descending muted brass notes with a wah wah bend, dry", 3),
      s("cartoon-record-scratch-stop", "Record scratch", "vinyl record scratching to an abrupt stop, classic comedic freeze-frame effect, close and dry", 2),
      s("cartoon-eat-crunch-gulp", "Eat and gulp", "cartoon eating, exaggerated rapid crunching followed by a huge comedic gulp, close mic, dry", 3),
    ],
    recipes: [
      {
        label: "The boing",
        prompt: "cartoon boing, comedic metal spring twanging with a wobbling pitch bend, bright and dry",
        why: "\"Pitch bend\" and \"wobbling\" make it comic. A real spring twang without the exaggerated bend sounds like hardware.",
      },
      {
        label: "The pop",
        prompt: "cartoon pop, single bright mouth-like bubble pop with a hollow tone, very close mic, dry",
        why: "\"Mouth-like\" is the key word. The classic cartoon pop was performed by a person, and asking for that origin gets the hollow character.",
      },
      {
        label: "Falling",
        prompt: "slide whistle sweeping downward like a falling body, comedic glissando ending in a splat, dry",
        why: "Naming what the sweep represents sets the timing. A fall accelerates, and the model shapes the glissando to match.",
      },
      {
        label: "The comic stop",
        prompt: "vinyl record scratching to an abrupt stop, classic comedic freeze-frame effect, close and dry",
        why: "Naming the use instead of the mechanism works here because the effect is so codified that the model has heard it labelled that way.",
      },
    ],
    craft: [
      {
        heading: "Exaggerate",
        body: "Elsewhere in this library, a generation that sounds too big or too obvious is wrong. Here it is the target. Cartoon sound is more extreme than physics allows: springs that bend further than metal can, splats wetter than any substance, falls that whistle. Use words that would be warnings elsewhere: \"exaggerated\", \"comedic\", \"cartoon\", \"huge\". They steer the model toward the animation corpus and away from the foley corpus.",
      },
      {
        heading: "Keep it dry and short",
        body: "Comic timing depends on a sound stopping when the joke does. Room tone smears the ending and softens the punchline, which is why almost every prompt in this collection ends with \"dry\" and asks for one to three seconds. If a cartoon sound is not working, it is more often too long than wrong. Trim it before you regenerate, and if you regenerate, shorten the render.",
      },
      {
        heading: "Most of the classics were performed by people",
        body: "The pop, the boing, the gulp, the crunch and the whistle were originally mouths, springs and slide whistles played by hand in a studio. Prompts that point at that human origin (\"mouth-like\", \"performed\", \"comedic\") land closer to the classic sound than prompts describing an abstract effect, because the model learned from those performances.",
      },
    ],
    faqs: faqs({
      question: "Can I get the specific classic sounds from old animation?",
      answer:
        "You can get close to the archetypes. The boing, the pop, the slide whistle and the sad trombone are well represented and come back recognisable. You cannot get a specific studio's specific recording, and those are copyrighted recordings with owners. Generating gives you the same comic vocabulary in a version that is yours to ship.",
    }),
    related: ["8bit", "impact", "whoosh", "transition", "notification", "animal"],
  },
};

const ROBOT: SfxCategory = {
  slug: "robot",
  name: "Robots & mechs",
  targetQuery: "robot sound effect",
  intent:
    "Game developers and sci-fi editors building machines with bodies — servos, actuators, mech " +
    "footsteps, transformations and synthetic voices without words.",
  metaTitle: "Robot sound effects: servos, mechs, machines | Konchi",
  metaDescription:
    "Generate robot servos, mech movement, transformations and synthetic vocalisations locally. Prompts for small drones through to walking machines.",
  h1: "Robot and mech sound effects you generate yourself",
  intro:
    "A robot sounds like its size and its era. Small modern machines are quiet, precise and " +
    "electric; large ones are hydraulic, heavy and slow; retro ones clank and whir with visible " +
    "mechanism. Any of them sounds alive when its movement has a shape: a start, a travel and a " +
    "stop. A servo that only hums sounds like a fan.",
  content: {
    samples: [
      s("robot-servo-arm-move", "Servo movement", "small robotic servo motor moving an arm and stopping precisely, clean electric whir with a settling click, close mic, dry", 2),
      s("robot-mech-heavy-step", "Mech footstep", "giant mech taking a single heavy step, hydraulic servo whine with an enormous metal foot slamming onto concrete", 3),
      s("robot-transform-sequence", "Transformation", "robot transforming, cascade of servos, hydraulic hisses and metal panels locking into place, close and mechanical", 5),
      s("robot-vocal-beeps", "Robot chatter", "small robot vocalising in expressive electronic beeps and warbles, curious and questioning, dry", 3),
      s("robot-power-up-boot", "Boot sequence", "robot powering up, rising electrical whine with systems clicking online and servos calibrating, close mic", 5),
      s("robot-power-down-collapse", "Power down", "robot powering down and collapsing, servos losing tension with a descending whine and metal settling", 4),
      s("robot-hydraulic-piston", "Hydraulic piston", "heavy hydraulic piston extending under load then venting pressure, industrial and close, dry", 3),
      s("robot-retro-clank-walk", "Retro robot walk", "retro tin robot walking, clanking metal feet with a whirring clockwork motor, close mic, dry", 5),
      s("robot-scan-targeting", "Targeting scan", "robot targeting scanner sweeping, thin oscillating electronic tone with tiny servo adjustments, dry", 4),
      s("robot-damage-malfunction", "Malfunction", "robot malfunctioning, servos grinding and stalling with electrical sparks and distorted vocal glitches", 4),
    ],
    recipes: [
      {
        label: "Small and precise",
        prompt: "small robotic servo motor moving an arm and stopping precisely, clean electric whir with a settling click, close mic, dry",
        why: "\"Stopping precisely\" with \"a settling click\" gives the movement an endpoint, so the servo sounds controlled instead of idling.",
      },
      {
        label: "Large and hydraulic",
        prompt: "giant mech taking a single heavy step, hydraulic servo whine with an enormous metal foot slamming onto concrete",
        why: "Scale comes from the two layers together: the whine says it is powered, the slam says how big it is.",
      },
      {
        label: "Voice without words",
        prompt: "small robot vocalising in expressive electronic beeps and warbles, curious and questioning, dry",
        why: "Emotional direction works here, unlike in most categories, because expressive beeping is a performed convention the model has heard often.",
      },
      {
        label: "Retro mechanism",
        prompt: "retro tin robot walking, clanking metal feet with a whirring clockwork motor, close mic, dry",
        why: "\"Clockwork\" and \"tin\" place it decades before hydraulics, a period cue as strong as a visual one.",
      },
    ],
    craft: [
      {
        heading: "Movement needs a start, a travel and a stop",
        body: "The most common robot-sound mistake is rendering only the travel: a whir with no beginning and no end. Real actuators engage, move and arrive, and the arrival is a small mechanical event that tells the audience the motion was finished and deliberate. Ask for it: \"stopping precisely\", \"locking into place\", \"with a settling click\". Those few words separate a machine from a fan.",
      },
      {
        heading: "Electric is small, hydraulic is large",
        body: "Small robots are electric: high-pitched, quiet, fast, clean. Large ones are hydraulic: low, slow and loud, with pressure release in every movement. This maps so directly onto perceived size that you can change a robot's scale by swapping those words and leaving the rest of the prompt alone, which helps when a design brief changes and you need the same motion at twice the weight.",
      },
      {
        heading: "Layer the body onto the motion",
        body: "A mech step is three sounds: the servo that lifted the leg, the mass that landed, and the frame rattling afterwards. Generating them separately and stacking them gives a heavier result than a single render, and lets you retime the impact to the animation frame without moving the servo. Transformations work the same way: they are a sequence of small events you can control individually.",
      },
    ],
    faqs: faqs({
      question: "Can I get a talking robot voice?",
      answer:
        "For expressive non-verbal chatter (beeps, warbles, curious rising tones), yes; this collection covers it. For a robot speaking words, use Konchi's speech path: the text-to-speech models render real words, and processing that output with the glitch and electricity collections adds the synthetic character. A sound-effect model asked for words produces something speech-like but unintelligible.",
    }),
    related: ["sci-fi", "machinery", "electricity", "glitch", "laser", "creature"],
  },
};

const CREATURE: SfxCategory = {
  slug: "creature",
  name: "Creatures & monsters",
  targetQuery: "monster sound effect",
  intent:
    "Game developers and horror editors who need creatures — growls, roars, shrieks, chittering — " +
    "that are not simply pitched-down animals, and that can be varied per enemy type.",
  metaTitle: "Monster sound effects: growls, roars, creatures | Konchi",
  metaDescription:
    "Generate monster growls, roars, shrieks and creature vocalisations locally. Prompts for size, anatomy and wetness rather than vague menace.",
  h1: "Creature and monster sound effects you generate yourself",
  intro:
    "A convincing creature vocalisation implies a body: lungs of a certain size, a throat of a " +
    "certain wetness, teeth or a beak or neither. Prompting the anatomy gives specific, repeatable " +
    "results. Prompting menace gives generic ones, because menace is the audience's conclusion and " +
    "has no acoustic signature of its own. Describing the mechanism instead of the mood pays off " +
    "more in this collection than in any other.",
  content: {
    samples: [
      s("creature-large-roar", "Large roar", "enormous creature roaring, deep chest-driven bellow with a rasping throat and a long tail, open outdoor space", 5),
      s("creature-low-growl-threat", "Low growl", "large predator growling a low continuous warning, wet throat rattle with breath behind it, very close mic", 5),
      s("creature-shriek-high", "Shriek", "small creature shrieking in alarm, piercing high cry breaking into a rasp, echoing cave", 3),
      s("creature-insect-chitter", "Chittering", "insectile creature chittering rapidly, dry clicking mandibles with a thin buzzing vocal underneath, close mic", 4),
      s("creature-wet-breathing", "Wet breathing", "large creature breathing slowly and wetly, thick mucous rattle on each inhale, very close and intimate", 8),
      s("creature-swarm-approach", "Swarm", "swarm of small creatures approaching, dense overlapping chittering and scrabbling claws on stone, tunnel reverb", 8),
      s("creature-death-gurgle", "Death rattle", "creature dying, wet gurgling exhale collapsing into silence, close mic, dark space", 4),
      s("creature-tentacle-slither", "Slither", "huge wet tentacle dragging across stone, thick suction with slapping impacts, cavernous and damp", 5),
      s("creature-bone-crunch-feed", "Feeding", "creature feeding, wet tearing of flesh with bone cracking and heavy breathing between, close and visceral", 6),
      s("creature-distant-call-echo", "Distant call", "unknown creature calling from far away, long mournful cry echoing across a vast valley at night", 8),
    ],
    recipes: [
      {
        label: "Size through chest",
        prompt: "enormous creature roaring, deep chest-driven bellow with a rasping throat and a long tail, open outdoor space",
        why: "\"Chest-driven\" implies lung volume, the only reliable cue for size. A small roar pitched down only sounds pitched down.",
      },
      {
        label: "Threat through restraint",
        prompt: "large predator growling a low continuous warning, wet throat rattle with breath behind it, very close mic",
        why: "A quiet sustained growl close to the microphone is more threatening than a roar, and \"breath behind it\" makes it sound alive.",
      },
      {
        label: "Non-mammalian",
        prompt: "insectile creature chittering rapidly, dry clicking mandibles with a thin buzzing vocal underneath, close mic",
        why: "\"Dry\" and \"mandibles\" push away from the wet-throated mammal the model defaults to on the word creature.",
      },
      {
        label: "Wetness as character",
        prompt: "large creature breathing slowly and wetly, thick mucous rattle on each inhale, very close and intimate",
        why: "Wetness is the most reliable single control for how disgusting a creature is, and it is independent of size and pitch.",
      },
    ],
    craft: [
      {
        heading: "Describe the body",
        body: "\"Scary monster\" is an instruction the model cannot act on, because no spectral property corresponds to scary. \"Wet throat rattle\", \"chest-driven bellow\", \"clicking mandibles\" and \"mucous inhale\" are things a body does, and they give specific, repeatable results. Whenever you are about to write an emotion, write the anatomy that would cause it.",
      },
      {
        heading: "Wet and dry is the anatomy axis",
        body: "Wet creatures have throats, mucus and soft tissue; they gurgle, rattle and slather, and they read as flesh. Dry creatures click, rasp and rustle, and read as chitin, bone or something desiccated. That one axis covers most of the range between a dragon and a swarm. It is independent of size and pitch, so you can move along it without changing your other choices.",
      },
      {
        heading: "Distance makes a creature bigger",
        body: "A roar close to the microphone reads as a large animal. The same roar heard across a valley with a long echo reads as something enormous, and as something the characters cannot see. Horror gets more out of the second. Put the distance in the prompt (\"calling from far away\", \"echoing across a vast valley\") instead of adding reverb, because real distance removes the high end and stretches the timing in a way a plate cannot fake.",
      },
    ],
    faqs: faqs({
      question: "How do I get variations for the same enemy type?",
      answer:
        "Keep the anatomical description fixed and vary only the action and the take. Four renders of \"large predator, wet throat rattle\" doing four things (warning, attacking, hurt, dying) sound like one creature with a repertoire, which is what a game needs. Varying the anatomy gives you four different monsters and inconsistent enemy audio. The seed parameter also gives different takes of an identical prompt, the cheapest variation available.",
    }),
    related: ["horror", "animal", "scream", "sci-fi", "robot", "magic"],
  },
};

export const DESIGN_AND_CREATURE: SfxCategory[] = [
  APPLAUSE,
  SCREAM,
  HEARTBEAT,
  RISER,
  BRAAM,
  DRONE,
  GUNSHOT,
  ALARM,
  ELECTRICITY,
  CARTOON,
  ROBOT,
  CREATURE,
];
