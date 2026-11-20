# Proposal: remote audio.cpp

Status: proposal, revision 2. Probed against a live `audiocpp_server`, then
reviewed by an architecture agent and a code-review agent (two rounds; see
[Review](#review-2026-10-24)). **Re-probed on v0.9.2** (the current release);
see [Re-probe on v0.9.2](#re-probe-on-v092-2026-10-25), which changes
sections 3 and 4. Nothing is built. Branch `feat/remote-audiocpp`.

## Goal

Let Soundbox drive an `audiocpp_server` running on another machine, such as a
GPU box on the LAN or a homelab server, with the audio.cpp features custom
endpoints can't offer. That means model switching, extend/cover/repaint, stem
separation, voice cloning and conversion, per-model controls and delivery
flags. Custom endpoints (v0.3.0) stay the option for runtimes that aren't
audio.cpp.

Soundbox already runs all inference through `audiocpp_server` over HTTP.
`AudioCppRuntime` launches a private copy on `127.0.0.1` at a random port.
Remote mode connects to an existing server instead. Every place that assumes
the two share a disk or a process moves behind one interface.

**Gate before building:** the issue #22 user has to confirm they can run the
server with `--ui-management`. Without it there's no upload and no model load,
so nothing in this design works.

## What audiocpp_server offers

Checked against the binary in `~/tools/audio.cpp` (0.6.1) with `--help` and a
live probe, and against upstream `app/server/api.md`:

| Need | What exists | Verified |
|---|---|---|
| Listen beyond localhost | `--host <ip> --port <port>` flags | `--help` |
| Health and capabilities | `GET /health` returns `{"status","backend","models","ui","ui_management"}`. No version field | probe |
| Send a clip to the server | `POST /v1/ui/upload`, raw WAV body, returns `{"path": "<server temp path>", "bytes": n}` (needs `--ui-management`) | probe |
| Inline audio | Documented (`audio_base64`, base64 `voice_ref`) but **not in 0.6.1**: ignored, and a data URI is opened as a filename | probe |
| Model switching | `POST /v1/models/load` (absolute `path` required, takes `load_options`) and `/v1/models/unload`; several ids loaded at once; `GET /v1/models` lists loaded ids with paths | probe |
| What's installed | `GET /v1/ui/models/package-sizes`: every package this build knows, with `installed`. Asynchronous (`running` → `complete`) | probe |
| Package management | `/v1/ui/models/install`, `install-status` (job progress only, not install state), `delete`, `models-root` | already used by Soundbox; probe |
| Authentication | **None.** CORS "is not authentication" | `--help`, docs |
| Concurrency | One request per model at a time; 503 `server_busy` after `--busy-timeout-ms` (default 300 s) | docs |
| Cancel a request | **None per request.** Only killing the process | docs and our code |

`--ui-management` turns on uploads, install/delete, `models-root` **and**
`POST /v1/ui/browse-directories` (lists the server's folders) all at once.
With no auth upstream, the proxy in front decides what's reachable.

## Design

### 1. One host interface, three implementations

Revision 1 added a `spawn | remote` switch inside `AudioCppRuntime` plus an
upload shim in the adapter, which put mode branches in two places. Instead,
promote the existing `PackageInstaller` seam (`audiocpp.ts` ~772) into one
interface that managed, external and remote all implement, so `AudioCppModel`
has no mode checks:

```ts
interface AudioCppHost {
  readonly kind: "managed" | "external" | "remote";
  readonly canRunCli: boolean;                 // false for remote

  // connection and state
  health(): Promise<{ backend: string; managementOk: boolean }>;
  backendLabel(): string;                      // /health's backend remotely
  packages(): Promise<Map<string, { installed: boolean }>>;  // disk walk | package-sizes
  weightsReady(spec: ModelSpec): Promise<boolean>;           // never touches disk remotely
  resolveWeights(spec: ModelSpec): Promise<string | null>;   // a path on the HOST's filesystem
  listLoaded(): Promise<{ id: string; path: string }[]>;     // GET /v1/models

  // lifecycle
  install(pkg: string, progress?, signal?): Promise<void>;   // remote v1: throws "not supported yet"
  remove(pkg: string): Promise<void>;                        // remote: throws on ANY failure

  // inference
  ensureLoaded(req: LoadReq): Promise<string>;   // returns the id; owns residency + reload-on-lost
  run(body: object, opts: { signal?: AbortSignal }): Promise<TaskResult>;
  stage(localPath: string): Promise<string>;     // identity locally; upload + cache remotely
  release(id: string): Promise<void>;            // unload locally; no-op remotely
  cancel(id: string): Promise<{ kind: "killed" } | { kind: "abandoned"; settled: Promise<void> }>;
}
```

- **Local hosts** (managed and external) share today's spawning code and
  differ only in the models root. They keep every existing fallback: the CLI,
  the local HF downloader, and local `rm` on delete. Managed and External
  behaviour doesn't change; the existing adapter tests guard that.
- **The remote host** is a separate class. Its methods have no local fallback
  to fall into.
- **The adapter** calls `host.weightsReady` / `host.resolveWeights` instead of
  `weightsFile()`, and `host.stage()` for every path that goes into a request
  body. `serverRun`'s reload-on-"unknown model id" retry moves into
  `ensureLoaded` / `run`. `canRunCli` decides whether a CLI fallback exists at
  all.
- **`ModelManager.deleteWeights`** stops doing its own `rm` and calls
  `host.remove`. Today a failed delegated delete falls through to local `rm`
  (`manager.ts` ~407, `.catch(() => false)`). Remotely, that would wipe the
  local copy after a network error.

### 2. Setting and connection

`audiocpp_mode` gains `"remote"`. New settings:

- `audiocpp_remote_url`: for example `https://audio.homelab.lan`. URLs with
  embedded credentials are refused.
- `audiocpp_remote_auth_header`: header **name**, default `Authorization`.
- `audiocpp_remote_auth_value`: header **value**, write-only like `hf_token`,
  redacted in `GET /api/settings`, errors and logs. Name plus value covers
  Bearer, Basic, Cloudflare Access and similar.

Settings → Generation → Audio engine gets **Remote** with URL, header and
**Test connection**. Test calls `/health`, requires `ui_management: true`,
shows the server's backend and fetches `package-sizes`. Notices appear for a
URL that isn't on the LAN, for plain `http` off the LAN (the key travels in
clear) and for any URL without a header value.

Every request goes through one fetch helper:

- adds the auth header;
- uses `redirect: "error"`, so a 301/302 can't turn an upload POST into a GET
  or replay the header elsewhere;
- sets explicit undici timeouts, because Node's 300 s `headersTimeout` and
  `bodyTimeout` defaults would cut long music runs;
- maps 413 (proxy body limit), 502/504/524 (proxy timeout, and the server may
  still be running) and 503 `server_busy` to readable `ModelError`s;
- **refuses** `POST /v1/ui/models-root` and `/v1/ui/browse-directories` in
  remote mode. That's enforced in code, not only by the proxy allowlist.

The remote host never spawns, never kills and never sets the models root.
Connection state isn't the local runtime's sticky `unavailable` flag. One
failed request marks it disconnected, and the next request retries.
`makeResident`'s habit of swallowing load errors for a CLI fallback becomes a
rethrow when `canRunCli` is false. Otherwise "Test connection OK, then
generation fails with a CLI message".

`reconfigure()` or a URL change clears **local** state only: the resident set,
the upload cache and the package cache. Nothing is unloaded on the old server
(see section 5).

### 3. Weights: resolve from the catalogue, not the disk

`/v1/models/load` needs an absolute path on the server. There's no
load-by-package-id, and a relative path resolves against the server binary's
folder. The remote host builds it as:

```
<models_root from GET /v1/ui/models-root> + "/" + <relative path>
```

joined with **POSIX** separators. `path.join` on a Windows client would emit
`\`, which breaks on a Linux server. The probe showed `/` works after a
Windows root too.

The relative path comes from the catalogue, which already has it:

- **One literal `weights_glob` entry (58 of 65 entries): that file.** ACE-Step's
  four variants share `ACE-Step1.5-GGUF/`, but each names its own exact file
  (`…/turbo/ace-step-1.5-turbo-q8_0.gguf`), so there's no "largest match"
  guesswork. Apply the existing prefix stripping (`onDisk`).
- **Several entries (7: PocketTTS ×5, MiniMax Music 3, MiniMax H3): the
  package folder** (`audiocpp_target_dir`), loaded as a directory.
- **A wildcard pattern** (only possible in a user's `custom.json`) is refused
  in remote mode with a message asking for an exact file. No new catalogue
  field is needed.

Readiness is `package-sizes` saying `installed`. The `weights_required`
`existsSync` check and the `stat` of `weights_path` are skipped remotely.

A catalogue package **missing** from `package-sizes` is one the remote's
audio.cpp doesn't know (version skew). It shows as "not supported by the
server's audio.cpp". `/health` has no version, so `package-sizes` is the only
skew signal.

### 4. Files: stage, then send the server's path

`host.stage(localPath)` replaces the six local paths in request bodies:
`genBody` `audio` (edits), `speak` `voice_ref`, `convert` `audio` and
`voice_ref`, `separate` `audio`.

- Remote: `POST /v1/ui/upload` with the **raw** WAV body (multipart is stored
  with its boundaries). Base64 isn't in 0.6.1.
- **Cache per connection epoch**, keyed by content hash. The epoch bumps on
  any `/health` failure and any change to the URL or auth header. A different
  machine behind the same URL can have a different file at the same temp path,
  so a stale entry must never be reused.
- On `could not open WAV input`, evict the entry, re-upload and retry once.
  That's safe because it fails at input open, before any compute.
- Windowed extend writes a new temp WAV per window (`service.ts` ~1139), so
  each window is a fresh upload with no cache hits. Fine for v1; note it.
- Uploads pile up on the server: there's no delete endpoint, and the server
  never cleans its `audiocpp-ui-*` temp folders (about 300 empty ones on the
  probe machine from Soundbox's own starts). The docs tell admins to clear
  them, and the leak gets reported upstream.

### 5. Shared servers: ids, residency and cancel

Several Soundbox installs can share one server, which changes three things.

- **Ids are content-derived:** `spec.id` + a short hash of the server-side
  weights path and `load_options`. Two clients share a resident model only
  when they'd load exactly the same thing, so neither swaps the other's model
  out (`reconfigured: true`) and the GPU never holds duplicates. Per-install ids
  were rejected because they'd load the same weights twice.
- **Residency** is checked against `GET /v1/models` (id **and** path), not a
  cached local set. That happens lazily: before loading, and on
  "unknown model id" (eviction by LRU, idle unload or another client). A
  model can have a *set* of resident ids (variants), all tracked.
- **Remote mode never unloads.** One client's unload, or Soundbox's idle tick,
  would evict a model another client is using. The server's `--idle-unload-ms`
  does cleanup. The cost is VRAM held after Soundbox exits, which the recipe
  documents.
- **Cancel detaches.** The job gets `CancelledJob` immediately. The request
  keeps settling in the background, recorded as
  `abandoned[id] = settled`. The next request for that id waits on it, with a
  cap, showing "Waiting for the cancelled run to finish" instead of hanging
  for up to `--busy-timeout-ms` and then failing with 503. Locally, cancel
  still kills the process as it does today.

### 6. Running the server: a hardened recipe, not our own server

No Soundbox-specific server. The issue #22 user already runs
`audiocpp_server` behind Caddy, and a packaged server would be a third thing
to keep in step with audio.cpp, with its own CUDA builds. If skew ever becomes
unmanageable, the fallback is to run **Soundbox headless on the GPU box**. Its
Fastify server is already an audio.cpp front end that matches its own
catalogue. That's noted here and not built.

`docs/AUDIOCPP.md` gets a **Remote server** section, shipped in v1 and not
deferred:

- A compose file on the upstream image (`ghcr.io/0xshug0/audio.cpp`, which
  already contains `audiocpp_server`), published on `127.0.0.1` only.
- A complete **Caddyfile** (nginx equivalent alongside) with:
  - auth (a header token or Basic);
  - a **route allowlist**: `/health`, `/v1/models*`, `/v1/tasks/run`,
    `/v1/ui/upload`, `/v1/ui/models/package-sizes`, `GET /v1/ui/models-root`,
    with everything else, including `browse-directories` and the WebUI,
    denied;
  - a body limit that fits a long upload (nginx's 1 MB `client_max_body_size`
    default would 413);
  - read timeouts that fit a long music render, and a long base64 response.

## Probe results (2026-10-24)

Probed against `audiocpp_server` from `~/tools/audio.cpp` (the 0.6.1 release
`SOUNDBOX_AUDIOCPP_BIN` points at), CUDA backend, with the installed HTDemucs
package (`htdemucs_q8_0`, stem separation), chosen because it takes input
audio. Each request went to a live server on a spare local port.

| # | Question | Answer |
|---|---|---|
| 1 | Load by id or by path? | **Path, absolute.** No package-id field; a missing `path` is a 500. Relative paths resolve against the binary's folder. `models_root + "/" + relative` loads in ~1.9 s. |
| 2 | Upload lifetime? | **Until deleted.** It survives the task and a server restart. There's no delete endpoint, and temp folders are never cleaned (a small upstream leak). |
| 3 | `audio_base64` on `/v1/tasks/run`? | **No, not in 0.6.1.** Ignored nested or flat (`requires an audio contract`); a data URI in `audio` is opened as a filename. Upload, then path works (200, four stems, 0.75 s). |
| 4 | `load_options` for variants? | **Yes.** Accepted on load; the same id with new options returns `reconfigured: true`; two ids can be loaded at once. Unknown options are accepted silently. Not checked end to end with a real variant, since PocketTTS isn't installed in this build. |
| 5 | Detect version skew? | **`GET /v1/ui/models/package-sizes`.** It lists every package the build knows (145 here) with `installed`. Kokoro, Chatterbox-Turbo and HTDemucs-6stems are on disk but missing from 0.6.1's list, which is exactly the skew case. `install-status` can't tell: it answers "Not started" even for unknown ids. |

Other things the probe turned up:

- The separation response is `named_audio_outputs` (base64 WAV each) plus
  `timing`, which `decodeAudio` already handles. No output paths come back.
- On Windows, a plain `taskkill` doesn't stop `audiocpp_server`; it needs `/F`.
  That doesn't affect Soundbox, which kills its child with `proc.kill()`.
- Version skew is real on this machine: the pinned 0.6.1 binary is older than
  the build that installed Kokoro and Chatterbox-Turbo.

### Still to probe (before or during step 2)

1. **Through a real proxy:** a large upload and a long music response through
   Caddy and nginx with the recipe's settings. Body limits, read timeouts.
2. **Busy scope:** is `server_busy` per model or global? Does a load block runs
   on other models? What happens on out-of-memory with two large models
   loaded?
3. **Cancel:** with a small `--busy-timeout-ms`, does the server stop
   computing when the client disconnects? (Assumed no.)
4. **Routing:** are the WebUI, `browse-directories` and the API on one port
   and prefix in a way a proxy allowlist can separate?
5. **Upload safety:** does `/v1/ui/upload` take a client-supplied filename
   (path traversal), and do concurrent uploads of the same content collide?
6. **Load a multi-file package as a directory** (PocketTTS or MiniMax) and one
   prefixed package, on a build that knows them.

## Re-probe on v0.9.2 (2026-10-25)

The first probes ran on 0.6.1, the binary this machine happened to pin. The
current release is **v0.9.2** (git `0097d365`, 2026-10-15), so the same probes
ran again on its CPU build, plus a read of its server source at that tag.

| Finding (0.6.1) | On v0.9.2 | Effect on this design |
|---|---|---|
| `audio_base64` not supported | **Works**, flat or nested in `request`: HTDemucs split an inline clip into 4 stems | §4: send clips **inline** when they fit (the documented voice-reference cap is 5 MiB); upload only larger ones. Small requests leave nothing on the server's disk. |
| Uploads accumulate, temp folders never cleaned | Upstream **removes** its `audiocpp-ui-*` folder on a clean shutdown (`app/server/runtime.cpp`, server destructor). The ~290 empty folders on this machine come from **Soundbox hard-killing its own child** (`proc.kill()` is TerminateProcess on Windows). | Not an upstream bug. Our fix: stop the managed server gracefully where possible, and sweep stale `audiocpp-ui-*` folders at startup. Remote uploads are still never deleted while a server runs; prefer inline. |
| Load needs an absolute path; relative resolves against the binary | **Unchanged.** Load by `models_root + "/" + relative` took 0.35 s | §3 unchanged. |
| `install-status` says "Not started" for unknown ids | **Unchanged** | §3 unchanged: `package-sizes` is the install and skew signal. |
| `package-sizes`: 145 packages | **373 packages**, now including Kokoro, Chatterbox-Turbo and HTDemucs-6stems | Confirms the earlier "unknown package" cases were version skew. |
| No auth | **Still none.** `--frontend-listener https|websocket` is new (transport, not auth) | §2 and §6 unchanged: a proxy with auth stays required. |
| `--ui-management` is all or nothing | **Unchanged**: `browse-directories` listed `C:\` with no credentials | §6's route allowlist stays mandatory. |
| `/health` has no version | **Unchanged** (`--version` exists on the CLI) | Skew detection stays on `package-sizes`. |
| — | Uploads are allowed with `--ui` **or** `--ui-management`; the header filename is sanitised (`safe_upload_name`), and the limit is 2 GiB | A config-driven server (`--config` with fixed models, `--ui`, no management) could serve uploads without exposing model management. Worth a v2 "locked-down server" mode. |

**This machine is out of date:** both the managed install
(`~/.soundbox/bin/audiocpp/release-0.6.1`) and the `SOUNDBOX_AUDIOCPP_BIN` pin
(`~/tools/audio.cpp`) are 0.6.1. Soundbox installs `latest` only at install
time and never upgrades, so existing installs stay on whatever they got.
Separate from this proposal, but it means the app can't run every catalogue
family it lists.

## Plan

1. ~~**Probe**~~: done (0.6.1, then re-probed on v0.9.2). Review: done.
2. **v1, the smallest useful slice for issue #22:**
   - the `AudioCppHost` interface, with the local host extracted unchanged;
   - the remote host: settings, auth header, fetch helper (redirects,
     timeouts, error mapping, banned routes), Test connection;
   - read-only state from `package-sizes`, weights resolution, content-derived
     ids, lazy residency, no unloads;
   - generate and speak with built-in voices;
   - `stage()` uploads, which unlock edits, cloning, separation and voice
     conversion;
   - cancel detach with the abandoned-request wait;
   - the hardened recipe (compose + Caddyfile + nginx) in `docs/AUDIOCPP.md`.
3. **Later:** remote install and delete (until then, remote `install`/`remove`
   throw "not supported yet", and the UI hides Download and Delete in remote
   mode), `load_options` variants remotely (until then a variant request fails
   clearly), remote `custom.json` paths (POSIX or drive-letter
   `weights_path`).

## Tests

- **Fake `audiocpp_server`** (HTTP stub): auth header on every call; no spawn
  and no kill in remote mode; `redirect: "error"`; banned routes refused;
  413/502/503/504/524 mapping; `package-sizes` running → complete; upload cache
  epochs and evict-then-retry; abandoned-request wait; **remote delete or
  download never touches local disk** (the `manager.ts` ~407 fall-through).
- **Real binary**, gated by an env var, against 0.6.1 and HTDemucs: raw upload
  then separate; load with `root + "/" + rel`; `load_options` and
  `reconfigured`; the exact `unknown model id` and `could not open WAV input`
  strings; restart then retry; cancel then the next request with a small
  `--busy-timeout-ms`; a `package-sizes` skew entry. The fake server only
  proves what we guessed, and these pin what the server really does.
- Existing adapter tests stay green: Managed and External must not change.

## Review (2026-10-24)

Two agents reviewed revision 1 against the code: an architecture reviewer and
a correctness reviewer, then a cross round on their disagreements. Agreed
changes, all folded in above:

| Change | From | Section |
|---|---|---|
| One `AudioCppHost` interface instead of a runtime switch plus an upload shim | Architect; Reviewer added `weightsReady`, `listLoaded`, `backendLabel` and the `settled` promise on cancel | 1 |
| A failed remote delete must never fall through to local `rm`; no local HF download remotely | Reviewer (S1) | 1, 3, Tests |
| Remote mode must not need a local binary; `makeResident` rethrows; own reconnect state | Reviewer (S2) | 1, 2 |
| Step 2 couldn't run as planned: state and weights paths came from the local disk | Architect | 3, Plan |
| Weights path from the existing literal `weights_glob` (58/65) or the package folder (7), POSIX join | Both proposed a new field; checking the catalogue showed it isn't needed | 3 |
| Content-derived ids, path check via `GET /v1/models`, never unload remotely | Architect; Reviewer conceded in the cross round | 5 |
| Cancel detaches; the next request waits on the abandoned run, with a cap | Reviewer (S5), Architect agreed | 5 |
| Upload cache per connection epoch, evict before retry | Reviewer (S6) | 4 |
| Auth as header name + value; `redirect: "error"`; redaction; banned routes in code; explicit timeouts; 413/5xx mapping | Both (S7, S8) | 2 |
| Hardened Caddyfile with route allowlist, body and timeout limits, in v1 | Architect | 6 |
| Defer remote install/delete, variants and remote `custom.json` | Architect, Reviewer agreed | Plan |
| Confirm the issue #22 user can enable `--ui-management` first | Architect | Goal |

Not adopted: a Soundbox-specific server (both agreed upstream is right; the
headless-Soundbox fallback is noted instead), and per-install id namespacing
(it would duplicate weights in VRAM).
