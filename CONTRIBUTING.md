# Contributing

Mirli runs every model through **audio.cpp**
(`server/src/models/audiocpp.ts`), a single native binary. Most model
contributions are therefore a new entry in the audio.cpp catalog
(`server/src/models/audiocpp_models_catalog.json`) and need no new adapter
file. See `docs/AUDIOCPP.md`.

## Development setup

```bash
npm install
npm run dev        # server on 17494 + Vite on 5174, stopped together
```

`npm run dev:ui` starts only Vite (if you run the server some other way) and
`npm run dev:mock` runs the UI against an in-browser fake with no server and no
GPU. It is enough for almost all frontend work.

Tests and lint:

```bash
npm test                # server test suite (vitest)
npm run typecheck       # app + server, both strict
npm run lint            # oxlint over the app
```

```bash
cd app && npx tsc --noEmit -p tsconfig.app.json && npm run build
```

Tests use a fake sine-wave input or mocked subprocess output where they touch
audio.cpp, so they need no GPU, no weights and no network. New tests must not
download models.

## Adding a model

This usually means adding a `ModelSpec` entry to
`server/src/models/audiocpp_models_catalog.json`. No new code is needed:
`AudioCppModel` (`server/src/models/audiocpp.ts`) drives every audio.cpp
model through the same GGUF-download-and-subprocess path. See
`docs/AUDIOCPP.md` for the spec fields and the verified/unverified opt-in
split.

Declare capabilities accurately in `supports`. If the model has no negative
prompt, say so there and the UI hides the field instead of accepting input the
model ignores.

### Run it before you open the PR

1. Generate something with a strong transient (a door slam, a gunshot) and
   look at the waveform envelope. Real audio has a shape. A hum or drone shows
   as a flat line, and that is nearly always a layout or precision bug in the
   integration.
2. Say in the PR what hardware you ran on and what it sounded like.

The Status column in the README records which models have been through this.
Move yours to "Verified" only when it has.

### Licence metadata is not optional

Every catalog entry needs a `license` with an accurate `commercial` value:

- `"yes"`: permissive (Apache-2.0, MIT). No conditions on output.
- `"conditional"`: commercial use allowed with strings attached. Put the actual condition in `note`.
- `"no"`: non-commercial. The UI shows a red badge and makes the user confirm before downloading.

Cite the licence you read, on the model card or in the repo's LICENSE
file, and link it in `url`. If the code and the weights differ (common: MIT code, CC-BY-NC weights),
**the weights' licence governs output**, and that is the one to record here.

If you can't determine the licence, say so: set `name` to what you do know
(for example "Unconfirmed (MIT code; checkpoint licence undeclared)"), set
`commercial` to `"no"`, and explain what is missing in `note`. An entry
whose licence is unknown or unverified is treated as non-commercial until
someone reads the terms and fixes it. Never use `"conditional"` as a
placeholder, because the UI only stops users at `"no"`.

## Frontend

React + TypeScript + Vite, Tailwind v4, shadcn/ui. Use the existing CSS
variables; no inline hex colours. Every screen works in light and dark. `tsc
--noEmit` must be clean. `noUnusedLocals`, `noUnusedParameters` and
`verbatimModuleSyntax` are all on, so type-only imports need `import type`.

## Network calls

Mirli is a local app, and the list of things it contacts is short on purpose.
These are all of them. A change that adds a destination, or sends anything
new to an existing one, has to say so in the PR, add it here and in
[docs/PRIVACY.md](docs/PRIVACY.md), and be either something the user asked
for or something they can turn off.

| Destination | When | Code |
|---|---|---|
| `mirli.app/api/update` | Once a day at most, with the version and platform and nothing else. Off with Settings → Updates or `MIRLI_UPDATE_CHECK=0`; `npm run dev` starts with it off. | `server/src/updateCheck.ts` |
| `github.com/HamSanders/soundbox` releases | The installed desktop app, at launch: reads `latest.json` and, when there is a newer version, downloads and verifies it. Off with the same setting. | `src-tauri/src/updater.rs`, `src-tauri/tauri.conf.json` |
| `api.github.com` and `github.com` release downloads for `0xShug0/audio.cpp`, `ggml-org/llama.cpp` and `leejet/stable-diffusion.cpp` | When the user installs the audio runtime, the prompt assistant's engine or the artwork engine. Each archive is checked against a published SHA-256. | `server/src/models/releaseInstall.ts` and the three `*Binary.ts` beside it |
| `huggingface.co` | When the user downloads a model: audio weights, the prompt assistant's model, an artwork model. The saved Hugging Face token is sent only if there is one. | `server/src/models/audiocpp.ts`, `server/src/models/llmCatalog.ts`, `server/src/image/catalog.ts` |
| `raw.githubusercontent.com/sgossner/VSCO-2-CE` | When the user downloads a sampled instrument, at a pinned commit. | `server/src/instruments/` |
| A custom endpoint or hosted provider | Only one the user added in Settings, and only when they render with it. It receives the prompt and text of that render. | `server/src/endpoints/` |
| An OpenTelemetry collector | Only when the user names one, in Settings or with `OTEL_EXPORTER_OTLP_ENDPOINT`. | `server/src/telemetry.ts` |

Everything else the server calls is on the same machine: the engines it
starts on loopback ports, and the CLI and the MCP bridge talking to the
server. Building an installer also fetches a pinned Node from `nodejs.org`
and a prebuilt `better-sqlite3` (`scripts/desktop-stage.mjs`); that happens
on the build machine, not the user's.

Tests make none of these calls.

## Code from other projects

Say where code came from. If a PR includes code you didn't write, from
another project, a gist, an answer on a forum or a paper's reference
implementation, name the source and its licence in the PR.

- **MIT and Apache-2.0:** fine to bring in. Keep the copyright and licence
  notice the source requires, in the file or beside it, and note the origin
  in a comment at the top of what you copied. Apache-2.0 code keeps its
  `NOTICE` text if it has one. Ask in the PR about any other permissive
  licence.
- **GPL and AGPL, any other copyleft licence, and code with no licence at
  all:** read it for ideas only. Don't copy it, don't translate it line by
  line into another language, and don't paste its comments or its interface
  text. Describe the behaviour you want in your own words and write it fresh.
  Mirli is MIT, and code under those terms can't be relicensed into it.

Model weights are a separate matter, covered by
[Licence metadata is not optional](#licence-metadata-is-not-optional).

## AI-assisted contributions

Welcome, at the same bar as any other. Use whatever tools you like to write
code, tests or docs. What matters is the PR:

- You have read every line and can explain it. "The model wrote it" doesn't
  answer a review question.
- You ran it. The [Pull requests](#pull-requests) section applies in full: say
  what you ran and on what hardware, and for an audio change, what it sounded
  like.
- The licence rules above apply to generated code too. If a tool reproduced a
  recognisable piece of someone else's project, treat it as copied from there.
- Keep it small and focused. A large generated PR nobody asked for is hard to
  review; open an issue or a discussion first.

You don't have to say which tool you used.

## Pull requests

Keep pull requests small and focused. Explain what you changed and how you
verified it. For an audio change, "I generated a 3s clip on a 3060 and it
sounded right" is useful information.

PRs are squash-merged into `main` once CI passes. If users will notice the
change, add a line under `## [Unreleased]` in `CHANGELOG.md`. Leave version
numbers alone: they change only in a release PR. [docs/RELEASING.md](docs/RELEASING.md)
covers versions, releases and hotfixes.

By contributing you agree your contributions are licensed under the MIT licence.
