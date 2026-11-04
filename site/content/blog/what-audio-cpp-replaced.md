---
title: What audio.cpp replaced
description: Adding a model used to mean a research repo, a CUDA wheel and a torch pin that fought the last one. Now it is an id, a repo and a few defaults.
date: 2026-08-25
author: Anthony Saviano
tags: [engineering, audio.cpp]
image: /blog/what-audio-cpp-replaced.jpg
audio: /blog/audio/what-audio-cpp-replaced.mp3
draft: false
---

If you have ever tried to run two open-weight audio models on one machine, you
know the shape of the afternoon: two repos, two `requirements.txt`, two
opinions about which torch build is the correct one. In Konchi every model
goes through one native binary, and adding a model is a catalogue entry rather
than an environment.

This post is about what that ritual cost, what replaced it, and two install
decisions with named failure modes. It does not cover why only one model stays
resident in VRAM (that is [one model at a time](/blog/one-model-at-a-time)),
driving any of this from an agent (that is
[point your agent at Konchi](/blog/point-your-agent-at-soundbox)), or which
model is best at what.

## The two shapes a model can have

[docs/AUDIOCPP.md](./AUDIOCPP.md) puts the whole argument in two sentences. A
model that runs through audio.cpp is a catalogue entry: an id, a repo, a few
defaults. A model that does not is a Python stack with its own torch pin,
which sooner or later cannot coexist with the others and needs a sidecar
process to keep the peace.

Everything below is what it costs to be on the wrong side of that line.

## What the ritual actually was

The README says it plainly: there are excellent open-weight text-to-audio
models, and every one of them ships as a research repo — clone this, pin that
CUDA wheel, write your own inference script, discover the licence afterwards.
Four steps, and the fourth is the one you do last and should have done first.

That is not a criticism of the repos. Their job is to make a paper reproducible
on the machine the paper was written on; the job they are not doing is being
one of six things installed side by side on yours.

Model A wants a torch built against one CUDA runtime, model B wants a different
one, and pip will hand you the second while silently breaking the first — which
you discover at generation time. The usual fix is a virtualenv per model and a
process to talk to each one over a socket, every sidecar with its own startup
time, its own crash and its own thing to supervise. You wanted a sound effect
and you have acquired a service mesh.

## What replaced it

audio.cpp is a [ggml](https://github.com/ggerganov/ggml)-based C++ runtime that
implements 50+ audio model families behind a single CLI, with CUDA, HIP, Metal,
Vulkan and CPU backends, and no Python in the inference path. That last clause
is the one that does the work: there is no torch to pin, because there is no
torch.

Konchi's base install contains no model runtimes at all — Node 20+, `npm
install`, and no GPU-specific wheel to match against your hardware. The backend
is detected per machine (Metal on Apple silicon, CUDA where `nvidia-smi`
answers, Vulkan or CPU otherwise) and that decides which release asset gets
downloaded. Above the binary there is no Python either: the server is
TypeScript on Node — Fastify, with the MCP server mounted in the same process.
Nothing above the binary ever sees a tensor.

The docs took longer to agree than the code did: while this post was being
drafted they still promised Python in three places — a dead `backend/`
directory, a FastAPI server, and a `uv pip install` for a package that cannot
be installed — all three now corrected.

The scepticism this deserves is "no Python" as marketing versus as fact, so
here it is in a form you can check without installing anything — the CLI runs
with no server and no web app up:

```bash
konchi pull audiocpp-stable-audio-3-sfx
konchi run  audiocpp-stable-audio-3-sfx "glass breaking on concrete" --out test.wav
```

That is one process, writing a WAV. If a sidecar were hiding in there, this is
where you would find it.

## Adding a model is a JSON edit

The catalogue lives in `audiocpp_models_catalog.json`. Adding or correcting a
model means editing it — no new dependency, no new environment and no new code,
because every model drives through the same adapter. It does not even have to
be our JSON: anything in `<data dir>/models/custom.json` is loaded alongside
the shipped catalogue in the same shape, so your own quantisation of your own
finetune is a file you write, not a fork you maintain.

![The Konchi Models table: each model with its licence badge, VRAM estimate and installed status](/blog/models-page.png)

**Listed** models appear in the picker. **Extras** are catalogued but hidden
until you enable them on the Models page, and enabling one adds it to
`GET /api/models` immediately — same code path, no restart. Being data rather
than code is what makes that possible.

## Two install decisions with named failure modes

Konchi ships no native binaries and vendors none. `audiocpp_cli` is fetched
from upstream GitHub releases the first time you ask for it and cached under
your data directory, not inside the checkout.

**Vendoring it was the obvious alternative, and it loses twice.** A vendored
binary makes every clone carry a runtime most contributors will not run, and it
has to be a build that works everywhere — which means the lowest common
denominator, which means CPU. Fetching on demand gets the asset that matches
your machine's backend instead. Downloads are checksum-verified where the
release publishes a manifest; where it omits your platform, the installer warns
and installs anyway, because refusing there would make the automatic path less
reliable than the manual download it replaces.

**Letting `PATH` win was the other one.** When Konchi needs the binary it
checks an explicit `KONCHI_AUDIOCPP_BIN` override first, then the managed
install under `<data dir>/bin/`, then `PATH`. The managed install comes before
`PATH` deliberately: someone who has just run the installer should get what
they installed, not a stray system-wide copy from a `brew install` they made
months ago and have entirely forgotten about. `konchi model status audiocpp`
reports which one it resolved and how.

The caching follows the same instinct. Runtimes live in `bin/` beside
`models/` rather than inside it, and each version gets its own directory, so an
upgrade never half-overwrites the copy you are running and reinstalling the
engine does not cost you your weights.

## What this does not fix

It does not fix licensing. Every model shows its licence before you download
it, and several of the good ones forbid commercial use — open weights and
permission to sell what they make are separate questions, and some of these
models answer the second one with no.

It does not make anything fast. CPU works and CPU takes minutes; an 8 GB NVIDIA
GPU is the realistic requirement, and a generation far slower than you expected
is almost always a silent fall back to CPU that `konchi model status
audiocpp` will tell you about.

And it does not mean every catalogue entry has been run. One model is verified
end to end and the rest are untested — that is what the Status column says, and
a uniform install path is the thing that makes working through the list cheap
rather than an excuse for the column reading the way it does.

The claim is narrower than "no Python" sounds, and more useful: the cost of
supporting one more model is a few lines of JSON instead of an environment that
has to be negotiated with the last one.
