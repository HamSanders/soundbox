# Live voice worker

The process that holds a live spoken conversation: your speech in, a Mirli
voice out, with barge-in. Mirli's **Calls** page and the Discord bot
(`integrations/discord`) are its clients; the Mirli server hands them its
socket URL and a call token (see [../README.md](../README.md)).

```
mic (16 kHz s16le, 32 ms frames)
  -> WebSocket /ws
  -> Silero VAD (CPU)                     start of speech, barge-in, end of speech
  -> Nemotron ASR (audio.cpp)             utterance-so-far, every 480 ms and at the end
  -> LLM (llama-server, an OpenAI-compatible endpoint, or your Claude)
  -> sentence chunker                     first clause, then whole sentences
  -> VoxCPM2 TTS (audio.cpp, streamed)    PCM chunks at 48 kHz
  -> WebSocket /ws
```

It answers in a median of about half a second from the end of your speech to
its first audio on an RTX 5080, using about 8.5 GB of VRAM. The measurements
behind that, and why the pipeline is built the way it is, are in
[NOTES.md](NOTES.md).

## Run it

Needs Windows with an NVIDIA GPU, Node 22.12+, and `MIRLI_AUDIOCPP_BIN` (or
`SOUNDBOX_AUDIOCPP_BIN`) pointing at an audio.cpp CLI whose folder also holds
`audiocpp_server.exe`.

```bash
cd live/voice
```

```bash
npm install
```

```bash
npm run setup
```

```bash
npm start
```

`npm run setup` downloads about 4.3 GB into `~/.mirli-live/` (or
`MIRLI_LIVE_DIR`; an existing `~/.mirli-spike/` from the spike is used as is):
the TTS and STT weights, the VAD model and, on Windows, the CUDA 12 runtime for
llama-server. With the default local LLM it reads the Qwen3 1.7B weights and
the llama-server binary Mirli's Enhance feature installed under `~/.soundbox`.

Start-up takes 10 to 25 s: two `audiocpp_server` instances (TTS on 17651, STT
on 17652) and the LLM (17653). Everything listens on 127.0.0.1 only. When it
prints `live voice worker on ws://127.0.0.1:17650/ws`, open **Calls** in Mirli.

Start Mirli once before the worker the first time: the Mirli server writes the
shared call secret (`~/.mirli-live/call-secret`) and the worker only turns call
auth on if the secret exists when it starts.

## The brain: which LLM answers

| `LLM_PROVIDER` | What answers | Needs |
| --- | --- | --- |
| `local` (default) | Qwen3 1.7B in llama-server, on your GPU | Mirli's Enhance model installed, or `LLM_GGUF` + `LLAMA_SERVER_BIN` |
| `openai` | any OpenAI-compatible endpoint | `LLM_BASE_URL`, `LLM_MODEL`, optional `LLM_API_KEY` |
| `claude` | your own signed-in Claude Code (`claude`), no API key | Claude Code installed and signed in |

With `claude`, the worker keeps one `claude` process open per conversation
(stream-json in and out, no tools, no MCP servers, no CLAUDE.md, no session
saved) behind a loopback endpoint only it knows the key to. A new persona
restarts it; barge-in interrupts it. `CLAUDE_BRAIN_MODEL` (default `haiku`) and
`CLAUDE_BRAIN_EFFORT` (default `low`) pick the model; `CLAUDE_BIN` points at
the executable if it isn't found. Speculative replies are off by default with
Claude, since each one is a real turn. Expect 1 to 2 s to the first word once
warm and 3 to 4 s on the first turn.

It runs on your Claude subscription, on your machine, for you. Letting other
people talk to it (say, a Discord channel) uses your subscription on their
behalf: check Anthropic's terms for your plan first, and restrict who it
listens to (`DISCORD_ALLOWED_USERS` in the bot).

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `MIRLI_LIVE_PORT` | `17650` | The worker's port (`SPIKE_PORT` still works). The Mirli server finds it at `MIRLI_CALL_VOICE_URL`. |
| `MIRLI_LIVE_DIR` | `~/.mirli-live` | Models and engine binaries (`SPIKE_DIR` still works). |
| `MIRLI_CALL_AUTH` | on | `off` accepts any socket, as the spike did. Only for local experiments. |
| `MIRLI_CALL_SECRET` | the shared file | Overrides `~/.mirli-live/call-secret` (`MIRLI_CALL_SECRET_FILE` moves the file). |
| `MIRLI_ALLOWED_ORIGINS` | any | Comma-separated browser origins allowed to connect. Clients without an `Origin` (the Discord bot) still need a token. |
| `LLM_PROVIDER`, `LLM_*`, `CLAUDE_BRAIN_*` | `local` | See above. |
| `LLM_GPU_LAYERS` | `99` | llama-server layers on the GPU; `0` runs the LLM on the CPU. |
| `SPIKE_VOICE_REF` | unset | A WAV to clone when the call picks no voice. Unset uses VoxCPM2's default voice, held steady for the call (see Voices). |
| `VAD_ENDPOINT_MS` | `400` | Trailing silence that ends your turn. |
| `VAD_SPECULATE_MS` | `160` (`0` with Claude) | Silence after which a reply starts speculatively. |
| `VAD_BARGE_FRAMES` | `6` | 32 ms speech frames needed to interrupt (192 ms). |
| `STT_PARTIAL_MS` | `480` | How often the live transcript is refreshed while you talk. |

## Voices

`GET /voices` lists your saved Mirli voices, read-only from Mirli's database
(the clip under `<data dir>/sounds/`). VoxCPM2 clones each from its clip, so a
voice made on another model works here but sounds like VoxCPM2's take on it.
A preset voice (a model's built-in speaker) has no clip; Mirli's character
editor can make one into a clone voice (**Make a call voice from a preset**).
The worker only accepts ids from that list, never a file path.

A call with no voice (no `voice` control and no `SPIKE_VOICE_REF`) still keeps
one voice. VoxCPM2 with no clip invents a new speaker on every request, and a
reply is spoken one sentence per request, so the first finished sentence of the
call is saved under `<scratch>/voice-lock/` and cloned from then on. A new
persona or voice clears it (`lib/voice-lock.mjs`).

## The socket

`new WebSocket("ws://127.0.0.1:17650/ws", ["mirli.v1", "bearer." + token])`

- **In:** binary 16 kHz mono s16le, 512-sample (32 ms) frames, sent
  continuously (silence when muted). JSON controls:
  `{type:"persona", text}` (a new persona starts a fresh conversation),
  `{type:"voice", id}`, `{type:"playback", playing}` (whether the client is
  still playing the reply, for barge-in), `{type:"reset"}`, `{type:"text", text}`
  (a typed turn).
- **Out:** `hello` `{call, mic_rate, tts:{sample_rate, channels, chunk_samples}, vad, vram}`,
  then binary reply PCM (48 kHz mono s16le, sent faster than real time) and JSON
  events `state` (listening, thinking, speaking, idle), `partial`, `final`,
  `reply_delta`, `voice`, `flush` (barge-in: drop queued audio), `turn`
  (latency record), `error`.
- **Close codes:** `4000` replaced by a newer socket for the same call, `4001`
  the call was ended by the Mirli server.

Other endpoints: `GET /readyz`, `GET /voices`, `GET /metrics`, ws `/tap?call=<id>`
(that call's speech, for a face renderer), and `POST /internal/calls/:id/end`
(admin token; the Mirli server uses it on hang-up).

## Tests

```bash
npm test
```

Per-call routing and tokens (`test/calls.test.mjs`) and the Claude brain
(`test/claude-brain.test.mjs`), with stand-ins: no GPU, no `claude` needed.
`npm run fake` starts a worker with the real routing and a fake conversation (port 17750),
for testing clients on any machine.
