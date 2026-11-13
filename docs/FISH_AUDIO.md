# Fish Audio reference transcripts

In Voice Lab, enter **Reference Transcript** when creating a clone. Use
**Edit voice** to enter or correct the exact words for every existing clip;
each field includes a player. When adding another clip, enter that clip's
transcript before uploading or adding the recorded take.

The transcript describes the reference recording. The Speak prompt or script
line describes the new speech to generate. Soundbox never invents a transcript.
Fish Audio requires a transcript for every clip, including older saved voices.
Other TTS models continue to accept voices without transcripts.

Transcripts live in SQLite's `voice_samples.reference_text`. An additive,
idempotent migration gives old samples a null value. Editing a voice saves
its fields and sample transcripts in one transaction. Voice export format v1
includes each sample's optional transcript, so old exports still import.

The service resolves transcripts per selected voice for both Speak and Script
Builder. It concatenates them in the exact database order used to join audio
(`created_at, id`), and refuses missing or blank values before queueing. New
clips get increasing timestamps even during a rapid import. Voice transcripts
override shared request, story, line and catalog settings for Fish Audio.

Soundbox passes `voice_ref` and `request_options.reference_text` to its adapter.
The native runtime's [task JSON parser](https://github.com/0xShug0/audio.cpp/blob/v0.9.4/app/cli/request.cpp)
reads family options from `options`, so the HTTP transport translates the map
to that name. Sending `request_options` directly to audio.cpp silently drops
it. The CLI fallback uses `--request-option reference_text=...`.

## Checks

From the repository root in PowerShell:

```powershell
npm.cmd ci
npm.cmd run typecheck --workspace server
npm.cmd run typecheck --workspace app
npm.cmd run test --workspace server
npm.cmd run lint --workspace app
npm.cmd run build
```

The transcript tests cover SQLite persistence and migration, HTTP upload and
edits, missing transcripts, combined audio order and deletion, rapid appends,
old and new import/export, mixed models and voices, Script Builder, MCP Speak
and speak_story, frontend validation, and the actual runtime HTTP JSON body.

To exercise real inference, prepare two WAV clips and a JSON manifest:

```json
[
  { "file": "C:/clips/first.wav", "reference_text": "Exact speech in the first clip." },
  { "file": "C:/clips/second.wav", "reference_text": "Exact speech in the second clip." }
]
```

Run with the existing models directory and native CLI path:

```powershell
node scripts/verify-fish-reference.mjs C:/models/audiocpp C:/audio.cpp/audiocpp_cli.exe C:/clips/references.json
```

This uses a new SQLite library under `build/fish-reference-validation/run-*`
and reads the existing weights. It never opens the user's database or installs
models. It verifies rejection of an incomplete voice, Speak with a combined
reference, two-voice Speak, and Script Builder with two saved voices. WAVs and
`report.json` remain in the test library for inspection. The script runs real
inference and needs an installed Fish S2 Pro package and a compatible runtime.

## Windows build

Use Node 22.12 or later, stable Rust, MSVC C++ Build Tools with a Windows SDK,
and WebView2. Run the checks above, then:

```powershell
npm.cmd run desktop:build
```

The Tauri staging step builds the UI and server, prepares production
dependencies and bundles Node. The Windows installer is written to
`src-tauri/target/release/bundle/nsis/Soundbox_<version>_x64-setup.exe`.
Building does not install or replace the running application.
See [DESKTOP.md](DESKTOP.md) for packaging details.

For a browser-based checkout run after `npm.cmd run build`, select an isolated
data directory explicitly if testing:

```powershell
$env:SOUNDBOX_DATA_DIR = Join-Path (Get-Location) 'build/manual-fish-test'
node server/dist/cli.js --port 17495
```

Open `http://127.0.0.1:17495`. Configure its models directory in Settings to use
the already downloaded weights. Close the old desktop/server before launching
an updated desktop build on its standard port; the shell can adopt a server
that is already running.
