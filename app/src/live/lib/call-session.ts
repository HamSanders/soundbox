/**
 * One live call, outside React: microphone, the voice worker's WebSocket, the
 * face worker's WebSocket, audio playback and frame timing. Ported from the
 * spike's call pages (spikes/realtime-voice/public/index.html, voice.html).
 *
 * In a video call the page plays the audio that comes back WITH the frames
 * from the face worker, so mouth and sound share one clock; the voice worker's
 * own speech is only played when there is no face.
 *
 * `start()` must run inside a click handler: Chrome keeps an AudioContext made
 * outside a user gesture suspended, and then nothing is captured.
 */

import { type CallGrant, type LiveClient, wsProtocols } from "./live-client";

export type CallState = "starting" | "idle" | "listening" | "thinking" | "speaking" | "error" | "closed";

export interface TurnStats {
  turn: number;
  barged_in?: boolean;
  discarded?: string | null;
  endpoint_wait_ms?: number | null;
  eos_to_transcript_ms?: number | null;
  eos_to_first_token_ms?: number | null;
  eos_to_first_audio_ms?: number | null;
  vram_peak_mib?: number | null;
  target_ms?: number;
  heard_ms?: number | null;
}

export interface CallHandlers {
  state?: (s: CallState) => void;
  /** The caller's words so far (live) and when final. */
  partial?: (text: string) => void;
  final?: (text: string) => void;
  /** A new reply starts (first delta) / grows. */
  replyDelta?: (delta: string) => void;
  /** Barge-in: the reply was cut off. */
  flush?: () => void;
  turn?: (t: TurnStats) => void;
  /** Notes for the log: voice changed, face busy, errors. */
  note?: (text: string, isError?: boolean) => void;
  /** Video is on when frames are flowing from the face worker. */
  video?: (on: boolean) => void;
  info?: (text: string) => void;
  /** The call is over (hung up here, ended by the server, or lapsed). */
  ended?: (reason: string) => void;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
/** Close codes the workers use (4000-4999 are ours). */
const CLOSE = { replaced: 4000, ended: 4001, busy: 4409 } as const;

interface Frame { t: number; bm: ImageBitmap }

export class CallSession {
  ctx: AudioContext | null = null;
  /** Mirli's voice, for the pen line. */
  analyser: AnalyserNode | null = null;
  /** The caller's mic, for the voice page's line. */
  micAnalyser: AnalyserNode | null = null;
  micLevel = 0;
  muted = false;
  /** The mic could not be opened: the call is typed only. */
  noMic = false;
  startedAt = 0;
  replies = 0;
  lastReply = "";
  videoOn = false;

  #ws: WebSocket | null = null;
  #faceWs: WebSocket | null = null;
  #player: AudioWorkletNode | null = null;
  #mic: MediaStream | null = null;
  #token: string;
  #beat: number | undefined;
  #ending = false;
  #canvas: HTMLCanvasElement | null = null;
  #raf = 0;
  #face = { gen: 0, next: 0, frames: [] as Frame[], sources: [] as AudioBufferSourceNode[], speechFrom: Infinity, speechUntil: 0, playing: false, lastStart: 0 };
  #firstChunkAt: number | null = null;
  #lastHeard: number | null = null;
  #reply = "";

  client: LiveClient;
  grant: CallGrant;
  opts: { voiceId?: string; persona?: string; worklets?: string };
  on: CallHandlers;

  constructor(client: LiveClient, grant: CallGrant, opts: CallSession["opts"], on: CallHandlers = {}) {
    this.client = client;
    this.grant = grant;
    this.opts = opts;
    this.on = on;
    this.#token = grant.token;
  }

  get callId() { return this.grant.call_id; }

  /**
   * Make the AudioContext. Call synchronously inside the click, before any
   * await (the Call API request), then hand it to `start`.
   */
  static audioContext(): AudioContext {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); // VoxCPM2's rate
    void ctx.resume();
    return ctx;
  }

  start(ctx: AudioContext = CallSession.audioContext()) {
    this.on.state?.("starting");
    this.ctx = ctx;
    this.#connectVoice();
    this.#beat = window.setInterval(() => void this.#heartbeat(), Math.max(2, this.grant.heartbeat_s) * 1000);
  }

  /** Where the face's frames are drawn. */
  setCanvas(c: HTMLCanvasElement | null) { this.#canvas = c; }

  sendText(text: string) {
    if (this.#ws?.readyState !== 1) return false;
    this.#ws.send(JSON.stringify({ type: "text", text }));
    return true;
  }
  setVoice(id: string) {
    this.opts.voiceId = id;
    if (this.#ws?.readyState === 1 && id) this.#ws.send(JSON.stringify({ type: "voice", id }));
  }
  setPersona(text: string) {
    this.opts.persona = text;
    if (this.#ws?.readyState === 1) this.#ws.send(JSON.stringify({ type: "persona", text }));
  }
  setMuted(m: boolean) { this.muted = m; }

  /** Hang up here: stop the mic and the audio, tell the API. */
  async hangUp(reason = "hangup") {
    if (this.#ending) return;
    this.#ending = true;
    window.clearInterval(this.#beat);
    cancelAnimationFrame(this.#raf);
    try { this.#ws?.close(1000); } catch { /* already closed */ }
    try { this.#faceWs?.close(1000); } catch { /* already closed */ }
    this.#mic?.getTracks().forEach((t) => t.stop());
    this.#faceFlush();
    try { await this.ctx?.close(); } catch { /* already closed */ }
    this.on.state?.("closed");
    this.on.ended?.(reason);
    if (reason !== "lapsed") await this.client.endCall(this.callId).catch(() => {});
  }

  get seconds() { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }

  // ---- Voice worker -----------------------------------------------------------
  #connectVoice() {
    const ws = (this.#ws = new WebSocket(this.grant.ws_url, wsProtocols(this.#token)));
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return this.#onPcm(e.data as ArrayBuffer);
      this.#onJson(JSON.parse(e.data)).catch((err) => this.#fail(err));
    };
    ws.onerror = () => { if (!this.startedAt) this.#fail(new Error("Couldn't reach the call server.")); };
    ws.onclose = (e) => {
      if (this.#ending) return;
      if (e.code === CLOSE.replaced) return void this.hangUp("replaced");
      if (e.code === CLOSE.ended) return void this.hangUp("ended");
      if (this.startedAt) void this.hangUp("dropped");
    };
  }

  async #onJson(m: Record<string, unknown> & { type: string }) {
    switch (m.type) {
      case "hello": return this.#onHello(m as unknown as { tts: { sample_rate: number }; vram?: { total?: number }; vad?: { endpointMs?: number } });
      case "voice": if (this.startedAt) this.on.note?.(`Voice: ${m.name}. The first reply in a new voice can take a few seconds.`); return;
      case "state": {
        const s = m.state as CallState;
        if (s === "speaking") this.#firstChunkAt = performance.now();
        if (s === "listening") this.#reply = "";
        this.on.state?.(s);
        return;
      }
      case "partial": return this.on.partial?.(String(m.text ?? ""));
      case "final":
        this.#reply = "";
        return this.on.final?.(String(m.text ?? ""));
      case "reply_delta": {
        if (!this.#reply) this.replies++;
        this.#reply += String(m.text ?? "");
        this.lastReply = this.#reply;
        return this.on.replyDelta?.(String(m.text ?? ""));
      }
      case "flush":
        this.#player?.port.postMessage("flush");
        this.#faceFlush();
        return this.on.flush?.();
      case "turn": {
        const t = m as unknown as TurnStats;
        t.heard_ms = t.eos_to_first_audio_ms != null && this.#lastHeard != null ? t.eos_to_first_audio_ms + this.#lastHeard : null;
        this.#lastHeard = null;
        return this.on.turn?.(t);
      }
      case "error": return this.on.note?.(String(m.message), true);
    }
  }

  async #onHello(m: { tts: { sample_rate: number }; vram?: { total?: number }; vad?: { endpointMs?: number } }) {
    const ctx = this.ctx!;
    const ws = this.#ws!;
    if (this.opts.voiceId) ws.send(JSON.stringify({ type: "voice", id: this.opts.voiceId }));
    if (this.opts.persona) ws.send(JSON.stringify({ type: "persona", text: this.opts.persona }));
    const base = this.opts.worklets ?? `${import.meta.env.BASE_URL}live/`;
    await ctx.audioWorklet.addModule(`${base}capture-worklet.js`);
    await ctx.audioWorklet.addModule(`${base}playback-worklet.js`);
    // No microphone (refused, missing, or a browser that blocks it): the call
    // goes on as a typed one. Silence still flows so the server's clock and VAD carry on.
    let src: AudioNode;
    try {
      this.#mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      src = ctx.createMediaStreamSource(this.#mic);
    } catch (err) {
      const refused = (err as { name?: string })?.name === "NotAllowedError";
      this.noMic = true;
      this.on.note?.(refused ? "Microphone access was refused, so this is a typed call. Allow the mic and call again to talk." : "No microphone found, so this is a typed call.", true);
      const silence = ctx.createConstantSource();
      silence.offset.value = 0;
      silence.start();
      src = silence;
    }
    const capture = new AudioWorkletNode(ctx, "capture");
    capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      // Muted: keep frames coming, silent, so the server's clock and VAD carry on.
      const buf = this.muted ? new ArrayBuffer(e.data.byteLength) : e.data;
      if (ws.readyState === 1) ws.send(buf);
      const s = new Int16Array(buf);
      let peak = 0;
      for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
      this.micLevel = Math.max(peak / 32768, this.micLevel * 0.85);
    };
    src.connect(capture);
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 2048;
    src.connect(this.micAnalyser);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.#player = new AudioWorkletNode(ctx, "playback", { outputChannelCount: [1] });
    this.#player.port.onmessage = (e: MessageEvent<{ playing: boolean }>) => { if (!this.videoOn) this.#reportPlaying(e.data.playing); };
    this.#player.connect(this.analyser);
    this.#player.connect(ctx.destination);
    if (ctx.state !== "running") await ctx.resume();
    this.on.info?.(`TTS ${m.tts.sample_rate} Hz${m.vram?.total != null ? ` · engines +${m.vram.total} MiB` : ""}${m.vad?.endpointMs ? ` · endpoint ${m.vad.endpointMs} ms` : ""}`);
    this.startedAt = Date.now();
    this.on.state?.("idle");
    if (this.grant.face_ws_url) this.#connectFace();
    this.#raf = requestAnimationFrame(this.#tick);
  }

  #onPcm(buf: ArrayBuffer) {
    if (this.videoOn) return; // in a video call the face worker sends the audio back with its frames
    const i16 = new Int16Array(buf);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    this.#player?.port.postMessage(f32.buffer, [f32.buffer]);
  }

  async #heartbeat() {
    try {
      const b = await this.client.heartbeat(this.callId);
      this.#token = b.token;
    } catch (e) {
      if ((e as { status?: number }).status === 404) void this.hangUp("lapsed");
    }
  }

  #fail(err: unknown) {
    const e = err as { name?: string; message?: string };
    const msg = e?.name === "NotAllowedError" ? "Microphone access was refused. Allow it for this page and try again." : String(e?.message ?? err);
    this.on.note?.(msg, true);
    this.on.state?.("error");
    void this.hangUp("error");
  }

  // ---- Face worker ------------------------------------------------------------
  #connectFace() {
    if (this.#ending || !this.ctx || this.ctx.state === "closed" || !this.grant.face_ws_url) return;
    const s = (this.#faceWs = new WebSocket(this.grant.face_ws_url, wsProtocols(this.#token)));
    s.binaryType = "arraybuffer";
    s.onopen = () => this.#setVideo(true);
    s.onmessage = (e) => this.#onFace(e).catch(() => {});
    s.onclose = (e) => {
      this.#setVideo(false);
      if (this.#ending) return;
      if (e.code === CLOSE.busy) return this.on.note?.("The face is on another call. Carrying on as a voice call.", true);
      if (e.code === CLOSE.ended || e.code === CLOSE.replaced) return;
      window.setTimeout(() => this.#connectFace(), 4000);
    };
  }

  #setVideo(on: boolean) {
    if (this.videoOn === on) return;
    this.videoOn = on;
    this.#player?.port.postMessage("flush");
    this.#faceFlush();
    if (!on && this.#face.playing) { this.#face.playing = false; this.#reportPlaying(false); }
    this.on.video?.(on);
  }

  #faceFlush() {
    const f = this.#face;
    f.gen++;
    for (const s of f.sources) try { s.stop(); } catch { /* not started */ }
    for (const fr of f.frames) fr.bm.close();
    f.sources = []; f.frames = []; f.next = 0; f.speechFrom = Infinity; f.speechUntil = 0;
  }

  async #onFace(ev: MessageEvent) {
    if (typeof ev.data === "string") {
      const m = JSON.parse(ev.data);
      if (m.type === "flush") this.#faceFlush();
      if (m.type === "engine") this.on.note?.("Switching the face model. Voice keeps going; the face is back in about 20 s.");
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return;
    const data = ev.data as ArrayBuffer;
    const dv = new DataView(data), hl = dv.getUint32(0, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, hl))) as { samples: number; rate: number; fps: number; frames: number[]; kind?: string; cont?: boolean; start_i?: number };
    let off = 4 + hl;
    const pcm = new Int16Array(data.slice(off, off + h.samples * 2));
    off += h.samples * 2;
    const blobs = h.frames.map((n) => { const b = new Blob([new Uint8Array(data, off, n)], { type: "image/jpeg" }); off += n; return b; });
    const f = this.#face, gen = f.gen;
    const bitmaps = await Promise.all(blobs.map((b) => createImageBitmap(b)));
    if (gen !== f.gen || !this.videoOn) return bitmaps.forEach((b) => b.close());
    if (h.cont) {
      // More frames for the chunk whose audio already went out (Ditto's fast first frame).
      const first = h.start_i ?? 0;
      bitmaps.forEach((bm, i) => f.frames.push({ t: f.lastStart + (first + i) / h.fps, bm }));
      f.frames.sort((x, y) => x.t - y.t);
      return;
    }
    const buf = ctx.createBuffer(1, h.samples, h.rate), ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (this.analyser) src.connect(this.analyser);
    src.connect(ctx.destination);
    if (f.next < ctx.currentTime + 0.03) f.next = ctx.currentTime + 0.06;
    src.start(f.next);
    f.sources.push(src);
    src.onended = () => { const i = f.sources.indexOf(src); if (i >= 0) f.sources.splice(i, 1); };
    f.lastStart = f.next;
    bitmaps.forEach((bm, i) => f.frames.push({ t: f.next + i / h.fps, bm }));
    const end = f.next + h.samples / h.rate;
    if (h.kind === "speech") {
      if (f.speechUntil < f.next - 0.01) f.speechFrom = f.next;
      f.speechUntil = end;
    }
    f.next = end;
  }

  #tick = () => {
    this.#raf = requestAnimationFrame(this.#tick);
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || !this.videoOn) return;
    const f = this.#face;
    const t = ctx.currentTime - (ctx.outputLatency || 0);
    let fr: Frame | null = null;
    while (f.frames.length && f.frames[0].t <= t) { fr?.bm.close(); fr = f.frames.shift()!; }
    if (fr) {
      const c = this.#canvas;
      if (c) c.getContext("2d")?.drawImage(fr.bm, 0, 0, c.width, c.height);
      fr.bm.close();
    }
    const playing = ctx.currentTime >= f.speechFrom && ctx.currentTime < f.speechUntil;
    if (playing !== f.playing) { f.playing = playing; this.#reportPlaying(playing); }
  };

  #reportPlaying(playing: boolean) {
    if (this.#ws?.readyState === 1) this.#ws.send(JSON.stringify({ type: "playback", playing }));
    if (playing && this.#firstChunkAt !== null) {
      this.#lastHeard = Math.round(performance.now() - this.#firstChunkAt + (this.ctx?.outputLatency || 0) * 1000);
      this.#firstChunkAt = null;
    }
  }
}
