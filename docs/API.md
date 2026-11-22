# Mirli HTTP API

Base URL: `http://127.0.0.1:17494`. All JSON. The Vite dev server proxies
`/api`, `/mcp`, `/files` and `/artwork` to this port, so the frontend uses
relative URLs.

## Request rules

Two checks run before any route, so a web page open in your browser cannot
drive the server, and a third when an access token is set:

- **Host header.** Requests are served only when the `Host` header names
  `localhost`, `127.0.0.1` or `[::1]` (any port), or the specific host passed
  to `soundbox --host`. Anything else gets `403`, which blocks DNS-rebinding
  attacks. Binding a wildcard (`--host 0.0.0.0`) turns the check off.
- **Mutating requests.** `POST`, `PUT`, `PATCH` and `DELETE` under `/api/`
  must send either a non-"simple" `Content-Type` (`application/json`, or the
  raw audio type `audio/wav` or `application/octet-stream` on the upload
  routes) or an `X-Soundbox` header (any value). A request with no body,
  `text/plain`, `application/x-www-form-urlencoded` or `multipart/form-data`
  and no `X-Soundbox` header gets `403`. Body-less calls such as
  `POST /api/sessions` therefore need the header:

  ```sh
  curl -X POST -H 'X-Soundbox: 1' http://127.0.0.1:17494/api/sessions
  ```

  The [OpenAI-compatible routes](#openai-compatible-routes) under `/v1/` have
  their own form of this rule, because their clients send no such header and
  upload as `multipart/form-data`: a "simple" request is refused only when the
  browser marks it as coming from another site.

- **Access token.** When the server runs with `MIRLI_API_TOKEN`, every
  `/api/*`, `/v1/*`, `/mcp`, `/files/*` and `/artwork/*` request needs
  `Authorization: Bearer <token>` or the session cookie that
  `POST /api/auth/login` sets, or it gets `401`. `GET /api/health`,
  `GET /api/auth/status`, `POST /api/auth/login` and `POST /api/auth/logout`
  stay open. See [Access token](INSTALL.md#access-token).

  ```sh
  curl -H "Authorization: Bearer $MIRLI_API_TOKEN" https://gpu-box.example/api/models
  ```

## Endpoint index

Every route the server registers (`server/src/routes/*.ts`), grouped by file.
The sections after this one document the core routes in detail: health,
models, generation, jobs, the library, sessions, settings, profiles and the
prompt assistant. For the rest, the zod schema named in the route handler
(`server/src/schemas.ts`) is the authority on the body. `→ job` means the
route answers `202 { "job_id": "..." }` and the work is followed through
[`/api/jobs/{id}`](#generation).

**Health and models** (`routes/models.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Version, backend device, loaded model, queue length |
| GET | `/api/models` | Every enabled model with status and licence |
| GET | `/api/models/audiocpp/catalog` | Every catalog entry, enabled or not |
| GET | `/api/models/audiocpp/runtime` | Which `audiocpp_cli` resolved, how, and where weights live |
| POST | `/api/models/audiocpp/engine/install` | Install `audiocpp_cli`. Body `{ version?, backend? }` → job |
| GET | `/api/models/{id}` | One model |
| POST | `/api/models/{id}/download` | Download weights → job |
| POST | `/api/models/{id}/load` | Load into memory, unloading any other |
| POST | `/api/models/{id}/unload` | Unload |
| DELETE | `/api/models/{id}/weights` | Delete downloaded weights |

**Generation and jobs** (`routes/jobs.ts`)

| Method | Path | What it does |
|---|---|---|
| POST | `/api/generate` | Text to audio, or extend/cover/repaint an existing sound. Body `{ model, prompt, duration_s?, seed?, steps?, cfg?, negative_prompt?, lyrics?, variations?, tags?, source_sound_id?, edit?, edit_options?, session_id?, project_id? }` → job |
| POST | `/api/separate` | Split a sound into stems. Body `{ model, source_sound_id, stems?: { keep: string[], rest: "discard" \| "merge" } }` → job |
| POST | `/api/repaint` | Regenerate one window of a sound. Body `{ source_sound_id, start_s, end_s, prompt?, lyrics?, model?, strength?, mode?, seed?, variations? }` → job |
| POST | `/api/speak` | Text to speech. Body `{ model, lines: [{ text, voice_id?, speaker? }], gap_s?, seed?, steps?, cfg?, name?, tags?, session_id?, project_id? }` → job |
| POST | `/api/speak/stream` | One line of speech, sent as it is generated. Body `{ model, text, voice_id?, format?: "sse" \| "pcm", seed?, steps?, cfg?, request_options?, save?, name?, tags?, project_id? }` → SSE or raw PCM, not a job. See [STREAMING.md](STREAMING.md) |
| POST | `/api/render` | Run one generate or speak job, wait for it, and answer with the WAV. Body as `/api/generate` or `/api/speak`, plus `text`/`voice` shorthand, `task?` and `keep?`. See [Render and wait](#render-and-wait) |
| POST | `/api/convert` | Voice conversion. Body `{ model, source_sound_id, voice_id, seed? }` → job |
| GET | `/api/jobs` | Recent jobs, newest first (`?limit`) |
| GET | `/api/jobs/{id}` | One job |
| POST | `/api/jobs/{id}/cancel` | Cancel a queued or running job |
| GET | `/api/jobs/{id}/events` | SSE stream of the job until it ends |

**Library and files** (`routes/sounds.ts`, `routes/files.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/sounds` | Search the library (`?q, tag, favorite, model, models, session_id, project_id, parent_id, voice_id, source, limit, offset`). `voice_id` lists what one saved voice has read: single-voice reads and conversions, not multi-voice dialogues |
| GET | `/api/sounds/{id}` | One sound |
| PATCH | `/api/sounds/{id}` | Body `{ name?, favorite?, tags? }` |
| DELETE | `/api/sounds/{id}` | Delete the row and the file |
| POST | `/api/sounds/upload` | Add audio from disk or the microphone. Body is the raw audio; `?name, source, project_id` |
| POST | `/api/sounds/{id}/edit` | Non-destructive edit: writes a new derived sound. Body `{ op: "trim" \| "normalize" \| "reverse" \| "gain" \| "highpass" \| "lowpass" \| "pitch" \| "stretch", start_s?, end_s?, target_lufs?, gain_db?, cutoff_hz?, semitones?, rate? }` → `201 Sound` |
| POST | `/api/sounds/{id}/reveal` | Show the file in the OS file manager |
| GET | `/api/tags` | Tags with counts |
| GET | `/files/{id}.wav` | The audio. `?format=mp3` transcodes when `ffmpeg` is installed |
| GET | `/artwork/{file}` | Generated cover art and avatars |

**Artwork** (`routes/image.ts`, see [ARTWORK.md](./ARTWORK.md))

| Method | Path | What it does |
|---|---|---|
| GET | `/api/image/status` | What is configured and installed |
| POST | `/api/image/engine/install` | Install `sd-server` → job |
| POST | `/api/image/models/{id}/download` | Download an image model → job |
| DELETE | `/api/image/models/{id}` | Delete its weights |
| POST / DELETE | `/api/sounds/{id}/artwork` | Draw or remove a sound's cover art |
| POST / DELETE | `/api/voices/{id}/artwork` | Draw or remove a voice's avatar |

**OpenAI-compatible** (`routes/openai.ts`). See [OpenAI-compatible routes](#openai-compatible-routes).

| Method | Path | What it does |
|---|---|---|
| POST | `/v1/audio/speech` | Text to speech. Body `{ input, model?, voice?, response_format?: "wav" \| "pcm" \| "mp3", speed?, instructions?, stream_format?: "audio" \| "sse", keep? }` → the audio |
| POST | `/v1/audio/transcriptions` | Speech to text. Multipart `file`, `model?`, `language?`, `response_format?: "json" \| "text" \| "verbose_json"` |
| GET | `/v1/models` | The speech and transcription models that are ready, as an OpenAI list |
| GET | `/v1/audio/voices` | Saved voices and the ready models' own voices |

**Voices** (`routes/voices.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/voices` | Saved voices. Each carries `read_count` and, for a clone, `samples: [{ id, file, duration_s, created_at, reference_text }]` |
| GET | `/api/voices/{id}` | One voice |
| POST | `/api/voices` | Body `{ name, kind: "clone" \| "builtin", voice_id?, model_id?, notes?, source_sound_id?, tidy?, reference_text? }` |
| POST | `/api/voices/upload` | Clone from a WAV. Body is the file; `?name, notes, model_id, tidy, reference_text` (URL-encode values) |
| PATCH | `/api/voices/{id}` | Body `{ name?, notes?, samples?: [{ id, reference_text }] }` |
| DELETE | `/api/voices/{id}` | Delete the voice and every clip file |
| POST | `/api/voices/{id}/samples` | Add a clip to a clone. Body is a WAV (`?tidy&reference_text=...`), or JSON `{ source_sound_id, tidy?, reference_text? }` |
| DELETE | `/api/voices/{id}/samples/{sample_id}` | Remove a clip. Refused for a voice's last one |
| GET | `/api/voices/{id}/export` | The voice as a `.soundbox-voice.json` download |
| POST | `/api/voices/import` | Body is an exported file. Makes a copy under a new id |

A clone voice holds one to five clips of the same speaker. audio.cpp takes a
single `--voice-ref`, so with more than one the server joins them: each made
mono, levelled to the median loudness of the set, with 0.3 s between them.
`reference_file` is that joined file, or the only clip. A clip is refused if it
is under 1 s, over 60 s or almost silent, and a voice's clips together stay
under 90 s — past that, models read the start of the reference and ignore the
rest.

Each clip's nullable `reference_text` is its exact spoken transcript (up to
20,000 characters), editable in Voice Lab under **Reference Transcript**.
For Fish Audio, every clip must have a non-blank transcript: `/api/speak` and
segment generation return HTTP 400 before queueing if any is missing, naming
the voice and clips to fix. Existing voices remain readable with null
transcripts; other models do not require them.

Mirli derives `request_options.reference_text` from the selected voice's
samples in the same `created_at, id` order used to join their audio, separated
by spaces. This overrides any story, line, request or catalog transcript.
The HTTP and MCP speech paths share this behavior. At the audio.cpp transport
boundary, Mirli's `request_options` map becomes the runtime's JSON `options`
map; the CLI fallback uses `--request-option reference_text=...`.

`tidy` (off by default over the API, on by default in the app) takes out DC
offset, cuts near-silence off both ends with a little padding left on, and pulls
a peak above full scale back under it. It never makes a clip louder or changes
its tone, because that is the voice.

An export is JSON: `{ format: "soundbox-voice", version: 1, voice: { name, kind,
voice_id, model_id, notes }, samples: [{ wav_base64, duration_s, reference_text }] }`. The clips
travel and the joined file does not; import rebuilds it. The avatar is not
included and can be redrawn from the notes. On import, a name already in the
library gets " (2)", and a `model_id` this Mirli does not know is dropped
rather than failing the import.

**Stories: scripts and studio timelines** (`routes/stories.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/stories` | Stories, most recently worked on first (`?limit`) |
| POST | `/api/stories` | Body `{ title?, project_id?, builder?: "script" \| "music" }` |
| GET / PATCH / DELETE | `/api/stories/{id}` | Read, update (`{ title?, project_id?, request_options?, builder? }`), delete |
| POST | `/api/stories/from-sound` | Lay a sound out on a new timeline. Body `{ sound_id, separate?, model?, stems? }` |
| GET | `/api/stories/{id}/events` | SSE stream of changes to the story |
| GET | `/api/stories/{id}/tracks` | Track settings |
| PATCH | `/api/stories/{id}/tracks/{track_index}` | Body `{ name?, muted?, soloed?, gain_db?, devices? }`. `devices` replaces the lane's chain (`[{ kind, id?, bypassed?, params? }]`); unknown knobs are dropped, values are clamped to range and missing knobs take defaults |
| DELETE | `/api/stories/{id}/tracks/{track_index}` | Delete the lane and everything on it |
| GET | `/api/stories/{id}/segments` | Lines and clips |
| POST | `/api/stories/{id}/segments` | Add one. Body `{ text?, kind?: "line" \| "pause", speaker?, voice_id?, track_index?, start_s?, position?, sound_id?, duration_s?, trim_start_s?, fade_in_s?, fade_out_s?, gain_db?, muted?, midi? }`. `midi` is a MIDI take's notes: `{ notes: [{ note, velocity, start_s, duration_s }], bpm?, instrument, cover?: { prompt, strength }, role: "dry" \| "cover", take_id }`; a PATCH with `midi: null` forgets them |
| PUT | `/api/stories/{id}/segments/reorder` | Body `{ segment_ids }` |
| PATCH / DELETE | `/api/stories/{id}/segments/{segment_id}` | Update (same fields as POST) or delete |
| POST | `/api/stories/{id}/segments/{segment_id}/generate` | Voice one line. Body `{ model, seed?, steps?, cfg? }` → job |
| POST | `/api/stories/{id}/segments/{segment_id}/split` | Body `{ at_s }` |
| POST | `/api/stories/{id}/export` | Mix down to one sound → job |

**Sessions and projects** (`routes/sessions.ts`)

| Method | Path | What it does |
|---|---|---|
| GET / POST | `/api/sessions` | List (`?limit`) or create (`{ title }`) |
| GET / PATCH / DELETE | `/api/sessions/{id}` | Read, update (`{ title?, project_id? }`), delete with its sounds |
| GET / POST | `/api/projects` | List or create (`{ name }`) |
| DELETE | `/api/projects/{id}` | Delete a project |

**Prompt assistant and studio chat** (`routes/llm.ts`, `routes/history.ts`)

| Method | Path | What it does |
|---|---|---|
| POST | `/api/enhance` | Rewrite a prompt. Body `{ prompt, n?, category?, lyrics?, model? }` |
| POST | `/api/enhance/lyrics` | Write lyrics. Body `{ theme, style? }` |
| POST | `/api/assistant/chat` | One turn of the assistant. Body `{ messages, studio?, draft? }` |
| POST | `/api/assistant/openers` | Suggested first messages. Body `{ studio? }` |
| POST | `/api/studio/command` | Turn a studio instruction into a plan of edits. Body `{ instruction, context: { tracks, clips, playhead_s?, selected_ids?, voices? } }` |
| GET | `/api/llm/status` | Engine and model install state, detected local endpoints |
| POST | `/api/llm/engine/install` | Install `llama-server` → job |
| POST | `/api/llm/models/{id}/download` | Download an assistant model → job |
| DELETE | `/api/llm/models/{id}` | Delete its weights |
| GET / POST | `/api/conversations` | List (`?limit` or `?story_id`) or create (`{ title?, story_id? }`) the chat history |
| GET / PATCH / DELETE | `/api/conversations/{id}` | Read, rename (`{ title }`), delete |
| GET / POST | `/api/conversations/{id}/entries` | Read or append (`{ entries: [{ role, content?, actions?, sound_ids?, job_id? }] }`) |

**Sampled instruments** (`routes/instruments.ts`): the VSCO 2 CE samples the
Studio's MIDI dry render can play. See `docs/STUDIO.md`.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/instruments` | The eight instruments: label, family, size, whether installed |
| GET | `/api/instruments/{id}` | An installed instrument's SFZ regions (404 if not installed) |
| POST | `/api/instruments/{id}/download` | Download its samples → job |
| DELETE | `/api/instruments/{id}` | Delete its samples |
| GET | `/api/instruments/{id}/files/{path}` | One sample file, by its path in the instrument's manifest |

**Settings, logs, profiles** (`routes/settings.ts`, `routes/fs.ts`, `routes/profiles.ts`)

| Method | Path | What it does |
|---|---|---|
| GET / PATCH | `/api/settings` | Read or change settings |
| GET | `/api/capabilities` | What this server lets its user do (see [Capabilities](#capabilities)) |
| GET | `/api/update` | What the daily update check last learned: `enabled`, `current`, `latest`, `available`, `url`, `checked_at` |
| POST | `/api/update/check` | Ask now (the Settings button). Does nothing when the check is off |
| GET | `/api/logs` | Tail of the server log (`?lines`) |
| GET | `/api/fs/dirs` | List folders on the server's disk (`?path`) |
| GET / POST | `/api/profiles` | List or create (`{ name }`) |
| PATCH / DELETE | `/api/profiles/{id}` | Rename (`{ name }`) or remove (`?delete_data=1` deletes its folder) |
| POST | `/api/profiles/{id}/activate` | Switch library |

**MCP** (`routes/mcp.ts`, `mcp/server.ts`)

| Method | Path | What it does |
|---|---|---|
| POST / GET / DELETE | `/mcp` | The streamable-HTTP MCP endpoint ([MCP.md](./MCP.md)) |
| GET | `/api/mcp/status` | Connection details, connected clients, totals, telemetry, skills |
| GET | `/api/mcp/calls` | Recent tool calls (`?limit, client, tool, status, since`) |
| POST | `/api/mcp/calls` | Record a call (the stdio bridge reports through this) |
| PATCH | `/api/mcp/calls/{id}` | Finish a recorded call |
| GET | `/api/mcp/calls/events` | SSE feed of calls as they start and settle |
| POST | `/api/mcp/skills/install` | Copy the bundled skills. Body `{ target?, path?, skills? }` |

`GET /` serves the built UI when it has been staged into `server/web`, and
otherwise a JSON stub saying it has not.

## Health

`GET /api/health`
```json
{ "status": "ok", "version": "0.1.0", "device": "cuda",
  "gpu_name": "NVIDIA GeForce RTX 3080", "vram_total_mb": 10240, "vram_free_mb": 9800,
  "loaded_model": "audiocpp-stable-audio-3-sfx" | null, "queue_length": 0 }
```
`device` comes from the same backend detection audio.cpp uses. On NVIDIA
hardware `gpu_name` and the `vram_*` fields come from `nvidia-smi`, for the
first GPU in `CUDA_VISIBLE_DEVICES` or GPU 0 when that is unset. Without
`nvidia-smi` (Metal, AMD, Intel, CPU) they are `null`.

## Capabilities

`GET /api/capabilities`
```json
{ "sandboxed": false, "settings_locked": [],
  "filesystem": true, "reveal": true, "downloads": true, "local_models": true,
  "custom_endpoints": true, "updates": true, "gpu_status": true,
  "agent_connect": true, "skills_install": true, "logs": true, "setup_wizard": true }
```
Each flag says whether the server allows something, and the UI shows only what
is allowed. On a desktop everything is `true`. With `MIRLI_SANDBOXED=1` every
flag is `false`. `settings_locked` lists the settings that need a flag that is
off (a path on the host, a local engine, or a URL the server would fetch), which
`PATCH /api/settings` then ignores. A request a flag turns off gets **403**
`{"detail": "This server doesn't allow that."}`; without `gpu_status`,
`/api/health` reports the GPU fields as `null`. See
[INSTALL.md](./INSTALL.md#running-mirli-for-someone-else).

## Models

`GET /api/models` → `Model[]`
```json
{
  "id": "audiocpp-stable-audio-3-sfx",
  "name": "Stable Audio 3.0 SFX (audio.cpp)",
  "vendor": "Stability AI",
  "description": "…",
  "license": { "name": "Stability AI Community License", "commercial": "conditional",
               "url": "https://stability.ai/license", "note": "…" },
  "hf_repo": "audio-cpp/audio.cpp-gguf",
  "max_duration_s": 120,
  "sample_rate": 44100,
  "channels": 2,
  "supports": { "negative_prompt": false, "seed": true, "steps": true, "cfg": true },
  "defaults": { "duration_s": 10, "steps": 8, "cfg": 1 },
  "vram_estimate_mb": 2500,
  "provider": "local",
  "status": "not_installed" | "needs_runtime" | "installed" | "downloading" | "loaded" | "error",
  "installed_deps": true,
  "error": null | "string",
  "avg_duration_s": null | 187.4
}
```
`status` says whether the model can be used now, so it covers both the weights
and the runtime. `needs_runtime` means the weights are downloaded but the
audio.cpp runtime is not installed. Fix it with `soundbox model install audiocpp`
(or `POST /api/models/audiocpp/engine/install`); there is nothing to download
again. `installed_deps` reports the runtime half on its own.
`provider` says where the model runs. It is always `local`: weights on this
machine, driven by audio.cpp, described by `hf_repo` and `vram_estimate_mb`.

`avg_duration_s` is a rolling average wall time (seconds) of this model's recent successful generate jobs,
`null` until at least one has completed. The app uses it to show a duration estimate before Generate is
clicked, and it feeds `eta_s` on queued jobs of the same model.

`GET /api/models/{id}` → `Model`, same shape as the list.

`POST /api/models/{id}/download` → `202 { "job_id": "..." }`. Pulls the model's GGUF package from Hugging Face. Progress via `GET /api/jobs/{job_id}/events` (SSE).

`POST /api/models/{id}/load` → `200 Model`. Loads into VRAM, unloading any other model first (one model resident at a time).

`POST /api/models/{id}/unload` → `200 Model`

`DELETE /api/models/{id}/weights` → `204`. Deletes cached weights. A model
whose weights are your own local files (`weights_path`, below) has none to
delete and returns `400`.

## Artwork

Cover art for music and avatars for voices, off by default. The endpoints and
modes are documented in [ARTWORK.md](ARTWORK.md).
`GET /api/image/status` reports what is configured; `POST /api/sounds/{id}/artwork`
and `POST /api/voices/{id}/artwork` draw one. A `Sound` and a `Voice` each
carry an `artwork` field: a served `/artwork/<file>.png` URL, or null.

## Models (audio.cpp catalogue)

`GET /api/models/audiocpp/catalog` → `AudioCppCatalogEntry[]`. Every model the
audio.cpp adapter knows, enabled or not.
```json
{
  "id": "audiocpp-ace-step",
  "name": "ACE-Step (audio.cpp)",
  "vendor": "ACE Studio",
  "description": "…",
  "license": { "name": "MIT License", "commercial": "yes", "url": "…", "note": "…" },
  "verified": true,
  "always_on": false,
  "enabled": true,
  "category": "music",
  "source": "builtin" | "custom"
}
```
`always_on` models are in `GET /api/models` regardless; the rest appear only
once their id is in `enabled_audiocpp_models` (`PATCH /api/settings`), which
takes effect without a restart. `source: "custom"` marks an entry from your own
`<data dir>/models/custom.json`; these are always on and never `verified`. Use
that file to add a model Mirli doesn't ship, including one whose weights are
already on your disk; see [AUDIOCPP.md](AUDIOCPP.md#bring-your-own-model).

## Generation

`POST /api/generate`
```json
{ "model": "audiocpp-stable-audio-3-sfx", "prompt": "heavy wooden door slam, dry room",
  "negative_prompt": null, "duration_s": 3.0, "seed": null | 1234,
  "steps": null, "cfg": null, "variations": 1, "tags": ["door","impact"],
  "session_id": null | "uuid" }
```
→ `202 { "job_id": "..." }`. If the model isn't loaded, the job loads it first (progress phase `loading`).
`negative_prompt` is ignored by models whose `supports.negative_prompt` is false.

`POST /api/separate`
```json
{ "model": "audiocpp-htdemucs-sep", "source_sound_id": "uuid",
  "stems": null | { "keep": ["vocals"], "rest": "discard" | "merge" } }
```
→ `202 { "job_id": "..." }`. Splits a library sound into stems, each saved as
its own sound; the job's `result.sounds` lists them. `model` is any model
whose `task` is `sep`. `stems.keep` keeps only the named stems, and
`rest: "merge"` sums the others into one "rest" sound.

`POST /api/repaint`
```json
{ "source_sound_id": "uuid", "start_s": 12.0, "end_s": 18.5,
  "prompt": null | "brass stabs instead of the pad", "lyrics": null,
  "model": null | "audiocpp-ace-step", "strength": null | 0.0..1.0,
  "mode": null | "conservative" | "balanced" | "aggressive",
  "seed": null, "variations": 1 }
```
→ `202 { "job_id": "..." }`. Regenerates `start_s..end_s` of an existing sound
and keeps the rest of it sample-for-sample. This is the editor's Repaint tool,
applied to the highlighted range. Everything outside the window is inherited
from the source: its model, its length and its lyrics. Omit `prompt` to reroll
the source's own description.

The same render is available as `POST /api/generate` with `edit: "repaint"`,
`source_sound_id` and `edit_options.repaint_start_s`/`repaint_end_s`. Use that
form to change the length, the model or the lyrics at the same time. Both
reject the request up front (before rendering) for a window past the end of the
clip, a model that can't repaint (only ACE-Step can today), or a clip longer
than that model renders in one pass.

`GET /api/jobs/{job_id}` → `Job`
```json
{ "id": "...", "kind": "generate" | "download" | "separate" | "speak" | "convert" | "segment" | "export", "status": "queued" | "running" | "done" | "error" | "cancelled",
  "phase": "queued" | "loading" | "generating" | "encoding" | "done",
  "progress": 0.0..1.0, "message": "step 4/8", "error": null,
  "request": { ...the request body... },
  "result": null | { "sounds": ["sound_id", ...] },
  "created_at": "iso", "started_at": "iso|null", "finished_at": "iso|null",
  "queue_position": null | 3, "eta_s": null | 210.5 }
```
`queue_position` is a 1-indexed position among jobs still waiting, and is `null`
once a job is running or in a terminal state. `eta_s` is a rough estimate of
how many seconds until this job starts running, derived from a rolling average
of recent successful jobs for the same model; `null` when there's no timing
history yet for that model, or the job isn't queued.

`GET /api/jobs/{job_id}/events` → SSE, `data: <Job JSON>` on every change, closes on terminal status. Send `Accept: text/event-stream`. Poll `GET /api/jobs/{id}` if you can't do SSE.

`POST /api/jobs/{job_id}/cancel` → `200 Job`. Cancels a queued or running job.

`GET /api/jobs?limit=50` → `Job[]` newest first (in-memory ring, not persisted).

## Streaming speech

`POST /api/speak/stream` speaks one line and sends the audio while it is
still being made, for game dialogue and chat agents. It is not a job: it
holds the GPU while you listen, and closing the connection cancels it.
Nothing is saved unless you pass `"save": true`.

```json
{ "model": "audiocpp-supertonic-3", "text": "Halt! Who goes there?",
  "voice_id": null, "format": "sse", "save": false }
```

- `format: "sse"` (default): `event: start` (`sample_rate`, `channels`,
  `encoding: "pcm_s16le"`), then `event: audio` with base64 PCM in `pcm`, then
  `event: done` (`duration_s`, `ttft_ms`, `model_ttft_ms`, `sound_id`). A
  failure after audio has started arrives as `event: error`.
- `format: "pcm"`: raw interleaved 16-bit little-endian PCM,
  `Content-Type: audio/L16; rate=…; channels=…`, with the same values in
  `X-Soundbox-Sample-Rate` and `X-Soundbox-Channels`.
- `409` with `reason: "unsupported"` when the model can't stream on this
  audio.cpp build, or `reason: "busy"` (plus `Retry-After`) when a generation
  holds the GPU. Streams never queue.
- Which models stream is `supports.streaming` in `GET /api/models`.

Full details, client examples and limits: [STREAMING.md](STREAMING.md).

### Render and wait

`POST /api/render` runs one job and holds the request open until it finishes,
then answers with the audio itself. Use it when you want a file back from one
call: a script, a render farm, or another Mirli that has this one set up as
a [custom endpoint](ENDPOINTS.md#another-soundbox).

```sh
curl -X POST http://127.0.0.1:17494/api/render   -H 'Content-Type: application/json'   -d '{"model": "audiocpp-stable-audio-3-sfx", "prompt": "door slam", "duration_s": 2}'   -o door.wav
```

The body is a `/api/generate` body, or a `/api/speak` body for speech. Speech
also takes a one-line shorthand, `{ "model", "text", "voice"? }`, where
`voice` is a saved voice's id or name (case does not matter). The route reads
two fields of its own:

- `task`: `"generate"` or `"speak"`. Omit it and a body with `text` or
  `lines` is speech; anything else is a generation.
- `keep`: `false` deletes the sound from this library once it has been sent,
  for a server that only renders for others. Default `true`.

A success is `200` with `Content-Type: audio/wav`, plus `X-Soundbox-Job-Id`
and `X-Soundbox-Sound-Id` headers (the sound id is empty when `keep` is
false). A render that fails is `500 { detail, failure, job_id }`, and one
cancelled from the app is `409`. Bad input is `400` before anything runs,
including `variations` above 1 and `separate`, since the answer is one file.
A full queue is `429`.

The job goes through the same queue as the app's, so the wait includes any
jobs ahead of it, and it shows in the app's queue while it runs. If the caller
disconnects before it finishes, the job is cancelled.

Some proxies cut a request that waits too long; a GPU host's HTTP proxy often
allows about 100 seconds. For longer renders behind one of those, use
`/api/generate` and follow the job instead.

## OpenAI-compatible routes

Four routes under `/v1/` take the same requests as OpenAI's audio API, so a
program with an "OpenAI base URL" setting (a chat UI, a voice agent framework,
a workflow tool, or OpenAI's own SDK) can use Mirli for speech. They run the
same models through the same queue as `/api/speak` and `/api/transcribe`.

Set the base URL to `http://127.0.0.1:17494/v1`. The API key can be any
string, unless the server has an [access token](INSTALL.md#access-token): then
the token is the key, since both travel as `Authorization: Bearer ...`.

```sh
curl http://127.0.0.1:17494/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model": "tts-1", "input": "Hello from Mirli.", "voice": "default", "response_format": "wav"}' \
  -o hello.wav
```

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:17494/v1", api_key="mirli")

with client.audio.speech.with_streaming_response.create(
    model="tts-1", voice="default", input="Hello from Mirli.", response_format="wav",
) as response:
    response.stream_to_file("hello.wav")

with open("hello.wav", "rb") as clip:
    print(client.audio.transcriptions.create(model="whisper-1", file=clip).text)
```

### `POST /v1/audio/speech`

| Field | Default | |
|---|---|---|
| `input` | required | The text, up to 20,000 characters |
| `voice` | the model's default | A saved voice by id or by name (case does not matter), one of a model's own voice names, or `default`. OpenAI's `{ "id": "..." }` form works too |
| `model` | see below | A Mirli speech model, by id or by name |
| `response_format` | `mp3` | `wav`, `pcm` or `mp3` |
| `speed` | `1` | 0.25 to 4. Passed to models that have a `speed` setting, held to the range the model allows; the others read at their own pace |
| `instructions` | | Passed to models that have an `instruct` setting; ignored by the others |
| `stream_format` | `audio` | `audio` for the bytes, `sse` for events |
| `keep` | `false` | Mirli's own: `true` saves the read in the library. By default it is deleted once sent, so a chat client does not fill the library |

**Which model reads it.** The `model` field, when it names a speech model on
this server. Otherwise the model the voice was made on, when that is ready.
Otherwise a ready speech model, preferring the one in memory and never one
that may charge per read. A name this server has never heard of (`tts-1`,
which many clients send without being asked) falls through to the rest, so a
client with a fixed model name still works. The answer says what was used in
`X-Soundbox-Model` and `X-Soundbox-Voice`.

**Formats.**

- `wav`: the file as the model made it, at the model's sample rate.
- `pcm`: headerless 16-bit little-endian mono at 24 kHz, the format OpenAI
  documents, resampled from whatever the model produced.
- `mp3`: needs `ffmpeg` on the server's `PATH`, as the app's own MP3 export
  does. Asked for by name without it, the answer is a `400` that names the
  formats that work. With no `response_format` at all and no ffmpeg, the
  answer is the WAV with `X-Soundbox-Format-Fallback: wav`.
- `opus`, `aac` and `flac` are a `400`: nothing in the server encodes them.

**Streaming.** When the model can stream (`supports.streaming` in
`GET /api/models`) and the format is `wav` or `pcm`, the audio is sent while
it is still being made, through the same path as
[`/api/speak/stream`](#streaming-speech); a streamed WAV carries a header with
open-ended sizes. If the model cannot stream, or the GPU is busy with another
job, the read goes through the queue and arrives whole. `stream_format: "sse"`
sends `speech.audio.delta` events with base64 PCM in `audio` (24 kHz mono),
then `speech.audio.done`; it takes `response_format: "pcm"` or none. Mirli
counts no tokens, so the `usage` in the last event is zeros.

### `POST /v1/audio/transcriptions`

A `multipart/form-data` body with the audio in `file`. WAV is read directly;
other formats (MP3, M4A, WebM and so on) are decoded with `ffmpeg` when it is
installed, and refused with a `400` when it is not. `model` picks a
transcription model on this server by id or name; any other value
(`whisper-1`) means a ready one. `language` is a hint.

`response_format` is `json` (`{ "text": "..." }`, the default), `text` (plain
text) or `verbose_json` (`{ task, language, duration, text }`, without
segments or word timings). `srt`, `vtt` and `stream: true` are a `400`. With no
transcription model installed the answer is a `404`.

### `GET /v1/models` and `GET /v1/audio/voices`

`/v1/models` lists the speech and transcription models that are ready, in
OpenAI's list shape: `{ "object": "list", "data": [{ "id", "object": "model",
"created", "owned_by" }] }`, plus `name` and `task` (`speech` or
`transcription`). `created` is always `0`.

`/v1/audio/voices` is Mirli's own, since OpenAI's API has no route that lists
voices: `{ "object": "list", "data": [...], "voices": [...] }`, the same
entries under both keys, each `{ id, object: "voice", name, kind, model }`.
`kind` is `clone` or `builtin` for a saved voice, `builtin` for a model's own
voice, and `default` for the entry that means the model's default voice. Pass
an entry's `id` or `name` as `voice`.

### Errors

Every error from these routes, including a refused `Host` and a missing access
token, is OpenAI's envelope:

```json
{ "error": { "message": "No voice is called 'shimmer'. Voices on this server: Narrator, alloy. ...",
             "type": "invalid_request_error", "param": "voice", "code": "voice_not_found" } }
```

`type` is `invalid_request_error`, `rate_limit_error` (a full queue) or
`server_error`. A read that fails while it runs is a `500` whose `message` is
the same explanation the app shows for that failure and whose `code` is its
topic, such as `gpu_oom` or `model_not_installed`; the raw text of the failure
is in `error.detail`, a field of Mirli's own. A wrong or missing token is
a `401` with `code: "invalid_api_key"`.

### Requests from a browser

`POST` requests here do not need the `X-Soundbox` header that `/api/` asks
for. A JSON body is safe for the same reason it is under `/api/`: a page on
another site cannot send one without a preflight, which the server's CORS
policy refuses. A "simple" body (multipart, form-encoded, plain text or none)
is refused with `403` when it carries an `Origin` the server does not trust, or
`Sec-Fetch-Site: cross-site`. Browsers add those to every cross-site `POST`;
scripts and SDKs send neither.

## Logs

`GET /api/logs?lines=200` → `{ "lines": ["...", ...] }`. The tail of the persistent log file
(`<data_dir>/soundbox-<port>.log`; see [INSTALL.md](./INSTALL.md#troubleshooting)), oldest first. The app and
MCP clients use it to show recent server activity. For a full trail, `grep` the log file itself.

## Library

`GET /api/sounds?limit=100&offset=0&q=door&tag=impact&favorite=true&model=...&session_id=...` → `{ "items": Sound[], "total": n }`
```json
{ "id": "uuid", "created_at": "iso", "model": "audiocpp-stable-audio-3-sfx",
  "prompt": "...", "negative_prompt": "...", "duration_s": 3.0, "seed": 1234,
  "steps": 8, "cfg": 1.0, "sample_rate": 44100, "channels": 2,
  "file": "/files/uuid.wav", "peaks": [0.0, ...],   // 256 normalised peaks for the waveform
  "favorite": false, "tags": ["door","impact"], "name": "Door slam 01",
  "size_bytes": 529244, "session_id": "uuid" | null }
```
`GET /api/sounds/{id}` → `Sound`
`PATCH /api/sounds/{id}` `{ "name"?, "favorite"?, "tags"? }` → `Sound`
`DELETE /api/sounds/{id}` → `204` (deletes file too)
`GET /api/tags` → `[{ "tag": "impact", "count": 12 }]`
`GET /files/{id}.wav`: static. `?format=mp3` transcodes on the fly (cached).

## Sessions

A session groups a run of related generations so the app can show them as one
thread. Some sounds have no session: anything generated before sessions
existed, and anything made directly through this API or MCP. The Library view
lists every sound regardless of session.

A generation submitted without a `session_id` creates a session titled from
the prompt. Every new sound bumps its session's `updated_at`, so the sidebar
can order by last worked on. The resolved id comes back on the job's
`request`. Pass it on later generations to keep adding to the same thread.
A `session_id` that no longer exists starts a fresh session; the generation
still runs.

Sessions that produce no audio (the job was cancelled or errored) are pruned
automatically.

`GET /api/sessions?limit=50` → `Session[]`, newest activity first
```json
{ "id": "uuid", "title": "Glass bottle shattering on tile",
  "created_at": "iso", "updated_at": "iso", "sound_count": 2 }
```
`POST /api/sessions` `{ "title": "..." }` → `201 Session`. Rarely needed; generating creates one.
`GET /api/sessions/{id}` → `Session`
`PATCH /api/sessions/{id}` `{ "title": "..." }` → `Session`
`DELETE /api/sessions/{id}` → `204`. **Deletes the session and every sound in it, audio files included.**

To read one session's thread, filter the library: `GET /api/sounds?session_id={id}`.

## Settings

`GET /api/settings` / `PATCH /api/settings`
```json
{ "data_dir": "C:\\Users\\x\\.mirli", "hf_token_set": true, "output_format": "wav" | "mp3",
  "normalize_lufs": -16.0 | null, "trim_silence": true, "auto_unload_minutes": 10,
  "sounds_dir": "C:\\Users\\x\\.mirli\\sounds",
  "llm_mode": "off" | "managed" | "external", "llm_model": "qwen3-1.7b",
  "llm_external_base_url": "", "llm_external_model": "", "llm_external_api_key_set": false }
```
`PATCH` accepts `hf_token` and `llm_external_api_key`. Both are write-only and
never echoed; send `""` to clear one. `enabled_audiocpp_models` replaces the
whole list: send every id that should stay enabled.

`sounds_dir` is where generated audio is written. It is set independently of
`audiocpp_models_dir`, so weights and sounds can live on different disks. It is
always returned resolved, never null; `PATCH` it with `""` to go back to
`<data_dir>/sounds`. Changing it moves the existing library to the new folder
(the database stores bare filenames), so the request is refused with 400 while
anything is queued or generating.

`GET /api/fs/dirs?path=` lists the folders inside `path` on the server's own
disk. The "Browse…" buttons in Settings use it. It returns
`{ path, parent, separator, home, writable, roots, entries }`, where `entries`
is subdirectories only and `roots` is the drive letters (Windows) or `/`.
Omit `path` to start at the server user's home directory. A path that no
longer exists resolves to its nearest existing ancestor.
Read-only, directory names only, and reachable on the same loopback bind as
everything else. It is a server route because the chosen path is one the
server writes to, which a browser file input cannot provide.

## Profiles

Several libraries in one install. A profile is a data directory with its own
`soundbox.db`, `sounds/`, `artwork/` and `settings.json`, so switching profiles
changes everything the library endpoints return. Model weights (`models/`) and
the runtime binaries (`bin/`) live at the install root and are shared by every
profile.

The `default` profile is the data directory itself (`~/.mirli`). An install
that predates profiles is therefore the default profile. Named profiles live in
`~/.mirli/profiles/{id}`.

`GET /api/profiles`
```json
{ "active": "default",
  "profiles": [
    { "id": "default", "name": "Default", "created_at": "",
      "data_dir": "C:\\Users\\x\\.mirli", "active": true },
    { "id": "demo", "name": "Demo", "created_at": "2026-02-01T10:00:00Z",
      "data_dir": "C:\\Users\\x\\.mirli\\profiles\\demo", "active": false }
  ] }
```

`POST /api/profiles` `{ "name": "Demo" }` → `201` `Profile`. Creates the
profile without switching to it. The `id` is a slug of the name, fixed at creation.

`PATCH /api/profiles/{id}` `{ "name": "..." }` → `Profile`. Renames. The id and
its directory do not change.

`POST /api/profiles/{id}/activate` → the `GET` payload, with the new active id.
Switches the running server in place: no restart, and the loaded model stays in
VRAM. Returns **`400` while a job is queued or running**, because a generation
writes its file and database row at the end and would land in the wrong library.

`DELETE /api/profiles/{id}` → `204`. Removes it from the list and leaves its
folder on disk. **`?delete_data=1` also deletes the directory and every sound in
it.** The default profile and the active profile cannot be deleted.

Server-side, `--profile NAME` opens one at startup; without it the last active
profile is reopened.

## Prompt assistant

An optional local LLM that rewrites a terse prompt ("scary sound") into a
descriptive one, off by default (`llm_mode: "off"`). `managed` runs a small
model Mirli installs and manages (`llama-server` + a curated GGUF);
`external` talks to any OpenAI-compatible endpoint already running on this
machine. Check `detected` (below) before pointing someone at the managed install.

`POST /api/enhance` `{ "prompt": "scary sound", "n"?: 1..5, "category"?: "sfx" | "music", "lyrics"?: false }`
→ `{ "variations": ["heavy wooden door slamming shut in a stone corridor"] }`. `400` with an actionable message
when the assistant is off or unconfigured.

`POST /api/assistant/chat`: the multi-turn **studio assistant**. A conversation that
explains the installed models (licence, limits, how each family wants to be prompted) and ends
in a request ready to generate. Stateless: send the whole thread each time.
```json
{ "messages": [{ "role": "user", "content": "I need a door slam for a horror game" },
               { "role": "assistant", "content": "Wooden or metal?" },
               { "role": "user", "content": "wooden, huge" }],
  "draft"?: { "model": "audiocpp-stable-audio-3-sfx", "prompt": "..." } }
```
→ `{ "reply": "Going with Stable Audio 3.0 SFX — commercial use is conditional on its licence.",
     "proposal": { "model": "audiocpp-stable-audio-3-sfx", "prompt": "a massive oak door slamming shut in a
     cold stone corridor, close mic", "negative_prompt": null, "lyrics": null, "track_name": null,
     "duration_s": 4, "tags": ["door", "slam", "oak", "stone"] } }`. `proposal` is `null` while the
assistant is still asking; when present its `model` is guaranteed to be an installed generation
model, `duration_s` fits that model, and `lyrics` only ride on a model that sings. `draft` is the
composer's current contents, so "make it longer" has something to refer to.

`GET /api/llm/status` → engine/model install state plus discovery:
```json
{ "mode": "off", "engine": { "installed": false, "version": null, "backend": null },
  "model": null,
  "catalog": [{ "id": "qwen3-1.7b", "name": "Qwen3 1.7B", "vendor": "Alibaba", "license": "Apache-2.0",
                "size_bytes": 1834426016, "description": "...", "recommended": true, "installed": false }],
  "external": { "base_url": "", "model": "", "api_key_set": false },
  "running": false,
  "detected": [{ "label": "Ollama", "base_url": "http://127.0.0.1:11434", "models": ["llama3.1"] }] }
```
`detected` is a best-effort probe of the well-known local ports for Ollama, LM Studio and a bare
`llama-server`. Each one that answers its OpenAI-compat `/v1/models` is listed, so the app can offer
to use it instead of installing a second local server.

`POST /api/llm/engine/install` `{ "version"? }` → `202 { "job_id": "..." }`. Installs `llama-server`.
`POST /api/llm/models/{id}/download` → `202 { "job_id": "..." }`. Pulls one catalog model's GGUF.
`DELETE /api/llm/models/{id}` → `204`. Deletes cached weights.

## MCP

Streamable-HTTP MCP endpoint at `/mcp` (same port). Twenty-one tools; `server/src/mcp/server.ts` is the authority on their signatures, and [MCP.md](./MCP.md) documents them in full. Summary:

Sounds:
- `soundbox.generate(prompt, duration_s?, model?, negative_prompt?, seed?, variations?, tags?, lyrics?, source_sound_id?, edit?)` → waits for the job, returns `Sound[]` with absolute file paths.
- `soundbox.enhance_prompt(prompt, n?, category?, lyrics?, model?)` → `{ variations: string[] }`, or a plain-text explanation when the assistant is off.
- `soundbox.separate(sound_id, model?, stems?, rest?)` → waits for the job, returns the stems as `Sound[]` with absolute file paths.
- `soundbox.list_models()` → `Model[]`
- `soundbox.list_sounds(q?, tag?, limit?)` → `Sound[]`
- `soundbox.get_sound(sound_id)` → `Sound` + absolute path
- `soundbox.delete_sound(sound_id)`

Voices:
- `soundbox.list_voices()` → the saved voices a script can be cast to.
- `soundbox.speak(lines, model?, gap_s?, name?, delivery?)` → waits, returns a `Sound`.

Stories (a script that persists, with lines placed in time):
- `soundbox.create_story(title?, delivery?)`, `soundbox.list_stories(limit?)`, `soundbox.get_story(story_id)`
- `soundbox.add_lines(story_id, lines)`, `soundbox.update_line(line_id, …)`, `soundbox.delete_line(line_id)`, `soundbox.split_line(line_id, at_s)`
- `soundbox.speak_story(story_id, model?, regenerate?)` → reads every silent line; the slow one.
- `soundbox.export_story(story_id)` → mixes down to one `Sound`.

Arrangement:
- `soundbox.open_in_studio(sound_id, separate?, stems?, rest?)`
- `soundbox.mix_track(story_id, track_index, name?, muted?, soloed?, gain_db?)`, `soundbox.remove_track(story_id, track_index)`
- `soundbox.add_device(story_id, track_index, kind, params?, bypassed?, position?)`, `soundbox.set_device(story_id, track_index, device, params?, bypassed?)`, `soundbox.remove_device(story_id, track_index, device)`

Stdio bridge for clients that can't do HTTP: `node <checkout>/server/dist/mcp/stdio.js`, which proxies to the running server. The file exists only after `npm run build`, and the bridge covers the sound tools (`generate`, `enhance_prompt`, `list_models`, `list_sounds`, `get_sound`, `delete_sound`). Use HTTP for `separate`, speech and stories. The Agents page prints the line with the path resolved.
