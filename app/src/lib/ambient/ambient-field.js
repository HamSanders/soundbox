/**
 * The ambient field: a moving ground behind Mirli's panels that answers the
 * pointer and whatever is playing. Three styles share the plumbing:
 *
 *   - smoke: a bank of smoke rolls in from the bottom-left edge, dense at the
 *     source and thinning to clear air, with a soft billowing leading edge
 *     that breathes. The pointer blows it away: each trail sample pushes the
 *     smoke outward and clears a pocket that the smoke drifts back into.
 *   - liquid: warm colour pools drifting on folded noise. The pointer stirs
 *     them like a spoon in syrup, dragging and curling the colour.
 *   - gradient: the quietest. A soft wash of the accent from the bottom-left
 *     corner and a fainter one from the top-right, drifting very slowly. The
 *     pointer warms the light near it a touch; sound lifts it a little.
 *   - pixel: a grid of soft LED pixels. Embers drift up, a low skyline sways
 *     along the bottom, and while sound plays a spectrum rises from the
 *     bottom edge, one column group per band. The pointer leaves a trail of
 *     lit pixels.
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
 * Audio arrives as three numbers (level, bass, highs) and, for the pixel
 * style, 16 spectrum bands. Everything is drawn at a fraction of the
 * window's resolution. Reduced motion draws one still frame; a hidden tab
 * draws nothing.
 */

const TRAIL = 16;
const BANDS = 16;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = `
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
uniform float uBands[${BANDS}];
uniform float uCell;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8); // rotate each octave so no grid shows
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = turn * p * 2.02 + 17.1; a *= 0.5; }
  return v;
}
// Dither, so an 8-bit gradient never bands.
vec3 dither(vec3 col) { return col + (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0; }
`;

const SMOKE = `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 screen = p; // before the pointer moves anything

  // The pointer blows the smoke away. Each trail sample pushes the smoke
  // outward from where it passed and along the way it was going, and clears
  // a pocket of air there that the smoke drifts back into as the sample
  // fades. Faster passes blow harder.
  vec2 disp = vec2(0.0);
  float blown = 0.0;
  for (int i = 0; i < ${TRAIL}; i++) {
    vec4 s = uTrail[i];
    float life = 1.0 - clamp(uAge[i], 0.0, 1.0);
    if (life <= 0.0) continue;
    vec2 d = p - s.xy;
    float r2 = dot(d, d);
    float gust = min(1.0, 0.35 + length(s.zw) * 0.6);
    float w = exp(-r2 / 0.05) * life * gust;
    // Outward: sample nearer the centre, which spreads what was there.
    disp += d * inversesqrt(r2 + 0.002) * w * 0.09;
    disp -= s.zw * w * 0.03;
    blown += exp(-r2 / 0.02) * life * life * gust;
  }
  p -= disp;

  float level = uAudio.x, bass = uAudio.y, high = uAudio.z;
  float t = uTime * (0.03 + bass * 0.02);

  // Texture: noise warped by noise warped by noise, rising slowly, cut with
  // a soft threshold so it breaks into wisps with air between them.
  vec2 s0 = p * 1.7 + vec2(0.0, -t * 0.9);
  vec2 q = vec2(fbm(s0 + vec2(0.0, t)), fbm(s0 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(s0 + 3.2 * q + vec2(1.7, 9.2) + 0.4 * t),
                fbm(s0 + 3.2 * q + vec2(8.3, 2.8) - 0.3 * t));
  float d = fbm(s0 + 3.4 * r);
  float wisp = smoothstep(0.42 - level * 0.05, 0.86, d);

  // The bank: dense at the bottom-left source, clear air ahead, a billowing
  // front that breathes and leans forward on bass hits. Its direction sways
  // slowly so the front never sits still.
  float sway = 0.25 * sin(uTime * 0.021);
  vec2 dir = normalize(vec2(0.45 + sway, 1.0));
  float along = dot(p, dir);
  float across = dot(p, vec2(-dir.y, dir.x));
  float front = -0.08 + 0.1 * sin(uTime * 0.05) + bass * 0.06
              + (fbm(vec2(across * 2.2, t * 1.5)) - 0.5) * 0.45
              + (r.x - 0.5) * 0.18;
  float body = smoothstep(front + 0.04, front - 0.75, along);
  float rim = exp(-pow(along - front, 2.0) / 0.006);
  float ahead = smoothstep(front + 0.45, front, along);
  float haze = body * (0.55 + 0.45 * d) + rim * (0.25 + 0.6 * wisp);
  wisp *= max(body, ahead * 0.55);

  // Mostly the smoke's own grey, warm where the warp is strongest, a hint
  // of the amber where it is densest.
  vec3 smoke = mix(uC3, uC2, smoothstep(0.35, 0.75, r.y) * 0.5);
  smoke = mix(smoke, uC1, smoothstep(0.6, 0.95, d) * (0.35 + level * 0.4));

  vec2 dp = screen - uPointer;
  float clear = exp(-dot(dp, dp) / 0.025) * uPointerOn * 0.7;
  clear = clamp(max(clear, blown * 0.9), 0.0, 1.0);

  float amount = (wisp + haze) * uStrength * (1.0 - clear) * (1.0 + bass * 0.25);
  vec3 col = mix(uBg, smoke, clamp(amount, 0.0, 1.0));
  col += (noise(s0 * 18.0 + uTime * 2.0) - 0.5) * high * 0.025 * wisp;
  gl_FragColor = vec4(dither(col), 1.0);
}
`;

const LIQUID = `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // The pointer stirs: each trail sample drags the colour along its velocity
  // and curls it around itself, then fades.
  vec2 disp = vec2(0.0);
  for (int i = 0; i < ${TRAIL}; i++) {
    vec4 s = uTrail[i];
    float life = 1.0 - clamp(uAge[i], 0.0, 1.0);
    if (life <= 0.0) continue;
    vec2 d = p - s.xy;
    float w = exp(-dot(d, d) / 0.045) * life * life;
    disp += s.zw * w * 0.12;
    disp += vec2(-d.y, d.x) * length(s.zw) * w * 0.45;
  }
  p -= disp;

  float level = uAudio.x, bass = uAudio.y, high = uAudio.z;
  float t = uTime * (0.045 + bass * 0.03);

  // Noise warping noise, so the pools fold rather than slide.
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

  vec2 dp = p - uPointer;
  float lift = exp(-dot(dp, dp) / 0.08) * uPointerOn * 0.3;

  vec3 col = uBg;
  col = mix(col, uC2, b2 * uStrength * 0.9);
  col = mix(col, uC3, b3 * uStrength * 0.8);
  col = mix(col, uC1, clamp((b1 + lift) * uStrength * (1.0 + level * 0.5), 0.0, 1.0));
  col += (noise(w * 22.0 + uTime * 1.7) - 0.5) * high * 0.04 * uStrength * (b1 + b2);
  gl_FragColor = vec4(dither(col), 1.0);
}
`;

const PIXEL = `
void main() {
  // Everything is decided per cell, so each cell is one flat LED.
  vec2 grid = floor(uRes / uCell);
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 inCell = fract(gl_FragCoord.xy / uCell);
  vec2 cuv = (cell + 0.5) / grid;
  float aspect = uRes.x / uRes.y;
  vec2 p = (cuv - 0.5) * vec2(aspect, 1.0);
  float level = uAudio.x, bass = uAudio.y;

  // Embers drifting upward, a few more while something plays.
  float n = noise(vec2(cell.x * 0.23, cell.y * 0.23 - uTime * 0.35));
  float ember = step(0.8 - level * 0.08, n) * (0.2 + 0.15 * noise(cell + uTime));

  // A low skyline along the bottom that sways, so the grid is never empty.
  float sky = 0.05 + (fbm(vec2(cell.x * 0.07, uTime * 0.04)) - 0.35) * 0.14;
  float hill = step(cuv.y, sky) * (0.22 + 0.2 * (1.0 - cuv.y / max(sky, 0.001)));

  // The spectrum: each column group reads one band and stacks up from the
  // bottom edge, brightest at its top cell. Bass lifts the whole row a touch.
  float bi = floor(cuv.x * ${BANDS}.0);
  float band = 0.0;
  for (int i = 0; i < ${BANDS}; i++) { if (float(i) == bi) band = uBands[i]; }
  // A floor under each band, so broadband noise (rain, hiss) does not raise
  // a wall: only what stands out of the mix climbs.
  band = max(0.0, band - 0.3) / 0.7;
  float bar = band * 0.3 + bass * 0.03;
  float inBar = step(cuv.y, bar) * step(0.015, bar);
  float topRow = inBar * step(bar - 1.0 / grid.y, cuv.y);
  float eq = inBar * (0.2 + 0.25 * cuv.y / max(bar, 0.01)) + topRow * 0.6;

  // The pointer lights the cells it passes; they fade out behind it.
  float spark = 0.0;
  for (int i = 0; i < ${TRAIL}; i++) {
    vec4 s = uTrail[i];
    float life = 1.0 - clamp(uAge[i], 0.0, 1.0);
    if (life <= 0.0) continue;
    vec2 d = p - s.xy;
    // The brightest sample wins, so a slow pass does not pile up into a block.
    spark = max(spark, exp(-dot(d, d) / 0.0007) * life * life * 0.8);
  }
  vec2 dp = p - uPointer;
  spark = max(spark, exp(-dot(dp, dp) / 0.0004) * uPointerOn * 0.5);

  float v = max(max(ember, hill), max(eq, min(1.0, spark)));
  // Three brightness steps, like a cheap LED panel: dim, mid, the beak.
  float stepv = floor(v * 3.0 + 0.5) / 3.0;
  vec3 led = stepv < 0.5 ? uC3 : (stepv < 0.84 ? uC2 : uC1);
  // A dark seam between cells.
  float lit = step(0.14, inCell.x) * step(0.14, inCell.y);
  vec3 col = mix(uBg, led, stepv * uStrength * lit);
  gl_FragColor = vec4(col, 1.0);
}
`;

const GRADIENT = `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float level = uAudio.x, bass = uAudio.y;
  float t = uTime * 0.03;

  // Two washes of the accent, anchored just outside opposite corners and
  // drifting a little, so the light seems to come from beyond the window.
  vec2 a = vec2(-0.5 * aspect + 0.08 * sin(t * 1.3), -0.58 + 0.06 * cos(t));
  vec2 b = vec2(0.5 * aspect + 0.06 * cos(t * 0.9), 0.58 + 0.05 * sin(t * 1.1));
  float wa = exp(-dot(p - a, p - a) / (0.5 + bass * 0.1));
  float wb = exp(-dot(p - b, p - b) / 0.3) * 0.45;

  vec2 dp = p - uPointer;
  float lift = exp(-dot(dp, dp) / 0.06) * uPointerOn * 0.25;

  float amount = (wa + wb + lift) * uStrength * (1.0 + level * 0.3);
  vec3 col = mix(uBg, uC1, clamp(amount, 0.0, 1.0));
  gl_FragColor = vec4(dither(col), 1.0);
}
`;

const STYLES = { smoke: SMOKE, liquid: LIQUID, gradient: GRADIENT, pixel: PIXEL };
/** Render scale and cell size per style. The pixel grid draws at half
 *  resolution so each 6-pixel cell is 12 CSS pixels and stays crisp. */
const STYLE_SCALE = { smoke: 0.4, liquid: 0.4, gradient: 0.25, pixel: 0.5 };
const UNIFORMS = ["uRes", "uTime", "uBg", "uC1", "uC2", "uC3", "uStrength", "uTrail", "uAge", "uPointer", "uPointerOn", "uAudio", "uBands", "uCell"];

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
 *   style     "smoke" (default), "liquid", "gradient" or "pixel"
 *   palette   { bg, c1, c2, c3 } as CSS colours; c1 is the brightest
 *   strength  0..1, how strongly the style shows against the ground
 *   audio     () => [level, bass, high] in 0..1, polled each frame
 *   bands     () => 16 numbers in 0..1, low to high, polled each frame
 */
export function createAmbientField(canvas, options = {}) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || "shader");
    }
    return s;
  };
  const vert = compile(gl.VERTEX_SHADER, VERT);
  /** Compiled on first use and kept, so switching back is instant. */
  const programs = {};
  const programFor = (name) => {
    if (programs[name]) return programs[name];
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    const frag = compile(gl.FRAGMENT_SHADER, COMMON + STYLES[name]);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
    const U = {};
    for (const u of UNIFORMS) U[u] = gl.getUniformLocation(prog, u);
    return (programs[name] = { prog, U, aPos: gl.getAttribLocation(prog, "aPos") });
  };

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  let style = STYLES[options.style] ? options.style : "smoke";
  let current;
  try {
    current = programFor(style);
  } catch (err) {
    console.warn("[ambient] shader failed, keeping the flat background", err);
    return null;
  }
  const bindProgram = (prog) => {
    gl.useProgram(prog.prog);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
  };
  bindProgram(current);

  let scale = STYLE_SCALE[style];
  let strength = options.strength ?? 0.2;
  let audioSource = options.audio ?? null;
  let bandSource = options.bands ?? null;
  const pal = { bg: [0.08, 0.08, 0.075], c1: [0.95, 0.6, 0.1], c2: [0.55, 0.42, 0.33], c3: [0.6, 0.62, 0.64] };
  const setPalette = (p) => {
    for (const k of ["bg", "c1", "c2", "c3"]) {
      const c = p && parseColor(p[k]);
      if (c) pal[k] = c;
    }
    if (still) draw(performance.now());
  };
  const applyStyleLook = () => {
    // Upscaled with smoothing for the soft styles; hard edges for the grid.
    canvas.style.imageRendering = style === "pixel" ? "pixelated" : "";
  };
  applyStyleLook();

  // Pointer trail, in the shader's space: x in [-aspect/2, aspect/2], y in [-0.5, 0.5].
  const trail = new Float32Array(TRAIL * 4);
  const ages = new Float32Array(TRAIL).fill(1);
  let head = 0;
  let last = null; // { x, y, t }
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
  let follow = options.pointer ?? true;
  const toField = (clientX, clientY) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    return [(clientX / w - 0.5) * (w / h), 0.5 - clientY / h];
  };
  const onMove = (e) => {
    if (!follow) return;
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
  const bands = new Float32Array(BANDS);
  const smoothAudio = (dt) => {
    const raw = audioSource ? audioSource() : null;
    for (let i = 0; i < 3; i++) {
      let target = raw ? Math.min(1, Math.max(0, raw[i] || 0)) : 0;
      avg[i] += (target - avg[i]) * (1 - Math.exp(-dt / 1.5));
      if (i === 1) target = Math.min(1, 0.3 * target + 2.5 * Math.max(0, target - avg[i]));
      const k = target > audio[i] ? 1 - Math.exp(-dt / 0.06) : 1 - Math.exp(-dt / 0.6);
      audio[i] += (target - audio[i]) * k;
    }
    const rawBands = bandSource && style === "pixel" ? bandSource() : null;
    for (let i = 0; i < BANDS; i++) {
      const target = rawBands ? Math.min(1, Math.max(0, rawBands[i] || 0)) : 0;
      const k = target > bands[i] ? 1 - Math.exp(-dt / 0.04) : 1 - Math.exp(-dt / 0.35);
      bands[i] += (target - bands[i]) * k;
    }
  };

  const t0 = performance.now();
  let prev = t0;
  const zeros3 = [0, 0, 0];
  const zerosBands = new Float32Array(BANDS);
  const draw = (now) => {
    resize();
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    for (let i = 0; i < TRAIL; i++) ages[i] = Math.min(1, ages[i] + dt / 2.2);
    const ease = 1 - Math.exp(-dt / 0.25);
    pointer.x += (pointer.tx - pointer.x) * ease;
    pointer.y += (pointer.ty - pointer.y) * ease;
    pointer.on += (pointer.target - pointer.on) * (1 - Math.exp(-dt / 0.6));
    smoothAudio(dt);

    const U = current.U;
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
    gl.uniform3fv(U.uAudio, still ? zeros3 : audio);
    if (U.uBands) gl.uniform1fv(U.uBands, still ? zerosBands : bands);
    if (U.uCell) gl.uniform1f(U.uCell, 6.0);
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
    /** Switches style in place. Returns false, keeping the old one, if the
     *  new style's shader would not compile. */
    setStyle(name) {
      if (!STYLES[name] || name === style) return !!STYLES[name];
      try {
        current = programFor(name);
      } catch (err) {
        console.warn(`[ambient] ${name} shader failed`, err);
        return false;
      }
      style = name;
      scale = STYLE_SCALE[name];
      bindProgram(current);
      applyStyleLook();
      resize();
      if (still) draw(performance.now());
      return true;
    },
    setAudio(fn) { audioSource = fn; },
    setPointer(on) {
      follow = !!on;
      if (!follow) { pointer.target = 0; last = null; ages.fill(1); }
    },
    setBands(fn) { bandSource = fn; },
    setScale(v) { scale = v; resize(); },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce?.removeEventListener?.("change", onReduce);
      ro?.disconnect();
      gl.deleteBuffer(buf);
      for (const p of Object.values(programs)) gl.deleteProgram(p.prog);
      gl.deleteShader(vert);
    },
  };
}
