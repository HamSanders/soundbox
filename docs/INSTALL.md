# Installing

The base install contains no model runtimes: no torch, and no GPU Python wheel
to match to your hardware. Every model runs through [audio.cpp](AUDIOCPP.md),
a native binary with its own CUDA/HIP/Metal/Vulkan/CPU backends, selected
automatically at install time. There is no Python above it either. The server
is TypeScript on Node (Fastify), with the MCP server mounted in the same
process.

## Requirements

- **Node 22.12+** and `git`. This covers the server, the web app, the CLI and
  the MCP server. The repo's `.nvmrc` says `22`, so `nvm use` picks a matching
  version.
- **For the desktop shell only** (`npm run desktop` / `npm run desktop:build`):
  Rust (stable toolchain, installed with [rustup](https://rustup.rs)) and the
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your
  OS. On Windows that is Microsoft C++ Build Tools and WebView2 (preinstalled
  on Windows 11); on macOS, Xcode Command Line Tools; on Linux, `webkit2gtk`
  4.1 and the other system packages listed on that page. See
  [DESKTOP.md](DESKTOP.md).
- Optional: `ffmpeg` on `PATH` for MP3 export.

## Running the `konchi` CLI from a clone

The CLI is not published to npm, so every `konchi …` command on this page
runs from your checkout. Run `npm install` at the repo root, then either build
once and use the linked binary:

```bash
npm run build          # builds the app and the server into server/dist
npx konchi --help    # from the repo root; npm links the bin there
```

or skip the build and run the TypeScript source directly:

```bash
npx tsx server/src/cli.ts --help
```

Both take the same subcommands. `npx konchi` with no subcommand starts the
server. `npm run dev` starts the server and the Vite dev server for the UI.

## Step 1: the audio.cpp runtime

```bash
konchi model install audiocpp
```

This downloads and verifies a prebuilt `audiocpp_cli` for your platform. Check
what was installed with `konchi model status audiocpp`. To use a binary you
built or downloaded yourself, set `KONCHI_AUDIOCPP_BIN`.

Verify with `GET /api/health`. Its `device` field shows the backend the binary
picked.

## How the native binaries are managed

Konchi ships and vendors no native binaries. It uses three, each fetched
from upstream GitHub releases on demand and cached under your data directory:

| Binary | Upstream | What it is | When it's fetched |
|---|---|---|---|
| `audiocpp_cli` | [`0xShug0/audio.cpp`](https://github.com/0xShug0/audio.cpp) | the audio inference runtime | `konchi model install audiocpp` |
| `llama-server` | [`ggml-org/llama.cpp`](https://github.com/ggml-org/llama.cpp) | the optional prompt assistant | `konchi model install llm`, and only when the prompt assistant is set to *managed* |
| `sd-server` | [`leejet/stable-diffusion.cpp`](https://github.com/leejet/stable-diffusion.cpp) | the optional artwork generator | when you turn artwork on in the setup wizard or Settings → Generation (`POST /api/image/engine/install`) |

Nothing is downloaded until you ask for it, and nothing is installed
system-wide. The cache is per user, so uninstalling means deleting a folder.

```
<data dir>/bin/audiocpp/<version>/    audiocpp_cli, plus any companion runtime libraries
<data dir>/bin/llama/<version>/       llama-server, same layout
<data dir>/bin/sd/<version>/          sd-server, same layout
```

All three live beside `models/`, not inside it, so you can clear runtimes and
weights independently. Deleting your models keeps the engine, and reinstalling
the engine keeps your weights. Each version gets its own directory and the
most recently installed one wins, so an upgrade never overwrites the copy you
are running.

Downloads are checksum-verified before anything is unpacked: against GitHub's
SHA-256 digest for the asset, and against the release's checksum manifest when
it publishes one. An asset covered by neither is refused. To install such a
release anyway, set `KONCHI_ALLOW_UNVERIFIED_BINARIES=1` for that run, or
download the binary yourself and point the environment override below at it.

### Resolution order

When Konchi needs one of these binaries it checks, in order:

1. the environment override (`KONCHI_AUDIOCPP_BIN`,
   `KONCHI_LLAMA_SERVER_BIN` or `KONCHI_SD_SERVER_BIN`), an absolute path
   to a binary of yours;
2. the managed install under `<data dir>/bin/`;
3. `PATH`;
4. on macOS, `/opt/homebrew/bin` and `/usr/local/bin` directly. A server
   spawned by a desktop launcher often inherits a `PATH` without Homebrew, so
   a `brew install`ed binary would otherwise be missed.

The managed install is checked before `PATH` so that a binary you installed
through Konchi wins over a stray system-wide copy.

The backend is detected per machine (Metal on Apple silicon, CUDA where
`nvidia-smi` answers, Vulkan or CPU otherwise) and decides which release asset
is downloaded. Override the detection with `KONCHI_AUDIOCPP_BACKEND`,
`KONCHI_LLAMA_SERVER_BACKEND` or `KONCHI_SD_SERVER_BACKEND`, or pin the
download with `--backend` and `--version` on `install`. See
[AUDIOCPP.md](AUDIOCPP.md#choosing-a-backend).

### Checking and installing

```bash
konchi model status audiocpp                 # version, backend, resolved path
konchi model install audiocpp
konchi model install audiocpp --backend cuda --version 0.6.1

konchi model status llm
konchi model install llm                     # engine plus the default model
konchi model install llm --engine-only       # engine only, no weights
```

`status` shows whether the binary is managed or your own. A managed install
reports its version. A bring-your-own binary reports `external (env)` or
`external (PATH)` with no version, since Konchi did not install it.
`konchi model status llm` also lists the prompt-assistant models and whether
each is downloaded.

For the bring-your-own routes (prebuilt packages, the Homebrew tap, building
from source), see [AUDIOCPP.md](AUDIOCPP.md#using-a-binary-you-already-have).

## Step 2: models

```bash
konchi list                                            # the catalog
konchi pull audiocpp-stable-audio-3-sfx                 # download weights
konchi run  audiocpp-stable-audio-3-sfx "glass breaking" --out test.wav
```

You can also use the Models page in the app, which has the same catalog and
downloads. The audio models need no account. See Step 3 for the one download
that does.

Each model is an audio.cpp package of GGUF files (the catalog entry's
`weights_glob` names them). Konchi downloads only those files, not the whole
Hugging Face repo.

The catalogue has two tiers. **Listed** models appear in the picker and are
ready to download. **Extras** are catalogued but hidden until you enable them
under "Enable more models" on the Models page. They run through the same code
path, and enabling one adds it to the picker immediately.

Every model shows its licence before you download it. Some licences allow
open use of the weights but forbid selling what the model makes.

## Step 3: gated models

The audio models come from audio.cpp's GGUF repo (`audio-cpp/audio.cpp-gguf`),
which is not gated. Their licences still apply, but there is nothing to sign.
The optional artwork model, Stable Diffusion 3.5 Medium, is gated on Hugging
Face, as is any custom catalog entry pointing at a gated repo. Konchi cannot
accept the terms for you.

1. Sign in to Hugging Face and accept the licence on the model page
   (`huggingface.co/stabilityai/stable-diffusion-3.5-medium`).
2. Create a **read** token at <https://huggingface.co/settings/tokens>.
3. Paste it into Settings in the app (or set `HF_TOKEN` in your environment).

The token is stored in `~/.konchi/settings.json` and is never returned by
the API. `GET /api/settings` reports only the boolean `hf_token_set`.

## Optional extras

There is nothing to install here. Loudness normalisation is an EBU R 128 meter
written in TypeScript in `server/src/audio/dsp.ts` and is always on. If
metering fails on a pathological input, the code falls back to peak
normalisation and logs it.

MP3 export needs `ffmpeg` on `PATH`. Without it, `/files/{id}.wav?format=mp3`
returns 501 and WAV still works.

## Where things go

```
~/.konchi/
  soundbox.db     library index
  sounds/         generated WAVs (move this one on its own from Settings)
  cache/          mp3 transcodes
  models/         model weights (HF cache lives here)
  bin/audiocpp/   the audio.cpp runtime, one directory per version
  bin/llama/      the prompt-assistant engine, same layout
  bin/sd/         the artwork engine, same layout
  konchi-<port>.log   the server log (rotated)
  settings.json   settings, including the HF token
```

To uninstall, delete that folder. Override the location with
`KONCHI_DATA_DIR` or `konchi --data-dir`. You can move the folder safely:
downloaded weights are picked up in the new place, and an interrupted download
resumes.

The sounds folder can move on its own. Settings → Storage → **Sounds folder**
points new and existing audio at any path, so the library can live on a large
or backed-up disk while the weights stay put. **Browse** opens a folder picker
over the filesystem of the machine running the server. If the folder does not
exist yet, it is created on save.

## Docker

For a server or NAS: the server and web UI in one container, no desktop app.
From a checkout (or just the two compose files):

```bash
docker compose up -d
```

and open <http://localhost:17494>. The audio.cpp runtime is already in the
image, so skip Step 1: download a model from the Models page, or

```bash
docker compose exec konchi konchi pull audiocpp-stable-audio-3-sfx
```

That pulls the prebuilt image, `ghcr.io/hamsanders/soundbox:latest`. Each
release is also tagged by version (`:v0.4.0`), so change the `image:` line to
pin one. Prebuilt images are amd64 only for now. On arm64, or to run your own
changes, build from the checkout with the build override:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Without Compose:

```bash
docker run -d --name konchi -p 127.0.0.1:17494:17494 \
  -v soundbox-data:/data -v soundbox-models:/data/models \
  ghcr.io/hamsanders/soundbox:latest
```

or build it yourself with `docker build -t konchi .` and run `konchi` in
place of the image name.

**No authentication.** The server has no login of any kind. Anyone who can
reach the port can generate audio, read and delete your library, change
settings (including the stored Hugging Face token) and drive every MCP tool.
The examples publish the port on `127.0.0.1` only. To use it from other
machines, put it behind a reverse proxy that does authentication — Caddy or
nginx with basic auth, Authelia, Authentik, a Tailscale/WireGuard-only
listener — and do not publish `0.0.0.0:17494` on a network you do not
control.

**Volumes.** The container's `/data` is the whole of `~/.konchi` (see
[Where things go](#where-things-go)); `/data/models` is the weights, mounted
separately so tens of gigabytes can live on another disk. The container runs
as uid 1000. Named volumes just work; with host folders, create them first and
`chown 1000:1000` them, since a folder Docker creates for you is owned by root
and the server cannot write to it.

**Binding.** Inside the container the server listens on `0.0.0.0` (`--host
0.0.0.0`, the image default) — loopback inside a container is unreachable
from the published port. It logs a warning about binding beyond loopback on
every start; that is expected here, and is the reason for the paragraph above.

**`KONCHI_ALLOWED_HOSTS` and the MCP endpoint.** `/mcp` checks the `Host`
header (and `Origin`, when a browser sends one) against loopback and answers
**403** to anything else, so a web page cannot reach your server through DNS
rebinding. `http://localhost:17494/mcp` from the Docker host passes as is.
Reach it by any other name — a LAN IP, a proxy hostname — and that name has
to be listed in `KONCHI_ALLOWED_HOSTS`:

```bash
-e KONCHI_ALLOWED_HOSTS=konchi.example.lan,192.168.1.20:17494
```

A bare `host` matches that name on any port; `host:port` matches only that
port. A reverse proxy that rewrites `Host` to `127.0.0.1` also passes, but
forwarding the original host and listing it is the clearer setup. In the
container the server binds `0.0.0.0`, which turns off the `Host` check for the
web UI and `/api/*`, so there only `/mcp` needs the list. Outside Docker every
request is checked; see
[Reverse proxy or another machine](#reverse-proxy-or-another-machine).

## Reverse proxy or another machine

By default everything listens on loopback, and the server answers **403
Forbidden host** to a request whose `Host` header is not `localhost`,
`127.0.0.1` or `::1`. That is the defence against DNS rebinding. There is no
authentication, so anything you open up should sit behind a proxy that has
some.

**Built app (`konchi`, the desktop app) behind Caddy or nginx.** Keep the
server on `127.0.0.1` and list the name the proxy forwards as `Host`:

```bash
KONCHI_ALLOWED_HOSTS=konchi.example.lan konchi
```

That one list feeds every check: the `Host` allowlist for the UI and
`/api/*`, the MCP endpoint's `Host` check, and the trusted browser origins
(CORS and the MCP `Origin` check). A bare `host` matches that name on any
port; `host:port` matches only that port, so write
`konchi.example.lan:8443` to accept nothing else. Binding a specific address
with `--host 192.168.1.20` also accepts that address as `Host` for the UI and
`/api/*`, but `/mcp` still wants it listed.

**Dev mode (`npm run dev`).** Vite serves the UI on localhost:5174 and proxies
`/api`, `/mcp`, `/files` and `/artwork` to the server, which stays on
`127.0.0.1`. Two variables open it up:

- `KONCHI_DEV_HOST` is the address Vite listens on (`0.0.0.0` for every
  interface, or one LAN IP). Unset, Vite stays on localhost. `scripts/dev.mjs`
  warns when it is set to anything else.
- `KONCHI_ALLOWED_HOSTS` is also handed to Vite's `server.allowedHosts`
  (ports dropped), so Vite stops answering "Blocked request" for those names,
  and the server trusts them as origins.

```bash
KONCHI_DEV_HOST=0.0.0.0 KONCHI_ALLOWED_HOSTS=konchi.example.lan npm run dev
```

Behind a proxy on the same machine, `KONCHI_ALLOWED_HOSTS` alone is enough;
point the proxy at `127.0.0.1:5174`. Vite accepts IP addresses as `Host` on
its own, so a LAN IP only needs `KONCHI_DEV_HOST`.

**NVIDIA GPUs.** The default image is CPU-only and runs anywhere (amd64, and
arm64 when built from source). For CUDA, install the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
on the host, check that `docker run --rm --gpus all ubuntu nvidia-smi` lists
your GPU, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.cuda.yml up -d
```

which pulls `ghcr.io/hamsanders/soundbox:cuda` (per release:
`:v0.4.0-cuda`). To build it locally, add both build overrides:

```bash
docker compose -f docker-compose.yml -f docker-compose.cuda.yml   -f docker-compose.build.yml -f docker-compose.build-cuda.yml up -d --build
```

By hand:

```bash
docker run -d --gpus all -p 127.0.0.1:17494:17494 \
  -v soundbox-data:/data -v soundbox-models:/data/models \
  ghcr.io/hamsanders/soundbox:cuda
```

or build it:

```bash
docker build -t konchi:cuda \
  --build-arg AUDIOCPP_TAG=full-cuda12 --build-arg AUDIOCPP_BACKEND=cuda .
docker run -d --gpus all -p 127.0.0.1:17494:17494 \
  -v soundbox-data:/data -v soundbox-models:/data/models konchi:cuda
```

`full-cuda12` is built on CUDA 12.9 and needs a driver that supports it
(575 or newer on GeForce cards); `full-cuda13` is the alternative for newer
drivers. Expect the CUDA image to take about 10 GB of disk, most of it the
CUDA runtime; the CPU image is about 3.5 GB. `full-vulkan` with
`AUDIOCPP_BACKEND=vulkan` covers AMD and Intel GPUs, run with
`--device /dev/dri` and the host's `render`/`video` groups added.

**How the image is built.** It starts from
[audio.cpp's own published images](https://github.com/0xShug0/audio.cpp/blob/main/docs/docker.md)
(`ghcr.io/0xshug0/audio.cpp:full-<backend>`), which carry `audiocpp_cli`, its
backend libraries and ffmpeg, and adds Node and Konchi on top.
`KONCHI_AUDIOCPP_BIN` points at that binary, so `konchi model install
audiocpp` is never needed — and `KONCHI_AUDIOCPP_BACKEND` is set from the
build arg rather than detected, so a CPU image given `--gpus` does not ask its
binary for a CUDA backend it lacks. Upstream's tags move daily; pass a dated
one (`--build-arg AUDIOCPP_TAG=full-cuda12-<date>-<sha>`) for a reproducible
build. The prompt assistant's managed `llama-server` is not in the image —
point the assistant at an external OpenAI-compatible endpoint instead.

## Windows notes

**Keep the data directory path short.** The Hugging Face cache layout adds
about 130 characters to `KONCHI_DATA_DIR`, and Windows caps paths at 260
unless long paths are enabled. Past that limit a download fails partway
through with *"The system cannot find the path specified"*, even though the
directory exists. Konchi detects this and tells you. To fix it, do one of:

- use a short data dir: `set KONCHI_DATA_DIR=C:\konchi` (the default
  `%USERPROFILE%\.konchi` is short enough for a normal username), or
- enable long paths once, in an **admin** PowerShell, then reboot:

  ```powershell
  New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
  ```

Files already downloaded are kept. Move the folder and the download completes.


## Troubleshooting

**Where the logs are.** Every run writes a rotating log file to
`<data_dir>/konchi-<port>.log` (3 x 10MB, so `.1`/`.2` may exist too)
alongside the console output. `konchi --data-dir` or `KONCHI_DATA_DIR`
sets the location, and the server prints the exact path at startup. Every
job-related line is tagged with its job id, so
`grep <job-id> konchi-17494.log` shows everything that happened in one
generation. Without shell access, `GET /api/logs?lines=200` returns the tail
of the same file as JSON.

**A job sits in "Queued" for a long time.** The job queue is a single-worker
FIFO. The GPU runs one generation at a time, so everything behind the current
job waits. `GET /api/jobs/{id}` (and the app's job panel) reports
`queue_position` and a rough `eta_s` for queued jobs. Check what is `running`
with `GET /api/jobs` (or the log file) before assuming something is wrong.

**A sound plays but you hear nothing, and the clock stays at 0.0s.** The
output device your browser is using has stopped consuming audio. The usual
cause is a wireless headset that is off or out of range. Windows still lists
the endpoint as present, so `play()` succeeds, the button flips to Pause, no
error is raised, and the position never advances. Konchi detects this and
tells you. Go to **Settings → Playback device**, pick another output, and
click **Play test tone** to confirm.

**The UI loads but the Models page is empty / everything 502s.** The backend
is not running. Vite is serving the frontend on 5174 but its proxy target on
17494 is down. `npm run dev` from the repo root starts both. If you started
Vite alone (`npm run dev:ui`), start the backend separately.

**`konchi model status audiocpp` says not installed.** Run
`konchi model install audiocpp`, or set `KONCHI_AUDIOCPP_BIN` to a binary
you built or downloaded yourself.

**A model says Installed but Load fails.** The download was interrupted and
the cache is partial. Click Download again; it resumes. (Konchi writes a
completion marker at the end of a download and does not mark a model
installed without it, so this should be rare.)

**CUDA out of memory.** Only one model is resident at a time, but a long clip
can still exhaust a small card. Shorten the clip, or unload the model.

**Downloads fail with 401/403.** The repo is gated and you have not accepted
its terms, or the token is missing. See step 3.

**MCP client can't connect.** The endpoint is `http://127.0.0.1:17494/mcp`
with no trailing slash. If you bound a non-loopback host with `--host`, also
set `KONCHI_ALLOWED_HOSTS=your.host` (or `your.host:port` to accept only that
port), or the MCP endpoint's DNS-rebinding check answers 403.

**403 "Forbidden host" through a reverse proxy.** The proxy forwards a `Host`
the server does not know. List it in `KONCHI_ALLOWED_HOSTS`; see
[Reverse proxy or another machine](#reverse-proxy-or-another-machine).

## Environment variables

Server-side variables are read by the process running `konchi` (or
`npm run dev`, or the desktop shell, which passes its environment through).

| Variable | Read by | What it does |
|---|---|---|
| `KONCHI_DATA_DIR` | server | Install root. Default `~/.konchi`; `--data-dir` does the same per run. |
| `KONCHI_AUDIOCPP_BIN` | server | Absolute path to an `audiocpp_cli` of yours; nothing is downloaded. |
| `KONCHI_LLAMA_SERVER_BIN` | server | Same, for `llama-server`. |
| `KONCHI_SD_SERVER_BIN` | server | Same, for `sd-server`. |
| `KONCHI_AUDIOCPP_BACKEND` | server | Force the audio.cpp backend instead of auto-detecting (`cuda`, `hip`, `metal`, `vulkan`, `cpu`). |
| `KONCHI_LLAMA_SERVER_BACKEND` | server | Same, for the `llama-server` download. |
| `KONCHI_SD_SERVER_BACKEND` | server | Same, for the `sd-server` download. |
| `KONCHI_ALLOW_UNVERIFIED_BINARIES` | server | `1` installs an engine archive that no published SHA-256 covers. Off by default; a checksum *mismatch* is refused regardless. |
| `KONCHI_ALLOWED_HOSTS` | server, Vite | Comma-separated `host` (any port) or `host:port` (that port only). Adds `Host` values the server accepts (UI, `/api/*` and `/mcp`) and trusted browser origins (CORS and the MCP `Origin` check); under `npm run dev` also Vite's `server.allowedHosts`. See [Reverse proxy or another machine](#reverse-proxy-or-another-machine) and [SECURITY.md](https://github.com/HamSanders/soundbox/blob/main/SECURITY.md). |
| `KONCHI_DEV_HOST` | `npm run dev`, Vite | Address the Vite dev server listens on (`0.0.0.0`, a LAN IP). Default localhost. The server stays on `127.0.0.1`. No authentication, so open it up only on a network you trust or behind a proxy that has some. |
| `KONCHI_LOG_LEVEL` | server | `debug`, `info` (default), `warning`, `error` or `critical`; `warn` works too. Used when `--log-level` isn't given, so it reaches `npm run dev`, Docker and the desktop app, none of which pass the flag. The startup banner shows the level in force; an unknown value logs a warning and runs at `info`. At `debug`, every request to the prompt assistant, artwork and custom endpoints is logged with its full URL, HTTP status and timing. Custom endpoints also log the body's field names. Keys, headers, prompts and lyrics are never logged. For the desktop app, set it as a user environment variable (Windows) or with `launchctl setenv` (macOS), then restart the app. |
| `PORT` | server, Vite | The Vite dev server's port (default 5174); the server also trusts it as a dev origin. |
| `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` | server | Hugging Face token for gated models, used when none is saved in Settings. |
| `HF_HOME` | server | Hugging Face cache location. Left alone if set; otherwise Konchi points it at `<data dir>/models`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server | OpenTelemetry collector for MCP call traces and metrics. Wins over the Settings value. |
| `KONCHI_URL` | stdio MCP bridge | Where the running server is. Default `http://127.0.0.1:17494`. |
| `KONCHI_PORT` | `npm run dev`, Vite | Port `scripts/dev.mjs` starts the server on, and the port Vite proxies `/api`, `/mcp`, `/files` and `/artwork` to. Default 17494. The `konchi` CLI itself takes `--port`. |
| `KONCHI_NODE` | desktop shell | Node interpreter to run the built server with, if `node` is not on `PATH`. |
| `KONCHI_PROJECT_ROOT` | desktop shell | Path to the checkout, if the shell cannot find it from its own location. |
| `VITE_MOCK` | app build | `1` runs the UI against the in-browser fake backend (`npm run dev:mock` sets it). |
| `VITE_REPO_URL` | app build | Repository URL used in the app's links. Default `https://github.com/HamSanders/soundbox`. |
| `VITE_SITE_ORIGIN` | app and site builds | Absolute origin for canonical URLs and the site's RSS feed. |

The server sets `KONCHI_LOG_FILE` for its own use; you do not need to.
