#!/usr/bin/env node
// Renders the thirty-six tracks on the /music landing page.
//
// Same shape as gen-sfx-samples.ts — POST /api/generate, poll the job, pull
// the WAV (encoded to MP3 for the site) and the peaks the backend computed —
// but flat rather than per-category, because /music is one page with one
// track list.
//
// Usage: node scripts/gen-music-tracks.mjs [slug ...] [--new-only]
//   no args      render every track
//   --new-only   skip tracks that already have an MP3 and a manifest entry
//
// The list below must stay in sync with app/src/content/music/tracks.ts
// (prompts, slugs, models, durations), and duplicating it is a known liability:
// the sfx side hit exactly this problem and gen-sfx-samples.ts now imports its
// content file directly under tsx instead. This script should do the same. The
// check at the end of main() prints any slug that has content but no audio,
// which is the cheap stand-in until it does.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { wavToMp3 } from "./encode-mp3.mjs";

/** `KONCHI_<name>`, or its pre-rename spelling `SOUNDBOX_<name>`. */
const env = (name) => process.env[`KONCHI_${name}`] ?? process.env[`SOUNDBOX_${name}`];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const API = env("API") ?? "http://127.0.0.1:17494";

const MUSIC = "audiocpp-stable-audio-3-small-music";
const ACE = "audiocpp-ace-step";

const TRACKS = [
  {
    slug: "neon-arcade-nights",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "1980s synthwave arcade title theme, wide analog saw lead synth melody, gated reverb drum machine, pulsing sidechained bass synth, bright neon major key, 110 BPM, seamless loop",
  },
  {
    slug: "crystal-caverns",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "ambient underground exploration theme, glassy bell synth arpeggio, deep sustained pad underneath, sparse hand percussion, long dripping-water reverb tail, slow minor key, seamless loop",
  },
  {
    slug: "final-gate",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "orchestral hybrid final boss theme, staccato low string ostinato, brass ensemble stabs, taiko drum hits on the downbeat, choir pad sustained underneath, dark minor key, 150 BPM",
  },
  {
    slug: "pixel-sunrise",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "lo-fi hip hop chiptune beat, dusty vinyl crackle, mellow square wave lead synth melody, warm sub bass, laid-back swung drum machine, 82 BPM, seamless loop",
  },
  {
    slug: "iron-foundry",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "industrial factory level theme, metallic percussion struck on scrap steel, distorted bass synth ostinato, mechanical clanking locked to the grid, driving minor key, 128 BPM, seamless loop",
  },
  {
    slug: "starlight-drift",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "slow space ambient theme, evolving analog pad, distant reverb-drenched piano notes, soft granular texture, weightless and spacious, no percussion",
  },
  {
    slug: "street-circuit",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "high energy racing game theme, distorted electric guitar riff, driving four-on-the-floor drum kit, aggressive bass synth, rising tension across the loop, 165 BPM, seamless loop",
  },
  {
    slug: "market-of-lanterns",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "cheerful fantasy town market theme, plucked lute melody, hand drum and tambourine groove, wooden flute counter-melody, warm major key, seamless loop",
  },

  // Sung — ACE-Step. `prompt` sets the arrangement; `lyrics` is sung verbatim.
  {
    slug: "victory-lap",
    model: ACE,
    duration_s: 20,
    prompt:
      "triumphant power pop victory anthem, bright electric guitars, punchy live drums, gang vocal chorus, major key, 140 BPM",
    lyrics: "[chorus]\nWe took the long way home\nWe took the crown\nVictory lap, victory lap\nWe are not coming down",
  },
  {
    slug: "game-over-blues",
    model: ACE,
    duration_s: 20,
    prompt:
      "slow electric blues, weeping guitar bends, brushed drums, warm upright bass, smoky male lead vocal, minor key, 68 BPM",
    lyrics: "[verse]\nOne more life, one more try\nThe screen goes dark, so do I\n[chorus]\nGame over blues again",
  },
  {
    slug: "co-op-forever",
    model: ACE,
    duration_s: 20,
    prompt:
      "upbeat indie pop duet, jangly electric guitars, handclaps, warm synth pads, cheerful male and female vocals trading lines, major key, 124 BPM",
    lyrics: "[verse]\nYou take the left, I take the right\n[chorus]\nCo-op forever, player one and two",
  },
  {
    slug: "loading-screen-lullaby",
    model: ACE,
    duration_s: 20,
    prompt:
      "gentle lullaby, soft nylon-string guitar arpeggio, airy female vocal, quiet sustained strings, slow and tender, major key, 70 BPM",
    lyrics: "[verse]\nClose your eyes, the world will wait\n[chorus]\nSleep now little one, the stars are loading",
  },

  /* ------------------------------------------------------------------ */
  /* Popular now — contemporary chart and club genres. Same two models,  */
  /* same 20s renders; the split is still instrumental vs sung, so these */
  /* are grouped by model here rather than by scene.                     */
  /* ------------------------------------------------------------------ */

  // Instrumental — Stable Audio 3.0 Small Music.
  {
    slug: "log-drum-sunset",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "amapiano instrumental, deep detuned log drum bassline, airy shaker and rim-click percussion, soft Rhodes chord stabs, wide reverb, laid-back groove, 112 BPM",
  },
  {
    slug: "drift-tape",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "phonk instrumental, distorted cowbell melody, heavily saturated 808 bass, lo-fi tape hiss and vinyl noise, halftime trap drums, dark minor key, 140 BPM, seamless loop",
  },
  {
    slug: "club-bounce-140",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "jersey club instrumental, triplet kick pattern in groups of three, chopped vocal stab hook, punchy layered claps, sparse bright percussion, 140 BPM, seamless loop",
  },
  {
    slug: "two-step-rain",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "UK garage two-step instrumental, shuffled syncopated drum groove, warm sub bass, filtered organ chord stabs, crisp offbeat hi-hats, night-time city mood, 134 BPM, seamless loop",
  },
  {
    slug: "basement-rollers",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "rolling tech house instrumental, dry four-on-the-floor kick, tight rubbery bassline on the offbeat, filtered percussion loop, minimal dub chord stab, 126 BPM, seamless loop",
  },
  {
    slug: "baile-heat",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "brazilian baile funk instrumental, punchy tamborzao drum pattern, distorted bass drop, chopped vocal shout sample, whistle hook, raw and loud, 130 BPM, seamless loop",
  },
  {
    slug: "velvet-rhodes",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "neo-soul instrumental, lush Rhodes electric piano chords with extended jazz voicings, loose pocket drums slightly behind the beat, warm fretless bass, muted trumpet fills, 88 BPM",
  },
  {
    slug: "kick-cathedral",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "hardstyle instrumental, distorted pitched-down kick drum, screeching reverse lead synth, euphoric supersaw chord progression, festival main stage energy, 155 BPM",
  },
  {
    slug: "slow-lean",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "trap soul instrumental, sparse muted electric guitar loop, deep sliding 808 bass, skittering triplet hi-hat rolls, wide reverb tail, melancholy minor key, 72 BPM, seamless loop",
  },
  {
    slug: "liquid-mile",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "liquid drum and bass instrumental, fast broken breakbeat, smooth rolling sub bass, warm major-seventh pad chords, sparse piano flourishes, 174 BPM, seamless loop",
  },
  {
    slug: "wall-of-blue",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "shoegaze instrumental, thick layered guitar wall drenched in reverb and chorus, bent tremolo lead buried in the mix, steady live drum kit, hazy major key, 108 BPM",
  },
  {
    slug: "desert-drum",
    model: MUSIC,
    duration_s: 20,
    prompt:
      "afro house instrumental, tribal hand drum polyrhythm, deep round sub bass, hypnotic marimba melody, breathy vocal chop texture, 122 BPM, seamless loop",
  },

  // Sung — ACE-Step.
  {
    slug: "lagos-midnight",
    model: ACE,
    duration_s: 20,
    prompt:
      "afrobeats, syncopated log drum and shaker groove, bright plucked guitar riff, warm sub bass, smooth melodic male vocal, major key, 104 BPM",
    lyrics: "[chorus]\nLagos midnight, hold me slow\nDance until the morning show\nSay you never let me go",
  },
  {
    slug: "cold-corner",
    model: ACE,
    duration_s: 20,
    prompt:
      "melodic drill, sliding 808 bass, skippy drill hi-hat pattern, dark piano loop, half-sung half-rapped male vocal, minor key, 142 BPM",
    lyrics: "[chorus]\nCold corner, same old street\nNothing changes but the beat\nI been running on repeat",
  },
  {
    slug: "corrido-de-la-frontera",
    model: ACE,
    duration_s: 20,
    prompt:
      "corridos tumbados, requinto guitar lead melody, tuba bassline, twelve-string bajo sexto strumming, earnest male vocal, no drums, moderate tempo",
    lyrics: "[verse]\nCruzando la frontera al amanecer\nCon el corazon pesado y nada que perder",
  },
  {
    slug: "sugar-crash",
    model: ACE,
    duration_s: 20,
    prompt:
      "hyperpop, pitched-up processed vocals, glitchy chopped drums, brittle saw synth chords, extreme sidechain pumping, sugary major key, 160 BPM",
    lyrics: "[chorus]\nSugar crash, love it when it hurts\nTurn it up until it breaks\nEverything at once or nothing",
  },
  {
    slug: "two-lane-heart",
    model: ACE,
    duration_s: 20,
    prompt:
      "modern country pop, acoustic guitar strum, slide guitar fills, stomp-clap drums, warm bass, earnest male vocal with a slight drawl, major key, 96 BPM",
    lyrics: "[chorus]\nTwo-lane heart, one-way town\nI keep driving, you keep pulling me down",
  },
  {
    slug: "neon-signal",
    model: ACE,
    duration_s: 20,
    prompt:
      "K-pop, glossy synth-pop production, punchy electronic drums, staccato synth bass, layered female group vocals with harmony stacks, bright major key, 128 BPM",
    lyrics: "[chorus]\nNeon signal, catch the light\nWe go up, we go up tonight",
  },
  {
    slug: "bedroom-ceiling",
    model: ACE,
    duration_s: 20,
    prompt:
      "bedroom pop, softly clipped lo-fi drums, warm detuned synth pad, simple clean electric guitar, intimate close-mic breathy female vocal, hazy major key, 92 BPM",
    lyrics: "[verse]\nStaring at the bedroom ceiling\nCounting all the ways of healing",
  },
  {
    slug: "silk-hours",
    model: ACE,
    duration_s: 20,
    prompt:
      "contemporary R&B slow jam, sparse finger-snap percussion, deep warm bass, muted Rhodes chords, breathy layered female vocal with runs, minor key, 74 BPM",
    lyrics: "[chorus]\nSilk hours, don't turn on the light\nStay a little longer, make it last all night",
  },
  {
    slug: "perreo-nocturno",
    model: ACE,
    duration_s: 20,
    prompt:
      "reggaeton, classic dembow drum pattern, deep boomy kick, minor key synth plucks, confident male vocal, club atmosphere, 96 BPM",
    lyrics: "[chorus]\nPerreo nocturno, baja la luz\nMuevete conmigo, no pares tu",
  },
  {
    slug: "suburb-static",
    model: ACE,
    duration_s: 20,
    prompt:
      "pop punk revival, palm-muted distorted power chords, fast driving punk drums, melodic bass, urgent young male vocal, gang vocal backing, major key, 168 BPM",
    lyrics: "[chorus]\nSuburb static, same four walls\nScreaming down an empty hall",
  },
  {
    slug: "lift-me-higher",
    model: ACE,
    duration_s: 20,
    prompt:
      "soulful gospel house, four-on-the-floor kick, organ chord stabs, rolling piano riff, powerful belting female lead vocal with choir backing, uplifting major key, 124 BPM",
    lyrics: "[chorus]\nLift me higher, higher than before\nI can feel it, I can feel it in my soul",
  },
  {
    slug: "paper-thin",
    model: ACE,
    duration_s: 20,
    prompt:
      "indie folk, fingerpicked acoustic guitar, brushed snare, quiet swelling strings, close intimate female vocal with a second harmony voice, minor key, 76 BPM",
    lyrics: "[verse]\nEverything I built was paper thin\nThe wind came through and found its way in",
  },
];

const PROJECT_NAME = "Site: Music landing page";

/** One Project for the whole page, so every track also lands somewhere sane in
 *  the app's own Library. Looked up by name first so re-runs reuse it. */
async function ensureProject(name) {
  const list = await (await fetch(`${API}/api/projects`)).json();
  const existing = list.find((p) => p.name === name);
  if (existing) return existing.id;
  const res = await fetch(`${API}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create project ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

async function generate(track, projectId) {
  // Both models here run through audio.cpp from few-step distilled GGUFs —
  // cfg 1 / steps 8, the same settings gen-sfx-samples.ts uses for the
  // audiocpp-* family. Pushing cfg higher collapses them into noise.
  const res = await fetch(`${API}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: track.model,
      prompt: track.prompt,
      lyrics: track.lyrics ?? null,
      duration_s: track.duration_s,
      steps: 8,
      cfg: 1,
      project_id: projectId,
    }),
  });
  if (!res.ok) throw new Error(`generate ${res.status}: ${await res.text()}`);
  const { job_id } = await res.json();

  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${API}/api/jobs/${job_id}`);
    if (!poll.ok) throw new Error(`job poll ${poll.status}: ${await poll.text()}`);
    const job = await poll.json();
    if (job.status === "done") return job.result.sounds[0];
    if (job.status === "error" || job.status === "cancelled") {
      throw new Error(`job ${job.status}: ${job.error ?? "unknown"}`);
    }
    process.stdout.write(`  ${Math.round((job.progress ?? 0) * 100)}% ${job.message ?? ""}\r`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const newOnly = args.includes("--new-only");
  const only = args.filter((a) => !a.startsWith("--"));
  const outDir = join(root, "site", "public", "music");
  await mkdir(outDir, { recursive: true });

  const manifestPath = join(outDir, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : {};

  let queue = only.length ? TRACKS.filter((t) => only.includes(t.slug)) : TRACKS;
  if (newOnly) {
    queue = queue.filter(
      (t) => !(t.slug in manifest) || !existsSync(join(outDir, `${t.slug}.mp3`)),
    );
  }

  const projectId = await ensureProject(PROJECT_NAME);
  console.log(`=== /music: ${queue.length}/${TRACKS.length} tracks -> project ${projectId} ===`);

  const failed = [];
  for (const track of queue) {
    console.log(`-> ${track.slug} [${track.model}]`);
    try {
      const soundId = await generate(track, projectId);
      const info = await (await fetch(`${API}/api/sounds/${soundId}`)).json();
      const wav = await fetch(`${API}${info.file}`);
      const buf = await wavToMp3(Buffer.from(await wav.arrayBuffer()));
      await writeFile(join(outDir, `${track.slug}.mp3`), buf);
      manifest[track.slug] = {
        durationS: info.duration_s,
        sampleRate: info.sample_rate,
        sizeBytes: buf.length,
        peaks: info.peaks,
      };
      // Written after every track, not once at the end: these renders are
      // slow, and losing eleven of them to a failure on the twelfth would be
      // a self-inflicted wound.
      await writeFile(manifestPath, JSON.stringify(manifest));
      console.log(`   done: ${info.duration_s}s, ${buf.length} bytes (sound ${soundId})`);
    } catch (err) {
      failed.push(track.slug);
      console.error(`   FAILED ${track.slug}: ${err.message}`);
    }
  }

  const missing = TRACKS.filter(
    (t) => !(t.slug in manifest) || !existsSync(join(outDir, `${t.slug}.mp3`)),
  ).map((t) => t.slug);
  console.log(`\nwrote ${manifestPath}`);
  if (failed.length) console.log(`failed this run: ${failed.join(", ")}`);
  if (missing.length) console.log(`still missing audio: ${missing.join(", ")}`);
  else console.log(`all ${TRACKS.length} tracks have audio.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
