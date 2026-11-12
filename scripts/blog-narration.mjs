#!/usr/bin/env node
/**
 * Narrate a blog post with Konchi, and keep the timings the player follows.
 *
 *   node scripts/blog-narration.mjs plan   <slug>               > lines.json
 *   node scripts/blog-narration.mjs finish <slug> <story-id>
 *
 * `plan` turns a post into the lines of a Konchi story: one spoken block per
 * paragraph or list item, in the order the page renders them, with headings
 * turned into pauses and code, tables and images left out. Feed its output to
 * `konchi.add_lines` (or POST it as segments), then `konchi.speak_story`
 * and `konchi.export_story`.
 *
 * `finish` reads the voiced story back from the running Konchi server, finds
 * its export, encodes it to the site's audio format and writes the per-block
 * start times to `site/content/blog/narration/<slug>.json`, which the post
 * page imports at build time.
 *
 * A block is what the page highlights. Its number is its position among the
 * `.konchi-doc` elements that `blogReadableBlocks()` in
 * `site/src/blog/narration.ts` selects, so the two walks have to agree: a
 * paragraph is a `<p>` with text, a tight list item is its `<li>`, a loose
 * list item is each `<p>` inside it. The number travels through the story in
 * each line's `speaker` (`Bea #12`), so a line split in two, or reordered in
 * the studio, still lands on the right paragraph.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG = join(ROOT, "site/content/blog");
const SERVER = process.env.KONCHI_URL ?? process.env.SOUNDBOX_URL ?? "http://127.0.0.1:17494";

/** The narrator. Chatterbox clone from the shared library (Nightfall's Bea). */
export const NARRATOR = {
  name: "Bea",
  voiceId: "010dca88-8f06-4bcb-85f3-224bebc0426d",
  model: "audiocpp-chatterbox",
  modelName: "Chatterbox",
  delivery: { exaggeration: "0.3" },
};

/** Breathing room between paragraphs, and the longer beat a heading becomes. */
const GAP_S = 0.55;
const HEADING_PAUSE_S = 1.1;
/** Between the lines a long paragraph was split into. */
const SENTENCE_GAP_S = 0.3;
/** Above this a paragraph is read as several lines, split on sentences. */
const MAX_LINE_CHARS = 330;

/* ------------------------------------------------------------------ text */

/** Words the models misread, or that mean nothing read letter by letter. */
const SAY = [
  // A path is read as its file name (`docs/MCP.md` -> "MCP doc").
  [/(?:[\w.<>@-]+\/)+([\w-]+\.(?:md|json|ts|js|txt|toml))\b/g, "$1"],
  [/\b(\w+)\.(md|json|ts|js|toml)\b/g, "$1 dot $2"],
  [/\bdot md\b/g, "doc"],
  [/_/g, " "],
  [/\baudio\.cpp\b/gi, "audio dot C P P"],
  [/\baudiocpp\b/gi, "audio C P P"],
  [/\bVRAM\b/g, "V RAM"],
  [/\bMCP\b/g, "M C P"],
  [/\bSFX\b/g, "S F X"],
  [/\bTTS\b/g, "T T S"],
  [/\bGGUF\b/g, "G G U F"],
  [/\bAPI\b/g, "A P I"],
  [/\bUI\b/g, "U I"],
  [/\bjson\b/gi, "Jason"],
  [/\bRTX\b/g, "R T X"],
  [/\bGPUs\b/g, "G P Us"],
  [/\bGPU\b/g, "G P U"],
  [/\bCPU\b/g, "C P U"],
  [/\bstdio\b/g, "standard I O"],
  [/\be\.g\./g, "for example"],
  [/\bi\.e\./g, "that is"],
  [/US\$(\d+)M\b/g, "$1 million US dollars"],
  [/[−-](?=\d+\s?dB)/g, "minus "],
  [/(\d)\s?dB\b/g, "$1 decibels"],
  [/~(?=\d)/g, "about "],
  [/(\d)\s?GB\b/g, "$1 gigabytes"],
  [/\bGB\b/g, "gigabytes"],
  [/(\d)\s?MB\b/g, "$1 megabytes"],
  [/(\d)\s?kHz\b/g, "$1 kilohertz"],
  [/(\d)\s?ms\b/g, "$1 milliseconds"],
  [/(\d)\s?s\b/g, "$1 seconds"],
  [/\s?(->|→)\s?/g, " to "],
  [/\s?[—–]\s?/g, ", "],
  [/&/g, " and "],
  [/[<>]/g, ""],
  [/(\w)=(\w)/g, "$1 $2"],
  [/(\d)\+/g, "$1 plus"],
];

/** Inline code as words: a URL as host and path, a file path as its name. */
function speakCode(code) {
  const text = unescape(code).replace(/`/g, "");
  const url = /^https?:\/\/([^/]+)(\/.*)?$/.exec(text);
  if (url) {
    const host = url[1].replace(/:(\d+)$/, ", port $1");
    const path = (url[2] ?? "").split("/").filter(Boolean);
    return path.length ? `${host}, slash ${path.join(" slash ")}` : host;
  }
  // Paths and extensions are left for SAY; separators become spaces.
  if (/\.(md|json|ts|js|txt|toml)$/.test(text)) return text;
  return text.replace(/[_/\\@]+/g, " ").replace(/-(?=[a-z])/gi, " ");
}

/** Inline markdown to the words a listener should hear. */
function speakInline(tokens) {
  let out = "";
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "image":
        break; // alt text is for a reader who cannot see it, not a listener
      case "codespan":
        out += speakCode(t.text);
        break;
      case "br":
        out += " ";
        break;
      case "html":
        // Inline HTML is markup, not words; none of it is spoken. Dropping
        // the token outright rather than stripping tags from it means no
        // half-removed tag can survive into the script.
        break;
      default:
        out += t.tokens ? speakInline(t.tokens) : unescape(t.text ?? t.raw ?? "");
    }
  }
  return out;
}

/** One pass over the entities `marked` emits, so `&amp;lt;` comes out as the
 *  literal `&lt;` it was written as, not `<`. */
const ENTITIES = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };

function unescape(text) {
  return text.replace(/&(?:amp|quot|#39|lt|gt);/g, (m) => ENTITIES[m]);
}

function forSpeech(raw) {
  let text = raw.replace(/\s+/g, " ").trim();
  for (const [from, to] of SAY) text = text.replace(from, to);
  return text.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
}

/** Split a long paragraph on sentence ends, packing sentences up to the limit. */
function chunk(text) {
  if (text.length <= MAX_LINE_CHARS) return [text];
  // A sentence ends at punctuation followed by whitespace, so the "." in
  // "Stable Audio 3.0" is not one.
  const sentences = text.split(/(?<=[.!?]["')\]]?)\s+/).map((s) => `${s} `);
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > MAX_LINE_CHARS) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------------------------------------------------------------- blocks */

/**
 * The post as an ordered list of readable blocks and heading pauses.
 * Mirrors `blogReadableBlocks()` — see the header.
 */
export function blocksOf(markdown) {
  const body = markdown.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const items = [];
  let index = 0;
  let sawTitle = false;

  const paragraph = (tokens) => {
    const text = forSpeech(speakInline(tokens));
    // An image-only paragraph renders as a <p> with no text, which the page
    // does not count either.
    if (!/[A-Za-z0-9]/.test(text)) return;
    items.push({ kind: "block", index: index++, text });
  };

  const walk = (tokens) => {
    for (const t of tokens) {
      switch (t.type) {
        case "heading":
          if (t.depth === 1 && !sawTitle) {
            sawTitle = true; // the route draws it as the page title; not in the prose
            break;
          }
          items.push({ kind: "pause", heading: forSpeech(speakInline(t.tokens)) });
          break;
        case "paragraph":
          paragraph(t.tokens);
          break;
        case "blockquote":
          walk(t.tokens);
          break;
        case "list":
          for (const item of t.items) {
            if (item.loose) {
              walk(item.tokens);
            } else {
              const own = item.tokens.filter((x) => x.type === "text");
              paragraph(own.flatMap((x) => x.tokens ?? [{ type: "text", text: x.text }]));
              walk(item.tokens.filter((x) => x.type === "list"));
            }
          }
          break;
        default:
          break; // code, table, html, hr, space: nothing a listener needs
      }
    }
  };

  walk(marked.lexer(body));
  return items;
}

/** Story lines for `konchi.add_lines`. */
function storyLines(items) {
  const lines = [];
  for (const item of items) {
    if (item.kind === "pause") {
      // Replaces the paragraph gap rather than adding to it.
      if (lines.at(-1)?.kind === "pause") lines.pop();
      lines.push({ kind: "pause", duration_s: HEADING_PAUSE_S });
      continue;
    }
    for (const text of chunk(item.text)) {
      lines.push({ text, voice_id: NARRATOR.voiceId, speaker: `${NARRATOR.name} #${item.index}` });
    }
    lines.push({ kind: "pause", duration_s: GAP_S });
  }
  while (lines.at(-1)?.kind === "pause") lines.pop();
  if (lines[0]?.kind === "pause") lines.shift();
  return lines;
}

/* ---------------------------------------------------------------- finish */

async function api(path, init) {
  const resp = await fetch(`${SERVER}${path}`, init);
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status} ${await resp.text()}`);
  return resp.json();
}

/**
 * Append the post's lines to a story, one segment each, in order.
 * The same `createSegment` call `konchi.add_lines` makes, without pasting a
 * few thousand words of script through a tool call.
 */
async function load(slug, storyId) {
  const story = await api(`/api/stories/${storyId}/segments`);
  if (story.length) throw new Error(`story ${storyId} already has ${story.length} lines`);
  const lines = storyLines(blocksOf(readFileSync(join(BLOG, `${slug}.md`), "utf8")));
  for (const line of lines) {
    await api(`/api/stories/${storyId}/segments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(line),
    });
  }
  console.log(`${slug}: ${lines.length} lines added to ${storyId}`);
}

/**
 * Lay the voiced lines end to end, in script order.
 *
 * A story places a line when it is added, and a line has no length until it
 * has been read, so lines appended in one batch all land within a few seconds
 * of each other and overlap once voiced. Run this after `speak_story` and
 * before `export_story`; it also leaves the arrangement right in the studio.
 */
async function layout(storyId) {
  const segments = (await api(`/api/stories/${storyId}/segments`)).sort((a, b) => a.position - b.position);
  let cursor = 0;
  let prev = null;
  for (const seg of segments) {
    if (seg.kind !== "pause" && !seg.sound_id) throw new Error(`line ${seg.position} has not been voiced`);
    // Konchi trims each take's trailing silence, so two halves of one
    // paragraph would otherwise run together without a breath.
    if (seg.kind !== "pause" && prev && prev.kind !== "pause") cursor += SENTENCE_GAP_S;
    prev = seg;
    if (Math.abs(seg.start_s - cursor) > 1e-3 || seg.track_index !== 0) {
      await api(`/api/stories/${storyId}/segments/${seg.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start_s: Math.round(cursor * 1000) / 1000, track_index: 0 }),
      });
    }
    cursor += seg.duration_s;
  }
  console.log(`${segments.length} segments laid out, ${cursor.toFixed(1)} s`);
}

/** Bars the player's scrubber draws. Enough for a phone width, few enough to
 *  keep the JSON a few kilobytes. */
const PEAK_BARS = 160;

/**
 * The recording's loudness envelope, `PEAK_BARS` values from 0 to 1.
 *
 * Computed here rather than in the browser so the scrubber can draw before a
 * single byte of audio has loaded — the player uses `preload="none"`.
 * RMS per bar, not max: a narration's peaks are plosives, and a max-per-bar
 * waveform of speech is a flat comb.
 */
function peaksOf(file) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], {
    maxBuffer: 1 << 28,
  });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const per = Math.max(1, Math.floor(samples.length / PEAK_BARS));
  const rms = [];
  for (let b = 0; b < PEAK_BARS; b++) {
    let sum = 0;
    const end = Math.min(samples.length, (b + 1) * per);
    for (let i = b * per; i < end; i++) sum += samples[i] * samples[i];
    rms.push(Math.sqrt(sum / Math.max(1, end - b * per)));
  }
  const top = Math.max(...rms) || 1;
  return rms.map((v) => Math.round((v / top) * 100) / 100);
}

async function finish(slug, storyId) {
  const md = readFileSync(join(BLOG, `${slug}.md`), "utf8");
  const blockCount = blocksOf(md).filter((i) => i.kind === "block").length;

  const segments = await api(`/api/stories/${storyId}/segments`);
  const story = await api(`/api/stories/${storyId}`);
  const exportPath = process.argv[5];
  if (!exportPath) throw new Error("pass the exported WAV path as the third argument");

  const starts = Array.from({ length: blockCount }, () => null);
  for (const seg of segments) {
    const m = /#(\d+)$/.exec(seg.speaker ?? "");
    if (!m) continue;
    if (!seg.sound_id && !seg.audio_path && !seg.duration_s) {
      throw new Error(`line ${seg.id} ("${(seg.text ?? "").slice(0, 40)}…") has no audio yet`);
    }
    const i = Number(m[1]);
    const at = Number(seg.start_s);
    if (starts[i] === null || at < starts[i]) starts[i] = at;
  }
  const missing = starts.flatMap((s, i) => (s === null ? [i] : []));
  if (missing.length) throw new Error(`blocks with no line: ${missing.join(", ")}`);

  const mp3 = join(ROOT, "site/public/blog/audio", `${slug}.mp3`);
  mkdirSync(dirname(mp3), { recursive: true });
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", exportPath, "-ac", "1", "-ar", "24000", "-b:a", "64k", "-codec:a", "libmp3lame", mp3],
    { stdio: "inherit" },
  );
  const duration = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3])
      .toString()
      .trim(),
  );

  const out = {
    audio: `/blog/audio/${slug}.mp3`,
    peaks: peaksOf(mp3),
    narrator: NARRATOR.name,
    voice: `${NARRATOR.name}, a synthetic voice on ${NARRATOR.modelName}`,
    model: NARRATOR.model,
    duration: Math.round(duration * 100) / 100,
    story: story.id ?? storyId,
    blocks: starts.map((s) => Math.round(s * 100) / 100),
  };
  const json = join(BLOG, "narration", `${slug}.json`);
  mkdirSync(dirname(json), { recursive: true });
  // Number arrays on one line each, so a re-take shows up as a readable diff
  // rather than 160 changed lines.
  const text = JSON.stringify(out, null, 2).replace(/\[\s+([\d.,\s]+?)\s+\]/g, (_, nums) =>
    `[${nums.split(/,\s*/).join(", ")}]`,
  );
  writeFileSync(json, `${text}\n`);
  console.log(`${slug}: ${blockCount} blocks, ${duration.toFixed(1)} s -> ${mp3}`);
}

/* ------------------------------------------------------------------ main */

const [cmd, slug, storyId] = process.argv.slice(2);
if (cmd === "plan" && slug) {
  const items = blocksOf(readFileSync(join(BLOG, `${slug}.md`), "utf8"));
  process.stdout.write(`${JSON.stringify(storyLines(items))}\n`);
} else if (cmd === "blocks" && slug) {
  for (const item of blocksOf(readFileSync(join(BLOG, `${slug}.md`), "utf8"))) {
    console.log(item.kind === "pause" ? `-- ${item.heading}` : `${item.index}: ${item.text}`);
  }
} else if (cmd === "load" && slug && storyId) {
  await load(slug, storyId);
} else if (cmd === "layout" && slug) {
  await layout(slug); // `layout <story-id>`
} else if (cmd === "finish" && slug && storyId) {
  await finish(slug, storyId);
} else {
  console.error("usage: blog-narration.mjs plan|blocks <slug> | finish <slug> <story-id> <export.wav>");
  process.exit(2);
}
