// Pose-graph video player for santa.html: the "parlor trick" for a live character.
//
// Poses are keyframe stills. Clips are edges between poses (made with Wan first+last frame video),
// so every clip starts and ends on an exact pose and a cut between two clips that meet on the same
// pose is invisible. Idle clips loop on one pose; transitions move between poses; reactions
// (laugh, wink, check list...) are canned acting. Live lip-sync only runs on the talk pose: when
// Santa speaks we walk the graph to `talkPose`, then hand off to the face canvas (onLive(true)).
//
// Manifest (see the shared notes for the full format):
//   { talkPose, restPose?, startPose?, poses: { id: {label?} }, clips: [{ id, from, to, kind, tags?, src, weight? }] }
//   kind: "idle" (from === to, loops) | "transition" | "reaction". Reactions are found by `tags`
//   (or their id); the tag "thinking" is what plays while the LLM is thinking.
//
// Two stacked <video> elements: the next clip loads and starts in the back one, and the two swap
// on its first painted frame. The finished clip holds its last frame meanwhile, which is the same
// pose, so there's no gap.
(function () {
  "use strict";

  // Strip [tag] markers from streamed text. Tags can be split across deltas, so hold back an unclosed "[".
  function tagStream() {
    let held = "", last = "";
    return function (delta) {
      const r = strip(delta);
      if (last === " " && r.text[0] === " ") r.text = r.text.slice(1);
      if (r.text) last = r.text[r.text.length - 1];
      return r;
    };
    function strip(delta) {
      let s = held + delta, text = "", tags = []; held = "";
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
      // Collapse the double space a removed tag leaves behind.
      if (tags.length) text = text.replace(/ {2,}/g, " ").replace(/ ([!?.,;:])/g, "$1");
      return { text, tags };
    }
  }

  function resolve(manifest, base) {
    const clips = manifest.clips.map((c) => ({ weight: 1, tags: [], ...c, src: base && !/^(data:|blob:|https?:)/.test(c.src) ? new URL(c.src, base).href : c.src }));
    return { ...manifest, clips };
  }

  function create({ manifest, base, a, b, bg, onLive, liveReady, wanderS = 7, thinkDelayS = 0.6, log }) {
    const M = resolve(manifest, base);
    const talk = M.talkPose || "talk", rest = M.restPose || null;
    const moves = M.clips.filter((c) => c.from !== c.to && M.poses[c.from] && M.poses[c.to]);
    const say = log || (() => {});

    // Shortest number of clips from pose x to pose y (BFS), and the first clip of one such path.
    function route(x, y) {
      if (x === y) return { dist: 0, first: null };
      // Prefer transitions over pose-changing reactions on equal length, and randomise ties.
      const out = (p) => moves.filter((m) => m.from === p).sort((m, n) => (m.kind === "transition" ? 0 : 1) - (n.kind === "transition" ? 0 : 1) || Math.random() - 0.5);
      const seen = new Map([[x, { first: null, dist: 0 }]]), q = [x];
      while (q.length) {
        const p = q.shift(), at = seen.get(p);
        for (const c of out(p)) {
          if (seen.has(c.to)) continue;
          const next = { first: at.first || c, dist: at.dist + 1 };
          if (c.to === y) return next;
          seen.set(c.to, next); q.push(c.to);
        }
      }
      return { dist: Infinity, first: null };
    }
    const pick = (list) => { let t = list.reduce((s, c) => s + c.weight, 0) * Math.random(); for (const c of list) if ((t -= c.weight) <= 0) return c; return list[list.length - 1]; };
    const reactionsFor = (tag) => M.clips.filter((c) => c.kind === "reaction" && (c.tags.includes(tag) || c.id === tag));

    // Home is the talk pose. When the live face is up (canLive()), Santa "parks" there: no clip plays, the
    // face model's own silent motion is the idle, and lip-sync appears exactly when the audio does.
    // Clips run only to act (thinking, reactions, the odd wander). Without a live face, idle clips loop.
    const canLive = liveReady || (() => false);
    const st = { pose: M.startPose || talk, mode: "idle", live: false, queue: [], thought: false, idles: 0, front: a, back: b, clip: null,
      token: 0, stopped: true, parkedAt: 0, modeAt: 0, wander: false, visit: false, wanderAfter: 0 };
    a.muted = b.muted = true; a.playsInline = b.playsInline = true; a.preload = b.preload = "auto";
    a.classList.add("front"); b.classList.remove("front");

    function setLive(on) { if (st.live === on) return; st.live = on; say("live", on); onLive?.(on); }
    const parked = () => !st.clip && !st.stopped;

    // The next clip to play from st.pose, or null to park on the live face.
    function choose() {
      const now = performance.now(), live = canLive();
      st.queue = st.queue.filter((r) => now - r.at < 8000);
      // Never cover lip-sync with a reaction: those wait until Santa stops talking.
      const holdForSpeech = st.mode === "talk" && st.pose === talk && live;
      if (st.queue.length && !holdForSpeech) {
        const step = nearest(st.queue[0].clips);
        if (!step) st.queue.shift();
        else { if (step.here) st.queue.shift(); return step.clip; }
      }
      // A short think (most turns) shouldn't start a 5 s acting clip that then delays the answer.
      if (st.mode === "think" && !st.thought && now - st.modeAt > thinkDelayS * 1000) {
        const step = nearest(reactionsFor("thinking"));
        if (step) { if (step.here) st.thought = true; return step.clip; }
      }
      if (st.wander && st.pose === talk) {
        st.wander = false;
        // Go somewhere (and act there), or play a talk-pose gag. Talk idles are only the no-face fallback.
        const out = moves.filter((m) => m.from === talk && m.kind === "transition" && route(m.to, talk).dist < Infinity);
        const gags = M.clips.filter((c) => c.from === talk && c.to === talk && c.kind === "idle" && !/^talk_idle/.test(c.id));
        const all = [...out, ...gags];
        if (all.length) { const c = pick(all); st.visit = c.kind === "transition"; return c; }
      }
      // Wandered to a pose with its own acting (list -> check_list, cocoa -> sip_cocoa): do it once, then head home.
      if (st.visit && st.pose !== talk && st.mode === "idle") {
        st.visit = false;
        const here = M.clips.filter((c) => c.kind === "reaction" && c.from === st.pose);
        if (here.length) return pick(here);
      }
      if (st.pose !== talk && (live || st.mode === "talk" || st.mode === "think")) return route(st.pose, talk).first || idleAt(st.pose);
      if (st.pose === talk && live) return null;
      // No live face: the old behaviour, idle loops and a drift to the rest pose.
      if (st.mode === "idle" && rest && st.pose !== rest && st.idles >= 2) { const f = route(st.pose, rest).first; if (f) return f; }
      return idleAt(st.pose);
    }
    // Of these clips, the closest one by the graph: play it if we're on its pose, else the next step toward it.
    function nearest(list) {
      const opts = list.map((c) => ({ c, r: route(st.pose, c.from), weight: c.weight })).filter((o) => o.r.dist < Infinity);
      if (!opts.length) return null;
      const best = Math.min(...opts.map((o) => o.r.dist)), o = pick(opts.filter((o) => o.r.dist === best));
      return best === 0 ? { here: true, clip: o.c } : { here: false, clip: o.r.first };
    }
    function idleAt(p) {
      const loops = M.clips.filter((c) => c.kind === "idle" && c.from === p && c.to === p);
      if (loops.length) return pick(loops);
      return moves.find((m) => m.from === p) || null;  // no loop for this pose: leave it
    }

    function next() {
      const clip = choose();
      if (clip) return play(clip);
      st.clip = null; st.parkedAt = performance.now(); st.wanderAfter = wanderS * (0.7 + Math.random() * 0.8) * 1000; setLive(true);
    }
    function play(clip) {
      if (st.stopped) return;
      const tok = ++st.token, v = st.back;
      st.clip = clip; st.idles = clip.kind === "idle" ? st.idles + 1 : 0;
      say("play", clip.id, clip.from + "->" + clip.to);
      v.src = clip.src; v.currentTime = 0;
      const swap = () => {
        if (tok !== st.token) return;
        const old = st.front; st.front = v; st.back = old;
        v.classList.add("front"); old.classList.remove("front"); old.pause();
        setLive(false);  // only once the clip's first frame (= the talk still) is on screen
      };
      // Swap on the first painted frame; the timeout covers hidden/background tabs, where frame callbacks never fire.
      let done = false; const once = () => { if (!done) { done = true; swap(); } };
      v.play().then(() => { v.requestVideoFrameCallback?.(once); setTimeout(once, 250); }).catch((e) => { say("play failed", clip.id, e?.message); setTimeout(() => tok === st.token && advance(tok), 500); });
      v.onended = () => advance(tok);
    }
    function advance(tok) {
      if (tok !== st.token || st.stopped) return;
      st.pose = st.clip.to;
      next();
    }
    const kick = () => { if (parked()) next(); };
    // Parked: wander off now and then when nobody's talking; fall back to clips if the live face goes away.
    const timer = setInterval(() => {
      if (!parked()) return;
      if (!canLive() || st.mode === "think") return kick();
      if (st.mode === "idle" && wanderS && performance.now() - st.parkedAt > st.wanderAfter) { st.wander = true; kick(); }
    }, 250);

    // Blurred fill behind the frame: draw whatever the front video shows, small.
    if (bg) (function paint() {
      requestAnimationFrame(paint);
      if (!st.live && !st.stopped && st.front.readyState >= 2) bg.getContext("2d").drawImage(st.front, 0, 0, bg.width, bg.height);
    })();

    return {
      manifest: M,
      get pose() { return st.pose; }, get live() { return st.live; }, get clip() { return st.clip?.id ?? null; },
      start() {
        if (!st.stopped) return; st.stopped = false;
        // Open mid-action: start on a pose that has its own acting (list, cocoa...), do it, then come to talk.
        const busy = [...new Set(M.clips.filter((c) => c.kind === "reaction" && c.from !== talk && c.from === c.to && route(c.from, talk).dist < Infinity).map((c) => c.from))];
        if (busy.length) { st.pose = busy[Math.floor(Math.random() * busy.length)]; st.visit = true; }
        else st.wander = true;
        // Show the start pose's still frame at once (first frame of any clip from it), then decide.
        const first = M.clips.find((c) => c.from === st.pose);
        if (first) { a.src = first.src; a.currentTime = 0; }
        next();
      },
      stop() { st.stopped = true; st.token++; st.clip = null; a.pause(); b.pause(); setLive(false); },
      // Voice server states: idle | listening | thinking | speaking.
      setState(s) {
        const mode = s === "speaking" ? "talk" : s === "thinking" ? "think" : "idle";
        if (mode !== "think") st.thought = false;
        if (mode !== "idle") st.visit = false;
        if (mode !== st.mode) st.parkedAt = st.modeAt = performance.now();
        st.mode = mode;
        // Speech starts mid-acting on the talk pose (a laugh, a think): cut straight to the live face rather
        // than let lip-sync wait up to 5 s. Clips that change pose have to finish.
        if (mode === "talk" && st.clip && st.clip.from === talk && st.clip.to === talk && canLive()) {
          say("cut", st.clip.id); st.token++; st.pose = talk; st.clip = null; next(); return;
        }
        kick();
      },
      react(tag) {
        const clips = reactionsFor(tag);
        if (!clips.length) return false;
        if (st.queue.length < 2) st.queue.push({ tag, clips, at: performance.now() });
        kick(); return true;
      },
      // The live face just came up or went away.
      kick,
      dispose() { this.stop(); clearInterval(timer); },
    };
  }

  window.SantaPoses = { create, tagStream };
})();
