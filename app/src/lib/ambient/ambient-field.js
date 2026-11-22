/**
 * The ambient field: a slow, warm gradient that drifts behind Mirli's panels,
 * moves like a liquid when the pointer passes through it, and breathes with
 * whatever is playing.
 *
 * Plain JavaScript with no imports, on purpose. The same file runs in three
 * places that share nothing else:
 *
 *   - the app (app/src/components/ambient-background.tsx imports it),
 *   - the desktop splash, which is shown before any server is up
 *     (src-tauri/splash/ambient-field.js is a copy),
 *   - Mirli Cloud's own pages (the gateway serves a copy).
 *
 * Edit this one and run `node scripts/sync-ambient-field.mjs` to refresh the
 * splash copy. The cloud copy lives in the gateway repo.
 *
 * How it moves. One fragment shader at a fraction of the window's resolution
 * (the picture is all soft gradients, so the pixels are never seen):
 *   - three colour pools drift on a domain-warped noise field,
 *   - the pointer leaves a short trail of (position, velocity) samples; each
 *     one drags the field along its velocity and curls it around itself, then
 *     fades. That is the "stirred liquid" look without simulating a fluid,
 *   - audio arrives as three numbers (level, bass, highs). Bass swells the
 *     pools and speeds the drift, highs add a fine shimmer, the overall level
 *     lifts the signal colour a touch. All of it small: this is a background.
 *
 * Reduced motion draws one still frame. A hidden tab draws nothing.
 */

const TRAIL = 16;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBg;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uStrength;
uniform vec4 uTrail[${TRAIL}];
uniform float uAge[${TRAIL}];
uniform vec2 uPointer;
uniform float uPointerOn;
uniform vec3 uAudio;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // The pointer's wake: drag along each sample's velocity, and curl around it.
  vec2 disp = vec2(0.0);
  for (int i = 0; i < ${TRAIL}; i++) {
    vec4 s = uTrail[i];
    float life = 1.0 - clamp(uAge[i], 0.0, 1.0);
    if (life <= 0.0) continue;
    vec2 d = p - s.xy;
    float w = exp(-dot(d, d) / 0.045) * life * life;
    float speed = length(s.zw);
    disp += s.zw * w * 0.12;
    disp += vec2(-d.y, d.x) * speed * w * 0.45;
  }
  p -= disp;

  float bass = uAudio.y, high = uAudio.z, level = uAudio.x;
  float t = uTime * (0.045 + bass * 0.03);

  // The drift: noise warping noise, so the pools fold rather than slide.
  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, 1.3) - t * 0.8));
  vec2 w = p + (q - 0.5) * (0.9 + high * 0.25);

  // Three pools on slow Lissajous paths. Bass swells them.
  float swell = 1.0 + bass * 0.35;
  vec2 a1 = vec2(sin(t * 1.3) * 0.55 * aspect, cos(t * 0.9) * 0.35 - 0.15);
  vec2 a2 = vec2(cos(t * 0.7 + 2.0) * 0.5 * aspect, sin(t * 1.1 + 1.0) * 0.4 + 0.1);
  vec2 a3 = vec2(sin(t * 0.5 + 4.0) * 0.6 * aspect, cos(t * 0.6 + 3.0) * 0.45);
  float b1 = exp(-dot(w - a1, w - a1) / (0.28 * swell));
  float b2 = exp(-dot(w - a2, w - a2) / (0.36 * swell));
  float b3 = exp(-dot(w - a3, w - a3) / (0.22 * swell));

  // A soft lift where the pointer rests.
  vec2 dp = p - uPointer;
  float lift = exp(-dot(dp, dp) / 0.08) * uPointerOn * 0.35;

  vec3 col = uBg;
  col = mix(col, uC2, b2 * uStrength * 0.9);
  col = mix(col, uC3, b3 * uStrength * 0.8);
  col = mix(col, uC1, clamp((b1 + lift) * uStrength * (1.0 + level * 0.5), 0.0, 1.0));

  // Highs: a faint moving grain over the brightest parts.
  float shimmer = (noise(w * 22.0 + uTime * 1.7) - 0.5) * high * 0.05 * (b1 + b2);
  col += shimmer;

  // Dither, so an 8-bit gradient never bands.
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** "#f2a40c" or "rgb(…)" to [r, g, b] in 0..1. Unknown input gives null. */
export function parseColor(input) {
  const s = String(input || "").trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  return null;
}

/**
 * Starts the field on `canvas`. Returns null where WebGL is unavailable, and
 * the caller keeps its flat background.
 *
 * options:
 *   palette   { bg, c1, c2, c3 } as CSS colours; c1 is the bright one
 *   strength  0..1, how far the pools reach from the ground (default 0.35)
 *   scale     render resolution against CSS pixels (default 0.4)
 *   audio     () => [level, bass, high] in 0..1, polled each frame
 */
export function createAmbientField(canvas, options = {}) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
  } catch (err) {
    console.warn("[ambient] shader failed, keeping the flat background", err);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const name of ["uRes", "uTime", "uBg", "uC1", "uC2", "uC3", "uStrength", "uTrail", "uAge", "uPointer", "uPointerOn", "uAudio"]) {
    U[name] = gl.getUniformLocation(prog, name);
  }

  let scale = options.scale ?? 0.4;
  let strength = options.strength ?? 0.35;
  let audioSource = options.audio ?? null;
  const pal = { bg: [0.08, 0.08, 0.075], c1: [0.95, 0.64, 0.05], c2: [0.66, 0.31, 0.11], c3: [0.24, 0.29, 0.35] };
  const setPalette = (p) => {
    for (const k of ["bg", "c1", "c2", "c3"]) {
      const c = p && parseColor(p[k]);
      if (c) pal[k] = c;
    }
    if (still) draw(performance.now());
  };

  // Pointer trail, in the shader's space: x in [-aspect/2, aspect/2], y in [-0.5, 0.5].
  const trail = new Float32Array(TRAIL * 4);
  const ages = new Float32Array(TRAIL).fill(1);
  let head = 0;
  let last = null; // { x, y, t }
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
  const toField = (clientX, clientY) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    return [(clientX / w - 0.5) * (w / h), 0.5 - clientY / h];
  };
  const onMove = (e) => {
    const [x, y] = toField(e.clientX, e.clientY);
    const now = performance.now();
    pointer.tx = x;
    pointer.ty = y;
    pointer.target = 1;
    if (last) {
      const dt = Math.max(8, now - last.t) / 1000;
      let vx = (x - last.x) / dt;
      let vy = (y - last.y) / dt;
      const sp = Math.hypot(vx, vy);
      const cap = 2.2; // a flick should stir, not tear
      if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
      // Only keep a sample when the pointer has actually travelled.
      if (Math.hypot(x - last.x, y - last.y) > 0.012) {
        trail.set([x, y, vx, vy], head * 4);
        ages[head] = 0;
        head = (head + 1) % TRAIL;
        last = { x, y, t: now };
      }
    } else {
      last = { x, y, t: now };
    }
  };
  const onLeave = () => { pointer.target = 0; last = null; };
  window.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { resize(); if (still) draw(performance.now()); }) : null;
  ro?.observe(canvas);

  // Audio, smoothed here so every caller gets the same feel: quick to rise,
  // slow to fall, like a meter's ballistics. Bass is sent as how far it sits
  // above its own recent average, so a kick or a slam moves the field and a
  // steady rumble does not hold it swollen.
  const audio = [0, 0, 0];
  const avg = [0, 0, 0];
  const smoothAudio = (dt) => {
    const raw = audioSource ? audioSource() : null;
    for (let i = 0; i < 3; i++) {
      let target = raw ? Math.min(1, Math.max(0, raw[i] || 0)) : 0;
      avg[i] += (target - avg[i]) * (1 - Math.exp(-dt / 1.5));
      if (i === 1) target = Math.min(1, 0.3 * target + 2.5 * Math.max(0, target - avg[i]));
      const k = target > audio[i] ? 1 - Math.exp(-dt / 0.06) : 1 - Math.exp(-dt / 0.6);
      audio[i] += (target - audio[i]) * k;
    }
  };

  const t0 = performance.now();
  let prev = t0;
  const draw = (now) => {
    resize();
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    for (let i = 0; i < TRAIL; i++) ages[i] = Math.min(1, ages[i] + dt / 1.4);
    const ease = 1 - Math.exp(-dt / 0.25);
    pointer.x += (pointer.tx - pointer.x) * ease;
    pointer.y += (pointer.ty - pointer.y) * ease;
    pointer.on += (pointer.target - pointer.on) * (1 - Math.exp(-dt / 0.6));
    smoothAudio(dt);

    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, still ? 12.0 : (now - t0) / 1000);
    gl.uniform3fv(U.uBg, pal.bg);
    gl.uniform3fv(U.uC1, pal.c1);
    gl.uniform3fv(U.uC2, pal.c2);
    gl.uniform3fv(U.uC3, pal.c3);
    gl.uniform1f(U.uStrength, strength);
    gl.uniform4fv(U.uTrail, trail);
    gl.uniform1fv(U.uAge, ages);
    gl.uniform2f(U.uPointer, pointer.x, pointer.y);
    gl.uniform1f(U.uPointerOn, still ? 0 : pointer.on);
    gl.uniform3fv(U.uAudio, still ? [0, 0, 0] : audio);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let still = !!reduce?.matches;
  let raf = 0;
  const loop = (now) => {
    draw(now);
    raf = requestAnimationFrame(loop);
  };
  const run = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (document.hidden) return;
    if (still) { draw(performance.now()); return; }
    prev = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const onVisibility = () => run();
  const onReduce = () => { still = !!reduce?.matches; run(); };
  document.addEventListener("visibilitychange", onVisibility);
  reduce?.addEventListener?.("change", onReduce);
  setPalette(options.palette);
  run();

  return {
    setPalette,
    setStrength(v) { strength = v; if (still) draw(performance.now()); },
    setAudio(fn) { audioSource = fn; },
    setScale(v) { scale = v; resize(); },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce?.removeEventListener?.("change", onReduce);
      ro?.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}
