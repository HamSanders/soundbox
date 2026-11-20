// One browser connection's conversation: mic frames in, VAD, speech-to-text
// over the growing utterance, then LLM -> sentence chunks -> streaming TTS.
//
// The reply is *speculative*: it starts after `vad.speculateMs` of silence,
// which is shorter than the `vad.endpointMs` it takes to be sure the user has
// finished. Nothing the user could hear or see leaves until the endpoint
// confirms the turn; if they carry on talking the work is thrown away. That
// hides most of the pipeline's own latency inside the endpoint wait.

import { config } from "./config.mjs";
import { chat, SentenceChunker } from "./llm.mjs";
import { transcribe, Utterance } from "./stt.mjs";
import { speak } from "./tts.mjs";
import { Vad, VAD_FRAME } from "./vad.mjs";

const now = () => performance.now();
const ms = (a, b) => (a == null || b == null ? null : Math.round(b - a));
/** A transcript reduced to its words, for "did they say the same thing?" */
const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

export class Conversation {
  #send;
  #sendPcm;
  #deps;
  #vad;
  #chain = Promise.resolve();
  #pending = new Int16Array(0);
  #preroll = [];
  #run = 0;
  #userSpeaking = false;
  #lastVoiceAt = 0;
  #utt = null;
  #turn = null;
  #spec = null; // the reply being prepared for the current, still-open turn
  #partialBusy = false;
  #partialAt = 0;
  #active = null; // the confirmed reply in progress
  #clientPlaying = false;
  #history = [];
  #turnSeq = 0;

  /**
   * @param deps {{ tts, stt, llm, gpu, tap, log: (turn: object) => void }}
   * @param send (json) => void   @param sendPcm (Buffer) => void
   */
  constructor(deps, send, sendPcm) {
    this.#deps = deps;
    this.#send = send;
    this.#sendPcm = sendPcm;
  }

  async init() {
    this.#vad = await Vad.create();
  }

  /** Mic audio: s16le mono 16 kHz, any length. Order is preserved. */
  onMic(buf) {
    // Copy: a WebSocket payload can sit at an odd offset in its backing buffer,
    // which an Int16Array view refuses.
    const n = Math.floor(buf.byteLength / 2) * 2;
    const inc = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n));
    const all = new Int16Array(this.#pending.length + inc.length);
    all.set(this.#pending);
    all.set(inc, this.#pending.length);
    let off = 0;
    for (; off + VAD_FRAME <= all.length; off += VAD_FRAME) {
      const frame = all.slice(off, off + VAD_FRAME);
      this.#chain = this.#chain.then(() => this.#frame(frame)).catch((e) => this.#error(e));
    }
    this.#pending = all.slice(off);
  }

  onControl(msg) {
    if (msg.type === "playback") this.#clientPlaying = !!msg.playing;
    else if (msg.type === "reset") this.#history = [];
  }

  close() {
    this.#active?.ac.abort();
    this.#spec?.ac.abort();
  }

  #assistantActive() {
    return this.#active !== null || this.#clientPlaying;
  }

  async #frame(frame) {
    const p = await this.#vad.process(frame);
    const t = now();
    const speech = p >= config.vad.threshold;
    if (!this.#userSpeaking) {
      this.#preroll.push(frame);
      if (this.#preroll.length > config.vad.prerollFrames) this.#preroll.shift();
      this.#run = speech ? this.#run + 1 : 0;
      const need = this.#assistantActive() ? config.vad.bargeFrames : config.vad.startFrames;
      if (this.#run >= need) this.#startUserTurn(t);
      return;
    }
    this.#utt.push(frame);
    const turn = this.#turn;
    if (speech) {
      this.#lastVoiceAt = t;
      if (this.#spec) {
        // They were only pausing. Drop the reply we had started on.
        this.#spec.ac.abort();
        this.#spec = null;
        turn.speculationsDropped++;
      }
      this.#maybePartial(t);
      return;
    }
    const silence = t - this.#lastVoiceAt;
    if (silence >= config.vad.endpointMs) return this.#endUserTurn(t);
    if (!this.#spec && config.vad.speculateMs > 0 && silence >= config.vad.speculateMs) {
      this.#spec = this.#beginReply(turn, this.#utt.pcm(), t);
    }
  }

  #startUserTurn(t) {
    if (this.#assistantActive()) this.#bargeIn(t);
    const turn = { id: ++this.#turnSeq, t: { speechStart: t }, bargedIn: false, speculationsDropped: 0 };
    this.#turn = turn;
    this.#deps.gpu.takePeak();
    this.#utt = new Utterance();
    for (const f of this.#preroll) this.#utt.push(f);
    this.#preroll = [];
    this.#userSpeaking = true;
    this.#lastVoiceAt = t;
    this.#partialAt = t;
    this.#send({ type: "state", state: "listening", turn: turn.id });
  }

  /** While they talk, re-decode what we have every so often for a live transcript. */
  #maybePartial(t) {
    if (this.#partialBusy || config.partialMs <= 0 || t - this.#partialAt < config.partialMs) return;
    const turn = this.#turn;
    this.#partialBusy = true;
    this.#partialAt = t;
    transcribe(this.#deps.stt, this.#utt.pcm())
      .then(({ text }) => {
        if (!text || this.#turn !== turn || !this.#userSpeaking) return;
        turn.t.firstPartial ??= now();
        this.#send({ type: "partial", turn: turn.id, text });
      })
      .catch(() => {})
      .finally(() => (this.#partialBusy = false));
  }

  #endUserTurn(t) {
    const turn = this.#turn;
    const pcm = this.#utt.pcm();
    const spec = this.#spec;
    this.#userSpeaking = false;
    this.#run = 0;
    this.#spec = null;
    this.#utt = null;
    turn.t.eos = this.#lastVoiceAt; // the last frame the VAD heard speech in
    turn.t.endpoint = t; // when trailing silence let us act
    this.#send({ type: "state", state: "thinking", turn: turn.id });
    if (!spec) {
      this.#active = this.#beginReply(turn, pcm, t);
      return this.#active.confirm();
    }
    // The speculation heard the utterance minus its last moments of
    // "silence", which can still hold a quiet final syllable. Decode the whole
    // thing (about 20 ms) and only let the speculative reply out if the words
    // are the same; otherwise answer what was really said.
    this.#active = spec;
    turn.speculative = true;
    Promise.all([transcribe(this.#deps.stt, pcm), spec.heard])
      .then(([full, heard]) => {
        turn.t.confirmed = now();
        if (spec.ac.signal.aborted) {
          if (this.#active === spec) this.#active = null;
          return this.#finish(Object.assign(turn, { discarded: "interrupted before the reply started" }));
        }
        if (words(full.text) === words(heard)) return spec.confirm();
        spec.ac.abort();
        turn.speculative = false;
        turn.speculationsDropped++;
        this.#active = this.#beginReply(turn, pcm, now(), full.text);
        this.#active.confirm();
      })
      .catch((e) => this.#error(e));
  }

  /** The user spoke over the assistant: stop making audio and tell everyone to drop theirs. */
  #bargeIn(t) {
    const a = this.#active;
    if (a) {
      a.turn.bargedIn = true;
      a.turn.t.bargeIn = t;
      a.ac.abort();
    }
    this.#clientPlaying = false;
    this.#send({ type: "flush" });
    this.#deps.tap.flush();
  }

  /**
   * Start working on a reply to `pcm`. Returns a handle; until `confirm()` is
   * called everything it would send is held back, and `ac.abort()` discards it.
   */
  #beginReply(turn, pcm, startedAt, knownText = null) {
    const ac = new AbortController();
    const held = [];
    let confirmed = false;
    const emit = (fn) => (confirmed ? fn() : held.push(fn));
    let heardResolve;
    const reply = {
      turn,
      ac,
      audioSent: false,
      heard: new Promise((r) => (heardResolve = r)), // the transcript this reply answers
      confirm: () => {
        confirmed = true;
        for (const fn of held.splice(0)) fn();
      },
    };
    // Timings belong to this attempt; they are copied to the turn if it wins.
    const t = { replyStart: startedAt };
    const { tts, stt, llm, tap } = this.#deps;
    let text = "";
    let userText = "";

    const run = async () => {
      const heard = knownText === null ? await transcribe(stt, pcm, ac.signal) : { text: knownText, wallMs: null };
      t.transcript = now();
      t.sttWallMs = heard.wallMs;
      userText = heard.text;
      heardResolve(userText);
      emit(() => this.#send({ type: "final", turn: turn.id, text: userText }));
      if (!userText) return;
      const history = [...this.#history, { role: "user", content: userText }];

      const pieces = [];
      let llmDone = false;
      let wake = () => {};
      let utterance = 0;
      const ttsLoop = (async () => {
        for (;;) {
          while (!pieces.length) {
            if (llmDone) return;
            await new Promise((r) => (wake = r));
          }
          const piece = pieces.shift();
          const n = utterance++;
          t.ttsRequest ??= now();
          let first = true;
          for await (const ev of speak(tts, piece, ac.signal)) {
            if (!ev.pcm) continue;
            t.firstAudioReady ??= now();
            const isFirst = first;
            first = false;
            emit(() => {
              if (ac.signal.aborted) return;
              if (isFirst) {
                if (t.firstAudio == null) {
                  t.firstAudio = now();
                  this.#send({ type: "state", state: "speaking", turn: turn.id });
                }
                tap.start({ turn: turn.id, utterance: n, text: piece });
              }
              reply.audioSent = true;
              this.#sendPcm(ev.pcm);
              tap.pcm(ev.pcm);
            });
          }
          if (!first) emit(() => ac.signal.aborted || tap.end({ turn: turn.id, utterance: n }));
        }
      })();
      ttsLoop.catch(() => {});

      const chunker = new SentenceChunker();
      try {
        for await (const delta of chat(llm, history, ac.signal)) {
          t.firstToken ??= now();
          text += delta;
          emit(() => this.#send({ type: "reply_delta", turn: turn.id, text: delta }));
          const done = chunker.push(delta);
          if (done.length) {
            t.firstPiece ??= now();
            pieces.push(...done);
            wake();
          }
        }
        pieces.push(...chunker.flush());
      } finally {
        t.llmDone = now();
        llmDone = true;
        wake();
      }
      await ttsLoop;
      t.audioDone = now();
    };

    run()
      .catch((e) => {
        heardResolve("");
        if (!ac.signal.aborted) this.#error(e);
      })
      .finally(() => {
        if (!confirmed) return; // a dropped speculation leaves no trace
        if (this.#active === reply) this.#active = null;
        Object.assign(turn.t, t);
        turn.user = userText;
        turn.reply = text.trim();
        if (!userText) turn.discarded = "empty transcript";
        else {
          this.#history.push({ role: "user", content: userText });
          // Simplification: after a barge-in this stores what was generated,
          // not what was actually heard before playback stopped.
          if (turn.reply) this.#history.push({ role: "assistant", content: turn.reply });
        }
        this.#finish(turn);
      });
    return reply;
  }

  #finish(turn) {
    const t = turn.t;
    const record = {
      turn: turn.id,
      at: new Date().toISOString(),
      user: turn.user ?? "",
      reply: turn.reply ?? "",
      barged_in: turn.bargedIn,
      discarded: turn.discarded ?? null,
      speculative: turn.speculative ?? false,
      speculations_dropped: turn.speculationsDropped,
      speech_ms: ms(t.speechStart, t.eos),
      speech_start_to_first_partial_ms: ms(t.speechStart, t.firstPartial),
      endpoint_wait_ms: ms(t.eos, t.endpoint),
      // From end of speech (EOS): what the person waiting actually feels.
      eos_to_transcript_ms: ms(t.eos, t.transcript),
      eos_to_first_token_ms: ms(t.eos, t.firstToken),
      eos_to_first_audio_ms: ms(t.eos, t.firstAudio),
      // Stage by stage.
      eos_to_reply_start_ms: ms(t.eos, t.replyStart),
      stt_ms: ms(t.replyStart, t.transcript),
      stt_model_wall_ms: t.sttWallMs == null ? null : Math.round(t.sttWallMs),
      transcript_to_first_token_ms: ms(t.transcript, t.firstToken),
      first_token_to_first_piece_ms: ms(t.firstToken, t.firstPiece),
      tts_request_to_first_audio_ms: ms(t.ttsRequest, t.firstAudioReady),
      // First audio was ready this long before (+) or after (-) the endpoint.
      audio_ready_before_endpoint_ms: ms(t.firstAudioReady, t.endpoint),
      // What checking the speculative transcript cost after the endpoint.
      endpoint_to_confirm_ms: ms(t.endpoint, t.confirmed),
      eos_to_audio_done_ms: ms(t.eos, t.audioDone),
      vram_peak_mib: this.#deps.gpu.takePeak(),
      target_ms: config.targetMs,
    };
    this.#deps.log(record);
    this.#send({ type: "turn", ...record });
    this.#send({ type: "state", state: "idle" });
  }

  #error(e) {
    console.error("[conversation]", e);
    this.#send({ type: "error", message: String(e?.message ?? e) });
  }
}
