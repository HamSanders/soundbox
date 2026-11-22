/**
 * The pose-graph player: a character's avatar pack around the live face.
 * Ported from the spike's santa-poses.js.
 *
 * Poses are keyframe stills; clips are edges between poses (Wan first+last
 * frame video), so every clip starts and ends on an exact pose and a cut
 * between two clips that meet on one pose is invisible. Idle clips loop on a
 * pose, transitions move between poses, reactions (laugh, think, check list)
 * are canned acting. Live lip-sync only runs on the talk pose: when the
 * character speaks we walk the graph to `talkPose` and hand over to the live
 * face (onLive(true)), which is pasted into the talk still's faceBox.
 *
 * Two stacked <video> elements: the next clip starts in the back one and the
 * two swap on its first painted frame; the finished clip holds its last frame
 * meanwhile, which is the same pose, so there is no gap.
 */

export interface PackClip {
  id: string; from: string; to: string; kind: "idle" | "transition" | "reaction" | string;
  src?: string; tags?: string[]; weight?: number;
}
export interface PackManifest {
  talkPose?: string; restPose?: string; startPose?: string;
  poses: Record<string, { label?: string; still?: string; faceBox?: { x: number; y: number; size: number } }>;
  clips: PackClip[];
  name?: string; persona?: string;
}
type Clip = Required<Pick<PackClip, "id" | "from" | "to" | "kind">> & { src: string; tags: string[]; weight: number };

/** Strip [tag] acting cues from streamed text. A tag can be split across deltas, so an unclosed "[" is held back. */
export function tagStream() {
  let held = "", last = "";
  function strip(delta: string) {
    let s = held + delta, text = "";
    const tags: string[] = [];
    held = "";
    for (;;) {
      const i = s.indexOf("[");
      if (i < 0) { text += s; break; }
      text += s.slice(0, i);
      const j = s.indexOf("]", i);
      if (j < 0) { if (s.length - i <= 24) held = s.slice(i); else text += s.slice(i); break; }
      const tag = s.slice(i + 1, j).trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (/^[a-z_]{1,22}$/.test(tag)) tags.push(tag); else text += s.slice(i, j + 1);
      s = s.slice(j + 1);
    }
    if (tags.length) text = text.replace(/ {2,}/g, " ").replace(/ ([!?.,;:])/g, "$1");
    return { text, tags };
  }
  return (delta: string) => {
    const r = strip(delta);
    if (last === " " && r.text[0] === " ") r.text = r.text.slice(1);
    if (r.text) last = r.text[r.text.length - 1]!;
    return r;
  };
}

/** Acting cues from what the character says, for LLMs that don't write [tags] (once per reply each). */
export const WORD_CUES: [string, RegExp][] = [
  ["laugh", /ho,? ho|ha,? ?ha|hee hee|chuckle/i],
  ["shh", /secret|shh+|between (you|us)/i],
  ["check_list", /(naughty|nice) list|my list|check(ing)? (it|my list|twice)/i],
  ["sip_cocoa", /cocoa|hot chocolate|cookies? and milk/i],
];

export interface PosePlayer {
  readonly manifest: PackManifest;
  readonly pose: string;
  readonly live: boolean;
  start(): void;
  stop(): void;
  /** Voice worker states: idle | listening | thinking | speaking. */
  setState(s: string): void;
  react(tag: string): boolean;
  kick(): void;
  dispose(): void;
}

export function resolveClips(manifest: PackManifest, base: string): Clip[] {
  return manifest.clips
    .filter((c) => c.src)
    .map((c) => ({ weight: 1, tags: [], ...c, src: /^(data:|blob:|https?:)/.test(c.src!) ? c.src! : new URL(c.src!, base).href }) as Clip);
}

export function createPosePlayer(opts: {
  manifest: PackManifest; base: string; a: HTMLVideoElement; b: HTMLVideoElement;
  onLive?: (on: boolean) => void; liveReady?: () => boolean; wanderS?: number; thinkDelayS?: number; log?: (...a: unknown[]) => void;
}): PosePlayer {
  const { a, b, onLive, wanderS = 7, thinkDelayS = 0.6 } = opts;
  const M = { ...opts.manifest, clips: resolveClips(opts.manifest, opts.base) };
  const talk = M.talkPose || "talk", rest = M.restPose || null;
  const moves = M.clips.filter((c) => c.from !== c.to && M.poses[c.from] && M.poses[c.to]);
  const say = opts.log || (() => {});
  const canLive = opts.liveReady || (() => false);

  function route(x: string, y: string): { dist: number; first: Clip | null } {
    if (x === y) return { dist: 0, first: null };
    // Prefer transitions over pose-changing reactions on equal length, and randomise ties.
    const out = (p: string) => moves.filter((m) => m.from === p).sort((m, n) => (m.kind === "transition" ? 0 : 1) - (n.kind === "transition" ? 0 : 1) || Math.random() - 0.5);
    const seen = new Map<string, { first: Clip | null; dist: number }>([[x, { first: null, dist: 0 }]]);
    const q = [x];
    while (q.length) {
      const p = q.shift()!, at = seen.get(p)!;
      for (const c of out(p)) {
        if (seen.has(c.to)) continue;
        const next = { first: at.first || c, dist: at.dist + 1 };
        if (c.to === y) return next;
        seen.set(c.to, next);
        q.push(c.to);
      }
    }
    return { dist: Infinity, first: null };
  }
  function pick<T extends { weight: number }>(list: T[]): T {
    let t = list.reduce((s, c) => s + c.weight, 0) * Math.random();
    for (const c of list) if ((t -= c.weight) <= 0) return c;
    return list[list.length - 1]!;
  }
  const reactionsFor = (tag: string) => M.clips.filter((c) => c.kind === "reaction" && (c.tags.includes(tag) || c.id === tag));

  const st = {
    pose: M.startPose || talk, mode: "idle", live: false, queue: [] as { tag: string; clips: Clip[]; at: number }[], thought: false, idles: 0,
    front: a, back: b, clip: null as Clip | null, token: 0, stopped: true, parkedAt: 0, modeAt: 0, wander: false, visit: false, wanderAfter: 0,
  };
  for (const v of [a, b]) { v.muted = true; v.playsInline = true; v.preload = "auto"; }
  a.dataset.front = "1";
  b.dataset.front = "0";

  function setLive(on: boolean) { if (st.live === on) return; st.live = on; say("live", on); onLive?.(on); }
  const parked = () => !st.clip && !st.stopped;

  function nearest(list: Clip[]) {
    const opts2 = list.map((c) => ({ c, r: route(st.pose, c.from), weight: c.weight })).filter((o) => o.r.dist < Infinity);
    if (!opts2.length) return null;
    const best = Math.min(...opts2.map((o) => o.r.dist)), o = pick(opts2.filter((x) => x.r.dist === best));
    return best === 0 ? { here: true, clip: o.c } : { here: false, clip: o.r.first! };
  }
  function idleAt(p: string): Clip | null {
    const loops = M.clips.filter((c) => c.kind === "idle" && c.from === p && c.to === p);
    if (loops.length) return pick(loops);
    return moves.find((m) => m.from === p) || null;
  }

  // The next clip from st.pose, or null to park on the live face.
  function choose(): Clip | null {
    const now = performance.now(), live = canLive();
    st.queue = st.queue.filter((r) => now - r.at < 8000);
    // Never cover lip-sync with a reaction: those wait until the character stops talking.
    const holdForSpeech = st.mode === "talk" && st.pose === talk && live;
    if (st.queue.length && !holdForSpeech) {
      const step = nearest(st.queue[0]!.clips);
      if (!step) st.queue.shift();
      else { if (step.here) st.queue.shift(); return step.clip; }
    }
    // A short think shouldn't start a 5 s acting clip that then delays the answer.
    if (st.mode === "think" && !st.thought && now - st.modeAt > thinkDelayS * 1000) {
      const step = nearest(reactionsFor("thinking"));
      if (step) { if (step.here) st.thought = true; return step.clip; }
    }
    if (st.wander && st.pose === talk) {
      st.wander = false;
      const out = moves.filter((m) => m.from === talk && m.kind === "transition" && route(m.to, talk).dist < Infinity);
      const gags = M.clips.filter((c) => c.from === talk && c.to === talk && c.kind === "idle" && !/^talk_idle/.test(c.id));
      const all = [...out, ...gags];
      if (all.length) { const c = pick(all); st.visit = c.kind === "transition"; return c; }
    }
    // Wandered to a pose with its own acting: do it once, then head home.
    if (st.visit && st.pose !== talk && st.mode === "idle") {
      st.visit = false;
      const here = M.clips.filter((c) => c.kind === "reaction" && c.from === st.pose);
      if (here.length) return pick(here);
    }
    if (st.pose !== talk && (live || st.mode === "talk" || st.mode === "think")) return route(st.pose, talk).first || idleAt(st.pose);
    if (st.pose === talk && live) return null;
    // No live face: idle loops and a drift to the rest pose.
    if (st.mode === "idle" && rest && st.pose !== rest && st.idles >= 2) { const f = route(st.pose, rest).first; if (f) return f; }
    return idleAt(st.pose);
  }

  function next() {
    const clip = choose();
    if (clip) return play(clip);
    st.clip = null;
    st.parkedAt = performance.now();
    st.wanderAfter = wanderS * (0.7 + Math.random() * 0.8) * 1000;
    setLive(true);
  }
  function play(clip: Clip) {
    if (st.stopped) return;
    const tok = ++st.token, v = st.back;
    st.clip = clip;
    st.idles = clip.kind === "idle" ? st.idles + 1 : 0;
    say("play", clip.id, `${clip.from}->${clip.to}`);
    v.src = clip.src;
    v.currentTime = 0;
    const swap = () => {
      if (tok !== st.token) return;
      const old = st.front;
      st.front = v; st.back = old;
      v.dataset.front = "1"; old.dataset.front = "0"; old.pause();
      setLive(false); // only once the clip's first frame (the talk still) is on screen
    };
    let done = false;
    const once = () => { if (!done) { done = true; swap(); } };
    v.play().then(() => {
      (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback?.(once);
      setTimeout(once, 250);
    }).catch((e) => { say("play failed", clip.id, e?.message); setTimeout(() => tok === st.token && advance(tok), 500); });
    v.onended = () => advance(tok);
  }
  function advance(tok: number) {
    if (tok !== st.token || st.stopped || !st.clip) return;
    st.pose = st.clip.to;
    next();
  }
  const kick = () => { if (parked()) next(); };
  const timer = setInterval(() => {
    if (!parked()) return;
    if (!canLive() || st.mode === "think") return kick();
    if (st.mode === "idle" && wanderS && performance.now() - st.parkedAt > st.wanderAfter) { st.wander = true; kick(); }
  }, 250);

  return {
    manifest: M,
    get pose() { return st.pose; },
    get live() { return st.live; },
    start() {
      if (!st.stopped) return;
      st.stopped = false;
      // Open mid-action: start on a pose that has its own acting, do it, then come to talk.
      const busy = [...new Set(M.clips.filter((c) => c.kind === "reaction" && c.from !== talk && c.from === c.to && route(c.from, talk).dist < Infinity).map((c) => c.from))];
      if (busy.length) { st.pose = busy[Math.floor(Math.random() * busy.length)]!; st.visit = true; }
      else st.wander = true;
      const first = M.clips.find((c) => c.from === st.pose);
      if (first) { a.src = first.src; a.currentTime = 0; }
      next();
    },
    stop() { st.stopped = true; st.token++; st.clip = null; a.pause(); b.pause(); setLive(false); },
    setState(s: string) {
      const mode = s === "speaking" ? "talk" : s === "thinking" ? "think" : "idle";
      if (mode !== "think") st.thought = false;
      if (mode !== "idle") st.visit = false;
      if (mode !== st.mode) st.parkedAt = st.modeAt = performance.now();
      st.mode = mode;
      // Speech starts mid-acting on the talk pose: cut straight to the live face. Pose changes must finish.
      if (mode === "talk" && st.clip && st.clip.from === talk && st.clip.to === talk && canLive()) {
        say("cut", st.clip.id); st.token++; st.pose = talk; st.clip = null; next(); return;
      }
      kick();
    },
    react(tag: string) {
      const clips = reactionsFor(tag);
      if (!clips.length) return false;
      if (st.queue.length < 2) st.queue.push({ tag, clips, at: performance.now() });
      kick();
      return true;
    },
    kick,
    dispose() { this.stop(); clearInterval(timer); },
  };
}

/**
 * Paste the live face's square frames into the talk still at its faceBox,
 * with a feathered edge, so the talking view has the clips' exact framing.
 */
export class FaceCompositor {
  #still: HTMLImageElement;
  #box: { x: number; y: number; size: number };
  #tmp: HTMLCanvasElement;
  #mask: HTMLCanvasElement;
  constructor(still: HTMLImageElement, box: { x: number; y: number; size: number }) {
    this.#still = still;
    this.#box = box;
    const n = box.size;
    const mk = () => Object.assign(document.createElement("canvas"), { width: n, height: n });
    this.#tmp = mk();
    this.#mask = mk();
    const g = this.#mask.getContext("2d")!, f = Math.round(n * 0.09);
    // Rounded-rect alpha ramp: opaque inside, fading to 0 over the outer f pixels.
    for (let i = 0; i < f; i++) {
      g.fillStyle = `rgba(0,0,0,${(i + 1) / f})`;
      g.beginPath();
      g.roundRect(i, i, n - 2 * i, n - 2 * i, f - i);
      g.fill();
    }
  }
  get width() { return this.#still.naturalWidth; }
  get height() { return this.#still.naturalHeight; }
  /** Draw the still (call once when the canvas is sized). */
  paintStill(canvas: HTMLCanvasElement) {
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext("2d")!.drawImage(this.#still, 0, 0);
  }
  draw(canvas: HTMLCanvasElement, frame: CanvasImageSource) {
    const { x, y, size } = this.#box, t = this.#tmp.getContext("2d")!, g = canvas.getContext("2d")!;
    t.globalCompositeOperation = "copy";
    t.drawImage(frame, 0, 0, size, size);
    t.globalCompositeOperation = "destination-in";
    t.drawImage(this.#mask, 0, 0);
    g.drawImage(this.#still, x, y, size, size, x, y, size, size);
    g.drawImage(this.#tmp, x, y);
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = no;
    img.src = src;
  });
}
