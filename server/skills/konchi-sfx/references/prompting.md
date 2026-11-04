# Prompting text-to-audio models

The models behind Konchi (Stable Audio, ACE-Step, and others via audio.cpp)
were trained on captions of *recordings*. They respond to how a recording would
be described — physical, concrete, present tense — not to how a sound makes you
feel. Everything below follows from that.

## The formula

```
<material/source> <action>, <space/perspective>[, <texture qualifiers>]
```

| Piece | Examples |
|---|---|
| material / source | `wet gravel`, `sheet metal`, `glass bottle`, `leather boots`, `old diesel model`, `wooden crate` |
| action | `dragging`, `shattering`, `slamming shut`, `idling`, `crunching underfoot`, `swinging past` |
| space / perspective | `small tiled bathroom`, `open field, distant`, `close-mic, dry`, `large empty warehouse` |
| texture | `short tail`, `single hit`, `slow`, `rhythmic`, `no music`, `lo-fi radio` |

Good:

- `single heavy footstep on wet gravel, close perspective, dry`
- `sci-fi door sliding open with a pneumatic hiss, medium room`
- `soft UI confirmation blip, two rising sine tones, clean, no reverb`
- `wind through pine trees with distant crows, open field, steady`
- `wooden crate dropped onto concrete floor in a warehouse, single impact`

Bad → why:

- `epic explosion` → no material or space; "epic" isn't audible
- `scary ambience` → mood, not sound. Try `low metallic groan of a ship hull under pressure, distant, reverberant`
- `the sound a laser makes in Star Wars` → references to media rarely land; describe the sound (`short high-pitched electronic zap with a descending pitch sweep`)
- `footsteps, door, wind and rain` → four events; make four clips

## Duration

| Kind | duration_s |
|---|---|
| Click / blip / hit / whoosh | 0.5 – 2 |
| Foley (footstep, cloth, latch) | 1 – 3 |
| Mechanical (model, machine loop) | 4 – 8 |
| Ambience bed | 8 – 20 |

Models cap duration (check `max_duration_s` from `konchi.list_models`).
Long requests for short events give you the event followed by nothing useful.

## Negative prompts

Not every model supports one (ignored where unsupported). Useful ones:

- `music, melody, tones` — when the model drifts toward musicality
- `reverb, echo` — when you need a dry sample to place in a game model
- `speech, voice` — crowd/room ambiences sometimes grow murmurs
- `distortion, clipping`

## Seeds and variations

- Same prompt + same seed + same model → same audio. When the user likes take
  #2, read its `seed` from the result and pass it back to regenerate or tweak.
- `variations=N` runs the same prompt with N different seeds. Use it for sets
  (footsteps, hits) — not for fixing a bad prompt.

## Layering beats one long prompt

A convincing "door" is often three files: handle click (0.5 s), swing creak
(1.5 s), latch/slam (1 s). Generate them separately, name them clearly, and
tell the user how to sequence them. Games and DAWs mix; models don't.

## Model differences (rule of thumb)

- **Stable Audio 3.0 SFX** — good general foley/ambience quality.
- **Stable Audio 3.0 Small Music** — fast, music-focused.
- **ACE-Step 1.5 Turbo** — permissively licensed, general all-rounder.

Always confirm with `konchi.list_models` — the user may only have one installed,
and `commercial_use` differs per model.
