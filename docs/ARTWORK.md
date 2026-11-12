# Artwork

Cover art for music you generate, and avatars for saved voices. Artwork is
off by default, and nothing is downloaded until you turn it on.

Three of the four places artwork appears need an image model. Stem icons do
not.

## Stem icons need nothing

When you split a track into stems, each stem gets its instrument's icon
(vocals, drums, bass, guitar, keys) in the stem list and in the library row.
The app draws these from a fixed set, because a separator emits a closed set
of stem names. They appear instantly, look the same every time, and work with
artwork off. An unrecognised instrument gets a plain note icon.

Nothing else in this document is required for stem icons.

## Turning artwork on

Go to Settings → Artwork and pick one of three modes (the same three the
prompt assistant has):

| Mode | What it does |
| --- | --- |
| **Off** (default) | No artwork anywhere. |
| **Local** | Konchi installs [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)'s `sd-server` and a small checkpoint, and runs them for you. |
| **External** | Konchi talks to an image server you already run. |

If Automatic1111 or a compatible server is already listening, Konchi finds
it and offers a one-click switch to External. It probes 127.0.0.1 on 7860,
1234 and 8080 on every status fetch, with a 400 ms timeout.

### Local

The engine is one native binary, fetched from stable-diffusion.cpp's GitHub
releases and cached under `<data dir>/bin/sd/<version>/`. It uses the same
managed-binary system as `audiocpp_cli` and `llama-server`, including the
`KONCHI_SD_SERVER_BIN` override for your own build. See
[INSTALL.md](INSTALL.md).

Three models are offered:

| Model | Files | Size | Licence |
| --- | --- | --- | --- |
| SD-Turbo (Q8) | 1 | 2.0 GB | Stability AI Community: commercial below $1M revenue |
| SDXL-Turbo (Q8) | 1 | 4.1 GB | Stability AI **Non-Commercial** |
| Stable Diffusion 3.5 Medium | 4 | 11.6 GB | Stability AI Community |

The licence is shown before you download. The licences differ, and under the
non-commercial one you cannot ship what the model makes.

The first two are turbo-distilled: a cover takes one to four steps instead of
twenty-eight. The auto-cover switch is designed around them. SD 3.5 Medium is
the quality option: 1024px, 28 steps, and most of a 16 GB card. It loads with
`--clip-on-cpu` so its three text encoders stay off the GPU, which lets it
share the card with a resident audio model.

Weights go in `<data dir>/models/image/<id>/`, beside the audio and LLM model
directories, and can be deleted independently of both.

### Models made of several files

SD 3.5 is a transformer plus three text encoders, each passed to sd-server
under its own flag:

```
-m sd3.5_medium.safetensors
--clip_l text_encoders/clip_l.safetensors
--clip_g text_encoders/clip_g.safetensors
--t5xxl text_encoders/t5xxl_fp8_e4m3fn.safetensors
```

A catalog entry is therefore a *list* of files, each with the flag it loads
under. A family that needs a different flag, or an upstream rename, is a
catalog edit. Downloads skip files already present, so an interrupted 11.6 GB
pull resumes file by file.

The catalog uses the fp8 T5 instead of the fp16, which halves its 9.8 GB size.
The T5 encoder mainly helps with prompts that contain text, and cover-art
prompts avoid text.

### Bring your own image model

Add entries to the same file the audio side uses,
`<data dir>/models/custom.json`, under an `image_models` key:

```json
{
  "image_models": [
    {
      "id": "sd35-mine",
      "name": "SD 3.5 (my copy)",
      "files": [
        { "flag": "-m", "path": "D:/models/sd3.5_medium.safetensors" },
        { "flag": "--clip_l", "path": "D:/models/clip_l.safetensors" },
        { "flag": "--clip_g", "path": "D:/models/clip_g.safetensors" },
        { "flag": "--t5xxl", "path": "D:/models/t5xxl_fp8_e4m3fn.safetensors" }
      ],
      "resolution": 1024,
      "steps": 28,
      "cfg": 4.5,
      "extra_args": ["--sampling-method", "euler", "--clip-on-cpu"]
    }
  ]
}
```

- An **absolute** `path` is a file already on your disk. Nothing is
  downloaded, and Konchi never deletes weights it did not fetch. A relative
  path needs an `hf_repo` to resolve against.
- `flag` is passed to sd-server verbatim, so anything it accepts works,
  including `--vae` and `--diffusion-model`.
- If you omit `license`, the model shows as **Unspecified / not commercial**,
  as in the audio catalog.
- An id matching a shipped model replaces it. Use this to point an existing
  entry at your own copy.
- The file is re-read whenever it changes. A malformed entry is skipped with a
  console warning.

Models in **diffusers format** are not supported: a directory of
`model_index.json`, `transformer/`, `text_encoder/`, `vae/`, the layout the
Python `diffusers` library downloads. sd-server needs single files. Repos
usually publish the same weights in both layouts, so fetch the single-file
copies instead of converting.

### External

Set the base URL and pick the API it speaks. Image generation has no common
standard like `/v1/chat/completions` for chat, so you choose the API
explicitly:

- **Automatic1111:** `POST /sdapi/v1/txt2img`. Automatic1111, Forge, SD.Next,
  and stable-diffusion.cpp's own `sd-server`.
- **OpenAI-compatible:** `POST /v1/images/generations`. OpenAI, LocalAI, most
  proxies.

Konchi adds that path to the base URL without doubling it, so
`http://ai.lan:8080` and `http://ai.lan:8080/v1` (or `…/sdapi/v1` for
Automatic1111) all work. An error names the full URL it tried.

An API key is optional and write-only, like the Hugging Face token. The server
never returns it.

Konchi always requests the image inline as base64 (`response_format:
"b64_json"`). An endpoint that answers with a URL is refused, so Konchi
never fetches from a second host.

## What gets drawn

**Cover art** comes from the track's generation prompt, then its track name,
then its tags. Lyrics are excluded, because image models tend to render words
as text on the cover. The negative prompt leads with text, typography and
watermarks for the same reason.

**Voice avatars** come from the voice's *notes* field, falling back to its
name. A voice annotated "gravelly old sea captain, mid-Atlantic accent" gets a
portrait of one; a voice called "Voice 3" with no notes gets very little. Fill
in the notes to control the avatar. Avatars render as stylised illustration,
not photoreal portraits, so they do not look like a real person.

Prompts are built deterministically, without the prompt assistant. Artwork
works with the LLM off, and redrawing a cover gives another take on the same
subject.

## When it runs

By default, only when you ask: a **Draw cover** action on a music track, and an
**Avatar** action on a voice. The *Draw covers automatically* switch queues a
cover after each music render.

That switch is off by default because the image model needs the same VRAM the
audio model is using. Artwork is queued only after the generation it belongs
to has finished and been saved, and a failed render is logged without failing
the generation. The engine stops after the same idle period that unloads
audio models (`auto_unload_minutes`), so it does not hold VRAM between covers.

## Where images live

```
<data dir>/artwork/<uuid>.png
```

Images are served at `/artwork/<file>` and referenced from a sound's
`artwork` field and a voice's `artwork` field. They are derived files:
deleting the directory loses only the pictures. Redrawing writes a new file
and removes the old one only once the new one exists, so a failed redraw keeps
the existing cover.

## API

```
GET    /api/image/status                     engine, model, catalog, detected endpoints
POST   /api/image/engine/install             -> 202 { job_id }
POST   /api/image/models/{id}/download       -> 202 { job_id }
DELETE /api/image/models/{id}                -> 204
POST   /api/sounds/{id}/artwork              -> 200 Sound (with artwork set)
DELETE /api/sounds/{id}/artwork              -> 204
POST   /api/voices/{id}/artwork              -> 200 Voice
DELETE /api/voices/{id}/artwork              -> 204
```

The UI shows its draw actions only when `status.ready` is true. It combines
the mode, whether the engine is installed and whether the checkpoint is
downloaded. `status.detail` says in words which of those is missing.

Installs run as jobs because they download gigabytes. Generation is
synchronous because a turbo render takes seconds.
