# How Konchi is put together

Konchi is a local audio workstation: a web app, an HTTP API and an MCP server,
all served by one process on one port, generating audio with open-weight models
that run on your own machine. Nothing leaves the box unless you export it.

This page describes the pieces, where the boundaries sit and why, so you can
find the right file to change.

## One process, one port

The server is a [Fastify](https://fastify.dev) app that serves four things:

| Path      | What it is                                                            |
| --------- | --------------------------------------------------------------------- |
| `/`       | The built web app: the whole UI, as static files                       |
| `/api/*`  | The HTTP API                                                          |
| `/mcp`    | The MCP endpoint an agent connects to                                 |
| `/files/*`| The audio itself, straight off disk                                   |

With everything on one origin, the app needs no CORS configuration, the
desktop shell launches one process, and an agent's MCP session and your browser
session read the same database.

The default port is **17494**.

## The repository

Three npm workspaces plus a Rust shell:

```
konchi/
├── app/        the web app: React 19, Vite, Tailwind v4, shadcn/ui
├── server/     the server: Fastify, better-sqlite3, the model adapters
├── site/       the public static site, built from app/ components
├── src-tauri/  the desktop shell
├── docs/       these pages
└── scripts/    dev, build, and the content generators
```

`app/` and `site/` are two build targets over **one source tree**. The site
imports the app's components through the `@/*` alias and prerenders them to
static HTML, so a page like `/sfx` is written once and shipped twice: inside
the app, and as a crawlable page with no backend. See
[the site build](#the-public-site) below.

## Where your data lives

Everything is under one directory: `~/.konchi` by default, or wherever
`KONCHI_DATA_DIR` points.

```
~/.konchi/
├── soundbox.db      SQLite: every row of metadata
├── sounds/          one .wav per generated sound
├── models/          downloaded weights (GGUF and friends)
├── cache/           model and download scratch
└── settings.json    your settings
```

A sound is a file plus a row. The row carries the prompt, the model, the seed
and the peaks; the file is a plain WAV any audio tool can open. To back up,
copy the directory. Konchi keeps no state anywhere else.

### The database

| Table            | What it holds                                                       |
| ---------------- | ------------------------------------------------------------------- |
| `sounds`         | Every generated or imported clip, with its full provenance          |
| `sound_tags`     | The tag index                                                       |
| `sessions`       | A sitting: the sounds made in one run of the composer               |
| `projects`       | A folder you put sounds in on purpose                               |
| `stories`        | A script/arrangement you keep coming back to                        |
| `story_segments` | The clips on a story's timeline                                     |
| `story_tracks`   | Per-lane mute, solo, gain and name                                  |
| `voices`         | Builtin voices and clones                                           |
| `mcp_calls`      | What agents have done, so the Activity page can show it             |

Migrations are additive and run at startup: new columns are added to existing
databases, never removed. A database made by an older build keeps working.

## How a generation flows

Every slow operation is a **job**, and all jobs have the same shape:

```
POST /api/generate   →  { job_id }
GET  /api/jobs/:id/events   (Server-Sent Events)
     ↓
   queued → loading → generating → encoding → done
```

The client never blocks. It gets a job id, subscribes to the event stream, and
watches the phase and progress; the finished job carries the ids of the sounds
it produced. The same machinery covers every long operation:

| Job kind   | Started by                                            |
| ---------- | ----------------------------------------------------- |
| `generate` | Making a sound or a track from a prompt               |
| `speak`    | Reading a line, or a whole story                      |
| `separate` | Splitting a track into stems                          |
| `download` | Fetching a model's weights                            |
| `segment`  | Regenerating one line of a story                      |
| `export`   | Mixing a story's timeline down to one file            |
| `convert`  | Voice conversion                                      |

A job is a row and an event stream, independent of any open request. Closing
the tab does not cancel the work, and jobs started by agents and by you both
appear on the Activity page.

## Models

A model is described by a `ModelSpec` and carries a `task`:

| Task  | Meaning                            | Example                     |
| ----- | ---------------------------------- | --------------------------- |
| `gen` | Text to audio (SFX or music)       | Stable Audio, ACE-Step      |
| `tts` | Text to speech                     | Chatterbox                  |
| `vc`  | Voice conversion                   | —                           |
| `sep` | Source separation into stems       | HTDemucs                    |

Most run through **audio.cpp**: one native binary with CUDA, HIP, Metal, Vulkan
and CPU backends, and no Python in the inference path. Adding a model is
therefore usually a catalogue entry with no new dependencies;
[audio.cpp](./AUDIOCPP.md) has the details.

Every model's licence is shown before you download it. Open weights do not
always permit commercial use of the output.

## The web app

React 19 with a `HashRouter`, TanStack Query for server state, and Zustand for
the few pieces of global state. The main one is what is playing, so that only
one player sounds at a time.

Three surfaces you will meet in the code:

- **Generate** (`/app`, `/console`): the composer. A prompt, a model, some
  parameters, N takes. The console is the same session with a hardware-style
  front panel.
- **The studio** (`/voice/:storyId`): the timeline, with lanes, clips, a mixer,
  a device rack, and an export. See [the studio](./STUDIO.md).
- **The library** (`/library/*`, `/sounds/:id`): everything you have made,
  searchable, taggable, and editable without changing the original.

### The public site

`site/` is a second Vite entry that prerenders app components to static HTML
with [vite-react-ssg](https://github.com/Daydreamer-riri/vite-react-ssg). It has
no backend: the pages it renders (`/sfx`, `/music`, `/models`, `/docs`) read
from content files and manifests instead of the API, so they can be served
from any static host.

It reuses the app's components, so both share one design system, one waveform
player and one set of tokens. Components that call a live backend cannot be
used there; the two files that do are aliased out.

## The desktop app

`src-tauri/` is a thin Rust shell: it starts the same server, waits for
`/api/health`, and points a webview at it. There is no second copy of the UI and
no separate API. [Desktop app](./DESKTOP.md) has the details.

## Agents

The MCP server exposes the same operations the UI drives: generating, listing,
speaking, and the studio (create a story, add lines, mix a track, export).
When an agent works on a story, any browser watching it is notified, and the
studio shows "an agent is writing" and pauses editing so the two do not
conflict. See [MCP tools](./MCP.md).

## Conventions worth knowing before you change something

- **Non-destructive edits.** Every tool that changes audio writes a *new* sound
  with `parent_id` set. Nothing overwrites a file you made.
- **The timeline and the export must agree.** Playback while arranging and
  the mixdown are two implementations of one rule. Where they could drift, the
  code comments say so and point at the other implementation.
- **Estimates are labelled.** If a value is estimated, the UI says so on
  screen. Lyrics highlighting is divided evenly across the clip (not aligned
  to the audio), and the page states this.
- **Comments explain decisions.** A comment says why the code works this way
  and what the alternative would have cost.
