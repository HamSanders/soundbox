# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **An optional access token.** Set `SOUNDBOX_API_TOKEN` and every API, MCP and file request needs it, so a Soundbox on a rented GPU or a LAN box is no longer open to anyone who can reach its port. The web UI asks for the token once and stays signed in for 30 days; scripts and MCP clients send it as a bearer header, and the stdio bridge and CLI pick it up from the environment. The health check stays open. Off by default, so a desktop install is unchanged.

### Changed
- The site's download page has a new design: a full-width hero, the Soundbox film in a frame that flattens as you scroll, live GitHub numbers and a card per installer.

### Fixed
- `soundbox ps` asked the server for `/models` instead of `/api/models`, so it always reported that no server was running.
- Security: updated dependencies with open advisories: the system information library, the HTTP server adapter, and the desktop updater's zip support (Dependabot alerts).

## [0.4.1] - 2026-10-29

### Added

- **Device tools for agents.** `soundbox.add_device`, `soundbox.set_device`
  and `soundbox.remove_device` put a device on a story track, turn its knobs or
  bypass it, and take it off, with the same eight kinds, knobs and ranges as the
  studio's rack. Over-range values land at the end of the knob and are reported;
  unknown knobs are an error. An open studio shows the change as it lands.
  `soundbox.get_story` now returns each track's chain. Devices are still heard
  on the timeline only; `export_story` mixes dry.

- **Docker images publish with each release.** When a release is tagged,
  `ghcr.io/hamsanders/soundbox:<version>` and `:<version>-cuda` are built and
  pushed automatically; a full release also moves `latest` and `cuda`.
- **A download page on the site.** `/download` links the latest release's
  installers directly, picks the visitor's OS, plays the 30-second Soundbox
  film and shows live GitHub stars, downloads and forks. Every Download CTA on
  the site points at it.
- **Prebuilt Docker images.** `ghcr.io/hamsanders/soundbox` is published per
  release (`:vX.Y.Z`, `:vX.Y.Z-cuda`, plus `:latest` and `:cuda`) by a manual
  `docker-publish` workflow. `docker compose up -d` now pulls the image instead
  of building; to build from the checkout, add `-f docker-compose.build.yml`
  (see docs/INSTALL.md). amd64 only.
- **`SOUNDBOX_LOG_LEVEL`.** Sets the server's log level (`debug`, `info`,
  `warning`, `error`, `critical`) when `--log-level` isn't given. Unlike the
  flag, it reaches `npm run dev`, Docker and the desktop app. The startup banner
  shows the level in force, and an unknown value warns instead of being
  silently ignored. `debug` now logs each request to the prompt assistant,
  artwork and custom endpoints (URL, status, timing; never keys or prompts).
  Before this there were no debug lines at all, so `--log-level debug` showed
  nothing extra. (#22)
- **Press kit on the website.** `/press/` collects quotable descriptions, a
  fact sheet, the launch films with direct MP4 downloads, screenshots, GIFs
  and the mark for anyone writing or filming about Soundbox, and the landing
  page footer links to it.

### Changed

- **Device racks are stored with the story.** Each track's chain is saved on
  the server next to its name, mute, solo and volume
  (`PATCH /api/stories/:id/tracks/:n` takes `devices`), instead of in the
  browser's localStorage, so it reaches other windows and machines and follows
  its lane when a lane below it is removed. A rack saved by 0.4 is moved up the
  first time its story is opened. A dial sweep is saved once the dial settles,
  not on every step.

### Security

- **Dependency updates for the open Dependabot alerts.** Vite, the MCP SDK,
  Fastify, Hono, js-yaml, brace-expansion, proxy-addr, source-map-js,
  postcss-selector-parser and the app's react-router move to patched releases.
  The server's zod moves to 4.6.7 (the 3.x line has no fix for the
  oversized-collection memory issue).
- **Code-scanning fixes.** The MCP endpoint's trailing-slash trim no longer
  backtracks on a long run of slashes, profile ids are checked before they are
  joined into a path that delete can remove recursively, HTML-tag stripping in
  the docs search and heading plugin repeats until nothing is left, and the
  release scripts escape every regular-expression character.

### Fixed

- Trackpad gestures work on the story timeline. Only a pinch (or Ctrl+wheel)
  zooms now; a two-finger swipe pans left and right and a two-finger scroll
  moves the lanes up and down, where before every scroll was read as a zoom.
- **macOS: the server starts again.** The ad-hoc signed app gave its bundled
  Node the hardened runtime without the JIT entitlements, so Node died with a
  trace trap before writing a log and the app said the server did not start in
  time (0.3.0 and 0.4.0). Ad-hoc builds now leave the hardened runtime off, and
  every build embeds Node's entitlements for when a Developer ID build turns it
  on. (#71)
- Soundbox starts again on libraries from the voice-profiles era. Their old
  `voice_samples` table stopped the server with "no such column: voice_id"
  before it could write a log. The table is now renamed to
  `voice_samples_legacy` and kept, not dropped.
- **Prompt assistant and artwork base URLs ending in `/v1`.** Soundbox added
  `/v1/chat/completions` or `/v1/images/generations` to the base URL as typed,
  so the `…/v1` form most servers document became `/v1/v1/…` and a 404. The
  path is now joined without doubling, so a root, `…/v1`, `…/sdapi/v1` or the
  full endpoint all work. Errors name the full URL tried, and a 404 explains
  what to check. (#22)

- **Studio assistant: add a device, then set it.** A plan that added a device
  and then turned its knobs applied the second step to the rack as it was
  before the plan, which wrote the new device back out again.

## [0.4.0] - 2026-10-25

### Added

- **Studio: canvas layout and pop-out windows.** The studio can lay its
  panels out as free cards on a grid instead of three columns: drag a card's
  header to move it, drag its edges to resize it, and Panels → Tidy puts it
  back. Positions are remembered per builder. Any panel can also leave the
  studio for a window of its own, so you can put it on another monitor. Drag
  its header past the edge of the window, or press its pop-out button. A
  popped-out panel shares the studio's state, opens its menus in its own
  window and passes keyboard shortcuts through. Closing the window puts the
  panel back, and docking or closing the panel, or leaving the studio, closes
  the window. The desktop app opens these as native windows.
- **Failure cards.** A generation or download that fails now says what
  happened, why, what to do and what is kept, with up to two fix links, Retry
  where a retry can help, the raw text under Details and a Copy diagnostic
  button, in place of a bare red line or a toast. The server classifies the
  common causes (GPU out of memory, system memory, paging file, missing
  runtime, model not downloaded, corrupt model file, stalled or truncated
  download, Hugging Face gated or unreachable, disk full, timeout) in
  `server/src/failure.ts`; jobs carry the result as `failure`. A failed
  generation also stays on the Library page as a card instead of vanishing.
- **Command palette.** Ctrl/⌘+K now finds sounds, stories, voices and models
  as well as pages: a sound opens, a story opens in its builder, a model
  loads, downloads or unloads from the row. Settings rows appear once you
  type. On a page with a composer the first row is Generate, or Cancel while
  a job runs. `?` opens a keyboard cheatsheet.
- **Script Builder: paste a script.** Paste a scene or a passage and
  Auto-cast reads the speaker cues and "said X" attributions, hands each
  character a voice (a voice of the same name if there is one, otherwise the
  next unused one) and adds the lines; or split prose into lines by
  sentence, paragraph or chapter with a longest-line limit. An empty script
  offers Add first line, Paste a script and Load sample.
- **Library.** Every row carries its recipe (model, length, seed, steps,
  CFG, and whether it was extended or covered) so two takes of one prompt
  can be told apart; the sound page has a "How it was made" list with Copy
  recipe. A sound's menu has Send to: add it to a story, open it in the
  studio, or make a voice from it in the Voice Lab. The tag, model,
  favourites and by-agents filters fold behind a Filters button whose
  summary shows each chosen value as a chip that clears itself.
- **Models page.** Packs: one Install for a sensible model each for sound
  effects, music and voice at Fast, Balanced, Quality or Max, with the size
  to download; the category tabs say how many of each are on this machine;
  a model whose download stopped shows as Incomplete with Repair, which
  fetches only what is missing; and a Self-test in a model's details renders
  one second through the normal path and reports the time and device without
  saving anything (`POST /api/models/:id/selftest`).
- **README.** Shorter and faster to scan: a Make / Arrange / Connect table,
  a hardware table, profiles, an "install with a prompt" block for coding
  agents, and the source, Docker and API sections folded. `docs/INSTALL-AGENT.md`
  is the runbook that prompt points at.

### Changed

- **Composer.** The Generate button keeps one width and names the running
  job's stage ("Loading model", "Generating 42%"), Cancel keeps its place
  instead of pushing the pills about, a progress strip runs along the card's
  bottom edge, and whatever stops a run is said in one sentence with the link
  that fixes it rather than a greyed-out button.
- **Sidebar.** Each area's icon carries its own hue, the sidebar folds to an
  icon rail on studio, Music and Voice Lab pages (with a "keep expanded"
  preference in Settings → Interface and on the rail itself), and the device
  row in the footer opens a panel with the GPU, VRAM in use, the loaded model
  and an Unload button that frees the memory without a trip to Models.

## [0.3.0] - 2026-10-24

### Added

- **Custom endpoints.** Settings → Endpoints sends sound effects, music or
  speech to a server you already run (LocalAI, an OpenAI-compatible speech
  server) instead of downloading the model. The request body is a JSON
  template with variables such as `{{prompt}}`, `{{lyrics}}`, `{{bpm}}` and
  `{{key}}`. Each endpoint appears in the model pickers. WAV and PCM are read
  directly; other formats need ffmpeg. Endpoints outside the local network
  are marked, since prompts leave the machine. See `docs/ENDPOINTS.md`. (#22)
- **Updates in the desktop app.** On launch, an installed copy checks for a
  newer release and offers to install it and restart. Models and projects are
  kept. Copies installed before this version need one manual download to get
  it.

### Fixed

- **GPU name and VRAM on NVIDIA.** `/api/health` reports the GPU's name and
  its total and free VRAM from `nvidia-smi`, for the first GPU in
  `CUDA_VISIBLE_DEVICES` or GPU 0, so the sidebar, Settings and onboarding show
  them instead of only "cuda". Other GPUs still report `null`. (#17)
- **`SOUNDBOX_ALLOWED_HOSTS` behind a reverse proxy.** The server's `Host`
  check now accepts the names in `SOUNDBOX_ALLOWED_HOSTS`, so `soundbox` on
  `127.0.0.1` behind Caddy or nginx no longer answers 403 "Forbidden host" to
  every request. Before, the variable only reached CORS and `/mcp`. A bare
  `host` matches any port and `host:port` only that port, the same in every
  check. (#22)
- **Dev mode from another machine.** `npm run dev` passes
  `SOUNDBOX_ALLOWED_HOSTS` to Vite's `server.allowedHosts`, and a new
  `SOUNDBOX_DEV_HOST` sets the address Vite listens on. Both are unset by
  default, which keeps the dev UI on localhost. (#22)

## [0.2.0] - 2026-10-23

### Added

- **Compare voices.** The Voice Lab reads one line in two to four voices side
  by side, so a cast can be chosen by ear.
- **A new look.** Graphite surfaces with a faint teal cast, teal kept for what
  is sounding, selected or focused, each sound's own envelope as its icon, and
  mono numerals for times, seeds and sizes. Applied through the shared
  components, in both themes.
- **MCP progress notifications.** Tools that wait on a job (`generate`,
  `speak`, `speak_story`, `separate`, `export_story` and the rest) send
  `notifications/progress` when the request carries a `progressToken`, so a
  client with a short tool-call timeout no longer drops a long music render.
- **Docker.** `docker compose up -d --build` runs the server and web UI
  headless with the audio.cpp runtime inside; CPU by default, CUDA with
  `docker-compose.cuda.yml`. See `docs/INSTALL.md#docker`.
- 19 opt-in catalog entries for models that audio.cpp 0.9.2 runs: MiDashengLM-Gen
  and ControlFoley (sound effects), ACE-Step 1.5 XL Turbo and SFT, HTDemucs
  6-stem, MeanVC2, and TTS from Chatterbox Turbo, Kokoro, CosyVoice 3, Maya1,
  BreezeTTS 2, FireRedTTS3, VoxCPM 1, KittenTTS, MagpieTTS, KugelAudio,
  Irodori v4.1 Anime and Soprano. MiDashengLM-Gen, HTDemucs 6-stem and
  Chatterbox Turbo were run end to end. See `docs/new-models-2026-10.md`.
- `duration_option` catalog field, for a `gen` family that takes its length
  under its own option name. A `gen` entry with `supports.steps` or
  `supports.cfg` false is no longer sent a step count or guidance scale.
- **Several clips per voice.** A cloned voice can hold up to five clips of the
  same speaker, added by upload or recording in the Voice Lab's Clips dialog or
  by `POST /api/voices/{id}/samples`. They are levelled and joined into the one
  reference the model reads.
- **Reference clip checks and tidying.** A clip under 1 s, over 60 s or almost
  silent is refused with a reason. "Tidy the clip" cuts silence off the ends and
  pulls back a clipping peak, without making the clip louder.
- **Per-voice history.** Each voice card shows how many sounds were read in it
  and opens them; `GET /api/sounds?voice_id=` and the MCP `list_sounds` tool
  filter by voice.
- **Voice export and import** as a `.soundbox-voice.json` file with the clips
  inside.

### Fixed

- A line cast to a cloned voice is read on the model that voice was made on
  when no model is passed, instead of whichever model happened to be ready.
  In a story with mixed voices, each line uses its own voice's model.
- After the audio.cpp server restarts, a model Soundbox thought was still
  loaded is reloaded instead of every request failing with "unknown model id".
- `soundbox model install audiocpp` handles audio.cpp 0.9.x releases. It
  fetches the `cudart` runtime package beside a CUDA build. It picks the CUDA
  build the driver supports, matches Linux's `ubuntu` assets, and skips the
  `lib`, config and Colab packages, which contain no CLI.

## [0.1.0] - 2026-10-07

Initial public release, MIT-licensed. Everything below is new.

### Added

- **Sound effects** from a text prompt, with duration, seed, steps, CFG and
  negative prompt exposed; every generation is saved with its parameters so it
  can be regenerated, varied or reused.
- **Music**, instrumental or sung from a `[verse]`/`[chorus]` lyric sheet, with
  extend, cover and repaint on models that support them, and stem separation
  into drums, bass, vocals and other.
- **Speech and voices**: text-to-speech, voice cloning from a clip or the
  microphone, voice conversion, and a Voice Lab whose voices are cast onto
  lines of a multi-character script.
- **Studio**: a multi-track timeline with per-track effects, MIDI input, a
  piano roll, recording and one-click mixdown, plus an assistant chat that
  proposes edits as a plan you confirm.
- **MCP server** (21 tools) for Claude Code, Cursor and other MCP clients, an
  Agents page showing every call each client made, and an **HTTP API**
  (see `docs/API.md`).
- **Local model runtime** via [audio.cpp](docs/AUDIOCPP.md): one managed
  native binary with CUDA/HIP/Metal/Vulkan/CPU backends, no Python required.
- **Licences up front**: each model's licence and commercial-use status is
  shown before download, and non-commercial weights need explicit confirmation.
- **Local library**: one SQLite file and a folder of WAVs under `~/.soundbox`;
  works offline once weights are downloaded.
- **Desktop app** for Windows and macOS (Apple silicon and Intel), built on
  Tauri 2: an installer that carries its own Node and server, starts and
  supervises the server, and stops it on exit. Not signed yet.
- Optional local **artwork** (cover art, voice avatars) via stable-diffusion.cpp.

### Security

- Native binaries (`audiocpp_cli`, `llama-server`, `sd-server`) are verified
  against a published SHA-256 before install; unverifiable downloads are refused
  unless `SOUNDBOX_ALLOW_UNVERIFIED_BINARIES=1` is set.
- The server binds to loopback by default, rejects non-loopback `Host` headers,
  trusts only an allowlist of browser origins (its own, the Vite dev server and
  `SOUNDBOX_ALLOWED_HOSTS`), and requires JSON or an `X-Soundbox` header on
  mutating API requests.

[Unreleased]: https://github.com/HamSanders/soundbox/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/HamSanders/soundbox/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/HamSanders/soundbox/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/HamSanders/soundbox/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/HamSanders/soundbox/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HamSanders/soundbox/releases/tag/v0.1.0
