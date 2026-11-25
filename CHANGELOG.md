# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- **Theme opens a dialog.** The sidebar's **Theme** item now opens a dialog where you pick light or dark, the background behind the panels (Pixel, Smoke, Liquid, Gradient or None, each with a swatch), and whether it moves with your pointer and sound. Changes apply as you pick them. Settings → Interface still has the same choices.
- **Pixel is the default background** for new installs. If you already picked a background, or changed another interface setting, you keep what you had.

### Removed
- **Calls are off for now.** Live voice calls aren't ready, so the Calls tab is gone and the server no longer serves the Call API. That also covers the Discord bot's calls. The code stays in the repo, and developers can turn calls back on with `VITE_CALLS=1` (app build) and `MIRLI_CALLS=1` (server).

## [0.6.3] - 2026-11-24

### Added
- **Calls: talk live with a character, by voice.** The new **Calls** page in the sidebar puts you on a voice call with Mirli or one of your characters: you talk, they answer out loud in one of your saved voices, and you can talk over them. A character is a name, a persona, a voice and an optional portrait (uploaded or drawn); Santa is built in, and **Make a call voice from a preset** turns a model's preset voice into one a call can use. You can switch character in the middle of a call. Calls run on the live voice worker (`live/voice`), a separate process on your GPU; start it with `npm start` there. It can answer with the local model, any OpenAI-compatible endpoint, or your own signed-in Claude Code (`LLM_PROVIDER=claude`, no API key). Voice only for now. See `live/README.md`.
- **Mirli in Discord.** `integrations/discord` is a bot that brings one of your characters into a Discord voice channel under the character's name: `/mirli join character:`, then switch character, voice or a one-off persona mid-call. It sees the same characters as the app and listens to one person at a time. See `integrations/discord/README.md`.
- **Agents can work in the studio you have open.** Three new MCP tools. `soundbox.studio_context` reads the open studio as it is on screen: tracks with their effects, every clip with its id and words, the playhead, the selection and the voices a line can be cast to. `soundbox.studio_apply` edits it with the same actions as the studio's own chat (mute, rename, move, fade, recast, write and read lines, effects, a generated take on a track, panels), and one action can cover many clips. Every edit goes through the studio's own controls, so it is on your undo stack. Ids the agent made up are dropped and reported, and deletes are held unless the agent passes `allow_delete`. `soundbox.search_docs` finds the parts of Mirli's own docs that answer a question. See "The open studio" in `docs/MCP.md`.
- **Mirli Cloud waitlist links on mirli.app.** The top nav, the home page and the download page point people without a graphics card to the Mirli Cloud waitlist at cloud.mirli.app.
- **Sandboxed mode for shared servers.** `MIRLI_SANDBOXED=1` runs Mirli for people who don't own the machine: folder browsing, profile folders, downloads, local models, custom endpoints, the update check, the server log and agent skill installs are off, and settings that name a path, an engine or a URL are locked. The guards match the route the server resolved, so an encoded path can't slip past them. `MIRLI_DISABLE` turns off single capabilities, and `GET /api/capabilities` reports what the server allows. See `docs/INSTALL.md`.
- **OpenAI-compatible speech routes.** Point anything with an OpenAI base URL setting at `http://127.0.0.1:17494/v1` and it can use Mirli for speech: `POST /v1/audio/speech` (WAV, 24 kHz PCM, and MP3 when ffmpeg is installed; streamed where the model can stream, or as `speech.audio.delta` events), `POST /v1/audio/transcriptions`, `GET /v1/models` and `GET /v1/audio/voices`. `voice` is a saved voice's name or id, or one of a model's own voices; a model name the server doesn't know, such as `tts-1`, falls back to the voice's model or a ready one. Reads are not kept in the library unless the request says `"keep": true`. With `MIRLI_API_TOKEN` set, the token is the API key. See `docs/API.md`.
- **Exit when idle.** `MIRLI_IDLE_EXIT_MINUTES` stops the server after that long with no requests, none still being answered and no jobs, for hosts that scale to zero. It shuts down the same way Ctrl+C does.
- **Model downloads resume, retry and check the disk first.** A download that is cut off continues from where it stopped (an HTTP `Range` request from the `.part` file) instead of starting again, also after a restart of Mirli. If the file changed upstream in between, or the server cannot continue it, it starts again from the beginning; size and SHA-256 are still checked before the file is put in place. A dropped connection, a stall, a 429 or a 5xx is retried up to five times with a growing wait, following `Retry-After`; a 401, 403 or 404 is not. Before any download starts, Mirli compares what is still to fetch plus 2 GB with the free space at the models folder, and says which sizes and folder are involved when it will not fit. The progress line shows the transfer rate and the time left. The reason a download failed is kept per model across restarts and shown on the Models page with **Retry**, or **Repair** for an incomplete model; `GET /api/models` returns it as `download_failure`. See "When a download is interrupted" in `docs/INSTALL.md`.
- **Checksums for the installers.** Each release now carries `SHA256SUMS.txt`, the SHA-256 of every installer, so you can check a download is the file the release built. `docs/DESKTOP.md` shows how on Windows, macOS and Linux.
- **A slim Docker image without audio.cpp** (`Dockerfile.slim`), for a server that only uses custom endpoints or other remote models; local models are off in it. CI builds it and checks that it starts. See `docs/INSTALL.md`.
- **Game music on /music.** A "Game music" table on mirli.app/music plays the themes, loops and choir stings from the /sfx pages (8-bit and chiptune scores, boss themes, a fanfare, chants) in the page's player, each linking to its sample page. ACE-Step 1.5 XL Turbo gets its own model page.
- **Hear an SFX prompt on more than one model.** Some samples on mirli.app's /sfx pages are now rendered on Stable Audio 3.0 SFX, Stable Audio 3.0 Small Music and ACE-Step 1.5 Turbo: a switch under the prompt plays each take, and a "By model" filter shows one model's takes.

- **A moving background behind the panels.** The app, the desktop launch screen and the Mirli Cloud pages now draw a faint moving ground in the gaps around the panels, behind the sidebar and under the player. Choose it in Settings → Interface → Background: **Smoke** (the default) rolls in from a corner and your pointer blows it away; **Liquid** is warm colour you can stir; **Gradient** is a quiet wash of the accent from the corners; **Pixel** is a grid of soft lights that shows the spectrum of what is playing; or **None**. Each one reacts to your pointer and a little to whatever is playing; **Reactive background** turns both off and leaves it drifting. The sidebar's current page and hover are frosted glass over it. It listens without rerouting audio, so the output device you chose in Settings still applies. It draws one still frame when the system asks for reduced motion, and the old flat background where WebGL is missing. Colours are the `--ambient-*` variables in `app/src/index.css`.

- **The desktop app draws its own title bar.** On Windows and Linux the window has no system frame any more: one 40px bar across the top holds the sidebar button, back and forward, where you are, the page's own controls, the queue, search, and Windows-style minimize, maximize and close. Drag it to move the window and double-click it to maximize. On macOS the real traffic lights sit over the left end of the bar. In a studio the sidebar is hidden completely; hover the window's left edge or press the menu button to slide it out over the page. Pop-out panel windows keep the system frame. `MIRLI_DESKTOP_PORT` picks the port the desktop app runs its server on.

### Fixed
- Asking the studio's chat to hide a panel ("hide the library") now hides it. The studio reopened the panel straight after closing it.

### Changed
- **The MCP page fits on one screen, with setup for 14 clients.** mirli.app/mcp opens with the pitch and a connect card: the server URL, a client picker and the one thing to copy, plus an install link for Cursor, VS Code, Goose and LM Studio. Below it is a guide for each of Claude Code, Claude Desktop, Cursor, VS Code, Codex, Antigravity (formerly Gemini CLI), Devin Desktop (formerly Windsurf), Zed, Cline, Goose, LM Studio, opencode and Continue, with steps, config paths, how to check it worked and a link to that vendor's docs. The same guides are in the API & MCP reference, and `docs/MCP.md` has a section for each.
- **Voice Lab opens on a cast grid.** Every voice is a square tile in its own tint, with its name, kind and a play button for a clone's clip, the model and notes underneath; a switch beside the filters turns it into the list, and the choice is remembered. The header is a voice count, **New voice** and a ⋯ menu with Import; All, Cloned and Built-in are tabs as in the Library, and a Model pill replaces the per-family chips. The "Your voices" shelf and the page's explanation are gone, the voices are sorted by most used, and the detail panel's test read and Compare share one line.
- **mirli.app looks like the app.** Every page now sits in the app's own frame: the moving smoke ground behind everything, a slim icon rail down the left for the rest of the site, and each page as a floating rounded panel with the app's bar along its top (back, forward and `Mirli / Sound effects / Video game`). On /sfx and /music the jump-link rail is a panel of its own beside the page, as the app's Create panel is, and the player strip sits frosted on the ground under both. The rail has a light/dark switch. Phones keep the top nav. On /music the twenty-act section is now just "More samples", without the fictional-label framing.
- New screenshots of the 0.6 app in the README, on the site and in the press kit, with the Studio timeline second in the README. `npm run capture:media` takes them again from the app's mock backend, so they can be kept current.
- **The /sfx collection pages share /music's layout.** A left rail with jump links, sibling collections and a "Make your own" card, and the tile shelves on /music and /sfx are carousels with arrow buttons instead of a scrollbar.
- **Two setups: on this computer, or elsewhere.** First-run setup now starts by asking where sounds should be made. "On this computer" is the app as before. "Elsewhere" is a simple setup with nothing to download: renders go to a server you run or a hosted API with your own key, the Models page and pickers list only those models, and the settings for running models locally are hidden. Settings → Setup switches between them, and can keep the models already installed here in the simple setup; switching to it unloads a model left in memory. "On this computer" is preselected, and a server that can't run models itself skips the question.
- Agents and the app no longer pick a model that may charge you per render unless you choose it. A custom endpoint outside your machine, your local network and a private overlay network such as Tailscale (a hosted API used with your own key) is marked as metered: the composer never lands on it by default, and `soundbox.generate` and `soundbox.speak` without a `model` skip it and say how to name one. A voice made on a metered model is still read on it, since choosing the voice chooses its model.

### Fixed
- **Claude Desktop setup.** The docs told you to put an HTTP `url` in `claude_desktop_config.json`, which Claude Desktop does not support. It now connects through `npx -y mcp-remote http://127.0.0.1:17494/mcp`, or Mirli's own stdio bridge without Node.js.
- **Recent opens the sound, not a chat.** Clicking an entry under **Recent** in the sidebar used to replay that session as a chat on the old Generate page. It now opens the session's newest sound on its own library page (Music, SFX or Speech) with its details panel open. The entry stays highlighted, and anything made from that page's composer still joins the session.
- **Blown-out sound effects on mirli.app re-rendered.** Stable Audio 3.0 SFX breaks at 1.5 and 2.5 second lengths: over half the samples asked for those lengths came back as a steady hum or a wall of clipped noise in place of the sound. 77 sound effects are re-rendered: those, plus clips with clipping baked into the render and dry clicks sitting on hiss. Samples asked for 1.5 or 2.5 s now ask for the next whole second. Each was picked from four to six takes for no clipping and a real event rather than hum, and its seed is pinned. 20 of the 21 game-music pieces on the /sfx pages (8-bit and chiptune themes, choir stings) move from the SFX model and ACE-Step 1.5 Turbo to ACE-Step 1.5 XL Turbo, and the page copy says so.
- **Sound effect samples on mirli.app play at one loudness, without the noisy ones.** Every sample on the /sfx pages is levelled to the same loudness with a true-peak ceiling, so the list no longer jumps from a whisper to a shout or clips in the browser. Seven synth and UI samples that the model had rendered as hiss or hum (insert coin, shield hit, save chime, token accepted, magic coin, success chime, bright ping) are re-rendered on a pinned seed, and three of their prompts are reworded to the phrasing that renders cleanly.

## [0.6.2] - 2026-11-20

### Fixed
- **Scrubbing the player works.** Dragging the yellow ball on the player's timeline now moves playback there. The server sent sound files without byte-range support, so the browser (and the desktop app's window) treated them as unseekable and every scrub snapped back. `/files/{name}` now answers `Range` requests with `206 Partial Content`.

### Changed
- **A sound plays once and stops.** The bottom player no longer runs on to the next sound in the list when one ends. Two toggles beside the transport turn on **Autoplay** (play the next sound) and **Repeat** (loop this one); both are off by default and remembered in this browser.
- **A livelier splash screen.** While the desktop app starts, the mark plays a loop: rain falls into a puddle, the ripples swell into a sound wave, the wave folds into the M, the M opens into a pulsing ring and sinks back into the puddle. A slow amber glow breathes from the window's edges. Under the mark there is now just one status line and one thin progress bar, which also shows an update's download; tips take turns at the bottom edge instead of stacking under the status. Both settle to a still M when the app is ready, and stay still with reduced motion.
- **Desktop updates install at launch.** A new version now installs on the splash screen before the app opens, with its progress shown, and Mirli reopens on it. No more "Update available" dialog over the app after it has started, and on Windows no installer window: the per-user installer runs silently. The check gives up after 5 seconds when offline, and **Settings → Updates → Check for updates** still turns it off.
- **New screenshots.** The README and the mirli.app home page show the 0.6.0 redesign: the dashboard, the library with the player, the Create panel, the docked details panel, Voice Lab and the voice clone page.

## [0.6.0] - 2026-11-20

### Added
- **Export a MIDI take as `.mid`.** The MIDI panel and the piano roll can save the current take as a Standard MIDI File, at the roll's tempo and with each note's velocity. Render the part on another instrument, in a DAW or elsewhere, and drag the WAV back onto a lane.
- **MIDI takes keep their notes.** A take placed from the MIDI panel or the piano roll now stores its notes, tempo, instrument and cover prompt with the clip. Right-click the dry clip or its cover and choose **Edit notes** to open the take in the piano roll, fix it, and **Re-render dry** or **Re-render instrument**. The new audio replaces the old in place, and Undo brings the old take back. Clips placed before this are unchanged and stay audio only. `soundbox.get_story` and the segments API return the notes as `midi`.
- **Sampled instruments for the MIDI dry take.** The piano roll and the MIDI panel can render a take with real orchestral recordings instead of the synth: solo violin, violin section, cello section, harp, flute, clarinet, trumpet and French horn, from VSCO 2 Community Edition (CC0). Each is a separate download of 25-75 MB from **Samples** next to the Instrument menu; nothing is bundled. Place dry and Generate instrument use the samples, and the cover pass keeps the notes better from a real instrument than from the synth. The synth presets stay the default, and a take whose samples are missing renders on the synth and says so.
- **Voice clips transcribe themselves.** On the clone page each clip (an upload, a recording or a library sound) gets its transcript filled in automatically when a transcription model is installed, and every clip has a **Transcribe** button; the words stay editable. Transcription runs on Qwen3-ASR 0.6B through audio.cpp (Apache 2.0, about 1.2 GB, opt-in from the Models page), and the API gains `POST /api/transcribe`, which returns the text and language.
- **Linux desktop packages.** Releases now include an AppImage and a `.deb` for x64 Linux, built on Ubuntu 22.04, so they run on glibc 2.35 and newer. They have not been tested on a real Linux desktop yet, so reports are welcome. `docs/DESKTOP.md` covers installing and the NVIDIA blank-window workarounds.

### Changed
- The header bar across the window is gone: the toggle, back and forward, the breadcrumb and a page's own controls are the first row of the page panel, and the logo stays at the top of the sidebar. The profile picker is an avatar at the foot of the sidebar, with the profile's initials.
- The sidebar runs the full height again with the logo at its top left, on the same line as the header bar, which now starts where the first panel starts and keeps the toggle, back and forward, the breadcrumb and a page's own controls such as the Studio's story title on one line. The project picker moves to the bottom of the sidebar.
- The Models page is one list with one search: a kind switch (SFX, Music, Speech, Separation) and Installed, Commercial use and Fits my GPU filters sit in one row, the extra audio.cpp models you can add are in the same list, downloads show progress in the row, and a click opens the model's details (licence, specs, settings, files, delete) in a panel on the right.
- **A slim header bar above the panels.** The logo, sidebar toggle, back and forward buttons, breadcrumb and project picker sit in one bar across the top of the window, and on Studio pages it carries the title, Export, the Columns/Canvas switch and the Panels menu. Every panel is the same height between the bar and the player, and the player lines up with the panels above it. Create and Library come first in the sidebar. Music uses the same list page as SFX and Speech, with Extend and Cover in each track's menu. Sound lists drop their column headings and inline waveforms, and right-clicking a row opens its menu.
- **Panels resize.** Drag the inner edge of the Create panel or a details panel to make it wider or narrower; Mirli remembers the width, and a double-click resets it. The Library splits All, Music, SFX and Speech into tabs, pages fill the window, the sidebar sits on the background without a frame, and the header loses the rule between the back buttons and the breadcrumb.
- Settings are grouped by what you are trying to do and searchable (Ctrl/Cmd+K or `/`). Each setting saves as you change it and says so on its row, marks when it differs from the default with a one-click reset, and can be linked to directly with `#/settings?s=<id>`. Clearing the Hugging Face token and re-running first-run setup sit together at the end and ask before they act.
- The music and sound effect pages on mirli.app look like the app: tracks and samples are listed as rows with a play-on-hover tile, length, model and licence; collections are shelves of square tiles; collection, track and sample pages open with a header and a Play button; and the player is a thin timeline with a yellow playhead you can drag while it plays.
- **Voice Lab reads like a voice library.** Chips filter by clone, built-in or model family; a "Your voices" shelf holds the most-read voices; every voice is a row with its kind, model and read count, and the avatar plays the reference clip. Clicking a voice opens a side panel with its test read, reference clip and recent reads; the rarer actions sit in a ··· menu.
- Adding a voice is now a page instead of a dialog. **Add voice** in the Voice Lab opens Voice Creation, with a card for each way to make one: clone, a model's built-in voice, or import a voice file. Cloning gathers several uploaded or recorded clips at once, each with its own transcript, and a ring shows how much audio you have against the 90-second limit. *Make a voice from this* on a sound lands there with the sound as the first clip.
- **The Library is a tracklist.** Each sound is one row with its tile, name, licence, model and length; the row that is playing is marked with a thin yellow line, and the window is two floating panels with the player running full width beneath them. On the Music page the Quantity and Create controls stay in reach as the form scrolls.
- **Soundbox is now Mirli.** The site, page titles, share cards, press kit, blog, README, docs and issue templates use the new name, and the README and docs link to https://mirli.app. Nothing you rely on moves: the `soundbox` command, the `soundbox.*` MCP tools, the Docker image, the GitHub repository and the installer file names keep the old name for now, and existing installs carry on as they were. The home page, the download page, the press kit and the README each say once that Mirli was formerly Soundbox.
- The app and the server now say Mirli: the sidebar, settings, onboarding, the MCP server name and instructions, tool descriptions, CLI help, log lines and the bundled skills. Environment variables are read as `MIRLI_*` first, and the old `SOUNDBOX_*` names are still accepted, so existing Docker and MCP client configs keep working. A new install keeps its data in `~/.mirli`, and an existing `~/.soundbox` is used as long as there is no `~/.mirli`. Browser settings carry over on their own. The `soundbox.*` MCP tool names and the `soundbox` command stay as they are.
- **The desktop installer and start-up screen are on brand.** The Windows installer has its own side and header art in place of the stock wizard, and its description reads "Sound, music and voice". The start-up screen uses the new palette, shows three steps as the app boots, and the mark morphs from the M into a sound wave while it works. The window title, start-up messages and update prompt say Mirli.

### Removed
- **Blog read-alouds, for now.** The Listen card, the docked player and the paragraph highlight are gone from blog posts, along with the recordings, their timing files and `scripts/blog-narration.mjs`. The recordings said the old name, and the feature can come back from git history when the posts are re-voiced.

## [0.5.0] - 2026-11-18

### Added
- **A daily update check, which you can turn off.** Once a day at most, a running Soundbox asks whether a newer version is out. The request carries the version and the platform and nothing else: no install ID, no account, no cookie. The project counts requests per day, version and platform to learn roughly how many copies run and on which versions. When there is a newer version, Settings and the sidebar say so and link to the release page; nothing is downloaded for you. Turn it off in Settings → Updates or with `SOUNDBOX_UPDATE_CHECK=0`, and no request is sent; the desktop app's installer prompt is skipped too. `docs/PRIVACY.md` lists everything the app sends on its own.
- **Hosted providers with your own key.** Custom endpoints have presets for ElevenLabs sound effects, music and speech, and for ACE-Step on fal, used with your own account. The provider bills you directly, and Soundbox takes no cut. Endpoints can send the key in any header with any prefix, download audio from a link in a JSON answer, and put `{{voice}}` or `{{language}}` in the URL.
- **An optional access token.** Set `SOUNDBOX_API_TOKEN` and every API, MCP and file request needs it, so a Soundbox on a rented GPU or a LAN box is no longer open to anyone who can reach its port. The web UI asks for the token once and stays signed in for 30 days; scripts and MCP clients send it as a bearer header, and the stdio bridge and CLI pick it up from the environment. The health check stays open, and wrong tokens are rate limited per address. Off by default, so a desktop install is unchanged.
- **Streaming speech.** `POST /api/speak/stream` speaks a line and sends the audio while it's still being generated, as server-sent events or raw 16-bit PCM, for game dialogue and chat agents. Closing the connection cancels it; nothing is saved unless you ask. Models that can stream report `supports.streaming`, read from the audio.cpp build's own model specs. See `docs/STREAMING.md`.
- **Render and wait.** `POST /api/render` runs one generation or speech job and answers with the WAV once it is done, so a single request gets a file back. If the caller hangs up, the job is cancelled. New **Another Soundbox** endpoint presets use it, so one Soundbox can send its renders to another one, such as a desktop with a bigger GPU.

### Changed
- The sounds the site lets you play are better matched and level-matched. The home page's example chips now play a sound made from exactly the prompt in the box (the old ones played a near match), there is a new sung song with its lyric sheet, two new instrumentals, a coin pickup and a voice clip that no longer says the product's name, and every clip sits at the same loudness (-18 LUFS, peaks under -1 dBTP) so none is suddenly louder than the last. `site/public/examples/renders.json` records how each new one was made, and `scripts/check-examples.ts` checks the list against it.
- The home page is reordered and shorter: the pitch and a system-aware Download button, five things it does (each with a playable real sound and a link to its page), the running app, a "Soundbox next to a hosted service" table, the models, agents and API, an FAQ, then the installers. The animated pillars and the Local, Prompting and Getting started sections are replaced by these; the comparison and FAQ text is shared with the search landing pages.
- The README and the install docs send people to https://mirli.app/download/, which picks the installer for their system, instead of the GitHub releases page.
- Five search landing pages, in the sitemap and linked from the home page footer but not the top nav: `/alternatives/elevenlabs`, `/alternatives/suno`, `/make/sound-effects`, `/make/game-audio` and `/make/voiceovers`. Each has a playable real example, a numbered list of what it does, a screenshot, an FAQ with structured data and the installers; the alternative pages carry the README's comparison table.
- Pages that talk about a sound now let you play one: the home page's example chips (one real render each, with its prompt), the model cards and model pages, the MCP page's vault door, and a new "Hear a voice" section on the voices page. A new `scripts/check-examples.ts` checks each example still matches the SFX and music catalogues.
- The home page's first screen has a Download button that names your system (Windows, Mac or Intel Mac) and links straight to that installer, with the version and size under it. A row of all three installers, with yours marked, sits in Getting started. A phone or Linux visitor gets a plain Download link to the download page.
- A new look for the app and the site: warm paper by day and dark grey at dusk, with one accent, a beak yellow that marks where sound is playing. The mark and app icon are a one-line M (a sound wave that turns into the letter). Titles are Big Shoulders Display in capitals, labels and readouts are typewritten in Courier Prime, corners are soft and buttons are pills.
- Every blog post can be listened to, read by a new, softer Soundbox voice (Bea, on Chatterbox). The post page has a Listen card, a player that docks to the bottom with 15-second skips and 0.75× to 2× speed, and a highlight that follows the paragraph being read; click a paragraph to jump to it.
- The site's download page has a new design: a full-width hero, the Soundbox film in a frame that flattens as you scroll, live GitHub numbers and a card per installer.

### Fixed
- The site opens each new page at the top instead of keeping the scroll position of the page you came from. A link with a `#section` still goes to that section, and the back button returns you to where you were.
- Fish Audio S2 Pro cloning: save a Reference Transcript for each voice clip, pass the selected voice's transcripts in combined-audio order in Speak and Script Builder, and report missing transcripts before synthesis. Translate request options to audio.cpp's HTTP `options` map so the runtime receives them.
- `soundbox ps` asked the server for `/models` instead of `/api/models`, so it always reported that no server was running.
- Security: updated dependencies with open advisories: the system information library, the HTTP server adapter, and the desktop updater's zip support (Dependabot alerts).

## [0.4.1] - 2026-10-29

### Added

- **Device tools for agents.** `soundbox.add_device`, `soundbox.set_device`
  and `soundbox.remove_device` put a device on a story track, turn its knobs or
  bypass it, and take it off, with the same eight kinds, knobs and ranges as the
  studio's rack. Over-range values land at the end of the knob and are reported;
  unknown knobs are an error. An open studio shows the change as it lands.
  `soundbox.get_story` now returns each track's chain. Devices are still heard
  on the timeline only; `export_story` mixes dry.

- **Docker images publish with each release.** When a release is tagged,
  `ghcr.io/hamsanders/soundbox:<version>` and `:<version>-cuda` are built and
  pushed automatically; a full release also moves `latest` and `cuda`.
- **A download page on the site.** `/download` links the latest release's
  installers directly, picks the visitor's OS, plays the 30-second Soundbox
  film and shows live GitHub stars, downloads and forks. Every Download CTA on
  the site points at it.
- **Prebuilt Docker images.** `ghcr.io/hamsanders/soundbox` is published per
  release (`:vX.Y.Z`, `:vX.Y.Z-cuda`, plus `:latest` and `:cuda`) by a manual
  `docker-publish` workflow. `docker compose up -d` now pulls the image instead
  of building; to build from the checkout, add `-f docker-compose.build.yml`
  (see docs/INSTALL.md). amd64 only.
- **`SOUNDBOX_LOG_LEVEL`.** Sets the server's log level (`debug`, `info`,
  `warning`, `error`, `critical`) when `--log-level` isn't given. Unlike the
  flag, it reaches `npm run dev`, Docker and the desktop app. The startup banner
  shows the level in force, and an unknown value warns instead of being
  silently ignored. `debug` now logs each request to the prompt assistant,
  artwork and custom endpoints (URL, status, timing; never keys or prompts).
  Before this there were no debug lines at all, so `--log-level debug` showed
  nothing extra. (#22)
- **Press kit on the website.** `/press/` collects quotable descriptions, a
  fact sheet, the launch films with direct MP4 downloads, screenshots, GIFs
  and the mark for anyone writing or filming about Soundbox, and the landing
  page footer links to it.

### Changed

- **Device racks are stored with the story.** Each track's chain is saved on
  the server next to its name, mute, solo and volume
  (`PATCH /api/stories/:id/tracks/:n` takes `devices`), instead of in the
  browser's localStorage, so it reaches other windows and machines and follows
  its lane when a lane below it is removed. A rack saved by 0.4 is moved up the
  first time its story is opened. A dial sweep is saved once the dial settles,
  not on every step.

### Security

- **Dependency updates for the open Dependabot alerts.** Vite, the MCP SDK,
  Fastify, Hono, js-yaml, brace-expansion, proxy-addr, source-map-js,
  postcss-selector-parser and the app's react-router move to patched releases.
  The server's zod moves to 4.6.7 (the 3.x line has no fix for the
  oversized-collection memory issue).
- **Code-scanning fixes.** The MCP endpoint's trailing-slash trim no longer
  backtracks on a long run of slashes, profile ids are checked before they are
  joined into a path that delete can remove recursively, HTML-tag stripping in
  the docs search and heading plugin repeats until nothing is left, and the
  release scripts escape every regular-expression character.

### Fixed

- Trackpad gestures work on the story timeline. Only a pinch (or Ctrl+wheel)
  zooms now; a two-finger swipe pans left and right and a two-finger scroll
  moves the lanes up and down, where before every scroll was read as a zoom.
- **macOS: the server starts again.** The ad-hoc signed app gave its bundled
  Node the hardened runtime without the JIT entitlements, so Node died with a
  trace trap before writing a log and the app said the server did not start in
  time (0.3.0 and 0.4.0). Ad-hoc builds now leave the hardened runtime off, and
  every build embeds Node's entitlements for when a Developer ID build turns it
  on. (#71)
- Soundbox starts again on libraries from the voice-profiles era. Their old
  `voice_samples` table stopped the server with "no such column: voice_id"
  before it could write a log. The table is now renamed to
  `voice_samples_legacy` and kept, not dropped.
- **Prompt assistant and artwork base URLs ending in `/v1`.** Soundbox added
  `/v1/chat/completions` or `/v1/images/generations` to the base URL as typed,
  so the `…/v1` form most servers document became `/v1/v1/…` and a 404. The
  path is now joined without doubling, so a root, `…/v1`, `…/sdapi/v1` or the
  full endpoint all work. Errors name the full URL tried, and a 404 explains
  what to check. (#22)

- **Studio assistant: add a device, then set it.** A plan that added a device
  and then turned its knobs applied the second step to the rack as it was
  before the plan, which wrote the new device back out again.

## [0.4.0] - 2026-10-25

### Added

- **Studio: canvas layout and pop-out windows.** The studio can lay its
  panels out as free cards on a grid instead of three columns: drag a card's
  header to move it, drag its edges to resize it, and Panels → Tidy puts it
  back. Positions are remembered per builder. Any panel can also leave the
  studio for a window of its own, so you can put it on another monitor. Drag
  its header past the edge of the window, or press its pop-out button. A
  popped-out panel shares the studio's state, opens its menus in its own
  window and passes keyboard shortcuts through. Closing the window puts the
  panel back, and docking or closing the panel, or leaving the studio, closes
  the window. The desktop app opens these as native windows.
- **Failure cards.** A generation or download that fails now says what
  happened, why, what to do and what is kept, with up to two fix links, Retry
  where a retry can help, the raw text under Details and a Copy diagnostic
  button, in place of a bare red line or a toast. The server classifies the
  common causes (GPU out of memory, system memory, paging file, missing
  runtime, model not downloaded, corrupt model file, stalled or truncated
  download, Hugging Face gated or unreachable, disk full, timeout) in
  `server/src/failure.ts`; jobs carry the result as `failure`. A failed
  generation also stays on the Library page as a card instead of vanishing.
- **Command palette.** Ctrl/⌘+K now finds sounds, stories, voices and models
  as well as pages: a sound opens, a story opens in its builder, a model
  loads, downloads or unloads from the row. Settings rows appear once you
  type. On a page with a composer the first row is Generate, or Cancel while
  a job runs. `?` opens a keyboard cheatsheet.
- **Script Builder: paste a script.** Paste a scene or a passage and
  Auto-cast reads the speaker cues and "said X" attributions, hands each
  character a voice (a voice of the same name if there is one, otherwise the
  next unused one) and adds the lines; or split prose into lines by
  sentence, paragraph or chapter with a longest-line limit. An empty script
  offers Add first line, Paste a script and Load sample.
- **Library.** Every row carries its recipe (model, length, seed, steps,
  CFG, and whether it was extended or covered) so two takes of one prompt
  can be told apart; the sound page has a "How it was made" list with Copy
  recipe. A sound's menu has Send to: add it to a story, open it in the
  studio, or make a voice from it in the Voice Lab. The tag, model,
  favourites and by-agents filters fold behind a Filters button whose
  summary shows each chosen value as a chip that clears itself.
- **Models page.** Packs: one Install for a sensible model each for sound
  effects, music and voice at Fast, Balanced, Quality or Max, with the size
  to download; the category tabs say how many of each are on this machine;
  a model whose download stopped shows as Incomplete with Repair, which
  fetches only what is missing; and a Self-test in a model's details renders
  one second through the normal path and reports the time and device without
  saving anything (`POST /api/models/:id/selftest`).
- **README.** Shorter and faster to scan: a Make / Arrange / Connect table,
  a hardware table, profiles, an "install with a prompt" block for coding
  agents, and the source, Docker and API sections folded. `docs/INSTALL-AGENT.md`
  is the runbook that prompt points at.

### Changed

- **Composer.** The Generate button keeps one width and names the running
  job's stage ("Loading model", "Generating 42%"), Cancel keeps its place
  instead of pushing the pills about, a progress strip runs along the card's
  bottom edge, and whatever stops a run is said in one sentence with the link
  that fixes it rather than a greyed-out button.
- **Sidebar.** Each area's icon carries its own hue, the sidebar folds to an
  icon rail on studio, Music and Voice Lab pages (with a "keep expanded"
  preference in Settings → Interface and on the rail itself), and the device
  row in the footer opens a panel with the GPU, VRAM in use, the loaded model
  and an Unload button that frees the memory without a trip to Models.

## [0.3.0] - 2026-10-24

### Added

- **Custom endpoints.** Settings → Endpoints sends sound effects, music or
  speech to a server you already run (LocalAI, an OpenAI-compatible speech
  server) instead of downloading the model. The request body is a JSON
  template with variables such as `{{prompt}}`, `{{lyrics}}`, `{{bpm}}` and
  `{{key}}`. Each endpoint appears in the model pickers. WAV and PCM are read
  directly; other formats need ffmpeg. Endpoints outside the local network
  are marked, since prompts leave the machine. See `docs/ENDPOINTS.md`. (#22)
- **Updates in the desktop app.** On launch, an installed copy checks for a
  newer release and offers to install it and restart. Models and projects are
  kept. Copies installed before this version need one manual download to get
  it.

### Fixed

- **GPU name and VRAM on NVIDIA.** `/api/health` reports the GPU's name and
  its total and free VRAM from `nvidia-smi`, for the first GPU in
  `CUDA_VISIBLE_DEVICES` or GPU 0, so the sidebar, Settings and onboarding show
  them instead of only "cuda". Other GPUs still report `null`. (#17)
- **`SOUNDBOX_ALLOWED_HOSTS` behind a reverse proxy.** The server's `Host`
  check now accepts the names in `SOUNDBOX_ALLOWED_HOSTS`, so `soundbox` on
  `127.0.0.1` behind Caddy or nginx no longer answers 403 "Forbidden host" to
  every request. Before, the variable only reached CORS and `/mcp`. A bare
  `host` matches any port and `host:port` only that port, the same in every
  check. (#22)
- **Dev mode from another machine.** `npm run dev` passes
  `SOUNDBOX_ALLOWED_HOSTS` to Vite's `server.allowedHosts`, and a new
  `SOUNDBOX_DEV_HOST` sets the address Vite listens on. Both are unset by
  default, which keeps the dev UI on localhost. (#22)

## [0.2.0] - 2026-10-23

### Added

- **Compare voices.** The Voice Lab reads one line in two to four voices side
  by side, so a cast can be chosen by ear.
- **A new look.** Graphite surfaces with a faint teal cast, teal kept for what
  is sounding, selected or focused, each sound's own envelope as its icon, and
  mono numerals for times, seeds and sizes. Applied through the shared
  components, in both themes.
- **MCP progress notifications.** Tools that wait on a job (`generate`,
  `speak`, `speak_story`, `separate`, `export_story` and the rest) send
  `notifications/progress` when the request carries a `progressToken`, so a
  client with a short tool-call timeout no longer drops a long music render.
- **Docker.** `docker compose up -d --build` runs the server and web UI
  headless with the audio.cpp runtime inside; CPU by default, CUDA with
  `docker-compose.cuda.yml`. See `docs/INSTALL.md#docker`.
- 19 opt-in catalog entries for models that audio.cpp 0.9.2 runs: MiDashengLM-Gen
  and ControlFoley (sound effects), ACE-Step 1.5 XL Turbo and SFT, HTDemucs
  6-stem, MeanVC2, and TTS from Chatterbox Turbo, Kokoro, CosyVoice 3, Maya1,
  BreezeTTS 2, FireRedTTS3, VoxCPM 1, KittenTTS, MagpieTTS, KugelAudio,
  Irodori v4.1 Anime and Soprano. MiDashengLM-Gen, HTDemucs 6-stem and
  Chatterbox Turbo were run end to end. See `docs/new-models-2026-10.md`.
- `duration_option` catalog field, for a `gen` family that takes its length
  under its own option name. A `gen` entry with `supports.steps` or
  `supports.cfg` false is no longer sent a step count or guidance scale.
- **Several clips per voice.** A cloned voice can hold up to five clips of the
  same speaker, added by upload or recording in the Voice Lab's Clips dialog or
  by `POST /api/voices/{id}/samples`. They are levelled and joined into the one
  reference the model reads.
- **Reference clip checks and tidying.** A clip under 1 s, over 60 s or almost
  silent is refused with a reason. "Tidy the clip" cuts silence off the ends and
  pulls back a clipping peak, without making the clip louder.
- **Per-voice history.** Each voice card shows how many sounds were read in it
  and opens them; `GET /api/sounds?voice_id=` and the MCP `list_sounds` tool
  filter by voice.
- **Voice export and import** as a `.soundbox-voice.json` file with the clips
  inside.

### Fixed

- A line cast to a cloned voice is read on the model that voice was made on
  when no model is passed, instead of whichever model happened to be ready.
  In a story with mixed voices, each line uses its own voice's model.
- After the audio.cpp server restarts, a model Soundbox thought was still
  loaded is reloaded instead of every request failing with "unknown model id".
- `soundbox model install audiocpp` handles audio.cpp 0.9.x releases. It
  fetches the `cudart` runtime package beside a CUDA build. It picks the CUDA
  build the driver supports, matches Linux's `ubuntu` assets, and skips the
  `lib`, config and Colab packages, which contain no CLI.

## [0.1.0] - 2026-10-07

Initial public release, MIT-licensed. Everything below is new.

### Added

- **Sound effects** from a text prompt, with duration, seed, steps, CFG and
  negative prompt exposed; every generation is saved with its parameters so it
  can be regenerated, varied or reused.
- **Music**, instrumental or sung from a `[verse]`/`[chorus]` lyric sheet, with
  extend, cover and repaint on models that support them, and stem separation
  into drums, bass, vocals and other.
- **Speech and voices**: text-to-speech, voice cloning from a clip or the
  microphone, voice conversion, and a Voice Lab whose voices are cast onto
  lines of a multi-character script.
- **Studio**: a multi-track timeline with per-track effects, MIDI input, a
  piano roll, recording and one-click mixdown, plus an assistant chat that
  proposes edits as a plan you confirm.
- **MCP server** (21 tools) for Claude Code, Cursor and other MCP clients, an
  Agents page showing every call each client made, and an **HTTP API**
  (see `docs/API.md`).
- **Local model runtime** via [audio.cpp](docs/AUDIOCPP.md): one managed
  native binary with CUDA/HIP/Metal/Vulkan/CPU backends, no Python required.
- **Licences up front**: each model's licence and commercial-use status is
  shown before download, and non-commercial weights need explicit confirmation.
- **Local library**: one SQLite file and a folder of WAVs under `~/.soundbox`;
  works offline once weights are downloaded.
- **Desktop app** for Windows and macOS (Apple silicon and Intel), built on
  Tauri 2: an installer that carries its own Node and server, starts and
  supervises the server, and stops it on exit. Not signed yet.
- Optional local **artwork** (cover art, voice avatars) via stable-diffusion.cpp.

### Security

- Native binaries (`audiocpp_cli`, `llama-server`, `sd-server`) are verified
  against a published SHA-256 before install; unverifiable downloads are refused
  unless `SOUNDBOX_ALLOW_UNVERIFIED_BINARIES=1` is set.
- The server binds to loopback by default, rejects non-loopback `Host` headers,
  trusts only an allowlist of browser origins (its own, the Vite dev server and
  `SOUNDBOX_ALLOWED_HOSTS`), and requires JSON or an `X-Soundbox` header on
  mutating API requests.

[Unreleased]: https://github.com/HamSanders/soundbox/compare/v0.6.3...HEAD
[0.6.3]: https://github.com/HamSanders/soundbox/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/HamSanders/soundbox/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/HamSanders/soundbox/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/HamSanders/soundbox/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/HamSanders/soundbox/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/HamSanders/soundbox/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/HamSanders/soundbox/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/HamSanders/soundbox/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HamSanders/soundbox/releases/tag/v0.1.0
