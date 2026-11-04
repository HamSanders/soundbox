# The library

Everything Konchi makes is saved automatically. There is no "save" button:
a generation writes a WAV to disk and a row to the database before you hear
it. The library is where you find it again.

## What a sound carries

Every clip keeps the settings that made it:

| Field                        | Why it is there                                              |
| ---------------------------- | ------------------------------------------------------------ |
| Prompt, negative prompt      | What you asked for, verbatim                                 |
| Model                        | Which one answered                                           |
| Seed, steps, CFG             | Enough to render it again                                    |
| Duration, sample rate, size  | Facts about the file on disk                                 |
| Peaks                        | 256 measured points, so every waveform draws without decoding |
| Source                       | `app`, `api` or `mcp` (who asked)                            |
| Parent                       | Set on anything derived from another sound                   |

"Reuse this prompt" copies all of it back to the composer, so you can make a
variation of an earlier sound.

## Finding things

- **Search** matches prompts and names.
- **Categories** (SFX, Music, Text to Speech) are separate lists, narrowed by
  the models in each category, so a music render never appears while you are
  browsing SFX.
- **Tags** are yours, free-form, and indexed.
- **Favourites** are marked with a star.
- **Agent-made** sounds can be filtered on their own, to see what an agent
  generated.

## Sessions and projects

- A **session** is a sitting. It is created on your first generation, titled
  from the prompt, and collects everything made in that run automatically. Use
  it to find what you made on a given day.
- A **project** is a folder you put things in yourself. Use it to collect what
  a track is made of.

A sound inherits its session's project, and can be moved to a project of its
own. The library shows whether a sound's project is inherited or set directly.

## Editing without destroying

Every tool that changes audio writes a **new sound** with `parent_id` pointing
at the original. Nothing is overwritten.

A sound's page has a waveform you can drag a selection across, and a toolbar
that acts on the selection or the whole clip:

| Tool          | What it does                                                  |
| ------------- | ------------------------------------------------------------- |
| Trim          | Keep the selection, discard the rest                          |
| Normalize     | To a LUFS target                                              |
| Gain          | Up or down, in dB                                             |
| Reverse       | Backwards                                                     |
| High-pass, low-pass | Cut below or above a frequency                          |
| Pitch         | Semitones, without changing the length                        |
| Stretch       | Length, without changing the pitch                            |

Each Apply produces a new clip and opens it. The original is unchanged.

## Stems

If a separator model (HTDemucs) is installed, any sound can be **split into
stems**: vocals, drums, bass, other. The stems are ordinary library sounds with
their parent set, so you can search, tag and arrange them like any other.

When you split, choose the stems you want and what happens to the others:

- **Scrap them:** the stems you did not pick are never written. A split for
  the drums alone leaves one new sound.
- **Keep as one:** the rest is summed into a single `(rest)` sound, the
  original minus what you took out. The pieces still add back up to the take.

On a sound's page the stems appear beneath it as one synced player. They share
the source's length and start together. To arrange them, open the sound in
the studio, which splits it and puts one stem on each lane.

## Where the files are

```
~/.konchi/sounds/<id>.wav
```

Plain WAV, one per sound, named by id. The library's "reveal" opens your file
manager with the file selected. Downloads can be converted to mp3 if ffmpeg is
installed. Without it you get the WAV, and the app tells you.

The audio is plain files and the metadata is one SQLite file, so to back up
your work, copy `~/.konchi`. Deleting a sound from the library deletes its
row and its file, and never a derived clip made from it.

## From the API

```bash
# Everything, newest first
curl 'http://127.0.0.1:17494/api/sounds?limit=20'

# Only sounds from these models, matching "rain"
curl 'http://127.0.0.1:17494/api/sounds?q=rain&models=audiocpp-stable-audio-3-small-music,audiocpp-ace-step'

# One sound, in full
curl 'http://127.0.0.1:17494/api/sounds/<id>'
```

Every endpoint is in the [API reference](./API.md).
