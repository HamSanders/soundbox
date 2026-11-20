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

  function create({ manifest, base, a, b, bg, onLive, log }) {
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

    const st = { pose: M.startPose || rest || talk, mode: "idle", live: false, queue: [], thought: false, idles: 0, front: a, back: b, clip: null, token: 0, stopped: false };
    a.muted = b.muted = true; a.playsInline = b.playsInline = true; a.preload = b.preload = "auto";
    a.classList.add("front"); b.classList.remove("front");

    function setLive(on) { if (st.live === on) return; st.live = on; say("live", on); onLive?.(on); }

    // Pick the next clip to play from st.pose, given what the call wants right now.
    function choose() {
      const now = performance.now();
      st.queue = st.queue.filter((r) => now - r.at < 6000);
      // A reaction waiting, and we're not mid-speech: get to its pose, then play it.
      if (st.queue.length && !st.live) {
        const step = nearest(st.queue[0].clips);
        if (!step) st.queue.shift();
        else if (step.here) { st.queue.shift(); return step.clip; }
        else return step.clip;
      }
      if (st.mode === "talk") {
        if (st.pose === talk) { setLive(true); return idleAt(talk); }
        return route(st.pose, talk).first || idleAt(st.pose);
      }
      if (st.mode === "think" && !st.thought) {
        const step = nearest(reactionsFor("thinking"));
        if (step) { if (step.here) st.thought = true; return step.clip; }
      }
      // Idle: drift back to the rest pose after a loop or two; while listening, stay attentive.
      if (st.mode === "idle" && rest && st.pose !== rest && st.idles >= 1) { const f = route(st.pose, rest).first; if (f) return f; }
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

    function play(clip) {
      if (!clip || st.stopped) return;
      const tok = ++st.token, v = st.back;
      st.clip = clip; st.idles = clip.kind === "idle" ? st.idles + 1 : 0;
      say("play", clip.id, clip.from + "->" + clip.to);
      v.src = clip.src; v.currentTime = 0;
      const swap = () => {
        if (tok !== st.token) return;
        const old = st.front; st.front = v; st.back = old;
        v.classList.add("front"); old.classList.remove("front"); old.pause();
      };
      // Swap on the first painted frame; the timeout covers hidden/background tabs, where frame callbacks never fire.
      let done = false; const once = () => { if (!done) { done = true; swap(); } };
      v.play().then(() => { v.requestVideoFrameCallback?.(once); setTimeout(once, 250); }).catch((e) => { say("play failed", clip.id, e?.message); setTimeout(() => tok === st.token && advance(tok), 500); });
      v.onended = () => advance(tok);
    }
    function advance(tok) {
      if (tok !== st.token || st.stopped) return;
      st.pose = st.clip.to;
      play(choose());
    }

    // Blurred fill behind the frame: draw whatever the front video shows, small.
    if (bg) (function paint() {
      if (st.stopped) return; requestAnimationFrame(paint);
      if (!st.live && st.front.readyState >= 2) bg.getContext("2d").drawImage(st.front, 0, 0, bg.width, bg.height);
    })();

    return {
      get pose() { return st.pose; }, get live() { return st.live; }, get clip() { return st.clip?.id; },
      start() { st.stopped = false; play(idleAt(st.pose)); },
      stop() { st.stopped = true; st.token++; a.pause(); b.pause(); setLive(false); },
      // Voice server states: idle | listening | thinking | speaking.
      setState(s) {
        const mode = s === "speaking" ? "talk" : s === "thinking" ? "think" : "idle";
        if (mode !== "think") st.thought = false;
        if (mode !== "talk") setLive(false);
        st.mode = mode;
      },
      react(tag) {
        const clips = reactionsFor(tag);
        if (!clips.length) return false;
        if (st.queue.length < 2) st.queue.push({ tag, clips, at: performance.now() });
        return true;
      },
    };
  }

  window.SantaPoses = { create, tagStream };
})();
