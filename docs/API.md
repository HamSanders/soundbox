# Soundbox HTTP API

Base URL: `http://127.0.0.1:17494`. All JSON. The Vite dev server proxies
`/api`, `/mcp`, `/files` and `/artwork` to this port, so the frontend uses
relative URLs.

## Request rules

Two checks run before any route, so a web page open in your browser cannot
drive the server:

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

**Voices** (`routes/voices.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/voices` | Saved voices. Each carries `read_count` and, for a clone, `samples: [{ id, file, duration_s, created_at }]` |
| GET | `/api/voices/{id}` | One voice |
| POST | `/api/voices` | Body `{ name, kind: "clone" \| "builtin", voice_id?, model_id?, notes?, source_sound_id?, tidy? }` |
| POST | `/api/voices/upload` | Clone from a WAV. Body is the file; `?name, notes, model_id, tidy` |
| PATCH | `/api/voices/{id}` | Body `{ name?, notes? }` |
| DELETE | `/api/voices/{id}` | Delete the voice and every clip file |
| POST | `/api/voices/{id}/samples` | Add a clip to a clone. Body is a WAV (`?tidy`), or JSON `{ source_sound_id, tidy? }` |
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

`tidy` (off by default over the API, on by default in the app) takes out DC
offset, cuts near-silence off both ends with a little padding left on, and pulls
a peak above full scale back under it. It never makes a clip louder or changes
its tone, because that is the voice.

An export is JSON: `{ format: "soundbox-voice", version: 1, voice: { name, kind,
voice_id, model_id, notes }, samples: [{ wav_base64, duration_s }] }`. The clips
travel and the joined file does not; import rebuilds it. The avatar is not
included and can be redrawn from the notes. On import, a name already in the
library gets " (2)", and a `model_id` this Soundbox does not know is dropped
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
| POST | `/api/stories/{id}/segments` | Add one. Body `{ text?, kind?: "line" \| "pause", speaker?, voice_id?, track_index?, start_s?, position?, sound_id?, duration_s?, trim_start_s?, fade_in_s?, fade_out_s?, gain_db?, muted? }` |
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

**Settings, logs, profiles** (`routes/settings.ts`, `routes/fs.ts`, `routes/profiles.ts`)

| Method | Path | What it does |
|---|---|---|
| GET / PATCH | `/api/settings` | Read or change settings |
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
that file to add a model Soundbox doesn't ship, including one whose weights are
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
{ "data_dir": "C:\\Users\\x\\.soundbox", "hf_token_set": true, "output_format": "wav" | "mp3",
  "normalize_lufs": -16.0 | null, "trim_silence": true, "auto_unload_minutes": 10,
  "sounds_dir": "C:\\Users\\x\\.soundbox\\sounds",
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

The `default` profile is the data directory itself (`~/.soundbox`). An install
that predates profiles is therefore the default profile. Named profiles live in
`~/.soundbox/profiles/{id}`.

`GET /api/profiles`
```json
{ "active": "default",
  "profiles": [
    { "id": "default", "name": "Default", "created_at": "",
      "data_dir": "C:\\Users\\x\\.soundbox", "active": true },
    { "id": "demo", "name": "Demo", "created_at": "2026-02-01T10:00:00Z",
      "data_dir": "C:\\Users\\x\\.soundbox\\profiles\\demo", "active": false }
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
model Soundbox installs and manages (`llama-server` + a curated GGUF);
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
