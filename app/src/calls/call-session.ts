/**
 * One live voice call, outside React: microphone, the voice worker's
 * WebSocket and audio playback. Ported from the spike's call pages
 * (spikes/realtime-voice/public/voice.html).
 *
 * `start()` must run inside a click handler: Chrome keeps an AudioContext made
 * outside a user gesture suspended, and then nothing is captured.
 */

import { type CallCharacter, type CallGrant, type CallsClient, wsProtocols } from "./live-client";
// Served as files, never inlined as data: URLs (a script-src 'self' CSP, as in the desktop app, refuses those).
import captureWorklet from "./worklets/capture-worklet.js?url&no-inline";
import playbackWorklet from "./worklets/playback-worklet.js?url&no-inline";

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
  /** Notes for the log: voice changed, errors. */
  note?: (text: string, isError?: boolean) => void;
  info?: (text: string) => void;
  /** Someone else is on the call now (a mid-call switch). */
  character?: (c: CallCharacter) => void;
  /** The call is over (hung up here, ended by the server, or lapsed). */
  ended?: (reason: string) => void;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
/** Close codes the worker uses (4000-4999 are ours). */
const CLOSE = { replaced: 4000, ended: 4001 } as const;

export class CallSession {
  ctx: AudioContext | null = null;
  /** The reply's voice, for the pen line. */
  analyser: AnalyserNode | null = null;
  /** The caller's mic, for the pen line. */
  micAnalyser: AnalyserNode | null = null;
  micLevel = 0;
  muted = false;
  /** The mic could not be opened: the call is typed only. */
  noMic = false;
  startedAt = 0;
  replies = 0;
  lastReply = "";

  #ws: WebSocket | null = null;
  #player: AudioWorkletNode | null = null;
  #mic: MediaStream | null = null;
  #token: string;
  #beat: number | undefined;
  #ending = false;
  #firstChunkAt: number | null = null;
  #lastHeard: number | null = null;
  #reply = "";

  client: CallsClient;
  grant: CallGrant;
  opts: { voiceId?: string; persona?: string };
  on: CallHandlers;

  constructor(client: CallsClient, grant: CallGrant, opts: CallSession["opts"], on: CallHandlers = {}) {
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

  /**
   * Put someone else on the call: the API records the switch and hands back
   * their persona and voice, which go out on the socket (the worker starts a
   * fresh conversation). Anything still playing is cut.
   */
  async switchCharacter(character: string): Promise<CallCharacter> {
    const c = await this.client.setCharacter(this.callId, character);
    this.grant = { ...this.grant, character: c.character, name: c.name, persona: c.persona, voice_id: c.voice_id };
    this.#player?.port.postMessage("flush");
    this.#reply = "";
    this.setPersona(c.persona);
    if (c.voice_id) this.setVoice(c.voice_id);
    this.on.character?.(c);
    return c;
  }

  /** Hang up here: stop the mic and the audio, tell the API. */
  async hangUp(reason = "hangup") {
    if (this.#ending) return;
    this.#ending = true;
    window.clearInterval(this.#beat);
    try { this.#ws?.close(1000); } catch { /* already closed */ }
    this.#mic?.getTracks().forEach((t) => t.stop());
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
    ws.onerror = () => { if (!this.startedAt) this.#fail(new Error("Couldn't reach the live voice worker.")); };
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
    await ctx.audioWorklet.addModule(captureWorklet);
    await ctx.audioWorklet.addModule(playbackWorklet);
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
    this.#player.port.onmessage = (e: MessageEvent<{ playing: boolean }>) => this.#reportPlaying(e.data.playing);
    this.#player.connect(this.analyser);
    this.#player.connect(ctx.destination);
    if (ctx.state !== "running") await ctx.resume();
    this.on.info?.(`TTS ${m.tts.sample_rate} Hz${m.vram?.total != null ? ` · engines +${m.vram.total} MiB` : ""}${m.vad?.endpointMs ? ` · endpoint ${m.vad.endpointMs} ms` : ""}`);
    this.startedAt = Date.now();
    this.on.state?.("idle");
  }

  #onPcm(buf: ArrayBuffer) {
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

  /** Tell the worker when speech is actually audible (it times barge-in from this), and time "heard". */
  #reportPlaying(playing: boolean) {
    if (this.#ws?.readyState === 1) this.#ws.send(JSON.stringify({ type: "playback", playing }));
    if (playing && this.#firstChunkAt !== null) {
      this.#lastHeard = Math.round(performance.now() - this.#firstChunkAt + (this.ctx?.outputLatency || 0) * 1000);
      this.#firstChunkAt = null;
    }
  }
}
