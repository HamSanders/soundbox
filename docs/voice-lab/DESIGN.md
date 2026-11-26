# Voice Lab and comparing voices

Status: **A, shortlist tray, chosen 2026-11-23; building in steps.** Started 2026-11-23 from `main` at 295622b.

The brief: Voice Lab feels cluttered, worst on a phone, and comparing voices needs rethinking. This doc covers the Voice Lab screen (`app/src/routes/voice-lab.tsx`, `components/voice-library.tsx`, `components/voice-detail-panel.tsx`) and the `/voice/new*` pages. Navigation is out of scope: [`docs/device-nav/DESIGN.md`](../device-nav/DESIGN.md) on `design/device-nav` already chose adaptive tabs, which puts Voice Lab behind a Voices tab on phones and a rail item on tablets. The mockups assume that shell.

Files here:

- `mockups.html`: three directions, clickable, at phone (375), tablet (768) and desktop (1280) width, in Mirli's tokens. Silent: playback moves a playhead.
- `shots/`: today's Voice Lab in mock mode with the demo fixture (`VITE_MOCK=1 VITE_MOCK_FIXTURE=demo`, five voices).

## 1. What Voice Lab shows today

Top to bottom (`voice-lab.tsx:746-952`):

1. Title and a three-line explanation of what a voice is, with a link to the Script Builder.
2. **Import** and **Add voice** buttons.
3. Search box (from six voices up) and filter chips: All, Cloned, Built-in, then one chip per model family, labelled with the family id ("Kokoro_tts", "Audiocpp-pocket-tts").
4. **Your voices** shelf: up to eight cards, sorted by read count, scrolling sideways.
5. **All voices** table: avatar (plays a clone's reference clip), name and notes, kind, model, reads, **Try it**, and a ⋯ menu with Try it, Edit, Clips, History, Draw avatar, Export voice file, Delete.
6. **Compare voices** panel: a paragraph, a chip per voice to pick two to four (lettered A to D), a line, **Read it in N voices**, **Clear**, then one column per take with its own player.
7. **Convert a voice** panel (only when a voice-conversion model is installed): model, source sound and target voice pickers, a note, **Convert**.
8. Clicking a row opens the voice detail panel: header, Edit, Clips, ⋯, notes, reference clip, a **Try it** box with its own line and **Read it**, and the five most recent reads.

### Measured

Playwright in Chrome against the mock app, demo fixture, dark theme, touch on for phone and tablet. "Targets" counts visible buttons, links, inputs and menu triggers in the page.

| | Phone 375 | Tablet 768 | Desktop 1280 |
|---|---|---|---|
| Targets on the page | 43 | 48 | 48 |
| Under 44 px | 37 | 42 | 42 |
| Under 24 px | 6 | 6 | 6 |
| Targets with the detail panel open | 51 | 66 | 71 |
| Compare panel starts at (from the title) | 811 px | 741 px | 726 px |
| Compare panel height after a two-voice read | 608 px | 392 px | 392 px |

No horizontal scroll at any width. The under-24 targets are the voice names (about 20 px tall text buttons) and the Script Builder link. `/voice/new` is 8 targets and 1378 px tall on a phone (three stacked cards); `/voice/new/clone` 12; `/voice/new/builtin` 6.

### What makes it cluttered

- **Every voice appears three times.** With five voices, the shelf holds all five, the table holds all five and the compare chips hold all five. The shelf only adds something past eight voices, and on a phone it is a sideways strip cut off at the edge.
- **Compare is below the fold and disconnected.** It sits under the whole list (726 to 811 px down), and you pick voices for it from a second list of chips, not from the list above.
- **Each take has its own player.** Comparing means pressing play on A, then scrolling to B and pressing play again from the start. There is no way to flip between takes at the same point, and nothing happens once you've decided: no "this one".
- **Two test lines.** The detail panel's Try it and the compare panel each keep their own line, both defaulting to "The quick brown fox…".
- **Explanations everywhere.** The title paragraph, the compare paragraph and the convert note are written for a first visit and stay forever.
- **Filter chips use engine ids** ("Kokoro_tts"), and wrap to two rows on a phone.
- **Convert is a tool for a sound**, not a voice, parked at the bottom of a voice list.
- **Small targets.** 37 of 43 targets are under 44 px on a phone. Device-nav step 1 raises shared buttons on coarse pointers, which fixes part of this, but not the text-button names or the chips.

## 2. Research

Sources read by a research pass on 2026-11-23. Inference is marked.

**Voice libraries**

- ElevenLabs Voice Library: clicking a voice plays a sample in a player at the bottom of the page; two actions per voice, "Use voice" (try it in text to speech without saving) and "+" (save to My Voices); filters for language, accent (only after a language is picked), category, gender, age. https://elevenlabs.io/docs/eleven-creative/voices/voice-library.mdx
- ElevenLabs My Voices: a small icon per row says how the voice was made (professional clone, instant clone, none for Voice Design); a "T" button jumps to text to speech; everything else is in ⋯. Same page.
- ElevenLabs Voice Design generates three candidate voices from one prompt; you pick one and save it. https://elevenlabs.io/docs/eleven-creative/voices/voice-design.md . Voice Remix does the same from an existing voice. https://elevenlabs.io/docs/overview/capabilities/voice-remixing
- Murf: preview by the avatar or the card's play button; "Voice Auditioning" tries a voice on your own script. https://help.murf.ai/selecting-the-right-voice
- Cartesia's library has a featured mark, tag filters and a My Voices tab. https://docs.cartesia.ai/build-with-cartesia/capability-guides/choosing-a-voice.md
- None of these documents a side-by-side "compare voices" feature, and none documents its phone layout. Hume's voice design and PlayHT have shut down and were not usable references.

**A/B comparison in audio tools**

- Waves and FabFilter plugins: two state slots, A and B, a switch between them, and a copy from one to the other. https://www.manualsdir.com/manuals/221962/waves-api-550.html?page=16 , https://fabfilter.com/help/twin/using/undoredo
- ADPTR Metric AB: reference tracks locked to the timeline with seamless switching, and a level-match button so loudness doesn't decide. https://www.plugin-alliance.com/products/metric-ab
- foobar2000 ABX Comparator: an option to keep the playback position when switching, and loop points; some listeners turn keep-position off so each switch replays the same short section. https://www.head-fi.org/threads/abx-blind-testing-the-ins-outs.795020/ , https://foobar2000.org/components/view/foo_abx
- webMUSHRA listening tests: looping and sample-accurate switching. https://audiolabs-erlangen.com/resources/webMUSHRA
- TTS Arena: two anonymous voices read your text, you vote, then the names are revealed. https://huggingface.co/blog/arena-tts

**Phone players**

- Apple Music keeps a mini player at the bottom that opens Now Playing. https://support.apple.com/guide/apple-music-classical/glos61mrxxe2r/web
- Spotify puts Now Playing directly above the tab bar (cited in device-nav). https://support.spotify.com/article/now-playing/

**What this suggests (inference):** comparing is best done with one player and a switch, not N players; hearing a voice should take one tap from the list; "try" and "keep" are separate actions; and a phone wants one docked bar, not a panel at the bottom of a long page.

## 3. Matching the 0.6 redesign

A second look at the redesigned Library, Projects and Home (mock mode, light and dark, 1280 and 375) before building. The pages share a shape that Voice Lab did not follow, and step 1 follows it:

- **Header:** the title, a count line under it ("48 sounds", "0 projects"), the one ink action on the right. No paragraph.
- **Kinds as underlined tabs**, not pills: the Library's All, Music, SFX, Speech (`LibraryKindChips`). Voice Lab's All, Cloned, Built-in now use the same look.
- **One filter row:** search, then each filter as a small pill (`FilterMenu`, now shared in `components/filter-pills.tsx`). Voice Lab gets a Model pill naming models, not families.
- **Tiles** are the Home and Library shelf tiles (`ShelfTile`): square, `ProjectThumb`'s tint from the name, the name in the display face at the bottom, a log line under. A voice with drawn artwork shows it under a dusk scrim, the scrim the music hub uses for text on a picture.

## 4. Changes in every direction

These hold whichever direction is chosen:

1. **One set of voices, shown as a cast grid by default.** The "Your voices" shelf cards were the part that looked good, so they grow into the whole All view: square tiles drawn like the Home page's By-tag shelf (the `ProjectThumb` tint from the voice's name, the name in the display face, the kind as a pill, a play button for a clone's reference clip), with the model and notes under each tile. Sorted by most used, which is what the shelf was for. A grid/list switch beside the search box gives today's dense table for people with many voices. The voices are no longer drawn twice (shelf and table) or three times (plus the compare chips). Added 2026-11-23 after Anthony's feedback on the first draft; whether the switch is remembered per device is open.
2. **Header: title, New voice, ⋯.** Import moves into New voice, where the `/voice/new` hub already has an Import card. The explanation moves to the empty state, shown only when there are no voices.
3. **Filters: search, All, Cloned, Built-in, and one Model menu** that lists models by their display name. One row on a phone, scrolling sideways if needed.
4. **Tiles and rows open the details when tapped.** Rows keep avatar (plays the clip), name, notes, ⋯, with kind and model columns only at desktop width. The name stops being a separate 20 px text button. Grid columns: two on a phone, three on a tablet (two beside an open panel), five or more on desktop.
5. **Details: a bottom sheet on phone, the docked panel elsewhere**, as today. Edit, Clips and "Use in a script" as buttons, the rest in ⋯.
6. **One test line** shared by the detail panel and comparing, and a default line that sounds like a script rather than a typing test (the mockups use "The airlock opens at dawn. Bring the maps."; invented).
7. **Convert leaves the list.** It becomes "Change the voice of a sound…" in Voice Lab's ⋯ menu and on a Library sound's menu, next to the existing "Make a voice from this" (`sound-card.tsx:603`).
8. **`/voice/new` on a phone:** the three cards become compact rows so all three fit on one screen. Clone and Built-in pages stay as they are apart from device-nav's touch sizing. (Small; can ride along with whichever direction.)

## 5. Three directions for comparing

### A. Shortlist tray (recommended)

Each tile (or row) gets a round compare toggle in its corner. Ticking voices fills a tray, flush above the tab bar on a phone and at the foot of the list on larger screens, with the picked voices lettered A to D and a **Compare** button. Compare opens a sheet (phone) or the side panel (tablet, desktop): the line, **Read in N voices**, then the takes as rows, and **one transport** at the bottom with play, an A B C D switch, Keep place and Loop. Tapping a take or a letter switches what you hear. **Pick** marks the winner and offers "Use in a script".

- Compare happens where the voices are, with the same list you browse.
- One player and a switch is how plugin A/B and ABX tools compare.
- New parts: a tray, a compare sheet and a shared transport.

### B. Audition line

A sticky line sits above the list. Each row's play button reads that line in that voice, rendered on first play and cached. A mini player above the tab bar has previous and next, so stepping through voices on the same words is the comparison. Stars make a shortlist; a Starred chip narrows the list; "Play starred in turn" plays them back to back. No compare panel.

- Fewest new parts, and it feels like browsing music.
- Each switch restarts from the top; there is no same-place A/B.
- Every first play is a render, one at a time, so a long list is slow the first time through.

### C. Compare bench

Voice Lab gets two tabs, Voices and Compare. Voices is the plain list. Compare is a bench of two to four slots, the line, the same shared transport as A, and a **Blind** toggle that hides names and shuffles the order until you pick, as TTS Arena does.

- Most capable, and the bench survives leaving the page.
- Most UI, and a second level of tabs inside the Voices tab on a phone.
- Blind mode helps only when names bias you.

### How the shared transport behaves (A and C)

- Reads still run one after another, as today (`voice-lab.tsx:191-196`: parallel audio.cpp runs fight over VRAM). The first take is playable while the rest read.
- All takes share one seed, as today.
- **Keep place** (on by default): switching jumps to the same *fraction* of the new take, since two voices say the same line at different lengths. foobar's option keeps the absolute time; the fraction is invented here and needs listening to confirm. Off: each switch restarts the take.
- **Loop** repeats the current take.
- **Level matching** (Metric AB) is not in the mockups. Whether takes from different models already come out at similar loudness needs checking before deciding on it.
- **Pick** is invented as a closing step. Where it leads ("Use in a script" opens the Script Builder with that voice cast on the selected line, or just on the clipboard of voices) is open.

## 6. Build order (A)

Each step is its own PR to `main`, asked for before pushing.

1. **Declutter and cast grid.** Section 4 items 1 to 6: the cast grid with a list switch, header with ⋯, filters with a Model menu, simpler rows, empty-state explanation, a shared test line. **Built on `voice-lab/cast-grid`; see below.**
2. **Convert moves.** Section 4 item 7: a route or sheet for converting, reached from Voice Lab's ⋯ and the Library sound menu.
3. **Compare tray and sheet.** Row toggle, tray, compare sheet or panel reusing the existing queue in `ComparePanel`, the shared transport with A/B switch, Keep place, Loop and Pick.
4. **`/voice/new` on phone.** Compact hub rows.

Tests: mock-mode Playwright checks at 375, 768 and 1280 for targets and layout, in light and dark; unit tests for the queue and the switch logic. `npm run typecheck`, `npm run lint`, `npm test`.

### Step 1 as built

- `components/voice-library.tsx`: `VoiceTile` and `VoiceGrid` (two columns on a phone, 10rem tiles from there up), `VoiceKindTabs`, `VoiceViewSwitch`. The shelf card and the pill chips are gone. A row's name button stretches over the row, so the row is one target instead of a 20 px line.
- `lib/voice-lab-prefs.ts`: the grid or list choice and the test line, kept in this browser. The detail panel and Compare read the same line.
- `routes/voice-lab.tsx`: header with the count, **New voice** and ⋯ (Import a voice file); kind tabs; search (from six voices), Model pill, view switch; voices sorted by most used. Compare and Convert are unchanged until steps 2 and 3.
- The default test line stays "The quick brown fox…"; changing it is left for later.
- Checked with Playwright against the mock app (demo fixture) at 375, 768 and 1280, light and dark: targets on the page went from 43 to 28 on a phone, and none is under 24 px (was 6). Clicking a tile opens the details with the yellow ring; the list choice survives a reload. The demo fixture's clones have no reference clip, so the play button and artwork were checked with a temporary fixture edit that was not committed.
