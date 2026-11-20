// Placeholder pose-graph clips for santa.html, until the real ComfyUI (Wan FLF) clips land.
// Each pose is a coloured card; idles show a moving dot, transitions crossfade colour A to B.
// Writes public/santa-clips.js: window.SANTA_CLIPS = <manifest with data-URL srcs>,
// and, with --out <dir>, also manifest.json + the .mp4 files (to serve via ?clips=).
// Usage: node bench/make-placeholder-clips.mjs [--out <dir>]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf("--out"), outDir = outArg > 0 ? process.argv[outArg + 1] : null;
const FONT = process.platform === "win32" ? "C\\:/Windows/Fonts/arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const W = 320, H = 400, FPS = 15;

const poses = {
  talk: { color: "0x8a2a22", label: "TALK (to camera)" },
  rest: { color: "0x2a5a3a", label: "REST (leaning back)" },
  list: { color: "0x2a3f6a", label: "LIST (reading list)" },
};
const clips = [
  { id: "talk_idle_a", from: "talk", to: "talk", kind: "idle", dur: 2 },
  { id: "talk_idle_b", from: "talk", to: "talk", kind: "idle", dur: 2.5 },
  { id: "rest_idle_a", from: "rest", to: "rest", kind: "idle", dur: 2.5 },
  { id: "rest_idle_b", from: "rest", to: "rest", kind: "idle", dur: 3 },
  { id: "list_idle", from: "list", to: "list", kind: "idle", dur: 2 },
  { id: "rest_to_talk", from: "rest", to: "talk", kind: "transition", dur: 1 },
  { id: "talk_to_rest", from: "talk", to: "rest", kind: "transition", dur: 1 },
  { id: "talk_to_list", from: "talk", to: "list", kind: "transition", dur: 1 },
  { id: "list_to_talk", from: "list", to: "talk", kind: "transition", dur: 1 },
  { id: "rest_to_list", from: "rest", to: "list", kind: "transition", dur: 1 },
  { id: "laugh", from: "talk", to: "talk", kind: "reaction", tags: ["laugh"], dur: 1.5 },
  { id: "wink", from: "talk", to: "talk", kind: "reaction", tags: ["wink"], dur: 1 },
  { id: "sip_cocoa", from: "rest", to: "rest", kind: "reaction", tags: ["sip_cocoa"], dur: 2 },
  { id: "check_list", from: "list", to: "list", kind: "reaction", tags: ["check_list", "thinking"], dur: 2 },
  { id: "hmm", from: "talk", to: "talk", kind: "reaction", tags: ["thinking"], dur: 1.5 },
];

const tmp = mkdtempSync(join(tmpdir(), "santa-clips-"));
const txt = (s, y, size) => `drawtext=fontfile='${FONT}':text='${s}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
for (const c of clips) {
  const a = poses[c.from], b = poses[c.to], out = join(tmp, c.id + ".mp4");
  const src = (col) => ["-f", "lavfi", "-i", `color=c=${col}:s=${W}x${H}:r=${FPS}:d=${c.dur}`];
  const label = [txt(c.id.replace(/_/g, " "), 40, 26), txt(c.kind.toUpperCase(), 76, 16), txt(`${c.from} -> ${c.to}`, H - 60, 18)].join(",");
  let graph, inputs;
  if (c.from === c.to) {
    // Moving dot so you can see it play; it starts and ends at the centre, so loops cut cleanly.
    inputs = src(a.color);
    graph = `[0]drawbox=x='${W / 2 - 12}+90*sin(2*PI*t/${c.dur})':y=${H / 2 - 12}:w=24:h=24:color=white@0.8:t=fill,${label}[v]`;
  } else {
    inputs = [...src(a.color), ...src(b.color)];
    graph = `[0][1]xfade=transition=fade:duration=${c.dur * 0.8}:offset=${c.dur * 0.1},${label}[v]`;
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[v]",
    "-t", String(c.dur), "-c:v", "libx264", "-crf", "34", "-preset", "veryslow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
}

const manifest = (srcOf) => ({
  version: 1, fps: FPS, width: W, height: H,
  talkPose: "talk", restPose: "rest", startPose: "rest",
  poses: Object.fromEntries(Object.entries(poses).map(([id, p]) => [id, { label: p.label }])),
  clips: clips.map(({ dur, ...c }) => ({ ...c, src: srcOf(c.id) })),
});
const dataUrl = (id) => "data:video/mp4;base64," + readFileSync(join(tmp, id + ".mp4")).toString("base64");
const js = `// Placeholder pose-graph clips for santa.html (made by bench/make-placeholder-clips.mjs).\n// Data URLs because the spike server only serves .html and .js. Real clips: load with ?clips=<manifest url>.\nwindow.SANTA_CLIPS = ${JSON.stringify(manifest(dataUrl))};\n`;
writeFileSync(join(here, "../public/santa-clips.js"), js);
console.log(`santa-clips.js: ${(js.length / 1024).toFixed(0)} KB`);
for (const c of clips) console.log(c.id, readFileSync(join(tmp, c.id + ".mp4")).length, "bytes");
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const c of clips) copyFileSync(join(tmp, c.id + ".mp4"), join(outDir, c.id + ".mp4"));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest((id) => id + ".mp4"), null, 2));
}
