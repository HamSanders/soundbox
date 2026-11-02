# Using Soundbox from an AI agent

Soundbox exposes its generation pipeline over [MCP](https://modelcontextprotocol.io).
An agent can generate sound effects, music and speech as part of a larger
task, and arrange longer pieces on a timeline it can return to later.

The MCP server runs inside the main Soundbox process at
`http://127.0.0.1:17494/mcp`. **The server must be running.** There is no
separate daemon to start.

## Connecting

### HTTP (preferred)

```json
{
  "mcpServers": {
    "soundbox": { "type": "http", "url": "http://127.0.0.1:17494/mcp" }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp
```

The URL has **no trailing slash**. Soundbox rewrites `/mcp` to the mounted path
internally, so clients that don't follow 307 redirects on POST work.

### stdio

For clients that only speak stdio. The bridge is a thin proxy onto the running
server. It does not load models, so there is never a second copy of a model on
your GPU.

```json
{
  "mcpServers": {
    "soundbox": {
      "command": "node",
      "args": ["/absolute/path/to/soundbox/server/dist/mcp/stdio.js"]
    }
  }
}
```

Use the absolute path to the script. `npx soundbox-mcp` does not resolve
because the package is private. `npm install` links a `soundbox-mcp` bin, but
only into the checkout's own `node_modules/.bin`, which is not on the `PATH`
your editor spawns an MCP server with. Both short forms fail with "command not
found".

`server/dist/mcp/stdio.js` exists only after `npm run build` (or
`npm run build --workspace server`); a fresh clone does not have it.

The **Agents** page prints this line with the path resolved for the install
you are running. Copy it from there.

The bridge covers six tools: `generate`, `enhance_prompt`, `list_models`,
`list_sounds`, `get_sound` and `delete_sound`. For `separate`, speech,
stories and arrangement, use the HTTP transport.

Set `SOUNDBOX_URL` if the server listens somewhere other than
`http://127.0.0.1:17494`.

## Tools

Twenty-one tools in four groups: sounds, voices, stories, arrangement. The
authority is `server/src/mcp/server.ts`: the `MCP_TOOLS` table for names and
descriptions, and the zod `inputSchema` on each `registerTool` call for
arguments. Where this file and that one disagree, that one is right.

### Sounds

#### `soundbox.generate`

Generates one or more sounds and saves them to the library. **Blocks until the
audio is written to disk**, which can be seconds to a minute depending on model
and length.

A long music render can outlast a client's tool-call timeout, and some clients
cut a call off at 60 seconds. If the request carries `_meta.progressToken`,
Soundbox sends `notifications/progress` while the job runs: `progress` from 0
to 1 (`total: 1`) and the job's own `message` ("loading model", "sampling",
and so on). It sends one when the job moves, at most once a second, plus one
every 5 seconds while nothing moves, such as while weights load. A client that
resets its timeout on progress keeps the call alive this way. The same applies
to every tool that waits on a job: `speak`, `speak_story` (one bar across all
the lines it reads), `separate`, `export_story` and `open_in_studio`, over HTTP
and over the stdio bridge (which only has `generate`). A client that sends no
token gets no notifications. If the client neither sends a token nor resets on
progress, raise its tool timeout, or ask for a shorter `duration_s`.

| Argument | Type | Default | Notes |
|---|---|---|---|
| `prompt` | string | — | Describe material, action and space |
| `duration_s` | number | 5.0 | 0.5–30, clamped to the model's max |
| `model` | string? | loaded model | Falls back to the first installed one |
| `negative_prompt` | string? | — | Ignored by models that don't support it |
| `seed` | int? | random | For reproducibility |
| `variations` | int | 1 | 1–4 distinct takes |
| `tags` | string[]? | — | Library tags |
| `lyrics` | string? | — | Words for a lyrics-conditioned music model to sing |
| `source_sound_id` | string? | — | Edit an existing sound instead of rendering fresh |
| `edit` | string? | — | `extend` / `cover` / `repaint`, paired with `source_sound_id` |

Returns each sound with an **absolute filesystem path**, which the agent can
pass to ffmpeg or copy into a project.

`lyrics` and the `edit` family only work on models that declare them
(`supports.lyrics`, `supports.extend`, `supports.cover` in `list_models`).
Other models ignore these fields silently.

#### `soundbox.separate`

Splits a library sound into its stems (vocals, drums, bass, other), each saved
as its own sound with its own absolute path. **Blocks until the audio is on
disk.** Needs a separation model installed (`task: "sep"` in `list_models`).

| Argument | Type | Default | Notes |
|---|---|---|---|
| `sound_id` | string | — | The library sound to split |
| `model` | string? | installed separator | Prefers one already loaded |
| `stems` | string[]? | all | Which stems to keep, e.g. `["vocals"]`. A name nothing answers to is reported back, not dropped |
| `rest` | `discard` / `merge` | `discard` | What happens to the stems not named. `merge` sums them into one "rest" sound (the original minus what you took out). Ignored when `stems` is omitted |

#### `soundbox.enhance_prompt`

Rewrites a vague prompt ("scary sound") into one or more concrete ones. Takes
`prompt`, `n` (1–5), `category` (`sfx` / `music`), `lyrics`, and `model`. Pass
the id you intend to generate with and the rewrite follows that model's
prompting conventions.

Requires the local prompt assistant. When it is off, the tool returns a
plain-text explanation instead of an error; surface that reply to the user.

#### `soundbox.list_models`

Models with status and licence, including `commercial_use` (`yes` / `no` /
`conditional`). Call it before generating anything for a commercial project.

For a text-to-speech model it also returns `delivery`: the parameters that
model accepts, each with its range and default, read from audio.cpp's own
parameter table. Use these names. audio.cpp accepts unknown options silently,
so a name taken from a model card raises no error and has no effect. A model
with no `delivery` list has no such parameters; only its text and voice
control the output.

#### `soundbox.list_sounds` / `soundbox.get_sound` / `soundbox.delete_sound`

Search and manage the library. `list_sounds` takes `q`, `tag`, `voice_id` and
`limit`; searching before generating is usually faster than regenerating, and
`voice_id` answers "what has this voice already said" without re-reading it. `get_sound`
takes a `sound_id` and returns the one sound with its absolute path.
`delete_sound` takes a `sound_id` and **permanently** removes the row and the
file on disk.

### Voices

`soundbox.generate` does not produce speech. Use the voice tools below.

#### `soundbox.list_voices`

No arguments. Returns the saved voices a script can be read in. Call it before
writing a script so lines are cast to real voice ids. Each voice's `model_id` is
the model it was made on, and the one it is read with unless you pass `model`.

#### Which model reads a line

`speak` and `speak_story` pick a model per line, in this order:

1. `model`, when you pass it. Every line is read on it.
2. The line's voice's `model_id`, when that model is installed. A clone read on
   another family does not sound like the voice.
3. A ready text-to-speech model, preferring the one already loaded. This covers
   a line with no voice and a voice saved before voices carried a model.

Lines cast to voices on different models are each read on their own. When a
voice's model is not installed, the line falls back to step 3 and the result
carries a `notes` entry saying so. `speak_story` returns `models`, a count of
lines read per model id; a `speak` dialogue across families returns the same
next to `model`.

#### `soundbox.speak`

One read, saved to the library. Takes `lines` (1–200 objects of `text`,
`voice_id`, `speaker`; several with different `voice_id`s make a dialogue),
`model`, `gap_s` (silence between lines, default 0.4), `name`, and `delivery`.
**Blocks until the audio is written.**

`speak` produces one finished WAV that cannot be edited afterwards. Use a story
for anything you want to keep, re-read or rearrange.

### Stories

A story is a persistent script. Each line has a position in time, can be voiced
individually, and stays in the library after the conversation ends.

#### `soundbox.create_story`

Takes `title` and `delivery`. Returns a summary with a `story_id` and an
`open_in_studio` URL. Every story tool returns this summary.

#### `soundbox.list_stories` / `soundbox.get_story`

`list_stories` takes `limit` (1–200, default 20), most recently worked on
first. `get_story` takes a `story_id` and returns every line: text, voice,
track, start, and whether it has been voiced yet. The summary the other tools
return omits the lines; use `get_story` to read them.

#### `soundbox.add_lines`

Takes `story_id` and `lines` (1–200). Each line is a spoken line, a `pause` of
`duration_s` seconds, or an existing library `sound_id` placed on the
timeline. `track_index` picks the lane and `start_s` the position. Omit
`start_s` to append after that track's last clip.

#### `soundbox.update_line`

Takes `line_id` plus whatever you are changing: `text`, `speaker`, `voice_id`,
`track_index`, `start_s`, `muted`, `gain_db`, `duration_s` (how much of the
clip plays), `trim_start_s` (how far into the source it begins), `delivery`.

Changing the words or the delivery does not re-read the line. The existing
audio stays until the line is voiced again.

#### `soundbox.speak_story`

Takes `story_id`, `model`, and `regenerate` (re-read lines that already have
audio, default false). Reads every silent line in its assigned voice, on that
voice's model, one at a time. **This is the slowest tool**: a forty-line script is forty reads.

#### `soundbox.delete_line` / `soundbox.split_line`

`delete_line` takes a `line_id` and removes it from the story; the audio it was
using stays in the library. `split_line` takes `line_id` and `at_s` (seconds
into that line's own audio) and produces two clips. The text stays with the
first clip, since Soundbox cannot tell which words fall on each side of the cut.

#### `soundbox.export_story`

Takes `story_id`. Mixes the whole arrangement down to one sound, honouring
where each clip sits, its trim, its gain and whether it is muted. **Blocks**,
and returns the resulting sound with an absolute path.

### Arrangement

#### `soundbox.open_in_studio`

Takes `sound_id`, `separate` (split into stems first, default true), `stems`
(which ones get a track; omit for all) and `rest` (`discard` or `merge` the
ones you didn't name). Lays a library sound out on a timeline. Reuses stems the
sound already has instead of separating it again.

#### `soundbox.mix_track` / `soundbox.remove_track`

`mix_track` takes `story_id`, `track_index` and any of `name`, `muted`,
`soloed`, `gain_db`. These settings apply to the lane as a whole. With any
track soloed, only soloed tracks are heard. `remove_track` takes
`story_id` and `track_index` and **deletes the lane and everything on it**;
lanes above slide down. Call `get_story` first if you are not certain what is
on it.

#### `soundbox.add_device` / `soundbox.set_device` / `soundbox.remove_device`

The studio's device rack, one lane at a time. `add_device` takes `story_id`,
`track_index`, `kind` (`compressor`, `eq`, `reverb`, `delay`, `distortion`,
`gate`, `limiter`, `autotune`) and optionally `params`, `bypassed` and
`position` (where in the chain, from 0; omit to add it last). The device starts
at its defaults, so `params` only needs the knobs you mean to change.

`set_device` takes `story_id`, `track_index`, `device` and either `params`,
`bypassed` or both. `device` is the id that `add_device` returned, or the kind
when the lane has only one device of that kind; with two EQs on a lane, the
error lists their ids. `bypassed: true` takes a device out of the signal path
and keeps its settings. `remove_device` takes the same `device` reference.

Knob values are in the units the device stores: seconds for times (an attack of
6 ms is `0.006`), dB for levels and thresholds, `0`–`1` for mixes. The ranges
and defaults are in the `params` description of the tool's input schema, from
the same table the rack is built from. A value past the end of a knob's range
lands at the end, and the result lists it under `clamped`. A knob the device
does not have is an error rather than being ignored.

Every call returns the lane's whole chain, so the next call can use an id from
it. `soundbox.get_story` returns the chains too, under `tracks`. The studio
shows each change as it lands.

> Devices are heard in the studio's timeline playback. `export_story` mixes
> dry, without them.

### Delivery

Set how a line is performed with `delivery`, not in the text. Writing
`(whispering)` into a line makes the model say the word "whispering" aloud.
Pass `delivery` at the level it applies to:

| Where | Applies to |
|---|---|
| `soundbox.create_story` | Every line in the story that doesn't override it |
| `soundbox.add_lines` | One line, set as it is written |
| `soundbox.update_line` | One line, afterwards. `{}` puts it back on the story's |
| `soundbox.speak` | The whole one-off read |

The narrowest level wins: a line's own delivery overrides the story's. Changing
a delivery does not re-read anything; voice the line again to hear it.

## Watching what your agents do

Open the **Agents** page in the app (`/#/agents`) to see every client that has
connected: which agent, what it called, whether it worked, how long it took,
and every sound it produced, updated live. It also shows the endpoint and
stdio command above, and the bundled skills below.

Every call the server handles is:

- **Attributed.** The MCP handshake's `clientInfo` (name + version) is
  captured automatically. There is no header to add and no auth. Sounds an
  agent generates are tagged with that identity
  (`Sound.source = "mcp"`, `Sound.client = "claude-code 2.1.0"`), and the
  Library can filter to what agents made.
- **Logged.** One line per call in the server's log (`grep mcp
  ~/.soundbox/soundbox-17494.log`, or whatever port you run on), and persisted to `GET /api/mcp/calls` /
  `GET /api/mcp/status` for the app or your own tooling to read.
- **Optionally exported.** OpenTelemetry export is built in, with nothing extra
  to install. Point it at a collector:

  ```json
  { "otel_endpoint": "http://localhost:4318" }
  ```
  via `PATCH /api/settings`, or set `OTEL_EXPORTER_OTLP_ENDPOINT` in the
  server's environment (that env var wins). Each call becomes a span carrying
  the client, session, tool, model and resulting sound ids on standard
  OTLP/HTTP: traces to `<endpoint>/v1/traces`, metrics to
  `<endpoint>/v1/metrics`. Works with Jaeger, Tempo, Honeycomb, the OTel
  Collector, or anything else that speaks OTLP.

## Skills

Soundbox ships agent skills under `server/skills/`:
`soundbox-sfx` (prompting technique, tool usage), `soundbox-sound-pass`
(inventorying and generating every sound event a whole project needs) and
`soundbox-voice-story` (writing, voicing and arranging spoken audio as a
story). They tell a connected agent how to prompt and call these tools.

Install them once per machine:

```bash
soundbox skills install                  # -> ~/.claude/skills/
soundbox skills install --target cursor  # -> ~/.cursor/skills/
soundbox skills list                     # see what's bundled/installed
```

or click **Install skills** on the Agents page, which calls
`POST /api/mcp/skills/install`. Re-running overwrites, so reinstall after
upgrading Soundbox to keep them current.

## Notes for agent authors

**Generation is serialised.** One GPU, one job at a time. Five parallel
`generate` calls are queued and run one after another. Use `variations` for
several takes of the same idea.

**No model loaded is a normal state.** If nothing is installed, `generate`
returns an error telling the user to install one from the Models screen.
Surface it instead of retrying.

**Prompt style matters more than parameters.** These models respond to physical
description (material, action, space) and ignore mood words. "Scary sound"
produces noise. "Low metallic groan of a ship's hull under pressure, distant,
reverberant" produces something usable. Several short clips layered in an
editor usually sound better than one long generation.

**Licences are per-model and some forbid commercial use.** If the user's
project is commercial, prefer a model whose `commercial_use` is `yes`.
