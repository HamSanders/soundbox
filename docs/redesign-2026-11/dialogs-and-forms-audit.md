# Dialogs and forms audit

November 2026. An inventory of every dialog, sheet, popover form and
multi-field form in the app (`app/src`), a verdict on each, the handful of
patterns that would replace most of them, and an order to do it in.

The question behind it: Mirli is driven by MCP tools and agents as much as
by clicks. A surface that stops the page to ask a question costs twice in
that world. It interrupts the person, and the same step usually has no
agent-shaped equivalent, so an agent can't do it and the person can't simply
review what the agent did. Where a step can be done, shown, and taken back,
it shouldn't need a modal.

Contents:

1. [Principles](#1-principles)
2. [What the app already does well](#2-what-the-app-already-does-well)
3. [Inventory](#3-inventory)
4. [Verdicts in detail](#4-verdicts-in-detail)
5. [Worked example: the classic-book dialog](#5-worked-example-the-classic-book-dialog)
6. [Patterns to build once](#6-patterns-to-build-once)
7. [MCP parity gaps](#7-mcp-parity-gaps)
8. [Rollout](#8-rollout)
9. [References](#9-references)

---

## 1. Principles

These come from the references in [section 9](#9-references); each rule
names the source it rests on.

1. **Undo beats "are you sure".** If the action can be reversed, do it at
   once and offer Undo. Save the confirmation for what can't come back.
   (Gmail, Linear, NN/g, Material snackbars: [R1], [R2], [R9], [R11].)
2. **Modal only when the page underneath is irrelevant.** A modal is for
   a short, self-contained decision that must be made before anything else
   can happen. It is not for reading, browsing, or long forms. (Apple HIG
   modality, NN/g on modal dialogs: [R8], [R9].)
3. **Show details beside the list, not over it.** Opening something should
   keep the list it came from visible and live: peek, side peek, or an
   inspector. (Linear peek, Notion side peek, Arc Peek: [R2], [R3], [R4].)
4. **Edit where the value is shown.** A name is renamed where the name is
   displayed. A form that repeats fields already visible on the page is
   overhead. (Linear inline property editing, Things in-place to-dos:
   [R2], [R5].)
5. **The agent proposes, the person disposes.** When an agent (MCP client
   or the built-in assistant) does a multi-step job, the UI shows what will
   change, lets the person accept, tweak or reject, and afterwards keeps a
   receipt with Undo. (HAX guidelines, PAIR, human-in-the-loop tool
   approval: [R10].)
6. **Every UI action has a tool, every tool has a trace.** If a person can do
   it in a dialog, an agent should be able to do it through MCP. And if an
   agent did it through MCP, the person should see it happen and be able to
   undo it.

## 2. What the app already does well

The audit isn't starting from zero. These already follow the principles and
are the templates to copy:

| Where | What it does | Why it's right |
| --- | --- | --- |
| `components/listen/bookmark-list.tsx:33` | Deleting a bookmark deletes it and shows a sonner toast with **Undo**, which re-adds it. | Undo instead of confirm, exactly the Gmail pattern. |
| `components/audiobook/editor/use-book-ops.ts` | Paragraph text, casting, lock, split, merge, delete and reorder each push an inverse onto `history`; Ctrl+Z reverses them. | Destructive book edits with no confirm. |
| `hooks/use-edit-history.ts` | Inverse-operation undo stack for the studio timeline, with merge keys so a slider drag is one step. | The right model for server-side state. |
| `components/assistant-chat.tsx:640` `EditsCard` | Edits asked for in chat apply at once and show a receipt ("Applied to the studio, Ctrl+Z there undoes it"). Anything that deletes waits for a click, with the deleting lines in red. | This *is* the agent-proposal card. It needs lifting out of the studio so every area can use it. |
| `components/sound-detail-panel.tsx`, `voice-detail-panel.tsx`, `model-detail-panel.tsx` | Details dock to the right as a third shell column. The page narrows, the list stays live, another row swaps the content. | The inspector pattern, already built. Three separate stores (`detail-store`, `voice-detail-store`, `model-detail-store`) do the same job. |
| `components/audiobook/cast/index.tsx:245`, `pronounce/index.tsx:155` | Inline add forms at the bottom of a list. | Forms that live where their result appears. |
| `components/folder-picker.tsx` | Browse is a shortcut; the path field stays editable. | Modal used for a genuinely modal job (choosing a path). |

The problem is consistency, not capability. The same app that has undo for
bookmarks and paragraph deletes asks "are you sure" in a blurred modal
before deleting a single generated sound, and uses `window.confirm` in five
places.

## 3. Inventory

Columns:

- **Kind**: D = `Dialog`, S = `Sheet`, P = `Popover`, C = `window.confirm`,
  F = inline `<form>`.
- **Use**: how often a person meets it. High = most sessions,
  Med = most projects, Low = a few times ever.
- **MCP**: the tool that does the same job, or *none*.
- **Verdict**: Keep, Undo (act at once, offer undo), Inline (edit or
  expand in place), Panel (side panel or inspector), Agent
  (proposal card plus review), Delete.

### 3.1 Confirmations (13)

| # | Surface | file:line | Kind | Asks | Use | MCP | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Delete sound (card) | `components/sound-card.tsx:264` | D | "Delete this sound?" | High | `delete_sound` | **Undo** |
| C2 | Delete sound (detail) | `routes/sound-detail.tsx:445` | D | Same as C1 | Med | `delete_sound` | **Undo** |
| C3 | Delete session | `components/app-sidebar.tsx:328` | D | Session and its N sounds, files included | Med | none (per-sound only) | **Undo** once a trash exists; until then an **Inline** confirm |
| C4 | Delete project | `routes/projects.tsx:143` | D | Project goes, sounds stay unfiled | Low | none | **Undo** |
| C5 | Delete audiobook | `routes/audiobooks.tsx:290` | D | Book, chapters, voiced audio | Low | none | **Keep** until a trash exists, then **Undo** |
| C6 | Remove studio track | `routes/studio.tsx:2921` | D | Track and its clips; audio stays in library | Med | `remove_track` | **Undo** (put it in the edit history) |
| C7 | Delete voice | `routes/voice-lab.tsx:1074` | D | Clone: reference clip removed. Built-in: entry only | Low | none | **Undo** |
| C8 | Non-commercial model download | `components/model-detail-panel.tsx:454` | D | Acknowledge licence forbids commercial use | Low | none | **Keep** (consent with consequences outside the app), remember the answer per licence |
| C9 | Delete cached weights | `components/model-detail-panel.tsx:490` | D | Remove GBs of weights; can re-download | Low | none | **Undo** (defer the delete) |
| C10 | Delete chapter | `components/audiobook/editor/chapter-list.tsx:275` | C | "Delete X and its audio?" | Med | none | **Undo** via `use-book-ops` history |
| C11 | Remove chapter lane with clips | `components/audiobook/editor/chapter-timeline.tsx:306` | C | "Remove this lane and its N clips?" | Med | none | **Undo** via `use-edit-history` |
| C12 | Restore a version | `components/audiobook/editor/versions-dialog.tsx:167` | C | "Restore X?" (current state is saved first) | Low | none | **Delete** the confirm; toast with Undo |
| C13 | Delete endpoint | `components/endpoint-settings.tsx:244` | C | "Delete X? Sounds stay." | Low | none | **Undo** |
| C14 | Delete profile | `components/profile-manager.tsx:130` | C | OK/Cancel answering "also delete its data?" | Low | none | **Keep**, as a real two-button alert |
| C15 | Clear Hugging Face token | `routes/settings.tsx:886` via `ConfirmAction` (`settings-layout.tsx:527`) | D | "Clear the token?" | Low | none | **Undo** |
| C16 | Run setup again | `routes/settings.tsx:899` via `ConfirmAction` | D | "Run first-run setup again?" | Low | none | **Delete** the confirm (it only clears a flag) |

### 3.2 Dialogs and sheets that show or collect things (21)

| # | Surface | file:line | Kind | Shows / asks | Use | MCP | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Classic book details, Add to library | `components/listen/classic-dialog.tsx:50` | D | Cover, credits, genres, description, rights, one action | High | none (`import_manuscript` takes a path, text or URL, not a classic id) | **Panel** plus one-click **Undo**. Worked example in §5 |
| D2 | Import a manuscript (4-step wizard) | `components/audiobook/import/index.tsx:171` | D | Text, Sections, Details, Voice | Med | `import_manuscript`, `set_character_voice` | **Agent** + create-then-refine |
| D3 | Export audiobook | `components/audiobook/export/index.tsx:135` (806 lines) | D | Format, layout, chapters, mastering, ACX check, credits, retail sample, history | Med | `master_and_export_audiobook` | **Panel/page** with **Agent** shortcut |
| D4 | Book details (12 fields) | `components/audiobook/editor/book-header.tsx:100` | D | Title, subtitle, author, narrator, series, genres, ISBN, description… | Med | none | **Inline** (header) + **Panel** for the rest |
| D5 | Versions (save, compare, restore) | `components/audiobook/editor/versions-dialog.tsx:192` | D | Version list and a word diff | Low | none | **Panel**; diff renders on the paragraphs |
| D6 | Chapter from text | `components/audiobook/editor/chapter-from-text.tsx:60` | D | Paste box | Med | `add_lines` (story-level) | **Inline** |
| D7 | Export a podcast feed | `components/listen/publish-panel.tsx:138` | D | Feed fields | Low | none | **Inline** (expand inside the publish checklist) |
| D8 | Chapters and bookmarks (player) | `components/listen/full-player.tsx:170` | S | Chapter list, bookmarks | Med | n/a | **Keep** on narrow screens; dock as a column on wide |
| D9 | Studio command palette | `components/command-palette.tsx:126` | D | Filterable commands | High | n/a | **Keep**; add a natural-language fallthrough |
| D10 | App command palette (Ctrl/⌘K) | `components/app-command-palette.tsx` (uses D9) | D | Jump to anything | High | n/a | **Keep**; add "Ask" row |
| D11 | Keyboard shortcuts | `components/keyboard-cheatsheet.tsx:97` | D | Reference sheet | Low | n/a | **Keep** |
| D12 | New studio: "What are you making?" | `components/new-studio-dialog.tsx:102` | D | Script Builder or Music Builder | Med | `create_story` | **Delete** as a gate; ask on the empty canvas |
| D13 | First-run setup | `components/onboarding/onboarding-dialog.tsx:247` | D | Four questions, model downloads | Once | n/a | **Keep** (already skippable and non-blocking on downloads) |
| D14 | Profiles | `components/profile-manager.tsx:61` | D | List, create, rename, delete | Low | n/a | **Panel** (a Settings section), inline rename |
| D15 | Repaint (timeline) | `components/repaint-controls.tsx:150` | D | Window, description, strength | Med | none | **Inline**: anchored popover like the editor's |
| D16 | Stem picker | `components/stem-picker.tsx:69` | D | Which stems, what happens to the rest | Med | `separate` | **Inline**: one-click split with remembered defaults, popover for choices |
| D17 | Sampled instruments | `components/instrument-samples-dialog.tsx:44` | D | Download or remove 8 patches | Low | none | **Panel** (Models page) or inline rows in the Instrument menu |
| D18 | Folder picker | `components/folder-picker.tsx:86` | D | Browse server folders | Low | n/a | **Keep** |
| D19 | Add or edit endpoint | `components/endpoint-settings.tsx:338` | D | Name, URL, auth, body template, Test | Low | none | **Inline** (expand the row in Settings) + **Agent** ("add my LocalAI at …") |
| D20 | Rename sound | `components/sound-card.tsx:242` | D | One text field | High | none | **Inline** |
| D21 | Voice clips | `components/voice-clips.tsx:134` | D | Up to 5 clips of a clone | Low | none | **Panel** (voice detail panel) |
| D22 | Voice history ("Read in X") | `components/voice-clips.tsx:276` | D | What the voice has said | Low | `list_sounds` | **Panel**, or a Library filter link |
| D23 | Add a voice / voice from sound | `components/voice-shared.tsx:417` | D | Source clip, name, model, consent | Med | none | **Inline** draft card + **Agent** |
| D24 | Edit voice | `routes/voice-lab.tsx:963` | D | Name, notes, model | Med | none | **Inline** in the voice panel |

### 3.3 Popovers (anchored, non-blocking) (22)

Popovers are anchored to their trigger and don't dim the page. Most are the
right tool. Listed so the audit is complete.

| # | Surface | file:line | Shows / asks | Verdict |
| --- | --- | --- | --- | --- |
| P1 | Composer: voices, models, project | `components/generate-composer.tsx:461, 487, 710` | Pickers | **Keep** |
| P2 | Composer: duration, variations, seed, steps, CFG, negative, lyrics | `generate-composer.tsx:791, 823, 860, 947, 979, 1037, 1068` | Parameter chips | **Keep**; let the prompt set them too (see §4.4) |
| P3 | Book pacing | `audiobook/editor/book-header.tsx:243` | Pause lengths | **Keep** |
| P4 | Paragraph notes | `audiobook/editor/notes.tsx:57` | Note text | **Keep** |
| P5 | Takes | `audiobook/takes/index.tsx:34` | Pick a take | **Keep** |
| P6 | QC log | `audiobook/render/index.tsx:193` | Quality checks | **Keep**; also feed the activity feed (§6.6) |
| P7 | Add device | `components/device-rack.tsx:533` | Device picker | **Keep** |
| P8 | Job queue | `components/queue-indicator.tsx:125` | Running jobs | **Grow** into the activity feed (§6.6) |
| P9 | Player speed / sleep | `listen/player-controls.tsx:145` | Speed, timer | **Keep** |
| P10 | Sound editor DSP tools | `components/sound-editor.tsx:112` | Effect params | **Keep** |
| P11 | Script line options | `components/story-script.tsx:854` | Line settings | **Keep** |
| P12 | Add to project | `sound-card.tsx:394`, `routes/sound-detail.tsx:213` | Project picker | **Keep** |
| P13 | Backend status | `components/app-sidebar.tsx:581` | Status, help | **Keep** |

### 3.4 Full-page and inline forms (3)

| # | Surface | file:line | Verdict |
| --- | --- | --- | --- |
| F1 | Access token gate | `components/access-gate.tsx:91` | **Keep** (it is the page) |
| F2 | Add character | `audiobook/cast/index.tsx:245` | **Keep** (already inline) |
| F3 | Add pronunciation rule | `audiobook/pronounce/index.tsx:155` | **Keep**, plus agent suggestions (§4.4) |

**Totals:** 16 confirmations, 24 dialogs or sheets, 13 popover groups and
3 inline forms. Of the 40 confirmations, dialogs and sheets, **9 stay
modal** (C5 for now, C8, C14, D8 on narrow screens, D9, D10, D11, D13, D18).
The other 31 become undo, inline, panel or agent flows, or go away.

## 4. Verdicts in detail

### 4.1 Confirmations become undo

Twelve of the sixteen confirmations guard something that can be put back.
Apple's guidance is blunt: "Avoid displaying alerts for common, undoable
actions, even when they're destructive" [R8]. NN/g warns that confirmations
shown too often get ignored, and that designers should "go to great lengths
to provide undo" [R9]. Linear has made almost every change undoable with
Cmd Z since 2020, and restores a deleted issue the same way [R2]. Three
groups:

**Already reversible, confirm is pure friction.**
C12 (restore version) saves the current state as "Before restoring …"
before it restores, so Undo is "restore that one". C16 (run setup again)
only clears `onboarded_at`. C6 (remove track) and C11 (remove lane) remove
references; the audio stays in the library, and `use-edit-history`
already knows how to record an inverse. The comment at `studio.tsx:2918`
says the confirm exists "precisely because undo does not cover it". Make
undo cover it (re-create the track with its clips and devices) and the
confirm goes.

**Reversible on the client by deferring the server call.** C1, C2, C4, C7,
C9, C13, C15. Hide the item at once, show a toast with Undo, and send the
delete only when the toast closes (§6.1). Gmail's Undo Send works the same
way: a sent message can be cancelled for a set 5 to 30 seconds, so the send
is effectively held for that window [R1].

**Not reversible today.** C3 (session plus all its audio) and C5 (a book with
hours of voiced audio). These need a server-side trash (a `deleted_at`
column and a purge after a set time) before they can drop the confirm. The
trash matters beyond these two dialogs. `soundbox.delete_sound` deletes at
once ("Permanently delete a sound and its audio file", `mcp/server.ts:368`),
and an agent never sees a toast. With a trash, an agent's delete lands in
the activity feed with the same Undo a person gets (§6.6). Until the trash
exists, C3 becomes an inline confirm (§6.5) and C5 stays a modal.

**Stays modal.** C8 is consent to a licence term whose consequences sit
outside the app. HIG keeps alerts for exactly that kind of uncommon action
that can't be undone [R8]. Ask it once per licence, not once per download.
Raycast's `confirmAlert` has a built-in "Do not show this message again"
option (`rememberUserChoice`) for the same reason [R6]. C14 currently uses `window.confirm` to
answer a question its OK/Cancel buttons don't name ("also delete its
data?"). Replace it with an alert whose buttons say what they do: "Remove
profile, keep files" and "Delete profile and files".

**`window.confirm` goes everywhere.** It can't be styled or themed, and it
blocks the page's JavaScript until it's answered. C10, C11,
C12, C13 and C14 all use it.

### 4.2 Detail dialogs become the docked panel

NN/g, writing about records in tables, says it doesn't recommend modals for
deep editing work, and that "a nonmodal side panel allows for the full
display (and editing) of a single record" [R9]. The shell already has the
right container. `SoundDetailPanel`,
`VoiceDetailPanel` and `ModelDetailPanel` dock to the right as a third
column (`App.tsx:251-253`), the page narrows, and the list stays live. But:

- The voice panel opens *modal dialogs* for Edit (D24) and Clips (D21) on top
  of itself (`lib/voice-detail-store.ts` registers `edit` and `clips`
  actions that open the Lab's dialogs). A modal on top of an inspector is
  the worst of both. Put those sections in the panel.
- Each panel has its own zustand store and its own "one panel at a time"
  rule (`voice-detail-store.ts:38` closes the sound panel by hand). One
  `DetailDock` with a typed `kind` would replace three stores and make new
  kinds (classic, book version, endpoint) cheap (§6.3).
- `Sheet` (`ui/sheet.tsx`) always renders an overlay, so it's modal too. It
  is fine for the player's chapter drawer on a phone (D8). It isn't a
  substitute for the dock.

Moves to the dock: D1 classic details, D5 versions, D21 voice clips, D22
voice history, D24 voice edit, D14 profiles (or a Settings section), and
D4's long tail of book metadata.

### 4.3 Single-field and short forms become inline edits

D20 renames a sound in a modal with one text field, the most common edit in
the library. Linear edits properties where they're shown: click the
assignee on a card, or press a single key (L for label, A for assignee) on
the selected issue [R2]. Things opens a to-do by turning it into "a clear
white piece of paper" in the list [R5].
Same for D24 (voice name and notes), D4's title, subtitle and author (edit
them in the book header), and D14 profile rename. Use one `InlineEdit`
component (§6.2) so Enter, Escape, blur and F2 behave the same everywhere.

D6 (chapter from text) is a paste box in a modal. Make "+ Chapter" in the
chapter list expand an inline paste area in place, and accept a paste of
multi-paragraph text anywhere in the chapter list as "new chapter from
this" with a one-line preview and Undo.

D15 (repaint) already exists as an anchored popover in the waveform editor;
the timeline shows the same controls as a centered modal. Anchor it to the
marked span instead. D16 (stem picker): make the card's "Split" button do
the usual split with the last-used choices in one click, and put "Choose
stems…" on a split-button caret.

D7 (podcast feed) expands in place inside the publish checklist that already
lists it. D19 (endpoint add/edit) expands the Settings row in place, so
Test's output sits beside the list it will join.

### 4.4 Multi-step jobs become agent proposals

This is where "agent-first" changes the design, not just the container.

**D2, import a manuscript.** Today: a 4-step modal wizard (Text, Sections,
Details, Voice) of 770 lines. The server already parses, detects chapters,
marks front and back matter and keeps metadata; `import_manuscript` does the
whole thing for an agent in one call. The wizard asks the person to review
everything the parser decided before the book exists.

Proposed flow, *create then refine*:

1. Drop a file anywhere on Audiobooks (or paste text, or a URL, or ask the
   assistant "import moby-dick.epub").
2. The import runs and a **proposal card** appears where the book will be:
   "Moby-Dick, 135 chapters, front matter (3) and back matter (2) skipped,
   cover found, 14 speaking characters detected." with **Create book**,
   **Review sections**, **Discard**.
3. Create book opens the editor at once. The section review the wizard did
   becomes the chapter list itself, with skipped sections shown dimmed and
   one click to include them. Details go to the header (inline) and the
   dock. Voice and cast go to the cast panel, where they live anyway.
4. Every change after creation is an ordinary undoable book edit.

The wizard's Sections step survives as "Review sections" for people who
want it, but it's no longer in the way of everyone else. Things' Quick
Entry makes the same trade, capturing a to-do without leaving the app
you're in [R5]. Notion opens database pages in side peek by default so "the
rest of the database view continues to be interactive" [R3].

**D3, export audiobook.** Today: an 806-line modal with format, layout,
chapters, mastering, the ACX check, credits, a retail sample and export
history. Apple says to "avoid creating a modal experience that feels like
an app within your app" [R8]. NN/g says modals are poor for decisions that
need information from elsewhere on the screen [R9]. The ACX check in particular is a report you act on: its fix
hints send you back into the book, which the modal hides.

Proposed: an **Export** panel in the book (a dock kind or a tab next to the
chapter view) with three parts:

- a one-line preset choice (ACX, podcast, plain files) with **Export**;
- the ACX report as a checklist whose fix hints are links into the
  chapters, still visible beside the editor;
- export history as a list with downloads.

The agent path: "export this for ACX" runs `master_and_export_audiobook` and
posts the same report as a card in the activity feed, with failed checks
linked. The person reviews the result rather than filling in the form.

**D12, new studio.** "What are you making?" is asked before every new piece
of work. Ask it on the empty canvas instead: create an untitled story, show
two large starts ("Start from a script", "Start from a prompt") as the empty
state, and let the first action decide. The prompt bar can decide too: "a
radio play for two voices" goes to the Script Builder, "a lo-fi loop" to the
Music Builder. Entry points that already know (Voice's "New script") skip
the question.

**D23, add a voice.** Dropping a clip on Voice Lab should create a draft
voice card in the grid with the name guessed from the file, a play button,
and **Save**/**Discard**: the card is the form. There is no MCP tool for
making a voice today (§7), which is why this step needs the dialog at all.

**Suggestions that should be proposals.** Two places would benefit from the
assistant proposing a batch the person accepts row by row:

- *Pronunciations* (F3): "14 names in this book look unusual. Proposed
  readings:" with play, accept, edit and reject per row, written through
  `add_pronunciation`. The review works like ElevenLabs Studio's
  per-paragraph regeneration with its generation history: hear the change
  on the paragraph it affects, keep it or restore the earlier one [R7].
- *Composer parameters* (P2): "8 seconds, 3 variations, no vocals" typed in
  the prompt becomes chips the person can see and remove, rather than seven
  popovers to visit. `enhance_prompt` already does the prompt half. Suno's
  Simple mode takes a description and decides the rest, with Custom mode
  for control [R7].

### 4.5 What stays modal, and why

| # | Why it earns the modal |
| --- | --- |
| C5 (until trash) | Hours of GPU work, no way back. |
| C8 | Licence consent with consequences outside the app. |
| C14 | Deleting a profile's data on disk, no way back. |
| D8 (narrow only) | A drawer on a phone is the conventional pattern. |
| D9, D10 | Command palettes are modal by design: one keystroke in, one out [R2], [R6]. |
| D11 | Transient reference you dismiss with Escape. |
| D13 | First run, skippable, doesn't block on downloads. |
| D18 | Choosing a path is a modal job in every OS. |

These should use a proper `AlertDialog` (Radix ships one in the `radix-ui`
package the app already depends on) where they're confirmations: it gives
`role="alertdialog"`, doesn't close on an outside click, and focuses the
safe button. There's no `ui/alert-dialog.tsx` today; every confirmation is
a plain `Dialog`.

## 5. Worked example: the classic-book dialog

### Before

`components/listen/classic-dialog.tsx`. Opened from any cover on Listen →
Explore (`routes/listen-explore.tsx:230`, from the Top picks carousel, cover
rows and grids).

```
┌──────────────────────── page blurred and dimmed ─────────────────────────┐
│                                                                           │
│        ┌──────────────────────────────────────────────────┐               │
│        │ ┌──────┐  The Yellow Wallpaper                    │               │
│        │ │cover │  Charlotte Perkins Gilman                │               │
│        │ │      │  First published 1892 · 40 min           │               │
│        │ └──────┘  [Short story] [Gothic] [Psychological]  │               │
│        │                                                  │               │
│        │ Description paragraph …                          │               │
│        │ Public domain in the US. Source: Gutenberg ↗     │               │
│        │                                                  │               │
│        │                      [ Close ] [ Add to library ] │               │
│        └──────────────────────────────────────────────────┘               │
└───────────────────────────────────────────────────────────────────────────┘
```

What's wrong with it:

- It's **browsing**, and the modal stops browsing. To compare two classics
  you open, close, scroll, open. The carousel you came from is blurred.
- **One action**, and it navigates away. `onSuccess` imports, toasts,
  closes and `navigate`s to `/audiobooks/:id`. Someone adding three
  stories for later has to come back to Explore twice.
- **No undo.** A mis-click creates a book; removing it means finding it in
  Audiobooks and going through the C5 delete modal.
- **No state on the card.** Explore doesn't show which classics you've
  already added, so the dialog is also the only way to find out.
- **Not addressable.** No URL, so an agent or a link can't open it, and Back
  doesn't close it.
- **No agent path.** `import_manuscript` takes a path, text or URL, not a
  classic id, so "add The Yellow Wallpaper to my library" can't be done
  through MCP without scraping the source URL.

### After

Two changes, which can ship separately.

**1. The card does the action.** Every classic cover gets a hover/focus
"+" (and a long-press on touch). One click:

- adds the book (the same `parseClassic` + `commit` the dialog calls),
- turns the card's badge to "In library" at once (optimistic),
- shows a toast: *Added "The Yellow Wallpaper"* with **Open** and **Undo**.

Undo deletes the book that was just created. It has no audio yet, so
nothing is lost and no confirm is needed. Open navigates. If you do
nothing, you stay on Explore and keep browsing. ElevenLabs' Voice Library
works this way: saving a voice is one click on its **+** button, and you
don't leave the library to do it [R7]. Collecting is cheap and quiet; going
there is a separate choice.

**2. Details open beside the shelf, not over it.** Clicking a cover (not
the "+") opens the classic in the dock, the same third column the sound,
voice and model panels use:

```
┌ sidebar ┬──────────── Explore (narrowed, still live) ───────────┬──── dock ─────────────┐
│         │ Top picks                                             │ ┌──────┐               │
│         │ [▣][▣][▣ selected][▣][▣] →                            │ │cover │ The Yellow    │
│         │                                                       │ └──────┘ Wallpaper     │
│         │ Gothic & uncanny                                      │ Gilman · 1892 · 40 min │
│         │ [▣][▣][▣][▣] →                                        │ [Short story] [Gothic] │
│         │                                                       │                        │
│         │                                                       │ [ ▶ Sample ] [ + Add ] │
│         │                                                       │                        │
│         │                                                       │ Description …          │
│         │                                                       │ More like this ▸ ▣ ▣ ▣ │
│         │                                                       │ Public domain in the   │
│         │                                                       │ US · Gutenberg ↗       │
└─────────┴───────────────────────────────────────────────────────┴────────────────────────┘
```

- **The shelf stays live.** Arrow keys or a click on another cover swap the
  dock's content, like Linear's peek and Notion's side peek [R2], [R3].
  Escape closes it and returns focus to the cover.
- **URL-addressed:** `/listen/explore?classic=yellow-wallpaper`. Back closes
  it, a link opens it, and an MCP client or the assistant can send someone
  there.
- **Primary action at the top**, next to the cover, so it's in the same place
  whether the description is two lines or twenty. Once added, it becomes
  **Open in Audiobooks** and **Remove** (with Undo).
- **"More like this"** uses the genres and form the dialog already shows as
  badges, so the dock continues browsing rather than ending it.
- On a narrow window the dock covers the page, which is what the existing
  panels already do (`sound-detail-panel.tsx` header comment).

**3. The agent path.** Add a classics tool (§7) so "add three short gothic
stories to my library" works: the assistant lists matching classics, posts
a proposal card with the three covers, and Accept runs the same add with
one Undo for the batch.

### Sketch

```tsx
// routes/listen-explore.tsx
const dock = useDock();
<ExploreCard
  item={it}
  inLibrary={libraryIds.has(it.work.id)}
  onOpen={() => dock.open({ kind: "classic", id: it.work.id })}
  onAdd={() => addClassic(it)}
/>

// lib/add-classic.ts
export function useAddClassic() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (item: ExploreItem) =>
    reversible({
      message: `Added “${item.title}”`,
      run: async () => {
        const preview = await importApi.parseClassic(item.work.id);
        return importApi.commit({ preview_id: preview.id });
      },
      undo: (book) => audiobookApi.remove(book.id),
      open: (book) => navigate(`/audiobooks/${book.id}`),
      invalidate: () => {
        void qc.invalidateQueries({ queryKey: abk.books });
        void qc.invalidateQueries({ queryKey: lk.shelf });
      },
    });
}
```

`reversible` and `useDock` are §6.1 and §6.3. `ClassicDetail` reuses the
dialog's body (cover, credits, badges, description, rights) almost
unchanged; only its container and footer change.

Effort: **M**. The card action and toast are about half a day. The dock kind
is a day, less once `DetailDock` exists.

## 6. Patterns to build once

Six pieces. Each is small, and together they cover 31 of the 40 surfaces.

### 6.1 `undoable` and `reversible`: act now, offer Undo

Two shapes, one toast. Built on sonner, which the app already uses (2.0.8,
whose `ExternalToast` takes `action`, `duration`, `onDismiss` and
`onAutoClose`).

```ts
// app/src/lib/undo.ts

/** Delete-style: hide now, send the request when the toast closes. */
export function undoable(opts: {
  message: string;
  description?: string;
  /** Optimistic local change: remove the row from the query cache. */
  apply: () => void;
  /** Put it back. Runs on Undo or if commit fails. */
  revert: () => void;
  /** The real server call. Runs once, when the toast auto-closes or is dismissed. */
  commit: () => Promise<unknown>;
  /** How long Undo is offered. Default 8000 ms. */
  windowMs?: number;
}): void;

/** Create-style: run now, Undo runs the inverse. */
export function reversible<T>(opts: {
  message: string | ((result: T) => string);
  run: () => Promise<T>;
  undo: (result: T) => Promise<unknown>;
  /** Optional second action, e.g. "Open". */
  open?: (result: T) => void;
  invalidate?: () => void;
}): Promise<T>;
```

Behaviour that matters:

- A `settled` flag so commit runs exactly once whichever of Undo,
  `onAutoClose` or `onDismiss` comes first.
- Pending commits flush on `pagehide` and on profile switch, so closing the
  window during the undo window still deletes.
- If commit fails, `revert()` and an error toast with the reason.
- Ctrl+Z (Cmd+Z) while the toast is showing triggers its Undo, as long as
  focus isn't in a text field or a surface with its own history (the studio
  timeline, the book editor). Linear's undo is Cmd Z, or "Undo" typed in
  its command menu [R2], and Gmail's is `z` [R1].
- Material's snackbar guidance warns against auto-dismissing an actionable
  snackbar on the web unless there's also inline feedback [R11]. Here the
  row vanishing or the badge changing is that inline feedback. Without it,
  for example after an agent's action, use the activity feed (§6.6)
  instead of a timed toast.
- `aria-live` via sonner; the toast says what happened in the object's own
  name: *Deleted "Rain on tin roof"*, not *Item deleted*.

Replaces C1, C2, C4, C6, C7, C9, C10, C11, C12, C13, C15, and the success
path of D1.

### 6.2 `InlineEdit`: edit where it's shown

```tsx
// app/src/components/ui/inline-edit.tsx
<InlineEdit
  value={sound.name}
  onCommit={(next) => rename.mutate(next)}   // only called when changed and non-empty
  label="Sound name"                         // aria-label for the input
  as="h3"                                    // element shown when not editing
  className="font-medium truncate"
  multiline={false}                          // true → Textarea, Ctrl/⌘+Enter commits
  validate={(v) => (v.trim() ? null : "Name can't be empty")}
/>
```

- Click, Enter or F2 on the focused text starts editing; the text becomes an
  `Input` with the same font and box, so nothing jumps.
- Enter or blur commits, Escape reverts. An empty value reverts.
- Optimistic: the new value shows at once. A failure reverts it and toasts.
- Uses `ui/input.tsx` and `ui/textarea.tsx`, so it inherits the theme.

Replaces D20, D24, D4 (title, subtitle, author, narrator), D14 rename.

### 6.3 `DetailDock`: one inspector for everything

Generalise the three existing panels into one dock with typed kinds.

```ts
// app/src/lib/dock.ts
export type DockItem =
  | { kind: "sound"; id: string }
  | { kind: "voice"; id: string }
  | { kind: "model"; id: string }
  | { kind: "classic"; id: string }
  | { kind: "versions"; bookId: string }
  | { kind: "export"; bookId: string };

export function useDock(): {
  item: DockItem | null;
  open: (item: DockItem) => void;   // replaces whatever is open
  close: () => void;
};
```

- Synced to a `?detail=kind:id` search param, so Back closes it and links
  open it.
- The shell renders `<DetailDock />` once, in the slot `App.tsx:251-253`
  uses now, with a registry `kind → component`.
- Non-modal: no overlay, focus moves to the dock's heading on open and back
  to the opener on close, Escape closes.
- Below the shell's breakpoint it covers the page, as today.

Replaces `detail-store.ts`, `voice-detail-store.ts`, `model-detail-store.ts`,
and gives D1, D3, D5, D14, D17, D21, D22 a home.

### 6.4 `ProposalCard`: the agent proposes, the person decides

Lift `EditsCard` out of `assistant-chat.tsx:646` and make it a component any
area can render: in the assistant thread, in the activity feed, or inline
where the change will land (the import drop zone, the pronunciation list).

```tsx
// app/src/components/proposal-card.tsx
<ProposalCard
  title="Import “Moby-Dick”"
  summary="135 chapters · cover found · 14 characters"
  items={[
    { label: "Front matter", detail: "3 sections skipped", tone: "muted" },
    { label: "Narrator", detail: "Ada (from your default)" },
  ]}
  risk="safe"                 // "destructive" → deleting lines in red, no auto-apply
  status="proposed"           // proposed | applying | applied | rejected | failed
  onAccept={…}
  onTweak={…}                 // opens the relevant panel or "Review sections"
  onReject={…}
  onUndo={…}                  // shown once applied
/>
```

- `proposed` shows Accept (primary), Tweak, Reject. `applied` turns into a
  receipt with Undo, like `EditsCard`'s "Applied to the studio" line.
- Batch rows (pronunciations, classics) each get accept and reject, plus
  "Accept all".
- `risk="destructive"` never auto-applies, matching the rule in
  `assistant-chat.tsx`'s header: anything that deletes waits for a click.

Grounded in:

- Microsoft's Human-AI guidelines G8 and G9, "Support efficient dismissal"
  and "Support efficient correction" [R10].
- VS Code's Copilot edits: Keep or Undo per change, per file or all at
  once, and "Undo reverts them without rewinding the agent conversation"
  [R10].
- The Vercel AI SDK's tool approval: a tool call waits in
  `approval-requested` until the UI answers, and a denial goes back to the
  model with a reason [R10]. Mirli's server-side planner could use the same
  states.

### 6.5 `InlineConfirm`: when there's truly no undo

For the few irreversible actions that don't justify blocking the whole page
(C3 until a trash exists):

```tsx
<InlineConfirm
  label="Delete session"
  confirmLabel={`Delete ${n} sounds`}
  onConfirm={…}
/>
```

The button turns into "Delete 12 sounds? [Delete] [Keep]" in place, with
focus on Keep, and goes back after 5 seconds or on blur. No overlay, no
blur, and the thing being deleted stays visible next to the question.

### 6.6 `ActivityFeed`: what happened, by whom, with Undo

Grow the queue popover (P8, `queue-indicator.tsx`) into an activity feed:
running jobs, finished jobs, and **actions taken through MCP or the
assistant**, newest first.

```
● Rendering chapter 4 of Moby-Dick        2 of 31 paragraphs   [Stop]
✓ Agent (MCP) cast Ishmael → Ada                        2m     [Undo]
✓ Exported "Moby-Dick" for ACX · 2 checks failed        5m     [Report]
✓ You deleted 3 sounds                                  9m     [Undo]
```

- The server already counts tool calls per tool (`MCP_TOOLS[].calls`); the
  feed needs a per-call event (tool, arguments summary, result, inverse if
  any) over the existing job stream.
- Undo appears where the action has an inverse (casting, beds, track
  removal, trash deletes).
- This is the review surface that makes agent-first trustworthy: the person
  doesn't have to watch the agent work, but can always see and reverse what
  it did.
- GitHub's Copilot cloud agent keeps session logs that show "the tools it
  used" [R10].
- Linear's agent API models each run as a session made of typed
  activities: thought, action (a tool call and its result), elicitation,
  response and error. Thoughts and actions can be ephemeral, replaced by
  the next one [R10]. Those are the right row types for this feed too:
  collapse an agent's in-progress steps into one live row, and keep the
  actions.

## 7. MCP parity gaps

Several dialogs exist partly because no tool does the job. Closing these
lets the assistant and external agents do the step, and the UI reviews it.

| UI surface | Missing tool | Notes |
| --- | --- | --- |
| D1 classic add | `list_classics`, and `import_manuscript` accepting a `classic` id | The bundled library is UI-only today. |
| D4 book details | `update_audiobook` (metadata) | Import sets metadata; nothing edits it after. |
| C5 delete book | `delete_audiobook` (to the trash) | `delete_sound` exists; books have no equivalent. |
| D20 rename | `update_sound` (name, project) | |
| D23, D24, C7 voices | `create_voice` (from a clip path or sound id), `update_voice`, `delete_voice` | `list_voices` is read-only. |
| D5 versions | `save_version`, `restore_version` | Agents doing bulk edits should checkpoint first. |
| D12 new studio | `create_story` already takes the work; confirm it takes `builder` | |
| §6.6 | an activity endpoint (`GET /api/activity`) | Not an MCP tool; the feed's data source. |

`MCP_TOOLS` in `server/src/mcp/server.ts` and the `registerTool` calls must
be added together; the site build checks that they agree.

## 8. Rollout

Effort: **S** up to half a day, **M** 1-2 days, **L** 3-5 days,
**XL** more than a week. Ordered by impact over effort.

| # | Change | Surfaces | Effort | Why first |
| --- | --- | --- | --- | --- |
| 1 | `undoable` / `reversible` + convert the client-reversible confirms | C1, C2, C4, C7, C9, C12, C13, C15, C16 | **M** (S each after the helper) | Delete-sound is the most-seen modal in the app. Biggest felt change for the least code. |
| 2 | `InlineEdit` + sound rename, voice name/notes, book title/author | D20, D24, D4 (part) | **M** | Second most common modal; one component. |
| 3 | Classic add on the card with Undo, stay on Explore | D1 (part) | **S** | The example that prompted this audit. |
| 4 | `DetailDock` with URL sync; move sound, voice, model into it; add classic | D1, D21, D22 | **L** | Removes three stores, unlocks every later panel. |
| 5 | Book edits undo instead of `window.confirm` | C10, C11, C6 | **M** | Inverses exist for paragraphs; chapters and lanes need theirs. |
| 6 | `ProposalCard` extracted from `EditsCard`; assistant available in Audiobooks | §6.4 | **L** | No assistant exists in the audiobook area today; it's the most agent-shaped part of the app. |
| 7 | Server trash (`deleted_at`, purge job) for sounds, sessions, books | C3, C5, `delete_sound` | **L** | Makes agent deletes undoable; removes the last two "can't be undone" modals. |
| 8 | Activity feed from the queue popover, with MCP actions | P8, §6.6 | **L** | The review surface for everything agents do. |
| 9 | Export as a dock panel with ACX checklist and agent path | D3 | **L** | Report next to the book it describes. |
| 10 | Import create-then-refine with a proposal card | D2 | **XL** | Largest flow; benefits from 4, 6 and 8 existing first. |
| 11 | Small inline moves: chapter from text, podcast feed, endpoint row, repaint popover, stem split-button | D6, D7, D19, D15, D16 | **S** each | Independent; good first issues. |
| 12 | New studio question on the empty canvas | D12 | **M** | Touches every entry point. |
| 13 | MCP parity tools | §7 | **M** each | Pairs with 3, 4, 6 and 10 as they land. |
| 14 | `ui/alert-dialog.tsx` for the modals that stay; C14 two-button alert | C5, C8, C14 | **S** | Correct semantics for what's left. |

Every user-visible step gets a line under `## [Unreleased]` in
`CHANGELOG.md` and works in light and dark.

## 9. References

Each of these was read for this audit in November 2026. Product behaviour
changes, so check the page before you lean on a detail. Where a page
couldn't be fetched directly, it was read through a search engine's copy of
the official page; those are marked *(indexed copy)*.

**[R1] Gmail**
- Undo Send, a cancel window of 5, 10, 20 or 30 seconds:
  <https://support.google.com/mail/answer/2819488>
- Keyboard shortcuts, `z` is "Undo last action":
  <https://support.google.com/mail/answer/6594>
- Trash keeps deleted mail for 30 days:
  <https://support.google.com/mail/answer/7401>

**[R2] Linear**
- Undo for almost every change, Cmd Z / Shift Cmd Z:
  <https://linear.app/changelog/undo-actions>
- Deleted issues restored with Cmd Z, kept 30 days *(indexed copy)*:
  <https://linear.app/docs/delete-archive-issues>
- Peek, Space to toggle or hold:
  <https://linear.app/docs/custom-views>; on boards *(indexed copy)*:
  <https://linear.app/docs/board-layout>
- Command menu and single-key property edits *(indexed copy)*:
  <https://linear.app/docs/select-issues>,
  <https://linear.app/docs/assigning-issues>,
  <https://linear.app/docs/labels>

**[R3] Notion**
- Side peek, center peek and full page; table, board, list and timeline
  default to side peek:
  <https://www.notion.com/help/views-filters-and-sorts>
- Slash menu and inline databases *(indexed copy)*:
  <https://www.notion.com/help/writing-and-editing-basics>,
  <https://www.notion.com/help/create-a-database>

**[R4] Arc** *(indexed copies)*
- Peek (2024), links from pinned tabs open in an overlay you can expand or
  dismiss: <https://resources.arc.net/hc/en-us/articles/20498293324823-Arc-for-macOS-2024-2026-Release-Notes>
- Little Arc: <https://resources.arc.net/hc/en-us/articles/20498463803799-Arc-for-macOS-2021-Release-Notes>
- Arc is being wound down, and Peek isn't in its successor:
  <https://resources.arc.net/hc/en-us/articles/44413577819159-Arc-Sunset-Frequently-Asked-Questions>.
  Cite it for the pattern, not as a live product.

**[R5] Things 3**
- To-dos open as "a clear white piece of paper"; Magic Plus:
  <https://culturedcode.com/things/features/>
- Drag to insert where you drop *(indexed copy)*:
  <https://culturedcode.com/things/support/articles/2803582/>
- Quick Entry: <https://culturedcode.com/things/support/articles/2249437/>

**[R6] Raycast**
- `confirmAlert` is for important actions "for example when irreversibly
  deleting something", and can remember the answer:
  <https://developers.raycast.com/api-reference/feedback/alert>
- Toast actions can "cancel an asynchronous operation, undo an action":
  <https://developers.raycast.com/api-reference/feedback/toast>
- Action panel, primary and secondary actions:
  <https://developers.raycast.com/api-reference/user-interface/action-panel>;
  ⌘K *(indexed copy)*: <https://manual.raycast.com/action-panel>

**[R7] Audio tools**
- ElevenLabs Voice Library, save a voice with one click on **+**:
  <https://elevenlabs.io/docs/eleven-creative/voices/voice-library>
- ElevenLabs Studio:
  <https://elevenlabs.io/docs/eleven-creative/products/studio>
  - a contextual sidebar for the selected item;
  - per-paragraph regeneration;
  - generation history with "Restore generation";
  - undo and redo.
- Suno Simple and Custom modes, Extend:
  <https://suno.com/llms.txt>
- Suno Song Editor, replace a region and choose from alternates in an
  "Edits Library" panel: <https://help.suno.com/en/articles/6141505>
- Fish Audio voice creation and cloning *(indexed copies)*:
  <https://docs.fish.audio/features/voice-cloning>,
  <https://docs.fish.audio/overview/platform/create-voice/professional-voice-clone>

**[R8] Apple Human Interface Guidelines**
- Modality: "Present content modally only when there's a clear benefit",
  and avoid a modal that "feels like an app within your app":
  <https://developer.apple.com/design/human-interface-guidelines/modality>
- Alerts: "Avoid displaying alerts for common, undoable actions, even when
  they're destructive":
  <https://developer.apple.com/design/human-interface-guidelines/alerts>

**[R9] Nielsen Norman Group**
- Modal & Nonmodal Dialogs:
  <https://www.nngroup.com/articles/modal-nonmodal-dialog/>
- Confirmation Dialogs Can Prevent User Errors (If Not Overused):
  <https://www.nngroup.com/articles/confirmation-dialog/>
- User Control and Freedom, multi-level undo:
  <https://www.nngroup.com/articles/user-control-and-freedom/>
- Data tables, a nonmodal side panel for a single record:
  <https://www.nngroup.com/articles/data-tables/>

**[R10] Agent and AI interaction**
- Microsoft, Guidelines for Human-AI Interaction (G8 dismissal, G9
  correction) *(indexed copy)*:
  <https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/>
- Google PAIR, Feedback + Control:
  <https://pair.withgoogle.com/chapter/feedback-controls/>
- VS Code, review Copilot edits with Keep or Undo:
  <https://code.visualstudio.com/docs/copilot/chat/review-code-edits>
- GitHub, managing and tracking Copilot agents, session logs:
  <https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents>
- Linear, agent sessions and activities:
  <https://linear.app/developers/agent-interaction>
- Vercel AI SDK, tool approval (human in the loop):
  <https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage>

**[R11] Material Design** *(indexed copies)*
- M3 snackbar, "Undo" to let people amend a choice; don't auto-dismiss an
  actionable snackbar on the web without inline feedback:
  <https://m3.material.io/components/snackbar/guidelines>
- M2 snackbars: <https://m2.material.io/components/snackbars>

**Not verified, so not relied on above.** Gmail's in-place Undo link after
archive or delete has no official help page. Linear's full-page issue side
panel, Cursor's accept and reject UI, Fish Audio's in-app library flow, and
Material 3's dialog guidance couldn't be confirmed from official pages.
