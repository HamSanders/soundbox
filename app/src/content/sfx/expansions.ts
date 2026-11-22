/**
 * Additional samples appended to the categories written in `categories.ts`.
 *
 * Why a separate file rather than more entries inline: `categories.ts` is
 * already thousands of lines of prose, and the sample grids are the part that
 * grows fastest. Keeping the prose and the render queue apart means a pass that
 * only adds clips produces a diff you can actually read.
 *
 * What's in here is not filler. Every entry answers a search term that appears
 * on the featured or popular shelf of at least one of the big libraries —
 * Epidemic Sound's category tree, ElevenLabs' sound-effect directory, Pixabay's
 * popular tags, Mixkit's front page — checked against what these collections
 * were already missing. The bias is deliberately toward the specific: nobody
 * searches "impact", they search "glass break", "body fall", "punch".
 *
 * `durationS` is the render length and matters more than it looks. A UI tick
 * asked to fill four seconds comes back with three and a half seconds of the
 * model inventing room tone, and an ambience bed asked for two seconds comes
 * back unusable. Set it to the length the sound actually is.
 *
 * A fifth argument pins the seed. The few-step SFX model answers a synth
 * prompt with either a clean tone, a low hum or a wash of hiss, and which one
 * depends on the seed; the pinned ones were picked from 8-24 takes with
 * scripts/check-sfx-noise.py and a look at the spectrogram. Prompts asking
 * for a "run of N notes" come out clean far more often than ones asking for a
 * single "ping" or "chirp", which is why several of these are worded that way.
 */

import type { SfxSample } from "./types";

/** Every clip in this pass renders on the current local SFX model. */
const MODEL = "audiocpp-stable-audio-3-sfx";

function s(slug: string, title: string, prompt: string, durationS: number, seed?: number): SfxSample {
  return { slug, title, prompt, source: "model", model: MODEL, durationS, ...(seed !== undefined && { seed }) };
}


export const EXTRA_SAMPLES: Record<string, SfxSample[]> = {
  /* ------------------------------------------------------------- Games */

  "8bit": [
    s("8bit-menu-blip", "Menu blip", "single short 8-bit menu cursor blip, square wave, 80 ms, completely dry, no reverb", 1),
    s("8bit-text-beep", "Text scroll beep", "repeating 8-bit dialogue text beep, short square wave tick per character, eight ticks in a row, dry", 2),
    s("8bit-explosion", "Pixel explosion", "8-bit explosion, white noise burst with a fast downward pitch sweep, noise channel, no reverb", 1.5),
    s("8bit-select-error", "Invalid select", "8-bit error buzz, low square wave two-tone rejection, harsh, 250 ms, dry", 1),
    s("8bit-teleport", "Teleport warp", "8-bit teleport warp, fast rising arpeggio of square wave notes then a bright ping, dry", 2),
    s("8bit-item-get", "Item get jingle", "8-bit item acquired jingle, four rising square wave notes ending on a held high note, bright major key, dry", 2.5),
    s("8bit-footstep", "Pixel footstep", "8-bit footstep tick, very short filtered noise burst, low pitched, 60 ms, dry", 1),
    s("8bit-boss-roar", "Boss roar", "8-bit boss roar, low square wave growl with noise-channel rasp layered on top, slow downward pitch bend, dry", 2),
    s("8bit-heartbeat-low-hp", "Low HP heartbeat", "8-bit low health warning, repeating two-note low square wave pulse like a heartbeat, urgent, dry, loopable", 3),
    s("8bit-save-chime", "Save confirmed", "8-bit save confirmed jingle, rapid ascending square wave run of six notes, bright, dry", 2, 889280131),
  ],

  "retro-game": [
    s("retro-pause", "Pause toggle", "retro arcade pause sound, single descending two-tone chirp, pulse wave, dry", 1),
    s("retro-extra-life", "Extra life", "retro arcade extra life jingle, rapid ascending square wave run of six notes, bright, dry", 2),
    s("retro-insert-coin", "Insert coin", "retro arcade insert coin sound, rapid ascending square wave run of four notes, bright, dry", 1.5, 424660679),
    s("retro-high-score", "High score entry", "retro arcade high score entry sound, cheerful looping four-note pulse wave motif, bright major key, dry", 3),
    s("retro-enemy-spawn", "Enemy spawn", "retro arcade enemy spawn alert, short descending noise sweep with a square wave tail, dry", 1.5),
    s("retro-shield-hit", "Shield hit", "retro arcade shield deflect, rapid ascending square wave run of three notes, bright, dry", 1, 228152900),
    s("retro-warp-zone", "Warp zone", "retro arcade warp zone, long rising pitch sweep of stacked pulse waves resolving into a bright sustained tone, dry", 3),
    s("retro-attract-loop", "Attract mode loop", "retro arcade attract mode background loop, bouncy square wave melody over a simple pulse bass, upbeat major key, 140 BPM, seamless loop", 10),
    s("retro-continue-countdown", "Continue countdown", "retro arcade continue countdown, single urgent low square wave beep repeated at one second intervals, dry", 5),
    s("retro-tilt-alarm", "Tilt alarm", "pinball machine tilt alarm, harsh buzzing electromechanical klaxon, short bursts, dry", 2),
  ],

  "video-game": [
    s("game-loot-drop", "Loot drop", "video game loot drop, soft magical shimmer with a metallic clink as an item lands on stone, close mic", 2),
    s("game-dodge-roll", "Dodge roll", "video game dodge roll, cloth and armour scrape across dirt with a quick body impact, close and dry", 1.5),
    s("game-bow-draw", "Bow draw", "wooden bow being drawn, creaking limbs and bowstring tension rising, close mic, dry", 2),
    s("game-potion-drink", "Potion drink", "character drinking a potion, three gulps then a glass bottle set down on wood, close mic", 2.5),
    s("game-chest-open", "Chest open", "heavy wooden treasure chest lid creaking open with an iron latch release, stone room reverb", 3),
    s("game-skill-cooldown", "Skill ready", "video game ability ready notification, short bright synthetic chime with a rising tail, clean and dry", 1.5),
    s("game-stealth-detected", "Stealth detected", "video game enemy alert sting, sharp rising two-note brass-like stab with a tense synth tail, dry", 2),
    s("game-fast-travel", "Fast travel", "video game fast travel transition, long airy whoosh rising into a soft magical shimmer and a warm resolve", 4),
    s("game-craft-success", "Crafting success", "video game crafting success, hammer strike on an anvil followed by a bright confirming chime", 2),
    s("game-respawn", "Respawn", "video game respawn, deep reversed swell rising into a clean sustained tone and a soft bloom of air", 3),
  ],

  "coin-pickup": [
    s("coin-vending-drop", "Vending drop", "coin falling through a vending machine mechanism and landing in a metal tray, several bounces, close mic", 2),
    s("coin-purse-shake", "Coin purse shake", "handful of loose metal coins shaken inside a leather pouch, dense metallic jingle, close mic, dry", 2),
    s("coin-single-spin", "Coin spin to rest", "single metal coin spinning on a wooden table, accelerating rattle as it settles flat, close mic", 4),
    s("coin-slot-machine-payout", "Slot payout", "casino slot machine payout, cascade of coins pouring into a metal tray, dense and continuous", 5),
    s("coin-stack-clink", "Stacking coins", "stacking metal coins one at a time on a hard wooden surface, six distinct clinks, close mic, dry", 3),
    s("coin-magic-pickup", "Magic coin pickup", "magical coin pickup, bright bell-like ping with a shimmering upward tail, dry with a short sparkle", 1.5, 1435780862),
    s("coin-heavy-gold-thud", "Heavy gold thud", "heavy gold coin dropped onto a stone slab, dull metallic thud with a short ring, cellar reverb", 2),
    s("coin-rapid-collect-run", "Rapid collect run", "rapid sequence of twelve bright coin pickup chimes ascending slightly in pitch, arcade style, dry", 3),
    s("coin-arcade-token-eat", "Token accepted", "arcade token accepted, rapid two-note ascending square wave beep, bright, dry", 1.5, 974091809),
    s("coin-toss-catch", "Coin toss and catch", "metal coin flipped into the air, spinning ring, then caught in a palm with a soft slap", 2),
  ],

  "power-up": [
    s("powerup-double-jump", "Double jump", "video game double jump power-up, short bright upward pitch sweep with an airy tail, dry", 1),
    s("powerup-weapon-upgrade", "Weapon upgrade", "weapon upgrade sound, metallic mechanical lock-in followed by a rising energy charge and a bright snap", 2.5),
    s("powerup-mushroom-grow", "Grow", "video game grow power-up, comedic ascending pitch slide with a soft inflating whoosh, bright and dry", 1.5),
    s("powerup-berserk-mode", "Berserk mode", "berserk mode activation, deep distorted energy surge rising into a growling sustained low drone, aggressive", 4),
    s("powerup-time-slow", "Time slow", "time slowing power-up, everything pitching down and stretching into a low warped drone with a soft flutter", 3),
    s("powerup-magnet-active", "Magnet active", "magnetic pull power-up, humming electromagnetic drone with a rising pitched shimmer, clean and synthetic", 3),
    s("powerup-fire-enchant", "Fire enchant", "fire enchantment activation, whoosh of igniting flame wrapping around metal with a crackling tail", 2.5),
    s("powerup-mega-charge", "Mega charge", "mega power-up charge, long rising synthetic energy build with an accelerating pulse, ending in a bright burst", 5),
    s("powerup-stat-boost-chime", "Stat boost", "stat boost confirmation, three clean ascending bell tones with a warm sustain, dry", 2),
    s("powerup-overdrive-loop", "Overdrive loop", "power-up overdrive active loop, pulsing synthetic energy hum with a bright shimmering top layer, seamless loop", 6),
  ],

  "game-over": [
    s("gameover-sad-trombone", "Sad trombone", "comedic sad trombone wah wah wah, four descending muted brass notes, dry", 3),
    s("gameover-slow-fade-drone", "Slow fade to black", "game over fade to black, warm sustained chord slowly detuning downward into silence, roomy", 6),
    s("gameover-8bit-death-spiral", "8-bit death spiral", "8-bit death sound, fast descending square wave pitch spiral ending in a low noise thud, dry", 2),
    s("gameover-heartbeat-stop", "Heartbeat stops", "two slow heartbeats then a long flat electronic monitor tone, clinical and close", 5),
    s("gameover-glass-shatter-fail", "Shatter fail", "failure sting, glass shattering into a low descending piano note and a dark reverb tail", 3),
    s("gameover-orchestral-defeat", "Orchestral defeat", "orchestral defeat sting, low strings falling in a minor cadence under a struck timpani, hall reverb", 5),
    s("gameover-retry-prompt", "Retry prompt", "retry prompt tone, neutral two-note synthetic chime, unresolved interval, dry", 1.5),
    s("gameover-power-down", "System power down", "machine powering down, whirring fan and drive slowing to a stop with a descending pitch, close mic", 4),
    s("gameover-crowd-groan", "Crowd groan", "small crowd groaning in disappointment, murmured aww falling away, medium room", 3),
    s("gameover-vhs-eject", "Tape ejects", "VHS tape mechanism whirring and ejecting with a mechanical clunk, close mic, dry", 3),
  ],

  laser: [
    s("laser-plasma-bolt", "Plasma bolt", "plasma bolt firing, thick electric discharge with a downward pitch sweep and a crackling tail, medium space", 1.5),
    s("laser-sniper-charge-fire", "Charged sniper shot", "sci-fi sniper rifle, long rising energy charge then a sharp focused beam discharge and a metallic echo", 4),
    s("laser-turret-burst", "Turret burst", "automated laser turret firing a six-shot burst, tight synthetic zaps with mechanical servo movement between", 3),
    s("laser-beam-sustained", "Sustained beam", "sustained laser beam, continuous bright searing tone with an unstable flickering harmonic, seamless loop", 5),
    s("laser-overheat-vent", "Overheat vent", "laser weapon overheating and venting, hissing steam release with metal ticking as it cools", 3),
    s("laser-lightsaber-swing", "Energy blade swing", "energy blade swinging through air, humming core with a doppler whoosh and a bright electric edge", 2),
    s("laser-deflect-ping", "Deflect ping", "laser bolt deflecting off metal, sharp zap with a ringing metallic ricochet tail, medium room", 1.5),
    s("laser-pistol-dry-click", "Empty cell click", "energy pistol out of charge, three dry mechanical clicks with a weak dying electrical whine", 2),
    s("laser-cannon-orbital", "Orbital cannon", "massive orbital laser cannon firing, enormous descending energy roar with a deep sub bass shockwave", 6),
    s("laser-scan-sweep", "Scanning sweep", "sci-fi scanning laser sweeping back and forth, thin oscillating tone with a soft doppler movement, clean", 4),
  ],

  magic: [
    s("magic-lightning-bolt", "Lightning bolt spell", "lightning bolt spell, sharp electric crack with a crackling arc tail and a rolling low rumble", 3),
    s("magic-summon-portal", "Summoning portal", "magic portal opening, deep swirling drone rising with layered shimmering bells and a bright bloom", 5),
    s("magic-wind-gust-spell", "Wind gust spell", "wind spell casting, sharp gust of air with a whistling upward sweep and a swirling tail", 2.5),
    s("magic-poison-bubble", "Poison spell", "poison spell, thick viscous bubbling with a sickly detuned drone underneath, close and wet", 3),
    s("magic-barrier-shatter", "Barrier shatter", "magical barrier shattering, crystalline glass breaking into a bright shimmering scatter with a fading hum", 3),
    s("magic-wand-flick", "Wand flick", "magic wand flick, short airy sparkle sweep with a bright twinkling tail, dry", 1.5),
    s("magic-necromancy-raise", "Raise dead", "necromantic spell, low guttural drone rising with bone rattling and a whispered choral swell, cavernous", 6),
    s("magic-mana-recharge", "Mana recharge", "mana recharging, soft pulsing energy shimmer building steadily with warm bell overtones, seamless loop", 5),
    s("magic-transmute", "Transmutation", "transmutation spell, sparkling granular shimmer morphing into a solid metallic ring, close mic", 3),
    s("magic-explosive-rune", "Explosive rune", "magical rune detonating, bright energy snap into a deep resonant boom with a shimmering debris tail", 3),
  ],

  weapon: [
    s("weapon-shotgun-blast", "Shotgun blast", "pump-action shotgun firing outdoors, sharp percussive blast with a wide crack and a distant echo", 3),
    s("weapon-shotgun-pump", "Shotgun pump", "pump-action shotgun being racked, heavy metal slide with a shell chambering, close mic, dry", 1.5),
    s("weapon-machine-gun-burst", "Machine gun burst", "automatic machine gun firing a long burst, rapid heavy reports with brass shells hitting concrete", 4),
    s("weapon-sword-unsheath", "Sword unsheathe", "steel sword drawn from a leather scabbard, long metallic ring with a bright edge, close mic", 2),
    s("weapon-sword-clash", "Sword clash", "two steel swords clashing, sharp metallic ring with sparks and a sustained shimmer, medium hall", 2.5),
    s("weapon-crossbow-fire", "Crossbow fire", "crossbow firing, taut string release with a wooden thunk and the bolt whistling away", 2),
    s("weapon-spear-throw-impact", "Spear impact", "thrown spear whistling through air and thudding into a wooden shield, splintering wood, outdoor space", 2.5),
    s("weapon-knife-stab", "Knife stab", "knife stabbing into flesh, wet visceral impact with a short blade scrape, close and dry", 1.5),
    s("weapon-gun-cock-hammer", "Hammer cock", "revolver hammer being cocked, three precise mechanical clicks, very close mic, completely dry", 1),
    s("weapon-grenade-pin-throw", "Grenade pin and throw", "grenade pin pulled with a metallic ping, lever springing off, then the grenade tumbling onto gravel", 3),
  ],

  /* ------------------------------------------------------- Film & video */

  explosion: [
    s("explosion-car-fireball", "Car fireball", "car exploding into a fireball, sharp metallic blast with glass shattering and a roaring fire tail, street reverb", 5),
    s("explosion-underwater", "Underwater blast", "underwater explosion, muffled deep concussive thump with a swirling bubble surge and a pressure wave", 4),
    s("explosion-firework-shell", "Firework shell", "large firework shell bursting high overhead, sharp crack followed by crackling stars and a rolling echo", 5),
    s("explosion-dust-debris-settle", "Debris settle", "aftermath of an explosion, dust and small rubble raining down onto concrete and slowly settling", 6),
    s("explosion-shockwave-sub", "Shockwave sub hit", "cinematic explosion shockwave, enormous sub bass drop with a compressed air whump and a long decay", 5),
    s("explosion-sequence-chain", "Chain of blasts", "chain of five explosions detonating in quick succession at increasing distance, rolling echoes overlapping", 6),
    s("explosion-gas-canister", "Gas canister", "pressurised gas canister rupturing and exploding, shrieking release into a sharp percussive blast", 3),
    s("explosion-slow-motion-reverse", "Reversed swell", "reversed explosion, long swelling suction rising into a sudden hard cutoff, cinematic and wide", 4),
    s("explosion-distant-city", "Distant city blast", "explosion heard from far across a city, dull low boom with a long reflected rumble off buildings", 6),
    s("explosion-mine-collapse", "Mine collapse", "underground explosion collapsing a mine shaft, deep muffled boom with tumbling rock and choking dust", 6),
  ],

  impact: [
    s("impact-body-fall-floor", "Body fall", "human body falling heavily onto a wooden floor, dull soft thud with a clothing rustle, medium room", 2),
    s("impact-metal-sheet-drop", "Metal sheet drop", "large sheet of metal dropped flat onto concrete, loud clattering boom with a long ringing wobble", 3),
    s("impact-wood-crate-smash", "Crate smash", "wooden crate smashing apart on stone, splintering wood with debris scattering, warehouse reverb", 3),
    s("impact-anvil-hammer", "Anvil strike", "blacksmith hammer striking a steel anvil, bright ringing clang with a long metallic sustain, stone forge", 3),
    s("impact-watermelon-splat", "Gore splat", "heavy wet splat, melon bursting on concrete, thick visceral impact with dripping aftermath, close mic", 2),
    s("impact-trailer-hit-deep", "Trailer hit", "cinematic trailer impact, enormous distorted low hit with a metallic transient and a long dark tail", 4),
    s("impact-boxing-glove-face", "Boxing hit", "boxing glove connecting with a face, dense leather-on-flesh smack with a sharp snap, close and dry", 1.5),
    s("impact-ice-block-drop", "Ice block drop", "large block of ice dropped onto stone and cracking apart, brittle crystalline shatter, cold room", 2.5),
    s("impact-sandbag-thud", "Sandbag thud", "heavy sandbag dropped onto packed dirt, dull soft thump with a granular hiss, outdoor and dry", 2),
    s("impact-bell-tower-strike", "Massive strike", "colossal metal impact, huge struck bell-like clang with an enormous slow decaying resonance, cavernous", 6),
  ],

  horror: [
    s("horror-child-music-box", "Music box", "antique music box playing a slow detuned lullaby, warped tape wow and flutter, dusty attic reverb", 8),
    s("horror-bone-crack", "Bone crack", "bone snapping and cartilage tearing, wet crunching with a sharp final crack, close and dry", 2),
    s("horror-dragging-body", "Dragging sound", "something heavy being dragged slowly across a wooden floor, scraping with intermittent stops, empty house", 6),
    s("horror-distorted-voice-drone", "Distorted voice drone", "unsettling drone made of stretched distorted human voices layered and detuned, slowly swelling", 8),
    s("horror-nail-scrape-metal", "Nails on metal", "fingernails scraping slowly down a rusted metal sheet, piercing high scrape with a rattling tail", 3),
    s("horror-heartbeat-panic", "Panic heartbeat", "human heartbeat accelerating from slow to frantic, deep thumping pulse with chest resonance, close mic", 8),
    s("horror-attic-footsteps-above", "Footsteps above", "slow deliberate footsteps on floorboards heard from the room below, muffled creaking, tense spacing", 6),
    s("horror-swarm-insects-approach", "Swarm approaching", "swarm of insects approaching, dense buzzing rising in volume and density with erratic close flybys", 6),
    s("horror-church-organ-dissonance", "Dissonant organ", "pipe organ holding a dissonant minor cluster chord, slowly swelling in a vast cathedral", 8),
    s("horror-static-whisper-radio", "Whisper in static", "radio static with faint unintelligible whispering emerging and receding, tuning drift, close mic", 8),
  ],

  "sci-fi": [
    s("scifi-hologram-activate", "Hologram activate", "holographic projection activating, electric flicker rising into a shimmering unstable synthetic hum", 3),
    s("scifi-teleporter-beam", "Teleporter", "sci-fi teleporter beam, granular particles rising through a bright energy sweep into a clean resolve", 4),
    s("scifi-reactor-overload", "Reactor overload", "fusion reactor overloading, rising harmonic whine with an unstable pulsing throb and warning klaxon", 8),
    s("scifi-mech-servo-step", "Mech footstep", "giant mech taking a step, hydraulic servo whine with a massive metal foot slamming onto concrete", 2.5),
    s("scifi-computer-processing", "Computer processing", "retro-futuristic computer processing, rapid chattering data blips and relay clicks, dry and close", 5),
    s("scifi-warp-jump", "Warp jump", "starship jumping to warp, deep engine build stretching into a sudden accelerating doppler tear", 5),
    s("scifi-force-field-loop", "Force field loop", "energy force field humming, layered electric drone with a slow pulsing shimmer, seamless loop", 6),
    s("scifi-drone-scanner-pass", "Drone scan pass", "surveillance drone hovering past, whirring rotors with a thin scanning tone sweeping by, outdoor", 5),
    s("scifi-cryo-pod-open", "Cryo pod open", "cryogenic pod releasing, pressurised hiss with frost cracking and heavy hydraulic seals unlocking", 4),
    s("scifi-alien-creature-vocal", "Alien vocal", "alien creature vocalising, wet clicking throat sounds with a warbling pitched shriek, close mic", 3),
  ],

  cinematic: [
    s("cinematic-sub-drop", "Sub drop", "cinematic sub bass drop, deep pitch falling into a long sustained rumbling low frequency bed", 5),
    s("cinematic-metallic-riser", "Metallic riser", "metallic cinematic riser, layered scraping metal harmonics accelerating upward into a hard cut", 6),
    s("cinematic-whoosh-to-impact", "Whoosh to impact", "long airy cinematic whoosh accelerating into a huge distorted impact with a dark decaying tail", 4),
    s("cinematic-string-tension-swell", "String tension", "orchestral string section swelling on a dissonant sustained note, bows tightening, large hall", 8),
    s("cinematic-taiko-build", "Taiko build", "taiko drums building from sparse hits into a fast driving pattern, huge room, epic and wide", 8),
    s("cinematic-clock-tension-loop", "Ticking tension", "tense ticking clock bed with a low pulsing drone underneath, steady and claustrophobic, seamless loop", 8),
    s("cinematic-heartbeat-drone-bed", "Heartbeat bed", "slow heartbeat pulse under a dark evolving drone, cinematic tension bed, seamless loop", 8),
    s("cinematic-reverse-riser-cut", "Reverse riser", "reversed cinematic riser, sound sucking backwards into a sharp silence, wide stereo, dramatic", 4),
    s("cinematic-choir-braam", "Choir braam", "epic trailer braam with a dark male choir layered over a distorted brass blast, enormous hall", 5),
    s("cinematic-title-card-boom", "Title card boom", "title card impact, deep clean boom with a bright metallic shimmer and a slow eight second decay", 8),
  ],

  glitch: [
    s("glitch-vhs-tracking", "VHS tracking error", "VHS tape tracking error, warbling analogue distortion with horizontal static sweeps and dropouts", 4),
    s("glitch-vinyl-skip-loop", "Vinyl skip", "vinyl record skipping and repeating the same fragment, rhythmic click with surface crackle", 4),
    s("glitch-modem-handshake", "Modem handshake", "dial-up modem handshake, screeching tonal negotiation with white noise bursts, close and dry", 6),
    s("glitch-robot-voice-corrupt", "Corrupted voice", "robotic voice corrupting mid-sentence, bit-crushed stutter breaking into digital garbage, dry", 3),
    s("glitch-buffer-underrun", "Buffer underrun", "audio buffer underrun, repeating fragment of a tone stuttering with hard digital clicks, dry", 3),
    s("glitch-crt-degauss", "CRT degauss", "CRT monitor degaussing, deep electromagnetic thunk with a warbling low hum decaying away", 3),
    s("glitch-datamosh-sweep", "Datamosh sweep", "datamoshed digital sweep, granular shredded audio smearing across the stereo field with sharp cuts", 4),
    s("glitch-hard-drive-failure", "Drive failure", "failing hard drive, rhythmic mechanical clicking with a straining motor whine, close mic, dry", 5),
    s("glitch-signal-scramble-burst", "Scramble burst", "scrambled encrypted signal burst, dense chattering digital noise with rapid frequency jumps", 3),
    s("glitch-power-surge-flicker", "Power surge", "electrical power surge, buzzing mains hum spiking with crackling arcs and a flickering fluorescent tick", 4),
  ],

  crowd: [
    s("crowd-stadium-goal-roar", "Goal roar", "football stadium erupting as a goal is scored, enormous crowd roar building and sustaining, huge open space", 8),
    s("crowd-boo-jeer", "Boos and jeers", "large crowd booing and jeering, sustained disapproval with individual shouts cutting through, arena", 5),
    s("crowd-airport-terminal", "Airport terminal", "busy airport terminal ambience, distant announcements, rolling luggage and layered conversation, large hall", 10),
    s("crowd-school-playground", "Playground", "school playground at break, children shouting and laughing with a ball bouncing, open outdoor space", 10),
    s("crowd-protest-chant", "Protest chant", "protest crowd chanting rhythmically with a megaphone cutting over the top, city street, echoing", 8),
    s("crowd-market-street", "Street market", "outdoor street market, vendors calling out over dense shopper chatter and cart wheels on cobbles", 10),
    s("crowd-theatre-settling", "Theatre settling", "theatre audience settling before a show, murmuring, coughs and seat creaks, then hushing", 8),
    s("crowd-panic-scatter", "Panic scatter", "crowd panicking and scattering, screams with running footsteps dispersing in every direction, street", 6),
    s("crowd-gasp-reaction", "Crowd gasp", "large audience gasping in unison then breaking into surprised murmur, medium hall", 4),
    s("crowd-standing-ovation", "Standing ovation", "concert hall standing ovation, thunderous sustained applause with whistles and cheers, large hall", 8),
  ],

  /* ------------------------------------------------------ World & nature */

  rain: [
    s("rain-thunderstorm-full", "Full thunderstorm", "heavy thunderstorm, driving rain with rolling thunder and wind gusting through trees, outdoor, seamless loop", 12),
    s("rain-car-windscreen", "Rain in a car", "rain on a car roof and windscreen with wipers sweeping intermittently, muffled interior perspective", 10),
    s("rain-forest-canopy", "Forest canopy rain", "rain falling through a dense forest canopy, drops striking leaves at varied distances, seamless loop", 12),
    s("rain-gutter-downpipe", "Gutter and downpipe", "rainwater rushing through a metal gutter and gurgling down a drainpipe, close mic, outdoor", 8),
    s("rain-drizzle-city-street", "City drizzle", "light drizzle on a city street, wet tyres passing on tarmac and distant traffic, night ambience", 12),
    s("rain-tent-camping", "Rain on a tent", "steady rain drumming on nylon tent fabric heard from inside, close and enclosed, seamless loop", 12),
    s("rain-tropical-monsoon", "Monsoon", "torrential tropical monsoon rain hammering onto broad leaves and standing water, dense and loud", 10),
    s("rain-ending-drips", "Rain ending", "rain tapering off to occasional drips falling from leaves onto wet ground, quiet and close", 8),
    s("rain-hail-on-roof", "Hail", "hailstones clattering onto a metal roof and pavement, hard erratic percussive strikes, outdoor", 8),
    s("rain-puddle-footsteps", "Walking in rain", "footsteps splashing through puddles on a wet pavement in steady rain, close mic, outdoor", 6),
  ],

  thunder: [
    s("thunder-rolling-distant-storm", "Rolling storm", "distant thunderstorm rolling across a wide valley, low sustained rumbles overlapping, open outdoor", 12),
    s("thunder-overhead-crack-boom", "Overhead crack", "lightning striking almost overhead, violent splitting crack into an immediate deep chest-hitting boom", 6),
    s("thunder-sheet-lightning-rumble", "Sheet lightning", "soft sheet lightning rumble, low broad thunder without a sharp transient, slowly decaying, distant", 8),
    s("thunder-strike-tree-split", "Strike and split", "lightning striking a tree, electric crack with splintering wood and a rolling thunder aftermath", 5),
    s("thunder-storm-approaching", "Storm approaching", "thunderstorm approaching, thunder growing louder and closer over successive strikes with rising wind", 12),
    s("thunder-desert-dry-storm", "Dry storm", "dry desert thunderstorm, sharp cracks echoing off canyon walls with no rain, wide open reverb", 8),
    s("thunder-mountain-echo", "Mountain echo", "thunder echoing repeatedly between mountain walls, multiple decaying reflections, vast outdoor space", 8),
    s("thunder-window-rattle", "Window rattle", "thunder heard from inside a house, muffled boom with window panes rattling in their frames", 5),
    s("thunder-sub-only-rumble", "Sub rumble bed", "pure low frequency thunder rumble with no high transient, slow swelling sub bass bed, seamless loop", 10),
    s("thunder-cinematic-hit", "Cinematic thunder hit", "cinematic thunder crack designed for impact, hard transient into an enormous processed low tail", 5),
  ],

  wind: [
    s("wind-desert-sandstorm", "Sandstorm", "desert sandstorm, howling wind carrying dense grit hissing across dunes, harsh and continuous", 12),
    s("wind-arctic-blizzard", "Blizzard", "arctic blizzard, screaming high wind with snow driving hard, bitter and unrelenting, seamless loop", 12),
    s("wind-chimney-moan", "Chimney moan", "wind moaning down a chimney flue, low hollow tonal howl with occasional gusts, enclosed", 10),
    s("wind-ship-rigging", "Ship rigging", "strong wind through ship rigging and canvas sails, ropes creaking and fabric snapping, open sea", 10),
    s("wind-canyon-hollow", "Canyon wind", "wind moving through a deep rock canyon, hollow resonant tone with swirling gusts, vast reverb", 12),
    s("wind-wheat-field", "Wheat field", "warm breeze moving through a field of ripe wheat, dry rustling stalks swaying, open countryside", 10),
    s("wind-door-gust-slam", "Gust slams a door", "sudden gust of wind blowing through a house and slamming a door shut, papers scattering", 4),
    s("wind-tunnel-steady", "Wind tunnel", "steady high-velocity wind tunnel roar, broadband rushing air, constant and featureless, seamless loop", 10),
    s("wind-hurricane-debris", "Hurricane", "hurricane force wind with debris striking a building, roaring gusts and sheet metal flapping violently", 10),
    s("wind-through-pine-forest", "Pine forest wind", "wind moving through tall pine trees, soft continuous needle hiss rising and falling, outdoor", 12),
  ],

  water: [
    s("water-ocean-waves-shore", "Ocean waves", "ocean waves rolling in and breaking on a sandy shore, receding foam hiss, wide open beach, seamless loop", 12),
    s("water-waterfall-large", "Waterfall", "large waterfall crashing into a plunge pool, dense white noise roar with spray, close outdoor", 10),
    s("water-underwater-submerge", "Submerging", "head submerging underwater, sudden muffling with bubbles rushing past the ears, enclosed and low", 4),
    s("water-boiling-pot", "Boiling pot", "water boiling vigorously in a metal pot, rolling bubbles with lid rattling, close kitchen mic", 6),
    s("water-toilet-flush", "Toilet flush", "toilet flushing, sudden rush of water swirling down with the cistern refilling afterwards, tiled room", 8),
    s("water-shower-running", "Shower", "shower running, water striking tiles and a shower tray, enclosed bathroom reverb, seamless loop", 10),
    s("water-swimming-strokes", "Swimming", "person swimming front crawl, rhythmic arm strokes splashing with breathing between, pool reverb", 8),
    s("water-fountain-plaza", "Fountain", "ornamental stone fountain in a plaza, layered falling water into a basin, gentle and continuous", 10),
    s("water-ice-cubes-glass", "Ice in a glass", "ice cubes dropped into a glass then liquid poured over them, cracking and fizzing, close mic", 4),
    s("water-rowing-oars", "Rowing", "wooden oars dipping and pulling through calm lake water, rhythmic splashes with rowlock creaks", 8),
  ],

  fire: [
    s("fire-forest-wildfire", "Wildfire", "forest wildfire, roaring flames with trees cracking and popping, huge and enveloping, outdoor", 10),
    s("fire-gas-stove-ignite", "Gas stove", "gas stove igniting, clicking piezo sparker then a soft whump as the ring lights and settles to a hum", 4),
    s("fire-candle-blow-out", "Candle out", "single candle flame flickering then blown out with a soft puff and a wisp of smoke, close mic, quiet room", 3),
    s("fire-flamethrower-burst", "Flamethrower", "flamethrower firing a sustained burst, pressurised fuel roaring into open flame, outdoor and wide", 4),
    s("fire-embers-settling", "Embers", "dying campfire embers ticking and settling, occasional soft pop, quiet night outdoors", 10),
    s("fire-fuse-burning", "Burning fuse", "burning fuse cord, fizzing sparks travelling steadily along, close mic, dry", 5),
    s("fire-fireball-whoosh", "Fireball whoosh", "large fireball erupting, deep air-sucking whoosh into a roaring flame burst with a crackling tail", 3),
    s("fire-paper-burning", "Paper burning", "sheet of paper catching and burning, crisp crackling with curling and a light ash collapse, close mic", 6),
    s("fire-torch-loop", "Torch loop", "burning torch held in hand, steady flame flutter with an occasional flare, stone corridor, seamless loop", 8),
    s("fire-house-fire-collapse", "Structure collapse", "burning building collapsing, roaring flames with timber cracking and heavy debris falling", 6),
  ],

  animal: [
    s("animal-lion-roar", "Lion roar", "lion roaring, deep guttural roar building to a full-throated bellow, open savannah, distant echo", 4),
    s("animal-horse-gallop", "Horse gallop", "horse galloping on packed dirt, rhythmic hoofbeats with snorting breath, outdoor, passing by", 6),
    s("animal-cow-moo", "Cow moo", "cow mooing in a field, long low call with a breathy tail, open countryside, distant birds", 4),
    s("animal-rooster-crow", "Rooster crow", "rooster crowing at dawn, sharp piercing four-note call, farmyard with faint hens, outdoor", 3),
    s("animal-snake-hiss-rattle", "Snake", "rattlesnake rattling and hissing a warning, dry buzzing rattle with a sharp exhale, close and dry", 4),
    s("animal-elephant-trumpet", "Elephant trumpet", "elephant trumpeting, brassy rising blast with a rumbling low chest tail, open outdoor space", 4),
    s("animal-seagull-colony", "Seagulls", "colony of seagulls calling over a harbour, overlapping squawks with waves and rigging beneath", 8),
    s("animal-frog-pond-night", "Frog chorus", "chorus of frogs croaking around a pond at night, overlapping calls with insects, humid outdoor", 10),
    s("animal-dog-growl-bark-attack", "Dog attack", "large dog growling low then erupting into aggressive rapid barking, close and threatening, outdoor", 5),
    s("animal-whale-song", "Whale song", "humpback whale song, long moaning glissandi with deep underwater resonance, vast submerged space", 10),
  ],

  ambience: [
    s("ambience-airport-lounge", "Airport lounge", "airport departure lounge, distant tannoy announcements, rolling cases and quiet conversation, large hall", 12),
    s("ambience-library-quiet", "Quiet library", "quiet library room tone, distant page turns, a single cough and faint chair movement, soft reverb", 12),
    s("ambience-subway-platform", "Subway platform", "underground subway platform, tiled reverb with distant train rumble and echoing announcements", 12),
    s("ambience-hospital-corridor", "Hospital corridor", "hospital corridor at night, distant monitor beeps, footsteps and a low ventilation hum, hard reverb", 12),
    s("ambience-medieval-market", "Medieval market", "medieval market square, wooden carts, livestock, hammering and layered period chatter, open air", 12),
    s("ambience-beach-day", "Beach day", "sunny beach ambience, waves breaking with distant children playing and gulls overhead, wide open", 12),
    s("ambience-mountain-summit", "Mountain summit", "exposed mountain summit, thin steady wind with faint distant birdsong and no traffic, vast and empty", 12),
    s("ambience-server-room", "Server room", "data centre server room, dense layered fan noise with a high electrical whine, enclosed and constant", 12),
    s("ambience-attic-old-house", "Old attic", "old house attic room tone, timbers creaking, faint wind through gaps and distant traffic, enclosed", 12),
    s("ambience-desert-night", "Desert night", "desert at night, faint wind over sand with occasional distant insect chirps, vast silence, seamless loop", 12),
  ],

  door: [
    s("door-sliding-glass", "Sliding glass door", "sliding glass patio door rolling open along its track and stopping, close mic, domestic room", 3),
    s("door-automatic-supermarket", "Automatic door", "automatic supermarket door, sensor chime then motorised glass panels sliding apart, entrance reverb", 4),
    s("door-heavy-vault", "Vault door", "heavy steel vault door, mechanism unlocking with deep bolts retracting and a slow massive swing", 6),
    s("door-screen-door-spring", "Screen door", "wooden screen door pushed open on a spring and slapping shut, porch acoustics, outdoor", 3),
    s("door-knock-heavy-three", "Heavy knock", "three heavy knocks on a solid wooden door, dull resonant thuds, hallway reverb", 3),
    s("door-doorbell-chime", "Doorbell", "two-tone doorbell chime ringing inside a house, warm metallic ding dong with a decaying tail", 3),
    s("door-key-unlock-open", "Key unlock", "key inserted into a deadbolt, turning with mechanical resistance, then the door opening, close mic", 4),
    s("door-elevator-open-close", "Elevator doors", "elevator doors sliding open with a soft ding, pausing, then closing with a rubber seal thump", 5),
    s("door-jail-cell-slam", "Cell door", "iron jail cell door sliding shut and locking with a hard metallic clang, long corridor echo", 4),
    s("door-cupboard-squeak-slow", "Slow squeak", "small cupboard door opening very slowly on a dry hinge, sustained high squeak, quiet close mic", 4),
  ],

  footsteps: [
    s("footsteps-metal-grate", "Metal grating", "footsteps walking on an industrial metal grate walkway, ringing hollow clangs, warehouse reverb", 6),
    s("footsteps-tile-heels", "Heels on tile", "high heels walking briskly on a polished tile floor, sharp clicks with a hard reflective tail, lobby", 6),
    s("footsteps-mud-squelch", "Mud", "boots trudging through thick mud, heavy wet squelching suction with each step, outdoor, close mic", 6),
    s("footsteps-leaves-dry", "Dry leaves", "footsteps crunching through dry autumn leaves, brittle crackling with each step, forest floor", 6),
    s("footsteps-sand-beach", "Sand", "bare feet walking on dry beach sand, soft granular shifting with no impact, outdoor and quiet", 6),
    s("footsteps-armour-knight", "Armoured knight", "knight in plate armour walking on stone, metal plates clanking with heavy boot impacts, castle hall", 6),
    s("footsteps-sneak-creep", "Sneaking", "someone creeping very slowly on creaking floorboards, careful weight shifts and long pauses, quiet house", 8),
    s("footsteps-ladder-rungs", "Ladder climb", "climbing a metal ladder, hands and boots on rungs with a hollow ring, industrial space", 6),
    s("footsteps-puddle-run", "Running in puddles", "person sprinting through shallow puddles on tarmac, fast splashing impacts, city street, night", 5),
    s("footsteps-carpet-soft", "Carpet", "soft footsteps on thick carpet, muffled dull impacts with faint fabric friction, quiet interior", 6),
  ],

  /* -------------------------------------------------- Interface & motion */

  whoosh: [
    s("whoosh-reverse-suck", "Reverse whoosh", "reversed whoosh, air sucking backwards and accelerating into a hard silent cutoff, wide stereo", 2),
    s("whoosh-heavy-door-air", "Heavy air movement", "large heavy object displacing air as it swings past, thick low rush with a soft turbulent tail", 3),
    s("whoosh-logo-sting", "Logo whoosh sting", "brand logo whoosh, clean airy sweep resolving into a short bright chime, polished and dry", 2.5),
    s("whoosh-fabric-cape", "Cape flourish", "heavy fabric cape swept sharply through the air, cloth snapping with a broad low whoosh, close mic", 2),
    s("whoosh-fire-trail", "Fire whoosh", "flaming object flying past, roaring fire whoosh with a crackling doppler tail, outdoor and wide", 3),
    s("whoosh-air-vent-burst", "Air burst", "sudden compressed air burst released from a nozzle, sharp hiss with a quick decay, close and dry", 1.5),
    s("whoosh-slow-motion-long", "Long slow whoosh", "very long slow cinematic whoosh, gradually building airy movement across eight seconds, wide stereo", 8),
    s("whoosh-multi-layer-stack", "Layered whoosh", "layered whoosh built from thin air, mid body and a low sub, all sweeping together, cinematic and wide", 3),
    s("whoosh-bullet-passby", "Bullet pass-by", "bullet whipping past close to the listener, sharp cracking snap with a fast doppler zip, outdoor", 1.5),
    s("whoosh-page-flip-air", "Page flip whoosh", "quick paper page flipping through air, light fluttering whoosh, close mic, completely dry", 1),
  ],

  ui: [
    s("ui-swipe-tick", "Swipe tick", "very short UI swipe tick, thin filtered click with a tiny airy tail, 60 ms, completely dry", 1),
    s("ui-keyboard-tap", "Keyboard tap", "single soft mechanical keyboard key tap, muted thock, close mic, completely dry", 1),
    s("ui-success-chime-warm", "Success chime", "warm two-note success chime, clean sine bells rising a fifth, short sustain, dry", 1.5, 1268007979),
    s("ui-delete-whoosh", "Delete", "UI delete sound, short descending filtered sweep into a soft crumple, dry and synthetic", 1.5),
    s("ui-loading-pulse-loop", "Loading pulse", "UI loading indicator, soft repeating pulse tone every half second, clean and unobtrusive, seamless loop", 4),
    s("ui-scan-progress-sweep", "Progress sweep", "UI progress sweep, thin rising filtered tone completing with a clean confirming tick, dry", 2),
    s("ui-tab-switch", "Tab switch", "UI tab switch, tiny dual-tone tick with a subtle stereo movement left to right, dry", 1),
    s("ui-slider-detent", "Slider detent", "UI slider passing through detents, six evenly spaced soft clicks with a subtle pitch rise, dry", 2),
    s("ui-modal-open-close", "Modal open", "UI modal opening, soft airy expansion with a light bloom of reverb then settling, clean", 1.5),
    s("ui-typing-burst", "Typing burst", "rapid typing on a laptop keyboard, twenty quick key presses with an enter key at the end, close mic", 4),
  ],

  notification: [
    s("notif-ios-style-ping", "Bright ping", "single bright notification ping, clean bell tone with a short shimmering decay, dry", 1.5, 231752683),
    s("notif-marimba-triple", "Marimba triple", "three-note marimba notification, warm wooden mallet tones ascending, close and dry", 2),
    s("notif-phone-vibrate", "Phone vibrate", "phone vibrating on a wooden desk, buzzing rattle in two short bursts, close mic", 3),
    s("notif-doorbell-app", "App doorbell", "digital doorbell notification, friendly descending two-tone chime with a soft synthetic pad, clean", 2),
    s("notif-error-negative", "Negative alert", "negative UI alert, two descending detuned tones with a short buzz, unmistakably a failure, dry", 1.5),
    s("notif-calendar-reminder", "Calendar reminder", "gentle calendar reminder, soft glassy bell struck twice with a warm tail, unobtrusive, dry", 2),
    s("notif-cash-register-sale", "Sale notification", "cash register sale notification, bright cha-ching bell with a mechanical drawer thunk, close mic", 2),
    s("notif-alarm-escalating", "Escalating alarm", "escalating notification alarm, repeating tone rising in pitch and urgency over four repeats, dry", 4),
    s("notif-chat-message-pop", "Chat pop", "chat message pop, short water-drop style bloop with a clean bright top, dry", 1),
    s("notif-system-startup", "System startup", "computer system startup chime, warm expanding synthetic chord resolving upward, spacious and clean", 4),
  ],

  transition: [
    s("transition-tape-stop", "Tape stop", "tape stop effect, sound pitching and slowing rapidly down to a halt, analogue warble, dry", 2),
    s("transition-vinyl-rewind", "Rewind", "fast rewind effect, audio scrubbing backwards at high speed with tape flutter, close and dry", 2),
    s("transition-camera-shutter-cut", "Shutter cut", "camera shutter snapping with a mechanical mirror slap, used as a hard scene cut, close mic, dry", 1),
    s("transition-water-drop-scene", "Water drop", "single water drop falling into still water with a clean plink and a widening ripple, close mic", 2),
    s("transition-swoosh-reverse-hit", "Reverse into hit", "reversed swoosh building backwards then landing on a clean percussive hit, wide stereo, cinematic", 3),
    s("transition-radio-tune-sweep", "Radio tune", "radio dial sweeping across stations, fragments of static and tones passing by, close and dry", 3),
    s("transition-elastic-snap", "Elastic snap", "elastic snap transition, rubbery tensioning stretch releasing into a sharp bright snap, dry", 1.5),
    s("transition-granular-dissolve", "Granular dissolve", "granular dissolve transition, sound shattering into fine particles that scatter and fade, wide stereo", 3),
    s("transition-doppler-pass-cut", "Doppler pass", "object passing the listener at speed with a strong doppler shift used as a scene cut, outdoor, wide", 2),
    s("transition-orchestral-harp-gliss", "Harp gliss", "harp glissando sweeping upward across the full range, warm and bright, concert hall reverb", 3),
  ],

  machinery: [
    s("machinery-factory-floor-loop", "Factory floor", "factory floor ambience, layered presses stamping, conveyors running and compressed air releases, large hall", 12),
    s("machinery-drill-press", "Drill press", "drill press boring into steel, rising motor load with metal shavings and a coolant hiss, workshop", 5),
    s("machinery-forklift-reverse", "Forklift reverse", "forklift reversing, electric motor whine with a repeating reverse beeper, warehouse reverb", 6),
    s("machinery-printing-press", "Printing press", "large printing press running, rhythmic mechanical cycling with paper sheets snapping through", 8),
    s("machinery-elevator-motor", "Elevator motor", "elevator winch motor engaging, cables tensioning under load then running steadily, shaft reverb", 6),
    s("machinery-washing-machine-spin", "Spin cycle", "washing machine entering a fast spin cycle, rising drum whine with an off-balance rumble, close", 8),
    s("machinery-chainsaw-cut", "Chainsaw", "chainsaw idling then revving into a log, chain biting wood with sawdust spray, outdoor forest", 6),
    s("machinery-pneumatic-press", "Pneumatic press", "pneumatic press cycling, sharp air release then a heavy stamping impact, repeating, factory reverb", 6),
    s("machinery-generator-diesel", "Diesel generator", "diesel generator running under load, rhythmic engine thump with a mechanical rattle, seamless loop", 10),
    s("machinery-robot-arm-assembly", "Robot arm", "industrial robot arm moving through a sequence, servo whines with pneumatic clamps and stops", 6),
  ],
};
