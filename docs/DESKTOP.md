# Desktop app (Tauri)

Soundbox is a web app you run locally. The desktop shell is a thin wrapper
around it, with no second copy of the UI and no separate API.

## Installing

1. Download the installer for your machine from the
   [Releases page](https://github.com/HamSanders/soundbox/releases):
   - Windows: `Soundbox_<version>_x64-setup.exe`
   - macOS: the `.dmg`, `aarch64` for Apple silicon or `x64` for Intel
2. Run it. The app carries its own Node and server, so nothing else needs
   installing.
3. Download model weights from the Models screen on first use.

**The installers are not signed yet**, so the first launch asks you to
confirm:

- **Windows:** SmartScreen says it "protected your PC". Choose **More info →
  Run anyway**.
- **macOS:** the app is ad-hoc signed but not notarized, so macOS refuses the
  first open. Open **System Settings → Privacy & Security**, find the note
  about Soundbox and choose **Open Anyway**. If macOS says the app is
  "damaged", the download's quarantine flag is the cause. Clear it with
  `xattr -dr com.apple.quarantine /Applications/Soundbox.app`.

## How it works

```
┌──────────────────────────────────────────────────────────┐
│ Tauri (Rust)                                             │
│  ├── spawns  <node> <app>/server/dist/cli.js --port 17494│
│  ├── waits for /api/health                               │
│  └── webview ──► http://127.0.0.1:17494                  │
└──────────────────────────────────────────────────────────┘
```

`<node>` and `<app>` depend on where the shell is running:

| | Installed app | A checkout (`npm run desktop`) |
|---|---|---|
| Server | `$RESOURCE/app/server`, staged into the installer | `server/` in the checkout |
| Node | the one installed beside the app's executable | `SOUNDBOX_NODE`, else `node` on `PATH` |

The installed copy is laid out like the repo: `server/{dist,web,skills}`, its
production `node_modules`, and `README.md` plus `docs/` for the in-app
assistant. The server finds everything relative to itself the same way in
both. The installed app always runs on its own Node, because its native module
(`better-sqlite3`) was built for that Node's ABI.

The server serves the built frontend at `/`, the HTTP API under `/api`, and
the MCP server at `/mcp`, all on one port. The desktop app starts that server
and points a window at it. After the splash screen, everything is the same app
that runs in a browser.

`src-tauri/splash/` is the only markup the shell owns: a standalone loading
screen shown while the server starts. `tauri.conf.json` also names it as
`frontendDist`, so the shell compiles without a prior web build.

**Stage the UI into the server first.** `scripts/build.mjs` builds the app
and copies `app/dist` into `server/web/`, and the server serves it from there.
Without that step the window shows a JSON stub saying the UI is not bundled;
the server is running but has nothing to serve. The `desktop` and
`desktop:build` scripts both run the build first.

## Running it

```bash
npm run desktop
```

This builds the frontend, stages it, builds the server, then compiles and
launches the shell. The first compile pulls the whole Tauri dependency tree
and takes several minutes. Later compiles take seconds.

## Building an installer

```bash
npm run desktop:build
```

This runs `tauri build` with `src-tauri/tauri.bundle.conf.json` merged in,
which adds three steps the plain config does not have:

1. Runs `scripts/desktop-stage.mjs` first. It builds the app and server,
   copies them into `build/desktop/`, and installs the server's production
   dependencies there at the versions in the root lockfile, fetching
   `better-sqlite3`'s prebuilt module for the bundled Node and the target's
   architecture. It then downloads a pinned Node (checked against nodejs.org's
   published SHA-256) into `src-tauri/binaries/`.
2. Ships that Node as an `externalBin`, beside the app's executable.
3. Ships `build/desktop/` as the `app` resource directory.

These live in a separate file so that `cargo check`, `npm run desktop` and CI
do not need anything staged. The output is in
`src-tauri/target/release/bundle/` (or `target/<triple>/release/bundle/` with
`--target`). Cross-building works only where Rust and the bundler support it;
the release workflow builds each OS on its own runner.

**Releases** come from `.github/workflows/release.yml`. Pushing a `v*` tag
builds Windows (x64) and macOS (Apple silicon and Intel) installers and
attaches them to a draft GitHub Release for a maintainer to publish. Running
the workflow by hand builds the same installers as artifacts without touching
Releases.

## What this build does and does not do

**Does:** launch and supervise the server; adopt an already-running server on
port 17494 instead of starting a second one (so it coexists with
`npm run dev`); and stop the server when the window closes. On Windows this
also covers a crash or force-kill, via a job object, because a
graceful-shutdown handler cannot run when the process is terminated, and an
orphaned server would keep holding the GPU and the port.

**Finds its server** in this order: `SOUNDBOX_PROJECT_ROOT`, then the copy
installed with the app, then a checkout found by walking up from the
executable (then the working directory) to `server/package.json`. In a
checkout with no build yet it falls back to running `server/src/cli.ts` with
the workspace's `tsx`.

**Logs** its own lifecycle lines to `soundbox-desktop.log` in the system temp
directory (a release build on Windows has no console), including any error the
splash screen shows. Everything after the server starts is in the server's own
log in the data directory.

**Does not:** bundle model weights. They are gigabytes, they come from Hugging
Face under the user's own account, and several models are non-commercial or
gated (see the licence table in the README). Download weights from the Models
screen, as in the web app.

## Environment

| Variable | Purpose |
|---|---|
| `SOUNDBOX_NODE` | Node interpreter to run the server with. Overrides both the bundled Node and the `PATH` lookup. |
| `SOUNDBOX_PROJECT_ROOT` | Run a checkout instead of the installed server, or point at one the shell cannot find by walking up. |
| `SOUNDBOX_DATA_DIR` | Inherited by the server: library, weights, logs. |

The port is fixed at 17494 in the shell. Every other server variable in
[INSTALL.md](./INSTALL.md#environment-variables) is inherited the same way.

## Prerequisites

None for the installed app. To build it you need Node 22.12+ (the same as for
the web app), Rust (stable), and the platform toolchain Tauri needs:

- **Windows:** MSVC Build Tools and the WebView2 runtime (present by default on Windows 11).
- **macOS:** Xcode command line tools.
- **Linux:** `webkit2gtk` 4.1 and related packages; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Known gaps

- **No code signing yet.** See [Installing](#installing) for what users see on
  first launch, and [Signing](#signing) for how to enable it.
- **No Linux installer in releases.** `npm run desktop:build` can produce an
  AppImage on Linux, but the release workflow does not build one yet.
- **macOS is unverified.** Every model runs through
  [audio.cpp](./AUDIOCPP.md), which has a Metal backend, but none of the
  verified-status claims were tested on a Mac. Web MIDI is unavailable in the
  macOS desktop shell.

## Updates

An installed copy checks the newest published GitHub Release once per launch,
after the server is up. When a newer version exists it asks; **Install and
restart** downloads it, stops the server, installs and restarts. **Later**
asks again next launch. A failed check (offline, rate-limited) is logged and
otherwise ignored. A checkout run with `npm run desktop` never checks.

Updates replace the app only. Models and projects live in the data directory
and are kept.

The check reads `latest.json` from `releases/latest`, so a draft release
reaches nobody until it is published. Every update is signed with the updater
key (separate from Apple/Windows code signing) and the app rejects anything
that doesn't verify against the public key in `src-tauri/tauri.conf.json`.
[RELEASING.md](./RELEASING.md#updater-key) covers the key.

## Signing

The release workflow signs whatever it has secrets for, and nothing else.

**macOS:** with an Apple Developer account ($99/yr), add these repository
secrets and the next tagged build is signed with your Developer ID and
notarized:

- `APPLE_CERTIFICATE` (the base64 of your exported `.p12`)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD` (an app-specific password)
- `APPLE_TEAM_ID`

A Developer ID build adds `src-tauri/tauri.signed.conf.json`, which turns on
the hardened runtime that notarization requires. Under it, Node's JIT and its
loading of `better-sqlite3` need the entitlements in
`src-tauri/Entitlements.plist` (`allow-jit`,
`allow-unsigned-executable-memory`, `disable-library-validation`), which every
build embeds. Check that the first signed build starts its server before
publishing it.

The ad-hoc build keeps the hardened runtime off. With it on, an ad-hoc
signature stops the bundled Node at its first JIT allocation (a `trace trap`,
and the app reports that the server did not start in time). To check a build,
`codesign -dv Soundbox.app/Contents/MacOS/node` should show
`flags=0x2(adhoc)` for an ad-hoc build, without `runtime`.

**Windows:** an unsigned installer works, behind the SmartScreen prompt. A
code-signing certificate removes the prompt (Azure Trusted Signing is the
cheapest current option). Configure it in Tauri's
`bundle.windows.signCommand`.
