---
title: What audio.cpp replaced
description: Adding a model used to mean a research repo, a CUDA wheel and a torch pin that clashed with the last one. Now it's an id, a repo and a few defaults.
date: 2026-08-25
updated: 2026-11-04
author: Anthony Saviano
tags: [engineering, audio.cpp]
image: /blog/what-audio-cpp-replaced.jpg
audio: /blog/audio/what-audio-cpp-replaced.mp3
draft: false
---

If you've tried to run two open-weight audio models on one machine, you know
how it goes: two repos, two `requirements.txt` files, and two different ideas
about which torch build to use. In Konchi every model runs through one native
binary, and adding a model means adding a catalogue entry, not building an
environment.

This post covers what the old way cost, what replaced it, and two install
decisions and the failures they avoid. It doesn't cover why only one model
stays in VRAM (see [one model at a time](/blog/one-model-at-a-time)), driving
Konchi from an agent (see
[point your agent at Konchi](/blog/point-your-agent-at-soundbox)), or which
model is best at what.

## Two kinds of model

[docs/AUDIOCPP.md](./AUDIOCPP.md) sums it up in two sentences. A model that
runs through audio.cpp is a catalogue entry: an id, a repo and a few defaults.
A model that doesn't is a Python stack with its own torch pin, which eventually
can't coexist with the others and needs a separate process to keep it apart.

The rest of this post is about the cost of the second kind.

## What it used to take

The README describes it: there are very good open-weight text-to-audio models,
and each one ships as a research repo. You clone it, pin a CUDA wheel, write
your own inference script, and find out the licence at the end. The licence
should be the first step, and it's usually the last.

The repos aren't at fault. Their job is to reproduce a paper on the machine it
was written on. Being one of six things installed side by side on your machine
isn't their job.

Model A wants torch built for one CUDA runtime and model B wants another. pip
installs the second and quietly breaks the first, and you find out when you try
to generate. The usual fix is a virtualenv per model and a process for each one
that you talk to over a socket. Each of those processes has its own startup
time, its own crashes and its own supervision. You wanted a sound effect, and
now you're running a small cluster of services.

## What replaced it

audio.cpp is a C++ runtime built on [ggml](https://github.com/ggerganov/ggml).
It implements 50+ audio model families behind one CLI, with CUDA, HIP, Metal,
Vulkan and CPU backends. There's no Python in the inference path, so there's no
torch to pin.

Konchi's base install has no model runtimes in it: Node 20+, `npm install`,
and no GPU-specific wheel to match to your hardware. The backend is detected
per machine (Metal on Apple silicon, CUDA where `nvidia-smi` responds, Vulkan
or CPU otherwise), and that picks which release asset to download. The server
above the binary is TypeScript on Node, using Fastify, with the MCP server in
the same process. Nothing above the binary handles a tensor.

The docs lagged behind the code. While this post was being drafted they still
mentioned Python in three places: a deleted `backend/` directory, a FastAPI
server, and a `uv pip install` for a package that can't be installed. All three
are fixed now.

You can check the "no Python" claim without installing the app. The CLI runs
with no server and no web app:

```bash
konchi pull audiocpp-stable-audio-3-sfx
konchi run  audiocpp-stable-audio-3-sfx "glass breaking on concrete" --out test.wav
```

That's one process writing a WAV. If a hidden sidecar process existed, you'd
see it here.

## Adding a model is a JSON edit

The catalogue lives in `audiocpp_models_catalog.json`. Adding or fixing a model
means editing that file. There's no new dependency, environment or code,
because every model uses the same adapter. You can also add your own: anything
in `<data dir>/models/custom.json` is loaded alongside the shipped catalogue in
the same format. A quantised version of your own fine-tune is a file you write,
not a fork you maintain.

![The Konchi Models table: each model with its licence badge, VRAM estimate and installed status](/blog/models-page.png)

**Listed** models appear in the picker. **Extras** are catalogued but hidden
until you enable them on the Models page. Enabling one adds it to
`GET /api/models` straight away, with no restart, because a model is data and
not code.

## Two install decisions

Konchi doesn't ship or vendor any native binaries. `audiocpp_cli` is
downloaded from upstream GitHub releases the first time it's needed and cached
in your data directory, not in the checkout.

**Why not vendor the binary.** A vendored binary means every clone carries a
runtime most contributors won't use. It also has to work everywhere, which in
practice means a CPU build. Downloading on demand gets the build for your
machine's backend. Downloads are checksum-verified when the release publishes a
manifest. If the manifest leaves out your platform, the installer warns and
installs anyway, because refusing would make the automatic install less
reliable than downloading it by hand.

**Why `PATH` comes last.** When Konchi needs the binary, it checks the
`KONCHI_AUDIOCPP_BIN` override first, then the managed install in
`<data dir>/bin/`, then `PATH`. The managed install comes before `PATH` so that
after you run the installer, you get what you just installed, not an old
system-wide copy from a `brew install` months ago. `konchi model status
audiocpp` reports which one it found and where.

Caching follows the same thinking. Runtimes live in `bin/` next to `models/`,
not inside it, and each version gets its own directory. An upgrade never
overwrites the copy that's running, and reinstalling the engine doesn't delete
your weights.

## What this doesn't fix

Licensing. Every model shows its licence before you download it, and several
of the good ones forbid commercial use. Open weights don't mean you can sell
what the model makes.

Speed. CPU works, but it takes minutes. In practice you need an NVIDIA GPU with
8 GB. If a generation is much slower than expected, it has usually fallen back
to CPU without telling you, and `konchi model status audiocpp` will show it.

Testing. Four models are verified end to end and the rest are untested, which
is what the Status column shows. Because every model installs the same way,
testing the rest is cheap. That's no excuse for leaving them untested.

The claim is narrower than "no Python" sounds: supporting one more model costs
a few lines of JSON, not a new environment that has to coexist with the last
one.
