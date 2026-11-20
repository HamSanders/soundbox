import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { decodeWav, writeWav } from "../src/audio/dsp.js";
import {
  FFMPEG_MISSING,
  acxFileName,
  buildEncodeArgs,
  escapeMeta,
  ffmetadata,
  formatUnavailable,
  parseFfmpegInfo,
  runFfmpeg,
  tagMetadata,
  wav16Bytes,
} from "../src/audio/encode.js";
import { closingCredits, narratorLine, openingCredits, pickSample } from "../src/audiobook/credits.js";
import { checkBook, checkReport } from "../src/audiobook/export-qc.js";
import { crc32, writeZip } from "../src/audiobook/export-zip.js";
import { cues, paragraphTimings, splitText, toSrt, toVtt } from "../src/audiobook/timings.js";
import type { LoudnessReport, ParagraphTiming } from "../src/audiobook/types.js";

const dir = mkdtempSync(join(tmpdir(), "mirli-export-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HAS_FFMPEG = spawnSync("ffmpeg", ["-hide_banner", "-version"], { windowsHide: true }).status === 0;

describe("ffmpeg detection", () => {
  it("reports absence with a clear message", () => {
    const info = parseFfmpegInfo(null, "");
    expect(info.available).toBe(false);
    expect(info.message).toBe(FFMPEG_MISSING);
    expect(formatUnavailable("mp3", info)).toBe(FFMPEG_MISSING);
    expect(formatUnavailable("wav", info)).toBeNull();
  });

  it("parses version and encoders", () => {
    const enc = [
      " A....D aac                  AAC (Advanced Audio Coding)",
      " A....D flac                 FLAC (Free Lossless Audio Codec)",
    ].join("\n");
    const info = parseFfmpegInfo("ffmpeg version 7.1 Copyright", enc);
    expect(info.version).toBe("7.1");
    expect(info.encoders).toEqual({ mp3: false, aac: true, flac: true });
    expect(formatUnavailable("mp3", info)).toMatch(/no mp3 encoder/);
    expect(formatUnavailable("m4b", info)).toBeNull();
  });
});

describe("encode arguments", () => {
  const tags = tagMetadata({ title: "Chapter One", album: "A Book", author: "A. Writer", narrator: "Ana", track: 2, totalTracks: 9 });

  it("maps tags to ID3 keys, narrator in composer", () => {
    expect(tags).toMatchObject({
      title: "Chapter One",
      album: "A Book",
      artist: "A. Writer",
      album_artist: "A. Writer",
      composer: "Ana",
      track: "2/9",
      genre: "Audiobook",
    });
    expect(tags.comment).toContain("Narrated by Ana");
  });

  it("MP3 is CBR libmp3lame at the chosen bitrate, 44.1 kHz, with cover", () => {
    const args = buildEncodeArgs({ format: "mp3", input: "in.wav", output: "out.mp3", bitrateKbps: 192, tags, cover: "c.jpg" });
    expect(args.join(" ")).toContain("-c:a libmp3lame -b:a 192k -ar 44100 -id3v2_version 3");
    expect(args).toContain("1:v");
    expect(args).not.toContain("-q:a"); // VBR would fail ACX
    expect(args.at(-1)).toBe("out.mp3");
    expect(args).toContain("composer=Ana");
  });

  it("M4B maps chapters from an FFMETADATA input and attaches the cover", () => {
    const args = buildEncodeArgs({ format: "m4b", input: "in.wav", output: "b.m4b", tags, metadataFile: "m.txt", cover: "c.png" });
    const s = args.join(" ");
    expect(s).toContain("-f ffmetadata -i m.txt -i c.png");
    expect(s).toContain("-map 0:a -map 2:v -map_metadata 1 -map_chapters 1");
    expect(s).toContain("-c:a aac -b:a 128k");
    expect(s).toContain("-disposition:v attached_pic");
    expect(s).toContain("-f mp4 b.m4b");
  });

  it("FLAC is 16-bit", () => {
    expect(buildEncodeArgs({ format: "flac", input: "a", output: "b.flac", tags }).join(" ")).toContain("-c:a flac -sample_fmt s16");
  });

  it("writes FFMETADATA1 with ms chapters and escaping", () => {
    expect(escapeMeta("a=b;c#d\\e\nf")).toBe("a\\=b\\;c\\#d\\\\e\\\nf");
    const text = ffmetadata({ title: "Book" }, [
      { title: "Opening", start_s: 0, end_s: 12.3456 },
      { title: "One; Two", start_s: 12.3456, end_s: 100 },
    ]);
    expect(text.startsWith(";FFMETADATA1\ntitle=Book\n")).toBe(true);
    expect(text).toContain("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=12346\ntitle=Opening");
    expect(text).toContain("START=12346\nEND=100000\ntitle=One\\; Two");
  });

  it("names files the ACX way", () => {
    expect(acxFileName(0, "Opening Credits", "mp3")).toBe("00_Opening Credits.mp3");
    expect(acxFileName(1, "Chapter One: The Café!", "mp3")).toBe("01_Chapter One The Cafe.mp3");
    expect(acxFileName(12, "***", "wav")).toBe("12_Section.wav");
    expect(acxFileName(3, "a/b\\c", "mp3")).toMatch(/^03_[A-Za-z0-9 _-]+\.mp3$/);
  });
});

describe("16-bit WAV", () => {
  it("writes a valid dithered PCM file that decodes back", () => {
    const n = 4410;
    const ch = new Float32Array(n).map((_, i) => 0.5 * Math.sin(i / 10));
    const bytes = wav16Bytes([ch], 44_100);
    expect(bytes.readUInt16LE(34)).toBe(16);
    const { audio, sampleRate } = decodeWav(bytes);
    expect(sampleRate).toBe(44_100);
    expect(audio[0].length).toBe(n);
    expect(Math.abs(audio[0][100] - ch[100])).toBeLessThan(3 / 32768);
  });
});

describe("zip", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("stores files that read back byte for byte", async () => {
    const a = join(dir, "a.bin");
    writeWav(a, [new Float32Array(1000).fill(0.1)], 8000);
    const zip = join(dir, "x.zip");
    await writeZip(zip, [
      { name: "00_Opening Credits.mp3", source: a },
      { name: "book.vtt", source: Buffer.from("WEBVTT\n") },
    ]);
    const z = readFileSync(zip);
    // Walk the local headers.
    let o = 0;
    const names: string[] = [];
    while (z.readUInt32LE(o) === 0x04034b50) {
      const size = z.readUInt32LE(o + 18);
      const nameLen = z.readUInt16LE(o + 26);
      const extra = z.readUInt16LE(o + 28);
      const name = z.subarray(o + 30, o + 30 + nameLen).toString();
      const data = z.subarray(o + 30 + nameLen + extra, o + 30 + nameLen + extra + size);
      expect(crc32(data)).toBe(z.readUInt32LE(o + 14));
      names.push(name);
      o += 30 + nameLen + extra + size;
    }
    expect(names).toEqual(["00_Opening Credits.mp3", "book.vtt"]);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 22 + 10)).toBe(2);
    expect(statSync(zip).size).toBe(z.length);
  });
});

describe("timings and captions", () => {
  const paragraphs = [
    { id: "p1", text: "Chapter One", start_s: 0, duration_s: 1.5, sound_id: "s1", character_id: null, kind: "line" },
    { id: "pause", text: "#", start_s: 1.5, duration_s: 1, sound_id: null, character_id: null, kind: "pause" },
    { id: "p2", text: "It was a cold morning. The kettle sang. Nobody answered the door, and the dog would not stop barking at it.", start_s: 2.5, duration_s: 8, sound_id: "s2", character_id: "c1", kind: "line" },
    { id: "p3", text: "Unvoiced.", start_s: 11, duration_s: null, sound_id: null, character_id: null, kind: "line" },
  ];

  it("keeps voiced spoken paragraphs, shifted into file time", () => {
    const t = paragraphTimings(paragraphs, 0.75);
    expect(t.map((x) => x.segment_id)).toEqual(["p1", "p2"]);
    expect(t[1]).toMatchObject({ start_s: 3.25, end_s: 11.25, character_id: "c1" });
  });

  it("splits paragraphs into short cues covering their time", () => {
    const t = paragraphTimings(paragraphs);
    const c = cues(t);
    expect(c.length).toBeGreaterThan(2);
    for (const cue of c) for (const line of cue.text.split("\n")) expect(line.length).toBeLessThanOrEqual(50);
    const p2 = c.filter((x) => x.start_s >= 2.5);
    expect(p2[0].start_s).toBe(2.5);
    expect(p2.at(-1)!.end_s).toBeCloseTo(10.5, 2);
    expect(splitText("a b c", 84)).toEqual(["a b c"]);
  });

  it("formats SRT and VTT timestamps", () => {
    const list = [{ start_s: 3661.5, end_s: 3662.25, text: "Hi" }];
    expect(toSrt(list)).toBe("1\n01:01:01,500 --> 01:01:02,250\nHi\n");
    expect(toVtt(list)).toBe("WEBVTT\n\n01:01:01.500 --> 01:01:02.250\nHi\n");
  });
});

describe("credits", () => {
  const book = { title: "The Long Road", subtitle: "A Novel", author: "Sam Field", narrator: null };

  it("opening credits name title, subtitle, author and a digital narrator", () => {
    expect(openingCredits(book)).toEqual([
      "The Long Road.",
      "A Novel.",
      "Written by Sam Field.",
      "Narrated by a digital voice.",
    ]);
    expect(narratorLine("Ana")).toBe("Narrated by Ana, a digital voice.");
  });

  it("closing credits start with The End", () => {
    const lines = closingCredits({ ...book, narrator: "Ana" });
    expect(lines[0]).toBe("The End.");
    expect(lines.join(" ")).toContain("The Long Road, written by Sam Field");
    expect(lines.join(" ")).toContain("a digital voice");
  });

  it("picks a 1-5 minute sample on paragraph boundaries", () => {
    const t: ParagraphTiming[] = Array.from({ length: 40 }, (_, i) => ({
      segment_id: `p${i}`,
      start_s: 1 + i * 20,
      end_s: 1 + i * 20 + 18,
      text: "x",
      character_id: null,
    }));
    const s = pickSample(t)!;
    expect(s.start_s).toBe(1);
    expect(s.end_s - s.start_s).toBeLessThanOrEqual(240);
    expect(s.end_s - s.start_s).toBeGreaterThanOrEqual(60);
    expect(t.some((p) => p.end_s === s.end_s)).toBe(true);
    expect(pickSample(t.slice(0, 2))).toBeNull();
  });
});

describe("QC checks", () => {
  const good: LoudnessReport = {
    rms_db: -20,
    peak_dbfs: -3.5,
    noise_floor_db: -68,
    integrated_lufs: -19,
    duration_s: 600,
    head_silence_s: 0.75,
    tail_silence_s: 2,
    sample_rate: 44_100,
    channels: 1,
  };

  it("passes a compliant ACX chapter", () => {
    const checks = checkReport(good, "acx");
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(["rms", "peak", "noise_floor", "room_tone_head", "room_tone_tail", "sample_rate", "max_length"]),
    );
  });

  it("fails each ACX limit with a reason", () => {
    const bad = { ...good, rms_db: -26, peak_dbfs: -1, noise_floor_db: -120, head_silence_s: 0, tail_silence_s: 8, sample_rate: 24_000, duration_s: 121 * 60 };
    const failed = checkReport(bad, "acx").filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toEqual(["rms", "peak", "digital_silence", "room_tone_head", "room_tone_tail", "sample_rate", "max_length"]);
  });

  it("flags mixed mono and stereo across the book", () => {
    const qc = checkBook(
      [
        { chapter_id: "a", report: good },
        { chapter_id: "b", report: good },
        { chapter_id: "c", report: { ...good, channels: 2 } },
      ],
      "acx",
    );
    expect(qc[2].checks.find((c) => c.id === "channels")!.pass).toBe(false);
    expect(qc[0].checks.find((c) => c.id === "channels")!.pass).toBe(true);
  });

  it("judges the podcast preset by LUFS and -1 dBTP", () => {
    const checks = checkReport({ ...good, integrated_lufs: -16.4, peak_dbfs: -1.2 }, "podcast");
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(checks.some((c) => c.id === "rms")).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)("real encodes (ffmpeg present)", () => {
  const input = join(dir, "tone.wav");
  const ch = new Float32Array(44_100 * 3).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 44_100));
  writeWav(input, [ch], 44_100);
  const tags = tagMetadata({ title: "One", album: "Book", author: "Writer", narrator: "Ana", track: 1, totalTracks: 1 });

  const probe = (file: string, entries: string) =>
    spawnSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "json", file], { encoding: "utf8", windowsHide: true }).stdout;

  it("MP3 at 192 kbps CBR with tags", async () => {
    const out = join(dir, "one.mp3");
    const r = await runFfmpeg(buildEncodeArgs({ format: "mp3", input, output: out, bitrateKbps: 192, tags }));
    expect(r.ok, r.error).toBe(true);
    const info = JSON.parse(probe(out, "stream=bit_rate,sample_rate,channels:format_tags=title,album,composer"));
    expect(Number(info.streams[0].bit_rate)).toBe(192_000);
    expect(info.streams[0].sample_rate).toBe("44100");
    expect(info.format.tags.composer).toBe("Ana");
  });

  it("M4B carries chapters", async () => {
    const meta = join(dir, "meta.txt");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(meta, ffmetadata(tags, [{ title: "Opening", start_s: 0, end_s: 1 }, { title: "One", start_s: 1, end_s: 3 }]));
    const out = join(dir, "book.m4b");
    const r = await runFfmpeg(buildEncodeArgs({ format: "m4b", input, output: out, tags, metadataFile: meta }));
    expect(r.ok, r.error).toBe(true);
    const info = JSON.parse(
      spawnSync("ffprobe", ["-v", "error", "-show_chapters", "-of", "json", out], { encoding: "utf8", windowsHide: true }).stdout,
    );
    expect(info.chapters.map((c: { tags: { title: string } }) => c.tags.title)).toEqual(["Opening", "One"]);
  });

  it("FLAC", async () => {
    const out = join(dir, "one.flac");
    const r = await runFfmpeg(buildEncodeArgs({ format: "flac", input, output: out, tags }));
    expect(r.ok, r.error).toBe(true);
  });
});

describe("lane mixdown", () => {
  it("summing lane buffers equals mixTimeline on overlapping mono and stereo clips", async () => {
    const { mixTimeline } = await import("../src/audio/dsp.js");
    const { layLanes, sumLanes } = await import("../src/audiobook/export-mix.js");
    const a = new Float32Array(1000).map((_, i) => 0.6 * Math.sin(i / 9));
    const b = new Float32Array(800).map((_, i) => 0.7 * Math.sin(i / 4));
    const placed = [
      { audio: [a], startS: 0, lane: 0 },
      { audio: [b, b], startS: 0.05, lane: 1 },
      { audio: [a], startS: 0.08, lane: 0 },
    ];
    const ref = mixTimeline(placed, 10_000);
    const got = sumLanes(layLanes(placed, 10_000));
    expect(got.length).toBe(ref.length);
    for (let c = 0; c < ref.length; c++) {
      expect(got[c].length).toBe(ref[c].length);
      for (let i = 0; i < ref[c].length; i++) expect(got[c][i]).toBeCloseTo(ref[c][i], 5);
    }
    expect(layLanes(placed, 10_000).size).toBe(2);
  });
});

describe("fast WAV decoding", () => {
  it("matches wavefile sample for sample on every PCM and float depth", async () => {
    const { WaveFile } = await import("wavefile");
    const { decodeWavFast } = await import("../src/audiobook/export-mix.js");
    const rand = (await import("../src/audio/master.js")).prng(4);
    const n = 3000;
    const left = Array.from({ length: n }, () => rand() * 2 - 1);
    const right = Array.from({ length: n }, () => rand() * 2 - 1);
    for (const bits of ["8", "16", "24", "32", "32f", "64"]) {
      for (const layout of [[left], [left, right]]) {
        const w = new WaveFile();
        w.fromScratch(layout.length, 22_050, "32f", layout.length === 1 ? layout[0] : layout);
        w.toBitDepth(bits);
        const bytes = Buffer.from(w.toBuffer());
        const ref = decodeWav(bytes);
        const got = decodeWavFast(bytes);
        expect(got.sampleRate).toBe(22_050);
        expect(got.audio.length).toBe(ref.audio.length);
        for (let c = 0; c < ref.audio.length; c++) {
          expect(got.audio[c].length).toBe(ref.audio[c].length);
          for (let i = 0; i < n; i++) if (got.audio[c][i] !== ref.audio[c][i]) throw new Error(`${bits}-bit ch${c}[${i}]: ${got.audio[c][i]} vs ${ref.audio[c][i]}`);
        }
      }
    }
  });
});

describe("planSplit", () => {
  const paras = (n: number, len: number, headingAt: number[] = []) =>
    Array.from({ length: n }, (_, i) => ({ start_s: i * (len + 1), end_s: i * (len + 1) + len, is_heading: headingAt.includes(i) }));

  it("leaves a chapter under the limit alone", async () => {
    const { planSplit } = await import("../src/audiobook/export-split.js");
    expect(planSplit(paras(10, 9), 100, 7000)).toEqual([]);
  });

  it("cuts in a gap before the last paragraph that fits, or at a heading", async () => {
    const { planSplit } = await import("../src/audiobook/export-split.js");
    const p = paras(30, 9); // 300 s
    const plain = planSplit(p, 300, 120);
    expect(plain.length).toBe(2);
    expect(plain.every((c) => !c.header)).toBe(true);
    expect(plain[0].at_s).toBe(119.5); // gap between 110-119 and 120-129
    const withHeading = planSplit(paras(30, 9, [8]), 300, 120);
    expect(withHeading[0]).toEqual({ at_s: 79.5, header: true });
    // Every part fits.
    const bounds = [0, ...withHeading.map((c) => c.at_s), 300];
    for (let i = 1; i < bounds.length; i++) expect(bounds[i] - bounds[i - 1]).toBeLessThanOrEqual(120);
  });

  it("flags parts that start without a header", async () => {
    const { splitChecks } = await import("../src/audiobook/export-qc.js");
    const checks = splitChecks(
      [{ id: "max_length", pass: false, message: "" }],
      [
        { duration_s: 7000, header: true, from_s: 0 },
        { duration_s: 4000, header: false, from_s: 7000 },
      ],
      "Chapter Twelve",
    );
    expect(checks.find((c) => c.id === "max_length")!.pass).toBe(true);
    const h = checks.find((c) => c.id === "secondary_header")!;
    expect(h.pass).toBe(false);
    expect(h.message).toContain("Chapter Twelve, continued");
  });
});
