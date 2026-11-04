# Contributing

Konchi runs every model through **audio.cpp**
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

## Pull requests

Keep pull requests small and focused. Explain what you changed and how you
verified it. For an audio change, "I generated a 3s clip on a 3060 and it
sounded right" is useful information.

PRs are squash-merged into `main` once CI passes. If users will notice the
change, add a line under `## [Unreleased]` in `CHANGELOG.md`. Leave version
numbers alone: they change only in a release PR. [docs/RELEASING.md](docs/RELEASING.md)
covers versions, releases and hotfixes.

By contributing you agree your contributions are licensed under the MIT licence.
