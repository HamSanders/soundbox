# audio.cpp

audio.cpp is the inference engine behind most of the models Konchi runs. It
is a [ggml](https://github.com/ggerganov/ggml)-based C++ runtime that
implements 50+ audio model families behind a single CLI, with CUDA, HIP, Metal,
Vulkan and CPU backends. There is no Python in the inference path.

Because of that, adding a model that runs through audio.cpp only takes a
catalogue entry: an id, a repo and a few defaults. No separate torch install
or sidecar process is needed.

## Installing it

Konchi manages the binary for you:

```bash
konchi model install audiocpp   # download, verify, cache
konchi model status audiocpp    # what is installed, and which backend
```

The installer picks a release asset for your OS and GPU, verifies its SHA-256
against GitHub's asset digest and the release's checksum manifest, and caches
it under `<data dir>/bin/audiocpp/<version>/`. An asset with no published
checksum is refused unless you set `KONCHI_ALLOW_UNVERIFIED_BINARIES=1`. A
mismatch is always refused. To override the choice:

```bash
konchi model install audiocpp --backend cuda   # cuda | hip | metal | vulkan | cpu
konchi model install audiocpp --version 0.6.1
```

From 0.9.x, upstream publishes one CUDA build per toolkit (CUDA 12.4 and 13.3
on Windows), each with a matching `cudart` package of runtime DLLs. The
installer picks the newest build your NVIDIA driver supports (from the "CUDA
Version" line of `nvidia-smi`), and fetches the matching `cudart` alongside.
If it cannot read the driver version, it picks the oldest. Linux assets are
named `ubuntu`. The `lib`, `server-config` and Colab packages contain no
`audiocpp_cli`, so the installer never picks them.

Catalogue entries added in October 2026 use loaders that first appeared in
audio.cpp 0.9.x. An older install reports an unknown family for them, and
`konchi model install audiocpp` fetches the latest release.

The CLI then works without the server or web app running:

```bash
konchi list                                       # the catalogue, with download status
konchi pull audiocpp-stable-audio-3-sfx
konchi run  audiocpp-stable-audio-3-sfx "glass breaking on concrete" --out test.wav
```

`run` offers to pull a model you have not downloaded. Pass `--yes` to skip the
prompt.

### Using a binary you already have

Prebuilt Windows CUDA and CPU packages are on the
[releases page](https://github.com/0xShug0/audio.cpp/releases). On macOS, run
`brew tap 0xShug0/audio-cpp && brew install audio-cpp`. On Linux, build with
`scripts/build_linux.sh --backend cuda --target audiocpp_cli`.

Point Konchi at the binary, or put `audiocpp_cli` on your `PATH`:

```bash
KONCHI_AUDIOCPP_BIN=/path/to/audiocpp_cli
```

`konchi model status audiocpp` reports which binary it resolved and how. A
managed install shows its version; a binary of yours shows `external (env)` or
`external (PATH)`. The same three routes, in the same order, apply to the
prompt-assistant engine via `KONCHI_LLAMA_SERVER_BIN` (`konchi model
status llm`). On macOS both also check the Homebrew prefixes directly, because
a desktop launcher's `PATH` often omits them.

### Choosing a backend

Konchi infers a backend and falls back to CPU. To override the guess, or to
compare backends, force one:

```bash
KONCHI_AUDIOCPP_BACKEND=cuda   # cpu | cuda | vulkan | metal | hip | best
```

If a generation is far slower than expected, it is usually running on CPU.
`konchi model status audiocpp` shows which backend is live.

## Where weights go

```
<models dir>/audiocpp/<model-id>/
```

Weights do not go in the Hugging Face cache. The GGUF repos hold every family
audio.cpp supports, and Konchi downloads only the files for the model you
asked for.

## The model catalogue

The catalogue lives in `audiocpp_models_catalog.json`. Adding or correcting a
model is a JSON edit, with no new dependency, adapter or environment.

Models come in two tiers:

- **Listed** models appear in the model picker.
- **Extras** are catalogued but hidden until you opt in, via the Models page's
  "Enable more models" section or
  `PATCH /api/settings {"enabled_audiocpp_models": ["…"]}`. Enabling one adds
  it to `GET /api/models` immediately, with no restart.

`GET /api/models/audiocpp/catalog` returns the whole catalogue, all tiers.

### Bring your own model

Entries in `<data dir>/models/custom.json` are loaded alongside the shipped
catalogue, in the same shape:

```json
{
  "models": [
    {
      "id": "my-ace-step-finetune",
      "name": "ACE-Step (my finetune)",
      "vendor": "me",
      "description": "Q8 quantisation of my own finetune.",
      "family": "ace_step",
      "category": "music",
      "weights_path": "/models/ace-step-mine-q8_0.gguf",
      "max_duration_s": 240,
      "sample_rate": 44100,
      "channels": 2,
      "vram_estimate_mb": 8000,
      "defaults": { "duration_s": 30, "steps": 27, "cfg": 4.0 },
      "supports": { "seed": true, "steps": true, "cfg": true, "lyrics": true },
      "license": { "name": "Apache-2.0", "commercial": "yes", "url": "https://…" }
    }
  ]
}
```

- `weights_path` is an **absolute** path to weights already on your disk: a
  file, or a directory for `weights_layout: "directory"`. Nothing is
  downloaded, and Konchi never deletes the file.
- Alternatively, give `hf_repo` + `weights_glob` and it downloads like any
  shipped entry, into `<models dir>/audiocpp/<your id>/`.
- `family` must be one audio.cpp knows (`audiocpp_cli --list-loaders`). Every
  other field (`defaults`, `supports`, `edit_routes`, `voice_ids`,
  `request_options` and the rest) means the same as for a shipped entry.
- If you omit `license`, the model is shown as **Unspecified / not
  commercial**, since Konchi cannot know the terms for weights on your disk.

Custom entries are always enabled; there is no separate toggle in Settings.
They are never marked verified, because "verified" means someone ran the model
end-to-end through this adapter. They use the same download/load flow in the
app as other models, and `konchi list` tags them `[custom]`.

The file is re-read whenever it changes, so you can edit it while the server
runs, with no restart. A malformed file, or an entry missing
`id`/`name`/`family` or naming neither `weights_path` nor `hf_repo`, is
skipped with a warning on the server's console. An id that matches a shipped
model **replaces** it. Use this to point an existing model at your own
quantisation.

Every entry declares its licence, and the UI shows it before you download.
Some of these models have open weights but a non-commercial licence.

## Capabilities

Each family supports a different set of features. The catalogue declares what
each one supports, and the app offers only what is declared.

| Capability          | Notes                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Generation          | Duration, steps, guidance and seed are common across `gen` loaders        |
| Lyrics              | Lyrics-conditioned vocal models (ACE-Step). Some *require* lyrics; see below |
| Separation          | `htdemucs`, `bs_roformer`, `mel_band_roformer` split a mix into stems     |
| Extend              | Continue a clip past its end, with the original kept bit-for-bit         |
| Cover               | Re-render a clip in a new style, at the source's length                  |
| Repaint             | Regenerate a window inside a clip                                        |

Negative prompts are not available on this path. No family exposes a flag for
them, so Konchi does not offer one.

### Lyrics

A lyrics-conditioned model takes the sung words separately from the prompt.
The prompt sets genre and production; the lyrics are what is sung. Some
models, including MiniMax Music 3, **refuse to run without lyrics**. For
those, Konchi supplies an explicit `[instrumental]` marker when you give
none.

### Separation

Separation is its own task mode. Two constraints produce confusing errors if
you miss them:

- The source is passed as the **audio input**, not as a reference input. The
  reference input is for voice conversion and style transfer. Using it for
  plain separation fails with an unrelated-sounding contract error.
- **htdemucs requires exactly 44.1 kHz.** Other rates fail with a sample-rate
  mismatch, so Konchi resamples the source to the model's rate before
  invoking it. Splitting a 48 kHz ACE-Step render is the common case.

htdemucs emits four stems: `vocals`, `drums`, `bass`, `other`.

### Audio-to-audio routes

There are three, available on models that declare support:

| Route     | What you get                                                                  |
| --------- | ----------------------------------------------------------------------------- |
| `extend`  | The source unchanged, followed by new material up to the target length         |
| `cover`   | The clip re-rendered in the style of a new prompt, locked to the source's length |
| `repaint` | A window inside the clip regenerated, with a strength and a mode               |

The sound editor's Repaint tool runs `repaint` on a highlighted range
(`POST /api/repaint`, or `generate` with `edit: "repaint"`).

Extend is implemented as a repaint whose window starts past the end of the
source, so the original is kept sample-for-sample. `cover` takes a strength
that sets how closely it follows the original.

The source is resampled to the model's rate first, as with separation.

## Adding a model

Most models are a single GGUF file, and a catalogue entry naming the repo and
the file pattern is enough. Two cases need more care.

### Package models

Some models ship a *directory* of components instead of one file. MiniMax
Music 3 has five (condition encoder, language model, transformer, RVQ depth
decoder, vocoder) plus config and tokenizer JSON. Passing only the largest
file to the loader would drop the rest without an error.

These catalogue fields cover this. All have defaults, so existing entries are
unaffected:

- `weights_layout: "file" | "directory"`. `"directory"` passes the whole
  weights directory to the loader.
- `weights_required: string[]`. Every file that must be present. The model
  counts as downloaded only when all of them are, so a half-finished download
  reports "not downloaded" instead of failing inside ggml.
- `weights_root: string`. The repo-relative subdirectory that is the
  package's real root, for a package under a prefix inside a shared repo.
  audio.cpp's own downloader strips the prefix (`strip_prefix` in the package
  spec); Konchi preserves repo paths, so `--model` has to point at the
  subdirectory. MiniMax H3's `MiniMax-H3-Q4-GGUF/` prefix inside the shared
  registry repo needs it; MiniMax Music 3's dedicated repo does not.

`weights_glob` accepts a list, which keeps a download bounded. One of these
repos is 58 GB and the entry pulls 8.45 GB of it.

### Request options a family does not declare are rejected

From 0.9.x, audio.cpp refuses any request option a family's spec does not
list, with an error like `unknown MiDashengLM-Gen request option:
duration_seconds`. Konchi sends a generation the generic fields
`duration_seconds`, `num_inference_steps` and `guidance_scale`. Most `gen`
families accept all three, but not every one does. Two catalogue knobs cover
that:

- `supports.steps: false` / `supports.cfg: false` on a `gen` entry. Konchi
  then sends no step count or guidance scale at all, rather than a default
  the family rejects.
- `duration_option: "<name>"`. Konchi sends the target length as that
  request option (for example `duration_sec`) instead of `duration_seconds`.

The family's accepted options are in `model_specs/<family>.json` beside the
binary, or embedded in it.

### Component filenames are not yours to choose

For a package model, the loader reads its component filenames from a package
spec **compiled into the binary**, and checks those files exist *before it
parses any option*. Overriding a component path with a session or load option
does not work, because the check has already failed.

The catalogue entry therefore has to match the package the installed binary
ships. Read it out of the binary; the spec is embedded as plain JSON:

```bash
node -e "const d=require('fs').readFileSync('audiocpp_cli.exe','latin1'); const i=d.indexOf('minimax_music3_q4_0'); console.log(d.slice(i-3000,i+1500))"
```

Two things to watch for. The package's name does not mean its contents are
uniform: a "q4_0" package can ship a q8_0 component. And the per-component
option defaults in the same spec can disagree with the package's own file
list. **Use the `files` array**, not the name or the defaults.

## How Konchi drives it

- **Loading resolves paths; it does not fill VRAM.** The child process holds
  the model in memory, per generation.
- **Cancelling a job kills the child.** An orphaned process would hold a GPU
  that Konchi believes is free, and the next job would contend for it.
- **A failed run shows the child's own last lines**, so you see the ggml error
  instead of "generation failed".
- **The binary is never auto-installed as part of a model download.** Install
  it explicitly with `konchi model install audiocpp`.

Adapter tests drive a fake CLI speaking the same protocol, so they cover the
integration without the real binary or real weights.
