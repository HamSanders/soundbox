# Streaming speech

> Status: **phase 1 built and run end to end** (the HTTP route, the GPU lock,
> `supports.streaming`) on Supertonic 3, VoxCPM2 and OmniVoice. The WebSocket, the MCP tool and the
> UI are still design. Sections marked _(to verify)_ need a measurement
> before release.

## Measured (2026-11-05)

The audio.cpp Windows CUDA build in `~/tools/audio.cpp` (the one the dev
machine runs), RTX 5080. The same 26-word line each time; "first audio" is
when the first chunk reached the client, "last" when the final one did.

| Model | Cold, first audio | Warm, first audio | Warm, last chunk | Chunks | Audio |
| --- | --- | --- | --- | --- | --- |
| **VoxCPM2** (`audiocpp-voxcpm2`) | 5.95 s | **0.19 to 0.21 s** | 1.65 s | 48 x 160 ms | 7.7 s, 48 kHz |
| OmniVoice (`audiocpp-omnivoice`) | 5.6 s | 0.63 s | same | 1 | 8.8 s, 24 kHz |
| Supertonic 3 (`audiocpp-supertonic-3`) | 8.5 s | 0.10 to 0.14 s | same | 1 | 10.6 s, 44.1 kHz |

- **VoxCPM2 is the one that really streams**: the first 160 ms of speech
  arrives in about 200 ms and the rest follows at roughly 3x real time. Use
  it for chat agents and long lines.
- **OmniVoice and Supertonic send each line as one chunk.** Nothing arrives
  early, but Supertonic is so fast warm (10.6 s of speech in about 0.1 s)
  that it's the better pick for short game barks.
- **Cloned voice, VoxCPM2:** works and streams (57 chunks). The first two
  reads with a new clip took 4.2 to 5.2 s to first audio, the third 0.17 s.
  _(to verify: what audio.cpp caches per reference clip.)_
- **Cloned voice, OmniVoice:** refused. audio.cpp needs the clip's
  transcript (`reference_text`), and Soundbox voices don't store one yet.
  This affects OmniVoice cloning everywhere, not just streaming.
- Cold times include loading both the offline and the streaming copy.
- A client hanging up mid-stream released the GPU lock; the next request
  took 0.47 s.
- `supports.streaming` came back true for all three from the build's
  `model_specs`, and `save: true` wrote a library sound.

**What this build actually does** (and the code now handles):

- `/v1/tasks/stream` ignores `stream_format: "sse"` and answers with one
  `{ events, result }` JSON body once the run is over, so it can't stream.
  `/v1/audio/speech` with `stream_format: "sse"` does stream. Soundbox uses
  the speech route, and falls back to the task route only for the first
  stream of a model, because the speech route's PCM deltas carry no sample
  rate and the task route's WAVs do. The rate is remembered per model after
  that (an ordinary `/api/speak` read also records it). The catalogue's
  `sample_rate` was wrong for both VoxCPM2 (listed 44.1 kHz, really 48) and
  OmniVoice (really 24), so it isn't used for this.
- Audio can come in `named_audio_outputs[].audio` rather than `audio`.
- **Per-family request options go in `options`, not `request_options`.**
  audio.cpp ignored `request_options`, so before this branch every delivery
  knob (exaggeration, temperature and so on) was silently dropped whenever a
  model ran resident in the server. Fixed for generate, speak, convert and
  the stream. It showed up here because VoxCPM2 refuses to stream unless
  `retry_badcase=false` reaches it; Soundbox now sets that for VoxCPM2
  streams.

Today `POST /api/speak` is a job: you submit a script, poll or watch
`/api/jobs/{id}`, and get a finished WAV in the library. That's right for
voiceovers and stories. It's wrong for anything conversational. A game NPC
or a chat agent wants the first syllable out in a few hundred milliseconds,
while the rest of the sentence is still being made, and usually doesn't want a
library entry for every line at all.

Streaming adds that second mode: **text in, audio chunks out, as they're made.**

## Who it's for

- **Game TTS.** NPC barks and dialogue generated at runtime (Godot plugin,
  Unity/Unreal over HTTP). Needs low first-audio latency and raw PCM a game
  audio engine can push into a buffer.
- **Chat agents.** An LLM writes its reply token by token; the agent wants to
  speak each sentence as soon as it's complete, not after the whole reply.
- **The UI.** A "Play as it generates" preview in the Speak panel, so you
  hear a line before committing to it.

## What already exists underneath

The `audiocpp_server` Soundbox already runs (see
[`server/src/models/audiocppRuntime.ts`](../server/src/models/audiocppRuntime.ts))
streams natively. Upstream exposes:

| Upstream route | What it does |
| --- | --- |
| `POST /v1/audio/speech` with `stream_format: "sse"` | OpenAI-shaped SSE: `speech.audio.delta` (base64 PCM) … `speech.audio.done`, `data: [DONE]` |
| `POST /v1/audio/speech` with `stream_format: "audio"`, `response_format: "pcm"` | raw PCM over chunked transfer encoding |
| `POST /v1/tasks/stream` | generic streaming run; SSE events carry a WAV per event plus `is_final` |

Only families whose session implements the streaming run mode can do it.
audio.cpp ships `model_specs/<family>.json` beside its binaries, and each
lists its `modes`; Soundbox reads that folder and sets `supports.streaming`
from it (`server/src/models/audiocppModes.ts`), so the flag follows whatever
build is installed, including your own via `SOUNDBOX_AUDIOCPP_BIN`.

In the bundled **audio.cpp 0.6.1**, the TTS families that list `streaming`
and that the Soundbox catalogue carries are:

| Model id | Family |
| --- | --- |
| `audiocpp-supertonic-3` | `supertonic` |
| `audiocpp-voxcpm2` | `voxcpm2` |
| `audiocpp-omnivoice` | `omnivoice` |
| `audiocpp-neutts-2e` | `neutts` |
| `audiocpp-dots-tts-*` | `dots_tts` |
| `audiocpp-confucius4-tts` | `confucius4_tts` |

Kokoro, Chatterbox, PocketTTS, IndexTTS2, Irodori and VibeVoice do **not**
stream in 0.6.1. VoxCPM2 also needs `retry_badcase=false` when streaming
_(to verify whether Soundbox should set that automatically)_.

audio.cpp fixes a model entry's run mode at load time, so a streamed read
loads a second resident copy of the weights (`<id>::stream`) next to the
offline one. Both are held until the model unloads: plan on **twice the
model's memory** while you use both `/api/speak` and the stream.

So most of the work is in Soundbox's own layer: a route, a capability flag,
voice resolution, cancellation, and the clients.

## Design principles

1. **Not a job.** A stream is a connection, not a queued job with progress.
   It doesn't appear in `/api/jobs`, and dropping the connection cancels it.
2. **Nothing saved unless asked.** Conversational audio is disposable. Pass
   `save: true` to also write the joined result into the library as an
   ordinary `Sound` once the stream finishes.
3. **Same inputs as `/api/speak`.** Same `model`, `voice_id`, `seed`,
   `request_options`. A voice you made for a story works in a stream with no
   changes.
4. **Two wire formats, one route.** SSE for browsers and agents (JSON,
   metadata, errors in-band); raw PCM for game engines (no parsing).
5. **Fall back honestly.** A model that can't stream returns `409` with a
   message saying so. We do not fake streaming by generating the whole line
   and then chunking it — that hides exactly the latency people are asking
   about. _(An opt-in `allow_buffered: true` could be added later.)_

## HTTP API

### `POST /api/speak/stream`

Body:

```json
{
  "model": "audiocpp-voxcpm2",
  "text": "Halt! Who goes there?",
  "voice_id": "guard-gruff",
  "format": "sse",
  "seed": 7,
  "request_options": { "temperature": "0.7" },
  "save": false,
  "name": "Guard bark",
  "session_id": null,
  "project_id": null
}
```

| Field | Default | Notes |
| --- | --- | --- |
| `model` | required | must report `supports.streaming: true` |
| `text` | required | one utterance. For multi-line scripts use `/api/speak` or the socket below |
| `voice_id` | model default | saved voice (built-in or clone), same as `/api/speak` |
| `format` | `"sse"` | `"sse"` or `"pcm"` |
| `save` | `false` | write the finished audio to the library (not normalised, so it sounds like what played) |
| `steps`, `cfg`, `request_options`, `name`, `tags`, `project_id` | | as `/api/speak` |

Not accepted: multi-line scripts (one request is one utterance) and
`load_options` (a weights variant is chosen at load time; the request gets
`409`). Output is at the model's own sample rate; resampling chunk by chunk
would click at the joins, so it isn't offered.

**`format: "sse"`** — `Content-Type: text/event-stream`:

```text
event: start
data: {"stream_id":"…","model":"audiocpp-voxcpm2","sample_rate":24000,"channels":1,"encoding":"pcm_s16le"}

event: audio
data: {"seq":0,"pcm":"<base64 s16le>","frames":4800}

event: audio
data: {"seq":1,"pcm":"…","frames":4800}

event: done
data: {"duration_s":1.84,"ttft_ms":212,"model_ttft_ms":180,"sound_id":null}
```

`ttft_ms` is what the caller waited: from the request to the first chunk,
model load included. `model_ttft_ms` is audio.cpp's own figure, from the
start of the run. On failure mid-stream: `event: error` with
`{ "message": "…" }`, then the connection closes. `sound_id` is filled when
`save: true`. `pcm` is interleaved when `channels` is more than 1.

**`format: "pcm"`** — `Content-Type: audio/L16; rate=24000; channels=1`,
chunked, raw little-endian 16-bit PCM and nothing else. The format is in the
headers (`X-Soundbox-Sample-Rate`, `X-Soundbox-Channels`) so a client can set
up its buffer before the first byte. Errors before the first chunk are normal
JSON with a 4xx/5xx status; an error after audio has started just closes the
stream (there's no in-band channel), and is logged.

**Cancel:** close the connection. Because audio.cpp has no per-request
cancel, Soundbox stops the audio.cpp process when a listener leaves
mid-stream (the same trade job cancel makes), so **the next request pays a
model reload**. _(to verify: whether aborting `/v1/tasks/stream` alone stops
the run, which would let us skip the kill.)_

**Errors before streaming starts:**

| Status | When |
| --- | --- |
| `400` | unknown model or voice, or not a TTS model (same as `/api/speak`) |
| `409` | `reason: "unsupported"`: the model can't stream on this build. `reason: "busy"`: a generation or another stream holds the GPU, with `retry_after_s` and `Retry-After` when there's an estimate |
| `422` | bad body |

### `GET /api/speak/socket` (WebSocket) — phase 2

For agents that produce text incrementally, and for barge-in. One socket,
many utterances:

```text
→ {"type":"config","model":"…","voice_id":"…","format":"pcm"}
→ {"type":"text","id":"u1","text":"Sure, I can help with that. ","flush":false}
→ {"type":"text","id":"u1","text":"Here's what I found.","flush":true}
← {"type":"start","id":"u1","sample_rate":24000}
← <binary frame: PCM>
← {"type":"done","id":"u1","ttft_ms":230}
→ {"type":"cancel","id":"u1"}        // user interrupted the agent
```

The server buffers `text` until a sentence boundary or `flush: true`, then
synthesises that sentence while more text arrives. Sentences queue in order.
`cancel` drops everything queued for that id. This is the piece that makes
"LLM tokens → speech" work without the client doing its own sentence split.

### Capability reporting

`GET /api/models` reports `supports.streaming: boolean` per model (built).
A build without `model_specs/` reports nothing as streaming.

## Concurrency

There is one GPU and one resident model. A stream takes the same lock a job
does. Rules:

- A stream request that arrives while a job is running gets `409` with
  `retry_after_s` — not queued. Games and agents would rather know now and
  say something else than wait behind a 30-second music render.
- A job submitted while a stream is running queues behind it, as jobs already
  do.
- Only one stream at a time: a second concurrent request gets `409 busy`. _(Parallel streams on
  one resident model depend on upstream batching; not in v1.)_
- Model swaps: streaming a model that isn't loaded loads it first, and that
  load counts toward `ttft_ms`. Clients that care should call
  `POST /api/models/{id}/load` up front.

## MCP

New tool:

- `soundbox.speak_stream(text, model?, voice_id?, save?)` → returns when done,
  with `{ duration_s, ttft_ms, sound_id? }`.

MCP tool results aren't a streaming audio channel, so this tool is mainly for
agents that **play audio on the Soundbox machine** (`play: true` routes the
stream to the default output device server-side) or that want a saved
`sound_id` with lower total latency. Agents that need the audio bytes as they
arrive should use the HTTP route directly. The MCP doc will say so plainly
rather than pretend otherwise.

## UI

- **Speak panel:** when the selected model streams, the Generate button gets
  a companion **Preview** (▶) that plays as it generates through Web Audio
  (`AudioWorklet` fed from the SSE stream). Preview doesn't save; a "Keep"
  button after it finishes saves what you heard (same seed, `save: true`
  re-run, or keep the buffered PCM — _decide in implementation_).
- **Model picker:** a small "streams" badge on models with
  `supports.streaming`.
- **Voice page:** "Try this voice" uses streaming when available, so
  auditioning voices stops being a wait.
- **Settings → API:** the endpoint and a copy-paste `curl` for streaming, next
  to the existing API key / port info.

Out of scope for the UI: a live conversation mode. That's what the socket is
for, from other apps.

## Client examples (ship with the docs)

**curl**

```bash
curl -N http://127.0.0.1:7777/api/speak/stream \
  -H 'Content-Type: application/json' \
  -d '{"model":"audiocpp-voxcpm2","text":"Stream this.","format":"sse"}'
```

**Browser / Electron** — `fetch` + `ReadableStream`, parse SSE, push PCM into
an `AudioWorkletNode` ring buffer.

**Python agent** — `httpx.stream(...)`, `sounddevice.RawOutputStream` with
`format: "pcm"`.

**Godot** — `HTTPClient` polling chunks into an `AudioStreamGenerator`
playback. Fits the existing Godot editor plugin (`integrations/`).

Each example goes in `docs/streaming-examples/` and is run against a real
server before release — none get published untested.

## Implementation plan

Steps 1 to 4 are built (`server/src/models/audiocppRuntime.ts` `streamTask`,
`AudioCppModel.speakStream`, `JobManager.acquireExclusive`,
`server/src/routes/speakStream.ts`, `server/test/speakStream.test.ts`).

1. **Runtime:** `AudioCppRuntime.stream(model, body, signal)` →
   `AsyncIterable<Float32Array>` over upstream `/v1/audio/speech`
   SSE. Detect support from the binary; cache per binary path.
2. **Model layer:** `AudioCppModel.speakStream(text, opts)` sharing voice
   and request-option resolution with `speak()` (factor it out, don't
   copy). `supports.streaming` per family in the catalogue.
3. **Route:** `POST /api/speak/stream` in `server/src/routes/`, SSE + PCM
   writers, abort on `request.raw.on("close")`, GPU lock, optional save
   through the existing `dsp.processAndWrite` path.
4. **Tests:** fake runtime yielding chunks; assert SSE framing, PCM headers,
   cancel-on-disconnect releases the lock, 409 for non-streaming models.
5. **UI:** Preview button + worklet player; model badge.
6. **MCP tool**, **docs** (this page → user-facing; `API.md` + `ENDPOINTS.md`
   + `MCP.md` entries), **CHANGELOG**.
7. **Phase 2:** WebSocket with sentence buffering and barge-in.

## Open questions

- Whether the first stream of a model can skip the task-route round trip
  (for example by reading the rate from `/v1/models` if a later build
  reports it).
- The catalogue: VoxCPM2 and OmniVoice clone in audio.cpp but aren't marked
  `supports.voice_reference`, so Soundbox won't attach a clip to them made
  for that model, and both list the wrong `sample_rate`.

- Which bundled TTS families actually stream in our shipped binary, and their
  measured `ttft_ms` on a mid-range GPU and on CPU.
- Whether a client abort upstream stops cleanly or needs the kill-and-reload.
- Default chunk size: upstream's, or re-chunk to ~100 ms for steady game
  playback.
- Auth: streaming inherits the existing API rules in `API.md` (localhost by
  default); confirm nothing extra is needed for the socket's `Origin` checks.
