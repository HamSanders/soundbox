---
title: "Bring your games to life: Claude Code, Soundbox and Godot"
description: One sentence to Claude Code, six local sounds, one jingle that failed by ear and the retake that fixed it, with prompts, seeds and timings from the call log.
date: 2026-10-26
author: Anthony Saviano
tags: [games, mcp, agents, godot]
draft: true
image: /blog/bring-your-games-to-life.jpg
audio: /blog/audio/bring-your-games-to-life.mp3
---

On 23 October I asked Claude Code to make the sounds for a small Godot
platformer. It got them from Soundbox, the app I build, over MCP. The models
ran on my own GPU. Here is the run call by call, including the jingle that
came back wrong.

Setting up the MCP connection is covered in
[point your agent at Soundbox](/blog/point-your-agent-at-soundbox), and why
none of this needs Python is in
[what audio.cpp replaced](/blog/what-audio-cpp-replaced).

![The finished run: the Godot platformer playing its six generated sounds, then the Soundbox library and Agents page showing the calls that made them](/media/godot.mp4 "/media/posters/godot.jpg")

The game audio in the clip is the sounds from this run, loudness-matched for
video. The synthwave bed under it is from an earlier Soundbox film.

## The setup

Everything ran on one Windows machine with an RTX 5080.

- **Soundbox, open.** The MCP server runs inside the app at
  `http://127.0.0.1:17494/mcp`.
- **Claude Code, connected with one command.**

  ```bash
  claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp
  ```

- **A new Godot 4.5.1 project.** One `Node2D` that draws itself, six
  `AudioStreamPlayer` nodes, and a script that plays the right one on jump,
  land, coin, crate, door and win.

The game has no input. The character runs a fixed course so it could be
recorded the same way every time.

![The Godot scene: a teal block runs a fixed course, collecting coins, breaking a crate and passing a stone door before the flag](/blog/godot-game.gif)

## The request

This is everything I typed:

```text
Make sound effects for my little Godot platformer: jump, coin pickup,
landing, a crate breaking, a stone door opening and a level-complete jingle.
```

"Jump" won't get you much from these models. They respond to material, action
and space, so what matters is what the agent wrote for each sound.

## Six calls

Each call went to `soundbox.generate` on Stable Audio 3.0 SFX. The arguments
are copied from the call log. The times are the server's own `elapsed_s`.

| Sound | Prompt the agent wrote | Seed | Asked | Got | Time |
| --- | --- | --- | --- | --- | --- |
| Jump | quick light cartoon jump, soft springy whoosh rising upward, short, dry studio | 101 | 1.0 s | 0.36 s | 10.57 s |
| Coin | bright metallic coin pickup chime, small gold coin, two quick high bell tones, dry | 202 | 1.0 s | 0.20 s | 0.26 s |
| Land | soft thud of rubber sneakers landing on a hollow wooden platform, short, dry room | 303 | 1.0 s | 0.29 s | 0.26 s |
| Crate | small wooden crate smashing apart, splintering planks and debris scattering on a stone floor | 404 | 1.5 s | 1.13 s | 1.96 s |
| Door | heavy stone door grinding open slowly, low rumble, echoing dungeon corridor | 505 | 2.0 s | 1.62 s | 0.52 s |
| Win | short triumphant retro synth fanfare, rising arpeggio, video game level complete jingle | 606 | 2.5 s | 2.50 s | 0.74 s |

The first call took 10.57 s because it included loading the model. The model
then stayed in VRAM, and the coin took 0.26 s. That's on a 16 GB card. On a
CPU, expect minutes.

I didn't tell the agent how to write prompts. The `generate` tool's
description of its `prompt` argument says "Describe material, action and
space", and all six prompts do that.

The sounds came back shorter than asked because Soundbox trims trailing
silence. A 1-second coin request gave 0.2 s of coin. For game sounds I want
that.

Each result includes the WAV's full path on disk, so the files were copied
straight into the project's `sfx/` folder under the names the scene expects.

![The Soundbox SFX library filtered to the godot-video tag: six sounds, each with its model, seed and the label claude-code 2.1.299](/blog/godot-sfx-library.png)

All six are in the library with prompt, model, seed and the client that asked
for them. If I want another take of the crate, I start from that row.

## The jingle was wrong

Five sounds were fine first time. The win sound was a wash of bright noise.
The agent couldn't know that, because it can't listen. I did.

I asked it to fix the jingle. It made four more calls with `variations: 3`,
so twelve takes, and ranked them by what it could measure: whether the spectrogram showed separate notes, whether a pitch track
climbed, and whether the last 100 ms faded out or stopped at full volume.

| Call | Model | Seed | Time for 3 takes | What came back |
| --- | --- | --- | --- | --- |
| "bright 8-bit chiptune victory jingle, square wave arpeggio rising up a major chord, ending on a held high note, clean, no reverb" | Stable Audio 3.0 SFX | 611 | 7.37 s | Noise wash, no notes, cut off at 2.5 s |
| "video game level complete sting, cheerful bell and synth chime, three rising notes then a sparkle, dry" | Stable Audio 3.0 SFX | 621 | 2.29 s | Noise wash, no notes, cut off |
| "short cheerful chiptune victory fanfare, 8-bit, rising arpeggio, major key, 140 BPM" | Stable Audio 3.0 Small Music | 631 | 6.49 s | Real notes, but drums, and cut off mid-phrase |
| "short 8-bit chiptune victory fanfare, square wave lead, quick rising major arpeggio then a long held final note, no drums, major key, 140 BPM" | Stable Audio 3.0 Small Music | 641 | 3.40 s | Real notes that climb and end |

The SFX model made six more takes from prompts that asked for notes by name.
None of them had a single note. Rewording was the obvious fix, and it did
nothing.

Changing the model did. Stable Audio 3.0 Small Music is the music fine-tune of
the same model, at the same ~2.5 GB of VRAM. It gave pitched notes on every
take on this prompt.

The prompt still mattered after that. The first music call gave drums and
phrases that ran into the cut, like the start of a loop. Adding "a long held
final note, no drums" got takes with endings. The one in the game is seed
544958598, the third take of that call. It's 3.44 s long, the notes climb and
finish on the highest one, and it fades to −38 dB, so the end isn't chopped.

## The Agents page

Soundbox logs every agent call with the client, the prompt, how many sounds
came back and how long it took. These are the ten calls from this run, newest
first:

![The Agents page's Recent calls: ten generate calls from claude-code, the six original sounds at the bottom with the 10569 ms first call, the four three-take win retakes at the top](/blog/godot-recent-calls.png)

When an agent makes files while it writes your code, this is how you find out
later which call made which file, without searching the chat history.

## The licence

Both models here use the Stability AI Community License. Commercial use is
free while you or your organisation make under US$1M a year in total revenue.
Above that you need an Enterprise licence from Stability AI. The app shows
this on each model's card before you download it. So does the site, for
[Stable Audio 3.0 SFX](/models/stable-audio-3-sfx) and
[Small Music](/models/stable-audio-3-small-music).

Some models in the catalogue are non-commercial. Check before you ship a game
with their output in it. If Soundbox can't establish a model's licence, it
treats it as non-commercial. The card is a summary, not legal advice.

## If you're looking for a local Suno alternative

Soundbox also makes songs with lyrics. ACE-Step 1.5 Turbo is MIT-licensed and
allows commercial use. MiniMax Music 3 needs about 10 GB of VRAM and has
conditional commercial terms. Both take a lyric sheet, and ACE-Step can also
extend, cover and repaint a take. Every model runs through the same audio.cpp
binary, so you can send one prompt and seed to three music models and compare:

![The same prompt and seed rendered by Stable Audio 3.0 Small Music, MiniMax Music 3 and ACE-Step 1.5 Turbo, with measured render times on an RTX 5080](/product/same-prompt-three-models.gif)

It isn't Suno. These are open models and quality varies between them. What
you get is no account and no credits, output under the licence of the model
that made it, and an agent that can ask for a song the way it asked for a coin.

The first load is slow. On the same RTX 5080 with audio.cpp 0.9.2, a
15-second song with lyrics on ACE-Step took 151 s the first time and about
15 s after that. A 10-second Small Music loop took 8 s.

## What's still rough

- **Only four models are verified end to end.** They are Stable Audio 3.0 SFX,
  Small Music, ACE-Step 1.5 Turbo and MiniMax Music 3. The other 61 are
  marked unverified until someone reports back. Four of those have also been
  run end to end: VibeVoice 1.5B, MiDashengLM-Gen, HTDemucs 6-stem and
  Chatterbox Turbo.
- **You want an NVIDIA GPU.** A few GB of VRAM covers the verified models,
  apart from MiniMax Music 3 at about 10 GB. AMD and Intel GPUs use the CPU
  unless you opt into Vulkan, which nobody has confirmed on the verified
  models. There are Mac installers, but nobody has confirmed the verified
  models on Apple silicon.
- **The installers aren't signed.** The first launch asks you to confirm.
- **The agent can't hear.** It will hand you a noise wash and call it a
  fanfare. Listen before you commit.

## Try it

Install Soundbox from the
[latest release](https://github.com/HamSanders/soundbox/releases/latest),
connect Claude Code with the command above, and give it the sentence from this
post or one about your own game.
[docs/MCP.md](https://github.com/HamSanders/soundbox/blob/main/docs/MCP.md)
lists the tools, the `soundbox-sound-pass` skill that reads a project and works out which sounds it
needs, and the stdio bridge for clients that don't speak HTTP.
