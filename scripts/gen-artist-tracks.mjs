#!/usr/bin/env node
// Renders one signature track per artist on the /music roster.
//
// Same shape as gen-music-tracks.mjs: POST /api/generate, poll the job, pull
// the WAV, encode it to MP3, write a manifest beside the
// files. Output lands next to the artist covers in site/public/music/artists/
// as <slug>.mp3, with manifest.json keyed by slug.
//
// Usage: node scripts/gen-artist-tracks.mjs [slug ...] [--new-only]
//
// The prompt for each track IS the artist's persona string plus a brief —
// that is the entire point of the roster: a persona is a house style held
// constant, and the signature track is the audible proof. The personas here
// must stay in sync with app/src/content/music/artists.ts.
//
// Vocal split mirrors the main track list: four acts whose persona names a
// voice render on ACE-Step with a short lyrics block; the other sixteen are
// instrumental on Stable Audio 3.0 Small Music, which has no vocal path.

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
const DURATION_S = 14;

const TRACKS = [
  { slug: "chrome-sunset-division", model: MUSIC, prompt: "1980s synthwave anthem, wide analog saw leads, gated reverb drums, sidechained bass, neon night-drive mood, 108 BPM, seamless loop" },
  { slug: "pixelheart-parade", model: MUSIC, prompt: "cheerful chiptune pop anthem, bright square wave leads, pulse wave harmony, noise-channel drums, relentlessly major key, 128 BPM, seamless loop" },
  { slug: "the-slow-cavern", model: MUSIC, prompt: "slow ambient piece, glassy bell arpeggios, long dripping-water reverb tails, sparse hand percussion, unhurried minor key" },
  { slug: "foundry-choir", model: MUSIC, prompt: "industrial track, scrap-steel percussion locked to the grid, distorted bass ostinato, machine-room atmosphere, 128 BPM, seamless loop" },
  { slug: "battalion-of-strings", model: MUSIC, prompt: "orchestral hybrid battle theme, staccato low string ostinato, brass stabs, taiko drums on the downbeat, sustained choir pad, dark minor key, 150 BPM" },
  { slug: "dust-and-circuit", model: MUSIC, prompt: "lo-fi beat, dusty vinyl crackle, mellow square wave melody, warm sub bass, laid-back swung drums, 82 BPM, seamless loop" },
  { slug: "lanternwood", model: MUSIC, prompt: "fantasy folk tune, plucked lute, wooden flute counter-melody, hand drum and tambourine, warm firelit major key, seamless loop" },
  { slug: "low-lamp-trio", model: MUSIC, prompt: "slow blues instrumental, weeping guitar bends, brushed drums, warm upright bass, smoky late-set minor key, 68 BPM" },
  { slug: "gravity-well-ensemble", model: MUSIC, prompt: "space ambient piece, evolving analog pads, distant reverb-drenched piano, soft granular texture, weightless and spacious, no percussion" },
  { slug: "redline-prophets", model: MUSIC, prompt: "racing rock theme, distorted guitar riffs, four-on-the-floor drum kit, aggressive bass synth, rising tension, 165 BPM, seamless loop" },
  {
    slug: "the-glass-arcade",
    model: ACE,
    prompt: "dream pop, washed-out shimmer guitars, soft airy female vocal, slow chorus-pedal sway, heavy reverb, 92 BPM",
    lyrics: "[verse]\nUnder glass we glow\nSlow light, slow light\n[chorus]\nDon't wake me now",
  },
  { slug: "copper-kettle-club", model: MUSIC, prompt: "ragtime jazz, upright piano stride, muted trumpet, brushed snare shuffle, cheerful tea-room swing, 96 BPM" },
  { slug: "static-bloom", model: MUSIC, prompt: "shoegaze instrumental, wall of fuzzed guitars, buried melody, slow crashing drums, everything blooming into feedback, 100 BPM" },
  { slug: "moth-orchestra", model: MUSIC, prompt: "chamber piece, close-mic string quartet, fluttering pizzicato, hushed dynamics, candlelit minor key" },
  { slug: "bitrate-bandits", model: MUSIC, prompt: "breakcore chiptune, chopped noise-channel breaks, detuned pulse stabs, frantic tempo shifts, gleeful 8-bit chaos, 180 BPM" },
  { slug: "velvet-modem", model: MUSIC, prompt: "synth funk groove, slap bass synth, clavinet stabs, tight drum machine groove, talkbox-style lead, 104 BPM, seamless loop" },
  {
    slug: "iron-lullaby",
    model: ACE,
    prompt: "doom folk lullaby, down-tuned acoustic guitar drones, funeral-pace percussion, deep low male vocal, heavy and strangely tender, 60 BPM",
    lyrics: "[verse]\nRest beneath the iron sky\nThe forge burns low\n[chorus]\nSleep now, sleep now",
  },
  {
    slug: "paper-satellites",
    model: ACE,
    prompt: "upbeat indie pop, jangly electric guitars, handclaps, warm synth pads, cheerful male and female duet vocals trading lines, 124 BPM",
    lyrics: "[verse]\nFold me a wing, throw me high\n[chorus]\nPaper satellites across the sky",
  },
  {
    slug: "the-hologram-choir",
    model: ACE,
    prompt: "synth choral piece, stacked vocoder vocal harmonies, cathedral reverb, slow chord swells, sacred and synthetic, 70 BPM",
    lyrics: "[chorus]\nLight in the wires\nWe sing, we sing\nLight in the wires",
  },
  { slug: "ember-fields", model: MUSIC, prompt: "post-rock crescendo, clean tremolo guitars building into a distorted crest, cymbal swells, patient build, 130 BPM" },
];

const PROJECT_NAME = "Site: Artist roster";

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
  // Both audio.cpp models are few-step distilled: cfg 1, steps 8.
  const res = await fetch(`${API}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: track.model,
      prompt: track.prompt,
      lyrics: track.lyrics ?? null,
      duration_s: DURATION_S,
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
    process.stdout.write(`  ${Math.round((job.progress ?? 0) * 100)}%\r`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const newOnly = args.includes("--new-only");
  const only = args.filter((a) => !a.startsWith("--"));
  const outDir = join(root, "site", "public", "music", "artists");
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
  console.log(`=== artist tracks: ${queue.length}/${TRACKS.length} -> project ${projectId} ===`);

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
      // Written per track: renders are slow and a failure on track twenty
      // must not cost the nineteen before it.
      await writeFile(manifestPath, JSON.stringify(manifest));
      console.log(`   done: ${info.duration_s}s, ${buf.length} bytes`);
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
  else console.log("all twenty artists have a signature track.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
