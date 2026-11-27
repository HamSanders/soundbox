# Audiobooks: build plan

Goal: a complete audiobook builder and listener in Mirli, from manuscript to a finished, distributable audiobook. It should cover everything ElevenLabs Audiobooks/Studio and ElevenReader do, and fill the gaps they leave. It is local-first and works with any TTS model Mirli runs, local or endpoint.

Research behind this plan: [research-elevenlabs.md](research-elevenlabs.md) (feature inventory with sources, ACX and retailer specs).
Contract: [`server/src/audiobook/types.ts`](../../server/src/audiobook/types.ts) (mirrored in `app/src/lib/audiobook-types.ts`).

## Shape

- **Book → chapters → paragraphs.** Each chapter is backed by one existing `story`, and each paragraph is one `story_segments` row. So a chapter opens in the studio timeline unchanged (`/studio/script/:storyId`), and story export mixing, delivery controls and devices all apply.
- **Audiobook tables hold only what stories lack:**
  - `books`, `book_chapters`, `book_characters`
  - `book_paragraphs` (character, lock, heading)
  - `segment_takes`, `pronunciations`
  - `book_renders`, `book_exports`
- **Store pattern:** each module has its own store class running its own `CREATE TABLE IF NOT EXISTS` SCHEMA on the shared connection, like `HistoryStore` (`server/src/history.ts`, built in `db.ts` around line 492). No edits to the core `SCHEMA` string.
- **Rendering:** a persisted, resumable book-render run that walks paragraphs through the existing segment generation. Every generation becomes a `Take`.
- **Mastering and export:** in-process DSP for metering, normalising and limiting, plus room tone. ffmpeg handles MP3 CBR, FLAC and M4B (chapters and cover). When ffmpeg is missing, Mirli detects that and explains clearly, following `transcodeMp3`'s approach.

## Feature checklist (parity + beyond)

ElevenLabs parity (see research §1–6):
- [ ] Import EPUB, PDF, DOCX, TXT, Markdown, HTML, URL, and pasted text.
- [ ] Auto chapters on import, with front/back-matter detection and an include checkbox per section.
- [ ] Cover and metadata extracted on import.
- [ ] Review screen.
- [ ] Single cast or multi cast.
- [ ] Character detection, with a voice suggested per character and a preview on real lines.
- [ ] Changing a character's voice updates all of that character's lines.
- [ ] Per-paragraph voice and model override.
- [ ] Replace a voice across the book.
- [ ] Voice settings per paragraph and per character (delivery controls).
- [ ] Pronunciation dictionary: alias, IPA and CMU rules; first match wins; auto-suggested terms; play the term in context; PLS import and export; affected paragraphs marked stale.
- [ ] Breaks and pauses (`#` pause lines already exist), plus book-wide pacing.
- [ ] Generation history: takes with listen, restore and delete.
- [ ] Regenerate a paragraph; regenerate a selection.
- [ ] Lock a paragraph.
- [ ] Chapter list: add, rename, reorder, delete.
- [ ] Paragraph status (unvoiced, voiced, stale, locked).
- [ ] Play until end, generating ahead.
- [ ] Undo.
- [ ] Music and SFX beds per chapter, with ducking under narration.
- [ ] Volume normalisation.
- [ ] Export the whole book or chosen chapters, as one file or a zip of one file per chapter, in MP3 or WAV.
- [ ] Metadata on export.
- [ ] Export history.
- [ ] Time estimate before a render.
- [ ] Progress per chapter.
- [ ] Auto-regenerate on failed QC (silence, clipping, length mismatch, ASR word check where an ASR model is installed).
- [ ] **Listening shelf** (ElevenReader-style, research §7):
  - shelves by genre and series, plus tag and genre filters and search;
  - book detail page with cover, blurb, details block (length, narrated by, language, published), table of contents, and a "preview" sample;
  - schema.org `Audiobook` JSON-LD on the exported web player.
- [ ] **Player:**
  - chapters, speed 0.25–4x, sleep timer (including end of chapter);
  - bookmarks and notes, resume position;
  - read-along highlighting: per paragraph from segment timings, and per word where a local ASR model (qwen3-asr) can align;
  - start from any paragraph;
  - narrator switching where alternate takes exist.

Beyond ElevenLabs (gaps in research §"Gaps"):
- [ ] **M4B** with chapter markers and cover.
- [ ] FLAC export.
- [ ] **ACX check** with published numbers: RMS −23…−18 dB, peak ≤ −3 dB, noise floor ≤ −60 dB, room tone, 44.1 kHz, 192 CBR, ≤ 120 min per file. Shown as pass/fail per chapter.
- [ ] Configurable room tone at head and tail.
- [ ] Generated opening and closing credits and a retail sample.
- [ ] ACX file naming.
- [ ] Find and replace across the book.
- [ ] Pacing that works on every model, because gaps are timeline placement rather than break tags.
- [ ] SRT/VTT captions.
- [ ] Read-along JSON.
- [ ] Self-contained web player export.
- [ ] Podcast RSS export.
- [ ] MCP tools so an agent can build a book end to end.
- [ ] Works fully offline with local models.

## HTTP API (owner in brackets)

Every path is under `/api/audiobooks`.

```
GET    /                                   list books                          [core]
POST   /                                   create blank book                   [core]
GET    /:id                                book + chapters + stats             [core]
PATCH  /:id                                metadata, settings                  [core]
DELETE /:id                                                                    [core]
PUT    /:id/cover                          raw image body                      [core]
POST   /:id/chapters                       add chapter {title, kind, position} [core]
PATCH  /:id/chapters/:cid                  rename, kind, included              [core]
POST   /:id/chapters/reorder               {ids}                               [core]
DELETE /:id/chapters/:cid                                                      [core]
GET    /:id/chapters/:cid/paragraphs       segments joined with ParagraphMeta  [core]
PATCH  /:id/paragraphs/:sid                {character_id, locked, is_heading}  [core]
POST   /:id/replace                        find/replace across book            [core]

POST   /import/parse                       raw file body + ?filename= -> Manuscript preview (no cover bytes; cover_token) [import]
POST   /import/url                         {url} -> Manuscript preview                                             [import]
POST   /import/commit                      {preview_id, edits, settings} -> Book                                   [import]

GET    /:id/characters                                                         [voice]
POST   /:id/characters/detect              LLM + heuristic -> characters + paragraph assignment [voice]
POST/PATCH/DELETE /:id/characters[/:chid]                                      [voice]
POST   /:id/characters/:chid/suggest-voice                                     [voice]
GET/POST/PATCH/DELETE /:id/pronunciations[/:rid]   (book_id null = global at /api/pronunciations) [voice]
POST   /:id/pronunciations/suggest         names/invented words from text      [voice]
POST   /:id/pronunciations/import          .pls/.txt ; GET .../export.pls      [voice]
GET    /:id/paragraphs/:sid/takes ; POST .../takes/:tid/select ; DELETE        [voice]
POST   /:id/paragraphs/:sid/generate       {range?} one paragraph or selection [voice]
POST   /:id/render                         {scope, overwrite} -> RenderRun     [voice]
GET    /:id/renders ; POST /:id/renders/:rid/{pause,resume,cancel}             [voice]
GET    /:id/estimate                       seconds of audio + render time      [voice]

POST   /:id/master/analyze                 -> ChapterQc[]                      [export]
POST   /:id/credits                        generate opening/closing/sample     [export]
POST   /:id/exports                        ExportRequest -> BookExport         [export]
GET    /:id/exports ; GET /:id/exports/:eid/download                           [export]
GET    /:id/chapters/:cid/timings          ParagraphTiming[]                   [export]

GET    /:id/beds ; POST /:id/chapters/:cid/beds {sound_id|prompt, gain_db, duck} [soundscape]

GET    /:id/listen                         playable manifest (chapters, files, timings) [listen]
PUT    /:id/progress                       {chapter_id, position_s}           [listen]
POST   /:id/publish/{webplayer,rss}                                           [listen]
```

Book-level events (render progress, export progress) reuse SSE via `streamSse`: `GET /api/audiobooks/:id/events` [core]. The other modules publish through a small `AudiobookHub` that core exports.

## Workers and file ownership

Nobody edits another area's files. If you need a hook in someone else's file, add a one-liner tagged `// [audiobooks:<area>]` and say so in your report. The lead resolves merge conflicts on the shared lines.

| Area | Session | Owns |
|---|---|---|
| **core**: book model, chapters, editor, shelf | `ab-core` | `server/src/audiobook/{store,service,hub}.ts`, `server/src/routes/audiobooks.ts`, `server/test/audiobook-core*.test.ts`, `app/src/routes/audiobooks.tsx`, `app/src/routes/audiobook.tsx`, `app/src/components/audiobook/editor/**`, `app/src/components/audiobook/shelf/**`, `app/src/lib/audiobook-api.ts`, `app/src/lib/audiobook-mock.ts`, `app/src/lib/audiobook-queries.ts` |
| **import**: manuscript parsing and the import wizard | `ab-import` | `server/src/audiobook/import/**`, `server/src/routes/audiobook-import.ts`, `server/test/audiobook-import*.test.ts`, `server/test/fixtures/audiobook/**`, `app/src/components/audiobook/import/**`, deps in `server/package.json` + lockfile |
| **voice**: cast, pronunciation, takes, render | `ab-voice` | `server/src/audiobook/{cast,pronounce,takes,render}*.ts`, `server/src/llm/characters.ts`, `server/src/routes/audiobook-voice.ts`, `server/test/audiobook-voice*.test.ts`, `app/src/components/audiobook/{cast,pronounce,takes,render}/**`; hooks: text override in `segmentGenerateSchema` + `service.ts` generateSegment, public `LlmService` method, job kind |
| **export**: mastering, QC, encoders, credits | `ab-export` | `server/src/audio/{master,encode,meter}.ts`, `server/src/audiobook/{export,credits,timings}*.ts`, `server/src/routes/audiobook-export.ts`, `server/test/audiobook-export*.test.ts`, `server/test/master*.test.ts`, `app/src/components/audiobook/export/**`; hook: factor mixdown out of `service.ts` `exportStory` |
| **listen**: shelf player, read-along, publish | `ab-listen` | `server/src/audiobook/publish/**`, `server/src/routes/audiobook-listen.ts`, `app/src/routes/listen*.tsx`, `app/src/components/listen/**`, `app/src/lib/listen-*.ts` |
| **soundscape**: beds, ducking, MCP, docs | `ab-soundscape` | `server/src/audio/duck.ts`, `server/src/audiobook/beds.ts`, `server/src/routes/audiobook-beds.ts`, `app/src/components/audiobook/beds/**`, MCP audiobook tools in `server/src/mcp/server.ts` + `app/src/content/mcp/tools.ts` + `docs/MCP.md`, `docs/AUDIOBOOKS.md` |

**Shared one-line hooks** (expect trivial merge conflicts; the lead resolves them):
- `server/src/app.ts`: each area adds its `register*` line.
- `server/src/db.ts`: core constructs `AudiobookStore`. Other stores are built by their own module from `db.conn`.
- `app/src/App.tsx`: core adds `/audiobooks`, `/audiobooks/:id` and the full-bleed rule; listen adds `/listen`, `/listen/:id`.
- `app-sidebar.tsx`: core adds Audiobooks; listen adds Listen.
- `app/src/components/audiobook/editor/` exposes **slots**: core renders `<CastPanel/>`, `<PronunciationPanel/>`, `<TakesPopover/>`, `<RenderBar/>`, `<ExportDialog/>`, `<BedsPanel/>` and `<ImportWizard/>` from their areas' `index.tsx`. Each area ships a stub `index.tsx` in its first commit so the editor compiles from day one.
- `CHANGELOG.md`: one line per area under `## [Unreleased]`.

## Order

1. Lead: contract + plan (this commit) on `integration/audiobooks`.
2. All six start together, cut from `integration/audiobooks`. Core lands the store and routes first, so the others build against real endpoints. Until then they use `audiobook-mock.ts` and pure-module tests.
3. The lead merges each green branch into `integration/audiobooks` (`--no-ff`, build + test after each), then opens PRs to `main`, one per area where practical.

## Rules for every area

- Public repo: keep text neutral and describe features, not business.
- Tests never download models and never need a GPU or network. Use sine/noise fixtures and mocked subprocesses.
- No inline hex colours. Light and dark both work. Use `import type`.
- `MCP_TOOLS` and the `registerTool` calls change together.
- App typecheck: `npx tsc --noEmit -p tsconfig.app.json` in `app/` (`-p .` checks nothing).
- The mock preview uses a hash router, and the in-memory mock resets on reload.
