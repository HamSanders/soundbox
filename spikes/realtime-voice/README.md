# Spike: real-time voice conversation

A local browser page where you talk into the mic and a Mirli voice answers,
with barge-in. Built to find out how close a pipeline (speech-to-text → LLM →
streaming TTS) gets to a 500 ms response on one RTX 5080, and what it costs in
VRAM. The face half of the idea lives in `spikes/realtime-face/`.

This is a spike. It is not wired into the app, the server or the build, it has
its own `package.json`, and it never writes to Mirli's data directory.

## Result in one paragraph

On this machine the loop answers in a **median of about 0.5 s from the end of
speech to the first audio** (507 ms with default settings, 476 ms with tighter
ones; 745 ms without the speculation trick), using **8.4 GB of VRAM at rest
and about 8.6 GB at peak**. Barge-in works: audio stops and none arrives
afterwards. The 500 ms target is met on roughly half the turns, not all of
them. Most numbers come from a scripted client playing synthesised speech
into the socket; a short real-microphone session afterwards gave a median of
485 ms (see "Real microphone test").

## How to run it

Needs Windows with an NVIDIA GPU, Node 22+, and `MIRLI_AUDIOCPP_BIN` (or the
old `SOUNDBOX_AUDIOCPP_BIN`) pointing at an audio.cpp CLI whose folder also
holds `audiocpp_server.exe`.

```bash
cd spikes/realtime-voice
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

Then open <http://127.0.0.1:17650>, press **Start**, allow the microphone and
talk. Use headphones: with speakers the assistant can hear itself and
interrupt itself.

`npm run setup` downloads about 4.3 GB into `~/.mirli-spike/` (override with
`SPIKE_DIR`): the TTS and STT weights, the VAD model and, on Windows, the CUDA
12 runtime DLLs for llama-server. The LLM is not downloaded. By default the
spike reads the Qwen3 1.7B weights and the llama-server binary that Mirli's own
Enhance feature installed under `~/.soundbox`; it only reads them.

Start-up takes 10 to 25 s and loads three engines as child processes: two
`audiocpp_server` instances (TTS on 17651, STT on 17652) and `llama-server`
(17653). Everything listens on 127.0.0.1 only.

### Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `LLM_PROVIDER` | `local` | `local` starts llama-server on `LLM_GGUF`. `openai` uses any OpenAI-compatible endpoint. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | unset | For `LLM_PROVIDER=openai`. The key is only ever read from the environment. |
| `LLM_GGUF`, `LLAMA_SERVER_BIN` | Mirli's Qwen3 1.7B and llama-server | Local model and binary. |
| `SPIKE_VOICE_REF` | unset | Path to a WAV to clone by default. Unset uses VoxCPM2's seeded default voice. The page's **Voice** menu overrides it. |
| `VAD_ENDPOINT_MS` | `400` | Trailing silence that ends your turn. |
| `VAD_SPECULATE_MS` | `160` | Silence after which the reply is started speculatively. `0` turns that off. |
| `VAD_BARGE_FRAMES` | `6` | 32 ms speech frames needed to interrupt (192 ms). |
| `STT_PARTIAL_MS` | `480` | How often the live transcript is refreshed while you talk. |
| `SPIKE_PORT` | `17650` | The page and the PCM tap. |

Only the local LLM path was run. `LLM_PROVIDER=openai` is written but
untested.

### Picking a voice

The **Voice** menu on the page lists your saved Mirli clone voices, read
read-only from Mirli's database (`voices` table, clip at
`<data dir>/sounds/<filename>`). VoxCPM2 clones each from its reference clip.
You can switch mid-conversation; the next reply uses the new voice. The server
only accepts ids from that list, never a file path.

Measured with the "Brit" voice (a 4.2 s clip): first audio 426 ms on the first
read with that clip, then 157 to 176 ms. Earlier Mirli measurements reported 4
to 5 s for the first reads with a new clip; on this build it is under half a
second. A voice made on another model (Chatterbox, VibeVoice) still clones from
its clip here, but will sound like VoxCPM2's take on it.

## How it works

```
mic (browser AudioWorklet, 16 kHz s16, 32 ms frames)
  → WebSocket /ws
  → Silero VAD (CPU)                      start of speech, barge-in, end of speech
  → Nemotron ASR, offline pass            utterance-so-far, every 480 ms and at the end
  → Qwen3 1.7B (llama-server, streamed)   tokens
  → sentence chunker                      first clause, then whole sentences
  → VoxCPM2 (audio.cpp, streamed)         160 ms PCM chunks at 48 kHz
  → WebSocket /ws → AudioWorklet playback, and the PCM tap
```

Three things in there are not the obvious design, and each came from a
measurement:

1. **Speech-to-text is an offline pass, repeated, not a streaming session.**
   See "What surprised me" below.
2. **The reply is speculative.** After 160 ms of silence the server transcribes
   what it has and starts the LLM and the TTS, but holds back everything the
   user could see or hear. At 400 ms of silence the turn is confirmed: the
   whole utterance is decoded once more (about 20 ms) and, if the words match
   what the speculation heard, the held audio is released. If the user carries
   on talking, the work is thrown away. This is the DuplexCascade idea in its
   simplest form, and it hides about 240 ms of pipeline inside the wait.
3. **The first piece of a reply is a clause, not a sentence.** TTS starts on
   "That sounds tough," without waiting for the full stop.

Barge-in: while the assistant is generating or the page reports it is still
playing, 192 ms of detected speech aborts the LLM and TTS requests and sends
`flush`, which empties the browser's playback queue.

## Step 1: does Mirli's TTS stream, and how fast?

Mirli already has streaming TTS (`POST /api/speak/stream`,
`docs/STREAMING.md`), built on audio.cpp's `/v1/audio/speech` SSE route. Of the
families that stream in audio.cpp, VoxCPM2 is the one that sends audio chunk
by chunk; the spike calls the same audio.cpp route directly so that it does
not need Mirli's server or data directory.

Measured with `npm run bench:tts` (VoxCPM2 q8_0, warm, 5 runs per line,
`runs/tts-ttfa.json`):

| Line | Time to first audio | Whole line generated in | Audio made | Real-time factor |
| --- | --- | --- | --- | --- |
| 17 characters | 186 to 368 ms | 0.52 to 0.73 s | 1.76 s | 0.30 to 0.41 |
| 53 characters | 189 to 262 ms | 0.68 to 0.82 s | 2.72 s | 0.25 to 0.30 |
| 157 characters | 190 to 243 ms | 1.75 to 1.96 s | 8.16 s | 0.22 to 0.24 |

- Time to first audio is about **200 ms** and does not grow with the length of
  the line. Inside the conversation loop it measured 150 to 230 ms.
- Chunks are **7 680 samples (160 ms) at 48 kHz mono**, with at most 73 ms
  between chunks, so playback never starves.
- **Aborting a line mid-stream frees the model at once.** The next line's first
  audio came 223 ms after the abort. `docs/STREAMING.md` has an open question
  about whether a client abort needs the audio.cpp process killed; on this
  build it does not.
- Model load is about 5 s.

## Real microphone test (2026-11-20)

The owner talked to it through Chrome and a real microphone for about three
minutes (31 turns, default settings, `runs/turns.jsonl` is not committed) and
said it "works pretty well". From the server's log of those turns:

| | Median | 90th percentile | Range |
| --- | --- | --- | --- |
| End of speech → final transcript | 207 ms | 463 ms | 175 to 495 |
| End of speech → first LLM token | 237 ms | 501 ms | 203 to 527 |
| End of speech → first audio | **485 ms** | 724 ms | 457 to 876 |

- 18 of 31 turns at or under 500 ms, slightly better than the scripted runs.
- 13 speculative replies were thrown away because the speaker carried on after
  a pause, and the turn was answered at the endpoint instead (the 600 to
  800 ms turns). Real speech pauses mid-sentence more than the test clips do.
- Very short words ("One", "Either", "I") were heard fine but sometimes cut a
  sentence in two: a 400 ms pause ends the turn.
- The small LLM shows: it echoes the user ("All right, this is working pretty
  well." → the same sentence) and kept offering to count to a hundred.
- No barge-in was tried, so that still rests on the scripted test.
- Peak VRAM 9.9 GB (card total, with the desktop).

## Step 3: latency per turn

`npm run bench:turns` connects to the running server like the browser does and
plays six spoken questions, three rounds each (18 turns), at real-time pace
with room tone in between, then interrupts a long answer. The "user" speech is
made with the TTS itself. Every turn is also appended to `runs/turns.jsonl`
when you use the page, and shown in the table on it.

All times are milliseconds from **end of speech** (the last 32 ms frame the VAD
scored as speech), median with the 90th percentile in brackets. Target: 500.

| Setting | → final transcript | → first LLM token | → first audio byte | Turns at or under 500 ms |
| --- | --- | --- | --- | --- |
| No speculation (endpoint 400 ms) | 445 (538) | 480 (574) | **745** (870) | 0 of 18 |
| **Default** (speculate at 160 ms, endpoint 400 ms) | 226 (453) | 256 (494) | **507** (672) | 9 of 18 |
| Tighter (speculate at 96 ms, endpoint 300 ms) | 170 (199) | 233 (276) | **476** (563) | 11 of 18 |

Raw data: `runs/bench-no-speculation.json`, `runs/bench-default.json`,
`runs/bench-aggressive.json`.

Where the time goes in a default turn (medians):

| Stage | ms |
| --- | --- |
| Silence before the speculative reply starts (160 ms plus frame rounding) | 187 |
| Speech-to-text | 22 |
| LLM, request to first token | 31 |
| LLM, first token to first speakable clause | 61 |
| TTS, request to first audio | 176 |
| Confirming the transcript at the endpoint | 49 |

Other things the runs showed:

- **The first words of the transcript appear about 530 ms after you start
  speaking** and refresh every 480 ms.
- **Barge-in:** `flush` reached the client 544 to 574 ms after the interrupting
  clip started, and no audio arrived in the 250 ms after it. That figure is
  inflated by the test clip, whose first word the VAD scores below its
  threshold (see the limits below); the rule itself fires after 192 ms of
  detected speech.
- A measurement taken on the client side (last speech sample sent → first PCM
  received) agrees with the server's: 514 ms median against 507.
- An earlier run of the default setting had one turn at 4.8 s, all of it
  waiting for the LLM's first token after a dropped speculation. I could not
  reproduce it (ten abort-then-request trials all answered in under 100 ms)
  and it did not recur in the final 54 turns. Unexplained.
- The first version, with audio.cpp's streaming transcription route and no
  speculation, had a median of 867 ms (6 turns).

### VRAM

Whole-card readings from `nvidia-smi`, taken before and after each engine
loads. Windows does not report per-process VRAM, so these are deltas, and the
card was shared with the desktop and another `audiocpp_server` during the runs.

| Engine | Model | VRAM |
| --- | --- | --- |
| Speech-to-text | Nemotron 3.5 ASR 0.6B, q8_0, offline mode | 1.2 GB |
| TTS | VoxCPM2, q8_0, streaming mode | 4.6 GB |
| LLM | Qwen3 1.7B, Q8_0, llama-server | 2.5 GB |
| **All three at rest** | | **8.4 GB** |
| **Peak during a turn** | card total 10.0 GB, less the 1.4 GB in use before start | **8.6 GB** |

That leaves about 5 to 6 GB of the 16 GB for a face model once the desktop has
taken its share. Pointing the LLM at a hosted endpoint frees 2.5 GB. VoxCPM2
is the expensive part: 4.6 GB for a 3 GB weights file.

## Step 4: the PCM tap for a face renderer

The TTS output is fanned out as it is generated, on two transports carrying
the same bytes (checked with `bench/tap-check.mjs`: 234 chunks, byte counts
equal).

| | |
| --- | --- |
| Raw stream | `GET http://127.0.0.1:17650/tts.pcm`: a chunked response that never ends, PCM and nothing else. Headers: `Content-Type: audio/L16; rate=48000; channels=1`, `X-Sample-Rate`, `X-Channels`, `X-Encoding`. |
| With events | `ws://127.0.0.1:17650/tap`: binary frames are PCM, text frames are JSON events. |
| In process | `PcmTap` in `lib/tap.mjs` is an `EventEmitter`: `pcm`, `start`, `end`, `flush`. |
| Encoding | signed 16-bit little-endian, mono |
| Sample rate | 48 000 Hz (read from the model at start-up and sent in the `format` event) |
| Chunk size | 7 680 samples = 160 ms = 15 360 bytes. The last chunk of a sentence may be shorter. |

Events on the WebSocket:

```json
{"type":"format","sample_rate":48000,"channels":1,"encoding":"pcm_s16le","chunk_samples":7680}
{"type":"start","turn":3,"utterance":0,"text":"That sounds tough,","sample_index":412160,"server_ms":1795142113948}
{"type":"end","turn":3,"utterance":0,"sample_index":489600}
{"type":"flush","sample_index":1658880,"server_ms":1795142115635}
```

What a subscriber needs to know:

- **Audio arrives about four times faster than real time.** It is not paced.
  Count samples, or follow a playback clock; arrival time is not playback time.
- **`flush` means barge-in:** drop what is buffered and stop the mouth. Only the
  WebSocket carries it.
- There is no silence between sentences in the stream. `start` and `end` mark
  each one, and `start` carries its text.
- The page does not report its playback position, so a renderer cannot yet
  lock to what is being heard. That would be the next thing to add.

## Model licences

Read from each model's Hugging Face card on 2026-11-19.

| Part | Model | Licence | Commercial use |
| --- | --- | --- | --- |
| TTS | [openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2), GGUF from `audio-cpp/audio.cpp-gguf` | Apache-2.0 | Yes |
| Speech-to-text | [nvidia/nemotron-3.5-asr-streaming-0.6b](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), GGUF from the same repo | [OpenMDW-1.1](https://openmdw.ai/license/1-1/) | Yes, according to audio.cpp's `docs/model_licenses.md`. I read the card's licence tag, not the licence text. |
| LLM | [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) | Apache-2.0 | Yes |
| VAD | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) v5 | MIT | Yes |

Runtimes: audio.cpp (Apache-2.0), llama.cpp (MIT), onnxruntime-node (MIT), ws
(MIT). The CUDA runtime DLLs are NVIDIA's, redistributed in llama.cpp's own
release. None of these models is in Mirli's catalogue as verified: the
catalogue entry for VoxCPM2 still says its licence needs confirming.

## What surprised me, and what blocked

- **audio.cpp's streaming transcription does not stream on this build.**
  `/v1/audio/transcriptions/live` takes PCM while you talk, but a raw-socket
  test showed no transcript bytes until the request body ended: for 8.16 s of
  speech the first delta came 77 ms after the last audio byte, and a 3.5 s
  utterance took 235 to 360 ms to finish. The same model in offline mode
  transcribes 1.5 s in about 14 ms and 8 s in about 40 ms, and adds
  punctuation. So the spike re-decodes the growing utterance instead. The
  audio.cpp source checkout on this machine (v0.9.4) describes true
  incremental delivery, so a newer build may behave differently.
  `bench/stt-live.mjs` is meant to reproduce this comparison, but on the final
  run the extra engine it starts crashed on a failed allocation
  (`GGML_ASSERT(ctx->mem_buffer != NULL)`) with 0.8 GB of system RAM free, so
  the figures above are from the earlier manual runs.
- **Mirli's LLM runs on the CPU on this machine.** The managed llama-server in
  `~/.soundbox/bin/llama/b10545` is a CUDA 12 build with no `cudart64_12.dll`
  beside it, so it finds no GPU and says nothing: 25 tokens a second instead of
  278. The spike adds the runtime to the child's `PATH` from its own folder and
  leaves the install alone. This affects the shipping Enhance feature too.
- **VAD and the first word.** In the test clip for "What should I cook for
  dinner tonight?" the TTS says "What", pauses for most of a second, and
  Silero scores that first word at 0.47, under the 0.5 threshold. It is lost
  in all runs (3 of 18 transcripts). The other 15 are exact. Real speech may
  do the same on a soft first word; untested.
- **System RAM, not VRAM, ran out first.** See the crash above.
- **The engines reserve far more system memory than they use.** Measured by
  the PersonaPlex spike session (Windows private bytes, running server): the
  TTS `audiocpp_server` (VoxCPM2, 3 GB weights) 17.6 GB committed with only
  2.2 GB resident; the STT one (0.9 GB weights) 6.5 GB; llama-server 2.9 GB.
  About 27 GB committed in all, leaving 0.5 GB of the machine's 31 GB, so
  another model then fails on the host side (`std::bad_alloc`) before it
  reaches the GPU. This is probably CUDA host staging buffers; not
  investigated. It is the likely cause of the `stt-live.mjs` crash too.
- **The GPU is shared with other things.** While the face spike's benchmark
  and an unrelated Voicebox app were running, they held 7.6 GB and the spike's
  engines failed to load (`cudaMalloc failed: out of memory`). Start-up worked
  again once that run ended. Running voice and face together will need a
  memory budget, not just "it fits on its own".
- A WebSocket payload can arrive at an odd byte offset, which crashed the
  server on an `Int16Array` view after about 14 turns. Fixed by copying.
- VoxCPM2's default voice: I fixed the seed so each sentence uses the same
  settings, but have not listened to check that the voice stays the same from
  one sentence to the next. With `SPIKE_VOICE_REF` it clones a clip, and
  Cloning was measured later; see "Picking a voice".

## Limits of this spike

- Tried with a real microphone for three minutes only, with headphones; not
  with speakers (echo), and barge-in not tried by a person.
- The conversation history stores the whole generated reply after a barge-in,
  not the part that was heard.
- One conversation at a time. A second browser tab would share the engines
  and wait.
- Endpointing is silence only. A long pause mid-sentence ends the turn.
- The local LLM is small and its answers are plain.

## Recommendation: is a full-duplex model worth trying next?

**Not yet, and not as a replacement.** The reasons to reach for Moshi or
PersonaPlex were latency and natural turn-taking. The pipeline is now at about
0.5 s with barge-in, in Mirli's own voice, on 8.4 GB, and most of what remains
is the wait to be sure the user has stopped, which a better end-of-turn
detector addresses more cheaply than a new model. A full-duplex model would
give up cloned voices, which is the reason the pipeline was chosen.

What I would do next, in order:

1. **Talk to it more.** The first three minutes show 400 ms endpointing does
   cut people off mid-sentence; try barge-in and speakers.
2. **Replace silence endpointing with a turn-detection model** (a small
   classifier over the partial transcript or the audio). That is where the
   remaining latency and most of the unnaturalness are.
3. **Try a newer audio.cpp build** for true streaming transcription, and send
   the report about the missing CUDA DLL upstream into Mirli's installer.
4. **Then a time-boxed look at PersonaPlex**, as a comparison and not a
   direction. audio.cpp v0.9.4 lists a `personaplex` family and a
   `/v1/audio/speech/live` route for speech-to-speech models, so it could run
   through the engine Mirli already ships; the binary in `~/tools/audio.cpp`
   predates that route. PersonaPlex is 7B parameters under the NVIDIA Open
   Model License, and with a face model also wanting the card it probably
   does not fit in 16 GB beside one. Worth an afternoon to hear what
   full-duplex feels like, so there is something to compare the pipeline to.

## Files

| | |
| --- | --- |
| `server.mjs` | Starts the engines, serves the page, the sockets and the tap |
| `lib/conversation.mjs` | The turn logic: VAD, speculation, barge-in, metrics |
| `lib/stt.mjs`, `lib/llm.mjs`, `lib/tts.mjs`, `lib/vad.mjs` | One engine each |
| `lib/tap.mjs` | The PCM tap |
| `lib/engines.mjs`, `lib/config.mjs`, `lib/gpu.mjs` | Child processes, settings, VRAM meter |
| `public/` | The page and its two audio worklets |
| `bench/` | `tts-ttfa.mjs`, `turns.mjs`, `matrix.sh`, `stt-live.mjs`, `tap-check.mjs` |
| `runs/` | Measured results quoted above |
| `restart.sh` | Dev helper: stop whatever holds the spike's ports and start again |
