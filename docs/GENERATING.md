# Generating sound

Every sound in Konchi is made from a prompt, a model, a few parameters, and
a job you can watch. This page follows one generation through, then covers the
parameters that change the result.

## Overview

1. Pick a model. Its licence and what it is good at are on the card.
2. Describe the sound: material, action, space.
3. Press generate. You get a job id, and the app follows it.
4. The takes land in your library, each with the prompt and seed that made it.

Nothing is uploaded. The model runs on your machine, and the WAV is written to
`~/.konchi/sounds` before you hear it.

## Writing a prompt

Describe **material, action and space**. Adjectives about mood do not help:

> "scary sound" → nothing useful
>
> "heavy wooden door slamming shut in a cold stone corridor" → what you wanted

For sound effects, say what the thing is made of, what is happening to it,
and where the listener is. For music, name instruments, tempo and production:
"90 BPM boom bap, dusty Rhodes chords, upright bass, vinyl crackle".

Three practical rules:

- **Write a sentence, not a keyword list.** The model reads connecting words
  ("in", "against", "over", "while"). Keywords go in the tags field.
- **One sound per prompt.** "A door slam and then footsteps" gives you a muddle.
  Generate two clips and put them on a timeline.
- **Do not write BPM or key into a music caption** for models that take them as
  separate parameters. The caption then conflicts with the parameter.

The **enhance** button (`POST /api/enhance`) rewrites a rough prompt using
guidance specific to the model family you are about to run. It needs a local
LLM, is optional, and tells you when it is unavailable.

There are three ways to supply the LLM, all of which keep your prompts on
your own setup:

- Let Konchi install `llama-server` and a small GGUF (Models page, or
  `konchi model install llm`).
- Point it at a `llama-server` you built, with `KONCHI_LLAMA_SERVER_BIN`.
- Set the mode to *external* and give it any OpenAI-compatible base URL
  (Ollama, LM Studio, vLLM, LocalAI, a hosted endpoint). With or without
  `/v1` both work, since Konchi adds `/v1/chat/completions` without
  doubling it. An error names the full URL it tried.

`konchi model status llm` shows which one is live.

Music tracks can also carry generated cover art, and saved voices generated
avatars; see [ARTWORK.md](ARTWORK.md). Both are off by default. The instrument
icons on separated stems are drawn by the app and need neither.

## Parameters

| Parameter        | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| **Duration**     | Target length. Diffusion models may not hit it exactly, so the rendered length is shown next to the requested one. |
| **Seed**         | The random start. Same seed + same prompt + same model = same audio. Lock it to iterate on wording, free it to explore. |
| **Steps**        | How many denoising steps. More is slower and usually cleaner, with diminishing returns; some models are tuned for very few and say so. |
| **CFG**          | How strongly the model follows your prompt. Too high gives artefacts; too low wanders. |
| **Negative prompt** | What to steer away from, where the model supports it. |
| **Takes**        | How many variations to render in one go. Each is its own sound with its own seed. |

Generate several takes and keep the best. The others stay in your library
with the prompt that made them, so you can go back to an earlier one.

## Lyrics and vocal music

A lyrics-conditioned model (ACE-Step) takes a second field. The prompt sets
genre, instrumentation and production; the lyrics are what gets sung:

```
[verse]
Game over, you have fallen
The screen goes dark again

[chorus]
Insert coin, insert coin
```

Section tags in brackets mark structure and are not sung. Leave the lyrics
empty and the same model renders an instrumental.

Lyrics support is declared on the model, and the UI shows the lyrics box only
for models that declare it.

## What happens after "generate"

```
POST /api/generate  { model, prompt, duration_s, seed, steps, cfg, variations }
  → { job_id }

GET /api/jobs/:id/events
  → queued        the request is in line
  → downloading   first run of a model it has to fetch weights
  → loading       weights into memory (or VRAM)
  → generating    the actual inference, with progress
  → encoding      peaks measured, loudness checked, file written
  → done          { sounds: [id, …] }
```

The model stays loaded after a run so the next generation skips `loading`. It
unloads after an idle period you can set.

Post-processing happens in `encoding` and is limited to:

- **Peaks**, measured once and stored, so every waveform in the app draws
  from the same 256 numbers instead of decoding the file again.
- **Loudness**, normalised to your target LUFS if you set one.
- **Silence trimming**, which removes the padding models leave at the edges,
  if you have it on. Recordings and imports are never trimmed.

## Stems instead of a mix

**Split into tracks**, under the prompt, sends the render through the
separator and returns the stems you picked instead of the mix. The job reports
done only once the stems exist, so a prompt in the studio lands as one lane
per stem.

The mix stays in the library as the stems' parent. Over the API it is one
field:

```
POST /api/generate  { …, "separate": { "keep": ["drums", "bass"], "rest": "merge" } }
  → done  { sounds: [stem ids…], sources: [the mix] }
```

`keep: []` means every stem; `rest` is `"discard"` or `"merge"`. See
[the library's Stems section](./LIBRARY.md).

## Sessions

Every run in the composer belongs to a **session**, created on first generate
and titled from your prompt. A session is a log of one sitting. To group
sounds by what they belong to, use [projects](./LIBRARY.md). A session tells
you what you made on Tuesday; a project tells you what a track is made of.

## Doing it over the API

The same generation, without the UI:

```bash
curl -X POST http://127.0.0.1:17494/api/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "audiocpp-stable-audio-3-sfx",
    "prompt": "heavy wooden door slamming in a stone corridor",
    "duration_s": 6,
    "variations": 2
  }'
# → {"job_id":"…"}

curl -N http://127.0.0.1:17494/api/jobs/<job_id>/events
```

Every endpoint and field is in the [API reference](./API.md). To drive
Konchi from an agent, use [MCP](./MCP.md): the same operations, with schemas
the model can read.

## When it goes wrong

**The output is silence, or almost.** Usually the prompt is something the
model has no data for (an abstract noun), or there are too few steps. Try the
enhance button, or a known-good example from one of the collection pages.

**It is much slower than you expect.** Check which backend audio.cpp picked;
a CPU fallback is the usual cause. [audio.cpp](./AUDIOCPP.md) covers backend
selection and how to force one.

**The length is wrong.** The rendered duration is shown next to the requested
one. Trim on the timeline, or generate longer and cut.

**It fails on the first run only.** That is the weights download. The job phase
says `downloading`, and the weights are cached afterwards.
