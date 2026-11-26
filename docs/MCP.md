# Using Mirli from an AI agent

Mirli exposes its generation pipeline over [MCP](https://modelcontextprotocol.io).
An agent can generate sound effects, music and speech as part of a larger
task, and arrange longer pieces on a timeline it can return to later.

The MCP server runs inside the main Mirli process at
`http://127.0.0.1:17494/mcp`. **The server must be running.** There is no
separate daemon to start.

## Connecting

### HTTP (preferred)

Every client below talks to the same URL, `http://127.0.0.1:17494/mcp`, over Streamable HTTP. There
is no auth to configure. The URL has **no trailing slash**. Mirli rewrites
`/mcp` to the mounted path internally, so clients that don't follow 307
redirects on POST work.

Each entry was checked against the vendor's own docs on 2026-11-23 (linked).
The same instructions, with one-click install links, are on the site's MCP
page.

#### Claude Code ([docs](https://code.claude.com/docs/en/mcp))

```bash
claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp
```

Add `--scope user` for every project. In a hand-written `.mcp.json`, `type` is
required: `{"mcpServers":{"soundbox":{"type":"http","url":"http://127.0.0.1:17494/mcp"}}}`.

#### Claude Desktop ([docs](https://modelcontextprotocol.io/docs/develop/connect-local-servers))

`claude_desktop_config.json` takes stdio servers only, and Settings →
Connectors connects from Anthropic's cloud, which cannot reach 127.0.0.1. Use
the `mcp-remote` bridge (needs Node.js), or Mirli's own bridge below:

```json
{"mcpServers":{"soundbox":{"command":"npx","args":["-y","mcp-remote","http://127.0.0.1:17494/mcp"]}}}
```

The file is in `%APPDATA%\Claude\` (Windows),
`~/Library/Application Support/Claude/` (macOS) or `~/.config/Claude/`
(Linux). Quit Desktop fully and reopen it after editing.

#### Cursor ([docs](https://cursor.com/docs/context/mcp))

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{"mcpServers":{"soundbox":{"url":"http://127.0.0.1:17494/mcp"}}}
```

#### VS Code / GitHub Copilot ([docs](https://code.visualstudio.com/docs/copilot/customization/mcp-servers))

```bash
code --add-mcp '{"name":"soundbox","type":"http","url":"http://127.0.0.1:17494/mcp"}'
```

Or MCP: Add Server → HTTP. `.vscode/mcp.json` uses a `servers` key, not
`mcpServers`.

#### Codex ([docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli))

```bash
codex mcp add soundbox --url http://127.0.0.1:17494/mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.soundbox]
url = "http://127.0.0.1:17494/mcp"
```

#### Antigravity, formerly Gemini CLI ([docs](https://antigravity.google/docs/mcp?tab=cli))

`~/.gemini/config/mcp_config.json` (or `.agents/mcp_config.json`):

```json
{"mcpServers":{"soundbox":{"serverUrl":"http://127.0.0.1:17494/mcp"}}}
```

Antigravity rejects `httpUrl`. The legacy Gemini CLI wants `httpUrl` instead
(`url` there means SSE): `gemini mcp add --transport http soundbox http://127.0.0.1:17494/mcp`.

#### Devin Desktop, formerly Windsurf ([docs](https://docs.devin.ai/cli/extensibility/mcp/configuration))

```bash
devin mcp add soundbox http://127.0.0.1:17494/mcp
```

Or `.devin/mcp_config.json`: `{"mcpServers":{"soundbox":{"url":"http://127.0.0.1:17494/mcp","transport":"http"}}}`.

#### Zed ([docs](https://zed.dev/docs/ai/mcp))

Settings → AI → MCP Servers → Add Remote Server, or in the settings file:
`"context_servers": {"soundbox": {"url": "http://127.0.0.1:17494/mcp"}}`.

#### Cline ([docs](https://docs.cline.bot/mcp/configuring-mcp-servers))

MCP Servers → Configure. Keep `type`, or Cline falls back to SSE:
`{"mcpServers":{"soundbox":{"type":"streamableHttp","url":"http://127.0.0.1:17494/mcp"}}}`.

#### Goose ([docs](https://goose-docs.ai/docs/getting-started/using-extensions))

`goose configure` → Add Extension → Remote Extension (Streamable HTTP), or in
`~/.config/goose/config.yaml` (the key is `uri`):

```yaml
extensions:
  soundbox:
    name: soundbox
    type: streamable_http
    uri: http://127.0.0.1:17494/mcp
    enabled: true
```

#### LM Studio ([docs](https://lmstudio.ai/docs/app/mcp))

Program tab → Install → Edit mcp.json: `{"mcpServers":{"soundbox":{"url":"http://127.0.0.1:17494/mcp"}}}`.

#### opencode ([docs](https://opencode.ai/docs/mcp-servers/))

```bash
opencode mcp add soundbox --url http://127.0.0.1:17494/mcp
```

Remote servers default to OAuth in opencode; Mirli has none, so set
`"oauth": false` if you write the entry by hand.

#### Continue ([docs](https://docs.continue.dev/customize/deep-dives/mcp))

```yaml
mcpServers:
  - name: soundbox
    type: streamable-http
    url: http://127.0.0.1:17494/mcp
```

#### Anything else

Add a remote server with the URL and the Streamable HTTP transport. If the
client only speaks stdio, wrap it with `npx -y mcp-remote http://127.0.0.1:17494/mcp`.

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

Set `MIRLI_URL` if the server listens somewhere other than
`http://127.0.0.1:17494`, and `MIRLI_API_TOKEN` if that server requires an
access token. Over HTTP, send the token as a header instead:
`claude mcp add --transport http soundbox <url>/mcp --header "Authorization: Bearer <token>"`.
See [Access token](INSTALL.md#access-token).

## Tools

Forty-nine tools in six groups: sounds, voices, stories, arrangement, the open studio, and
audiobooks. The
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
Mirli sends `notifications/progress` while the job runs: `progress` from 0
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
`delete_sound` takes a `sound_id` and moves the sound to the trash: it leaves
the library and is deleted for good after 30 days. `list_trash` shows what is
there, and `restore_from_trash` (`kind` `sound`, `session` or `book`, and `id`)
brings something back as it was. `delete_audiobook` takes a `book_id` and moves
the book to the trash the same way, chapters and voiced audio included.

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
track, start, and whether it has been voiced yet. A clip placed from the
studio's MIDI panel also carries `midi`: its notes, tempo, dry instrument,
cover prompt and strength, whether it is the dry render or the cover, and the
`take_id` the two share. The notes are read-only over MCP; they are edited in
the studio's piano roll. The summary the other tools return omits the lines;
use `get_story` to read them.

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
first clip, since Mirli cannot tell which words fall on each side of the cut.

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

### Audiobooks

A book is a list of chapters, and each chapter is a story, so the story and
arrangement tools above also work on a chapter (its `story_id` is in every
book summary). [AUDIOBOOKS.md](./AUDIOBOOKS.md) is the user guide. These tools
call the audiobook HTTP API in-process, so they validate exactly as the app
does. Every one returns ids for the next step and an `open_in_app` link.

A typical run: `import_manuscript` → `set_character_voice` for the narrator
and each character → `add_pronunciation` for names → `render_audiobook` →
`add_bed` → `master_and_export_audiobook`.

To tidy the text first: `edit_paragraph`, `find_replace`, `split_paragraph`
and `merge_paragraphs`; `cast_paragraphs` for who reads what; `add_chapter`,
`edit_chapter`, `move_chapter` and `delete_chapter` for the chapters.

#### `soundbox.create_audiobook` / `soundbox.import_manuscript`

`create_audiobook` takes `title` and optionally `author`, `narrator` (the
credited name), `language`, `model_id`, `narrator_voice_id` and `cast_mode`
(`single` or `multi`). It makes an empty book with one chapter.

`import_manuscript` takes exactly one of `path` (an absolute path to an
`.epub`, `.pdf`, `.docx`, `.txt`, `.md` or `.html` file, at most 200 MB),
`text` (with `format` `txt`, `md` or `html`), or `url`. `title` and `author`
override what the file says; the book settings are as for `create_audiobook`.
Chapters, front and back matter, the cover and metadata are detected as the
app's import does. The result includes the parser's `warnings`.

#### `soundbox.list_audiobooks` / `soundbox.get_audiobook`

`list_audiobooks` takes nothing. `get_audiobook` takes `book_id` and returns
chapters (with `chapter_id`, `story_id`, kind, whether it is included, and
voiced counts), the cast, settings and stats. With `chapter_id` it adds that
chapter's paragraphs (`offset`, `limit` up to 500): text, character, status
(`unvoiced`, `voiced`, `stale`, `locked`) and timing.

#### `soundbox.set_character_voice`

Takes `book_id`, `character` (a name, alias or id) and `voice_id` (from
`list_voices`, or `null` to clear it). Every paragraph of that character
follows. `character: "narrator"` sets the book's narrator voice instead.
`create: true` adds the character if the book has none by that name.
`model_id` reads the character on another model; usually leave it off, since
a voice has its own.

#### `soundbox.add_pronunciation`

Takes `term`, `replacement`, `kind` (`alias`, the default, `ipa` or `cmu`),
`case_sensitive` (default false) and `whole_word` (default true). With
`book_id` the rule belongs to that book; without, it is global. Rules apply
top to bottom and the first match wins. Paragraphs the rule changes become
`stale`.

#### `soundbox.render_audiobook`

Takes `book_id` and, to narrow it, `chapter_id` or `paragraph_ids`.
`overwrite` re-voices paragraphs that already have audio; locked paragraphs
are never redone. **Blocks** until the run finishes, reporting progress per
paragraph, unless `wait` is false. After `timeout_s` (default 3600) it stops
waiting and returns the run, which carries on in the app.

#### `soundbox.add_bed`

Takes `book_id`, `chapter_id`, `kind` (`music`, the default, `ambience` or
`sfx`) and either `sound_id` (a library sound) or `prompt` (generated on
`model`, or an installed music or SFX model). Optional: `gain_db`, `mode`
(`full`, `intro`, `outro`, `intro_outro`), `intro_s`, `loop`, `fade_in_s`,
`fade_out_s`, and for SFX `paragraph_id` and `offset_s`. `duck_db` sets how far
the bed dips under the narration; `0` turns ducking off. A prompt **blocks**
while the bed is generated. The bed lands on its own track in the chapter's
story; the result has the bed, its clip count and an `open_in_studio` link.

#### `soundbox.edit_paragraph`

Takes `book_id`, `paragraph_id` (from `get_audiobook` with a `chapter_id`) and
any of `text` (the whole new text), `character` (a character's name, alias or
id, or `narrator`), `locked` and `is_heading`. New text marks the paragraph
`stale` if it was voiced. Prefer this to `update_line` for a book: it goes
through the book, so its status and cast stay right.

#### `soundbox.cast_paragraphs` / `soundbox.lock_paragraphs`

`cast_paragraphs` takes `book_id`, `paragraph_ids` and `character` (a name,
alias or id, or `narrator`), and those paragraphs take that character's voice.
An unknown name is refused with the names the book has; add a character with
`set_character_voice` and `create: true`. `lock_paragraphs` takes `book_id`,
`paragraph_ids` and `locked` (default true; false unlocks). Locked paragraphs
are left alone by rendering and by find and replace.

#### `soundbox.split_paragraph` / `soundbox.merge_paragraphs`

`split_paragraph` takes `book_id`, `paragraph_id` and either `before` (the
words that start the second paragraph) or `at` (a character offset). Text
that isn't in the paragraph is refused with what the paragraph says.
`merge_paragraphs` takes `book_id` and `paragraph_id` and joins it with the
paragraph after it. Both work on text, so unlike `split_line` (which cuts a
clip at a time) they work on paragraphs that aren't voiced yet.

#### `soundbox.find_replace`

Takes `book_id`, `find`, `replace` (empty removes the match), and optionally
`chapter_ids`, `case_sensitive`, `whole_word` and `dry_run` (count without
changing). Locked paragraphs are skipped and counted. Returns the matches, the
paragraphs changed and their ids.

#### `soundbox.add_chapter` / `soundbox.edit_chapter` / `soundbox.move_chapter` / `soundbox.delete_chapter`

`add_chapter` takes `book_id`, `title`, and optionally `text` (split into
paragraphs the way an import is, with the title as its heading) and
`position` (0 is first; default the end). `edit_chapter` takes `book_id`,
`chapter_id` and any of `title`, `kind` (`chapter`, `front_matter`,
`back_matter`, `opening_credits`, `closing_credits`, `retail_sample`) and
`included` (false leaves it out of render and export). `move_chapter` takes
`book_id`, `chapter_id` and `position`. `delete_chapter` takes `book_id` and
`chapter_id`, and deletes the chapter, its paragraphs and their voiced audio;
it cannot be undone, and a book keeps at least one chapter.

#### `soundbox.master_and_export_audiobook`

Takes `book_id`, `format` (`mp3`, the default, `wav`, `flac`, `m4b`),
`layout` (`files`: one per chapter, zipped, ACX names; `single`: one file;
M4B is always single), `mastering` (`acx`, the default, `podcast`, `none`),
`bitrate_kbps` (MP3; default 192), `chapter_ids`, `include_cover`,
`include_transcripts` (SRT, VTT and read-along JSON) and `include_beds`.
`include_beds` defaults on, and off when a retail sample is exported, since
ACX samples must not contain music. **Blocks** until the export is written,
and returns its absolute `path`, `qc_failures` (each failed ACX check by
chapter), and any bed warnings.

### The open studio

These three work on the studio as it is on screen, not on the saved story. They
need Mirli open in a browser or the desktop app with a studio showing; the
server asks that tab and waits a few seconds for its answer.

#### `soundbox.studio_context`

Takes an optional `story_id` (omit it when one studio is open; with several
open, the error lists them). Returns the lanes (name, muted, soloed and the
effect kinds on the rack), every clip with its `id`, lane, start, length and
label (the line's words, or the sound's name), the playhead in seconds, the
selected clip ids and the voices a line can be cast to.

#### `soundbox.studio_apply`

Takes `actions`, and optionally `story_id`, `summary` (shown in the studio's
toast and history) and `allow_delete`. The actions are the vocabulary the
studio's own command bar uses: `set_track`, `rename_track`, `move_clip`,
`set_clip` (mute, text, speaker, voice, gain, fades, length, trim),
`delete_clip`, `add_clip`, `add_lines`, `speak_lines`, `add_device`,
`remove_device`, `set_device`, `generate_clip`, `show_panel` and
`start_recording`. The tool description has the shape of each.

Any clip action can take `select` instead of `clip_id` to mean many clips:
`{"scope": "all"}`, `{"scope": "selected"}`, `{"from_track": 2}` or
`{"matching": "vocal"}` (label contains), combined with AND.

Every action is checked against the live studio before anything is sent. An
action naming a clip, lane, voice or effect that is not there is dropped and
counted under `dropped`. `delete_clip` is held, and counted under
`held_deletes`, unless `allow_delete` is true. The studio applies what is left
through the same handlers a click uses, so each edit is on the user's undo
stack. Generating and reading lines run in the background: read the context
again to see the clips fill in.

#### `soundbox.search_docs`

Takes `query` and optionally `limit` (1–8, default 4). Returns the sections of
Mirli's README and `docs/` that match, each with its `source` file, `heading`
and `text`.

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
  ~/.mirli/soundbox-17494.log`, or whatever port you run on), and persisted to `GET /api/mcp/calls` /
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

Mirli ships agent skills under `server/skills/`:
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
upgrading Mirli to keep them current.

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
