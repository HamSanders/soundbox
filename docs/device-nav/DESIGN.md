# Mirli navigation per device class

Status: **model A chosen 2026-11-23; building in steps.** Started 2026-11-23 on branch `design/device-nav`, from `main` at 295622b (after the visual redesign).

The question: Mirli now also runs as a browser studio, so people will open it from a phone, an iPad or a desktop. How should navigation and menus work on each? The visual style stays as it is; this is about structure, menus and touch.

Files here:

- `mockups.html`: three clickable navigation models at phone, tablet and desktop size.
- `shots/`: a few screenshots of today's app (mock mode, `npm run dev:mock`). The full set of 68 at four sizes is outside the repo.
- `measurements.json`: per-route numbers behind the tables below.

## 1. What today's app does at each size (measured)

Measured with Playwright in Chrome against the mock app, with touch emulation on for phone and tablet. "Targets" counts every visible button, link, input, tab, slider and menu item. 44 px is Apple's default control size and WCAG 2.5.5; 24 px is WCAG 2.5.8's AA floor.

| Route | Phone 375: targets / under 44 / under 24 | Tablet 768: targets / under 44 / under 24 | Notes |
|---|---|---|---|
| `/dashboard` | 52 / 37 / 8 | 67 / 52 / 9 | Fits. Row actions (folder, ⋯) are about 28 px. |
| `/chat` | 4 / 4 / 0 | 19 / 19 / 1 | |
| `/console` | 37 / 24 / 4 | 52 / 39 / 5 | Stacks below `lg`. Knobs are pointer-drag. |
| `/studio` | 9 / 7 / 0 | 24 / 22 / 1 | |
| `/studio/script/:id` | 57 / **57** / 12 | 80 / **80** / 20 | Phone: panels stack, Library panel squeezed to about 70 px wide, timeline header wraps the time onto three lines. 13 controls sit past the right edge. |
| `/studio/music/:id` | 58 / **58** / 17 | 73 / 72 / 15 | Tablet: Prompt panel squeezed to about 140 px, model name cut to "Stab", quantity stepper clipped. |
| `/voice/lab` | 25 / 22 / 3 | 42 / 39 / 4 | |
| `/library` | 44 / **44** / 9 | 59 / 59 / 10 | List itself reads well on a phone. |
| `/library/sfx` | 51 / 50 / 8 | 69 / 60 / 9 | Inline composer docks at the bottom on phone; works. |
| `/models` | 38 / 27 / 0 | 53 / 42 / 1 | Reads fine; it is the local download manager. |
| `/agents` | 14 / 14 / 6 | 29 / 29 / 7 | |
| `/activity` | 13 / 12 / 6 | 28 / 28 / 7 | |
| `/settings` | 40 / **40** / 9 | 55 / 55 / 10 | Section nav only from `lg`. |
| Sidebar sheet (phone) | 66 / 48 / 8 | n/a | 18rem slide-in sheet; rows about 36 px. |

No page scrolls sideways at 375 px; the shell's `min-w-0` work holds. The problems are target size, the studio layout, and gestures.

Screenshots kept in the repo: `shots/phone-dashboard.png`, `phone-sidebar-open.png`, `phone-library-sfx.png`, `phone-studio-script.png`, `phone-studio-music.png`, `tablet-dashboard.png`, `tablet-studio-music.png`.

### Navigation inventory (from the code)

- **Routes** (`app/src/App.tsx:179-230`): one flat HashRouter. `/dashboard`, `/chat`, `/console`, `/studio`, `/studio/script/:id`, `/studio/music/:id`, `/voice/lab`, `/voice/new`, `/voice/new/clone`, `/voice/new/builtin`, `/create` (redirect), `/library`, `/library/sfx`, `/library/music`, `/library/speech`, `/projects`, `/sounds/:id`, `/models`, `/agents`, `/activity`, `/settings`; unknown paths go to `/dashboard`.
- **Sidebar** (`components/app-sidebar.tsx`): Create, Library; group "Studio": Studio, Voice Lab, Projects, Models, Agents; Recent sessions; Settings, Activity; footer: About, update notice, theme, GPU status, profile switcher. Folds to an icon rail with Mod+B, folds itself on `/studio/*`, `/voice/lab`, `/library/music`. Below 768 px it is an 18rem sheet (`components/ui/sidebar.tsx:181`).
- **Header** (`app-header.tsx`): sidebar toggle, back/forward, breadcrumb, a slot the studio fills (Export, layout, Panels, ⋯), job queue. No responsive behaviour.
- **Only breakpoint in the shell is `md` (768 px)**, via `useIsMobile`. No `pointer: coarse` or `hover: none` anywhere. So a 744 px iPad mini in portrait gets the phone layout and a 768 px iPad gets the desktop layout with 28 px buttons.
- **Below `md` today:** Create panel hides (library pages use their inline composer), detail panels become full-screen overlays, the player drops to a play button and a thin scrubber.
- **Right-click only:** timeline clip menu (10 actions: Split, Stems, Extend, Cover, Repaint, Mute, Delete…, `story-timeline.tsx:2598-2680`), empty-lane menu (New recording, Import, Paste here, Add track, `:2805-2856`), piano-roll note delete (`piano-roll.tsx:479`).
- **Hover-only controls:** five size-6 buttons in the script editor (`story-script.tsx:581-862`), Delete project (`projects.tsx:133`), Remove track (`story-timeline.tsx:3063`), tile play overlays (`sound-card.tsx:756`, `voice-library.tsx:123`).
- **Modifier gestures with no touch equivalent:** Shift-drag on the ruler (loop), Shift-drag on a clip (repaint window), Shift/Mod-click (multi-select), Alt-drag (no snap), Ctrl+wheel (zoom).
- **Keyboard shortcuts:** Mod+K palette, Mod+B sidebar (collides with the studio Library panel's Mod+B), studio panel letters, Space, undo/redo, clip editing keys, `?` cheat sheet. Full table in the session notes inventory.
- **Drag and drop:** HTML5 DnD for library-row → timeline lane and for the voice-clone file drop. iOS Safari has supported HTML5 DnD since 15, but it is choppy and long-press conflicts with scrolling, so it needs a tap alternative. Everything else (clips, piano roll, panel canvas, knobs, faders) uses pointer events; the clip body lacks `touch-none`, so a touch drag on a clip scrolls instead. Fade handles are 8 px, trim edges 6 px.
- **There is no drag-out to a DAW on main.** The only drag-out opens a studio panel in its own window (`hooks/use-drag-out.ts`).
- **Smallest common sizes:** the shared `Button` tops out at 36 px and the usual icon button is 28 px (`components/ui/button.tsx:27-37`).

## 2. Feature-by-device matrix

How the studio is reached:

- **Desktop app**: Tauri window, local server, audio.cpp on the local GPU.
- **Browser studio**: one server per user built from `Dockerfile.hosted`. That file and the `MIRLI_HOSTED` / `useHosted()` flag live on the unmerged `claude/mirli-cloud-client` branch, not on `main`. `main` already hides host features through `/api/capabilities` and `useCan()` (`server/src/capabilities.ts`; `MIRLI_SANDBOXED=1` turns every host capability off), and the cloud branch gates mostly the same lines, so the two will conflict on merge. The matrix assumes the browser studio runs sandboxed.
- Phone and tablet only ever see the browser studio.

Legend: **works**, **rework** (exists but needs a touch or size change), **no** (cannot exist there), **n/a**.

### Cannot exist in the browser studio (any device)

| Feature | Desktop app | Browser, desktop | Tablet | Phone | Why, and where in the code |
|---|---|---|---|---|---|
| Download and load local models (audio.cpp) | works | no | no | no | Weights go on the server's disk and run on its GPU. Capabilities `downloads`, `local_models`; `routes/models.tsx:327-470`, `model-shared.tsx:168-189`. In the browser studio the Models page becomes a list of cloud models. |
| Model packs, VRAM filter "Fits my GPU" | works | no | no | no | Same; `routes/models.tsx:439`. |
| GPU and VRAM readout | works | no | no | no | Server runs `nvidia-smi` (`server/src/gpu.ts:70-82`); capability `gpu_status`; sidebar `DeviceStatus`. |
| Folder picker, profile data paths, new profile folders | works | no | no | no | Browses the server's disk (`folder-picker.tsx`, `server/src/routes/fs.ts:81`); capability `filesystem`. |
| Open in Finder / Explorer | works | no | no | no | Server spawns `explorer /select` or `open -R` (`server/src/routes/sounds.ts:24-30`); capability `reveal`. Replace with Download. |
| Local MCP server (stdio command, `claude mcp add` for localhost) | works | no | no | no | `server/src/mcp/stdio.ts`, `routes/agents.tsx:101-107`; capability `agent_connect`. The browser studio has the gateway's remote MCP link with OAuth instead, which works from any device's agent. |
| Install agent skills into a client folder | works | no | no | no | Writes to this machine's disk; capability `skills_install`. |
| Server log tail | works | no | no | no | Names host paths and hardware; capability `logs`. |
| Custom endpoints | works | no | no | no | A hosted server must not fetch any URL a page gives it; capability `custom_endpoints`. |
| Update check and notice | works | no | no | no | The server image is updated for the user; capability `updates`. |
| Backend health / restart | works | no | no | no | Tauri-only (`lib/desktop.ts`, `routes/activity.tsx:100`). |
| Native pop-out window close | works | n/a | n/a | n/a | Tauri-only (`lib/popout.ts:67`). Browser pop-outs below. |

### Device limits inside the browser studio

| Feature | Desktop app | Browser, desktop | Tablet | Phone | Why |
|---|---|---|---|---|---|
| Sidebar navigation | works | works | rework | rework | Phone: 18rem sheet, 36 px rows. Tablet: desktop sidebar at 768 px with 28 px targets. |
| Context menus (timeline clip, empty lane, piano-roll note) | works | works | rework | rework | Right-click only. Need a visible ⋯ or selection toolbar, plus long-press. |
| Dropdown menus (sound card, library, studio, player, profile) | works | works | rework | rework | Work by tap, but items are about 32 px. Become bottom sheets on touch. |
| Hover-only row controls | works | works | rework | rework | Invisible without hover; show them under `(hover: none)`. |
| Keyboard shortcuts, Mod+K palette | works | works | works with keyboard | n/a | iPad with a keyboard gets them; touch needs visible buttons for each (the palette still helps). |
| Modifier gestures (loop, repaint window, multi-select, no-snap, zoom) | works | works | rework | rework | Need explicit modes or toolbar toggles; zoom becomes pinch. |
| Library → timeline drag | works | works | rework | rework | HTML5 DnD. Add "Add to timeline at playhead" on tap. |
| Clip move and trim | works | works | rework | rework | Pointer events already; clip body needs `touch-none`, handles need 44 px hit areas. |
| Multitrack timeline editing | works | works | rework | rework (or cut, see model C) | 168 px fixed gutter and 64 px lanes; at 375 px about 200 px is left for time. GarageBand and BandLab do it on phones with a hidden track header and a track focus view. |
| Piano roll | works | works | rework | no (proposed) | 14 px note rows; not usable with a finger at phone size. |
| Device rack, console knobs and faders | works | works | rework | rework | Pointer drag works on touch already; 24 to 28 px controls. |
| Panel canvas (free placement, splitters, pop-out) | works | works | rework | no | Free-placement canvas has no narrow fallback. Phone gets one panel at a time. |
| Pop-out panels into their own window | works | works | no | no | `window.open` windows don't exist on iPadOS or phone browsers in a useful way. |
| Microphone recording (voice clips, new recording) | works | works | works | works | `getUserMedia`; needs HTTPS, which the hosted studio has. |
| Voice-clone file drop | works | works | rework | rework | Drop zone; the file input button already exists beside it, make it the primary on touch. |
| Web MIDI input and mapping | works | works (Chrome, Edge) | no on iPad | no on iPhone; Android Chrome only | Safari has no Web MIDI. |
| Output device picker | works | works (Chrome, Edge) | no | no | `setSinkId` support in iOS Safari not yet checked; assume no until tested. |
| Sound and voice detail panels | works | works | works | works | Already full-screen overlays below `md`. |
| Settings section nav | works | works | rework | rework | Only from `lg`; below that it is one long page. |
| Generate (composer, create panel) | works | works | works | works | Phone already uses the inline composer. |
| Library, playback, favourites, tags | works | works | works | works | Targets need to grow. |
| Export and download | works | works | works | works | Downloads go to the browser's Files location. |

## 3. Research (cited)

Full notes with every source: session notes `device-nav-research.md`. The points that shaped the proposals:

- **Touch targets.** Apple: 44 × 44 pt default, 28 × 28 pt minimum (https://developer.apple.com/design/human-interface-guidelines/accessibility). Android: 48 × 48 dp (https://developer.android.com/guide/topics/ui/accessibility/apps). WCAG 2.2: 24 px at AA, 44 px at AAA (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html, https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).
- **Size classes, not devices.** Lay out by window size class; keep what the app can do constant and change only how much is visible (https://developer.apple.com/design/human-interface-guidelines/layout). Android width classes: compact under 600, medium 600 to 839, expanded 840 to 1199, large 1200 and up (https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes).
- **Bar, rail, sidebar.** Android's default: bottom bar when compact, rail otherwise (https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation). Apple: tab bar for top-level sections, about five or fewer; on iPad the tab bar sits at the top and can turn into a sidebar (https://developer.apple.com/design/human-interface-guidelines/tab-bars). Material 3 Expressive moved away from the navigation drawer toward an expandable rail (press report: https://9to5google.com/2025/05/14/material-3-expressive-navigation/).
- **Sheets and context menus.** Medium detent for progressive disclosure, full-screen modal for complex editing (https://developer.apple.com/design/human-interface-guidelines/sheets). Context menus open by touch-and-hold and are hidden, so every item must exist elsewhere too (https://developer.apple.com/design/human-interface-guidelines/context-menus).
- **Canonical layouts.** List-detail and supporting pane; Google's supporting-pane example is media-editing tool palettes, below the content or in a bottom sheet when compact (https://developer.android.com/guide/topics/large-screens/large-screen-canonical-layouts).
- **Web specifics.** `(pointer: coarse)` and `any-pointer` (https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer); `env(safe-area-inset-bottom)` for bottom bars (https://developer.mozilla.org/en-US/docs/Web/CSS/env); `svh` / `dvh` instead of `100vh` (https://web.dev/blog/viewport-units); HTML5 DnD on iOS Safari from 15 (https://caniuse.com/dragndrop).
- **Mini player with tab bar.** Spotify puts Now Playing directly above the menu bar (https://support.spotify.com/article/now-playing/); keep the two flush, since a gap passes taps through (https://community.spotify.com/t5/Android/There-is-a-clickable-area-in-a-gap-between-the-bottom-three/td-p/5435817).
- **Creative apps that cut on phone.** Figma's mobile app cannot edit design files; it views, comments and presents (https://help.figma.com/hc/en-us/articles/1500007537281). Ableton Note sketches and hands off to Live (https://www.ableton.com/en/blog/introducing-note-an-ios-app-for-sketching-musical-ideas). The ElevenLabs app covers core text to speech (https://elevenlabs.io/blog/introducing-the-elevenlabs-app).
- **Creative apps that keep the editor on phone.** BandLab: Mix View then a focused Track View, long-press with a visible ⋯ equivalent (https://blog.bandlab.com/studio-faq/). GarageBand hides track headers on iPhone and iPad and reveals them by dragging (https://support.apple.com/guide/garageband-iphone/chsb34b9a7c/ios). Premiere on iPhone: labelled bottom toolbar with progressive disclosure (https://adobe.design/ideas/behind-the-design-adobe-premiere-on-ios).
- **Suno and Notion.** Suno on iOS: Create is a centre bottom button with Library beside it (https://help.suno.com/en/articles/3726849). Notion mobile: a bottom bar of Home, Search, Inbox, New page, with the desktop sidebar's contents inside Home (https://www.notion.com/help/workspaces-on-mobile).

## 4. Proposed navigation models

All three keep today's desktop sidebar and studio unchanged at expanded width, and share these rules:

1. Touch sizing by input, not width: `(pointer: coarse)` raises icon buttons, rows and menu items to 44 px.
2. Menus become bottom sheets on touch; each opened by a visible ⋯ and by long-press. Right-click-only menus get a visible equivalent.
3. Hover-only controls show under `(hover: none)`.
4. Features from section 2's first table stay listed but say "Desktop app" with a reason, instead of vanishing silently.
5. The mini player sits flush above the bottom bar.
6. Breakpoints move to the Android classes: under 600 compact, 600 to 839 medium, 840 and up expanded (desktop sidebar).

**A. Adaptive tabs.** Phone: bottom tab bar Home, Library, Create (centre), Studio, Voices; Projects, Models, Agents, Activity and Settings behind a profile button ("You"). Tablet: a labelled rail with the same items. Desktop: today. Studio on phone: a track-focus timeline with a selection toolbar at the bottom and Script / Library / Mixer as sheets; on tablet the side panels become a supporting pane (bottom sheet in portrait, side column in landscape).

**B. One composer.** Phone and tablet keep a composer docked at the bottom (kind chips: SFX, Music, Speech) and make the library the home feed; everything else lives in a drawer. Tablet becomes list-detail. Studio as in A.

**C. Phone companion.** Phone: three tabs, Make, Library and Queue. Studio projects open as listen, export and redo-a-line, with "Continue on a larger screen". Tablet and up: the full studio, with an iPad-style top tab bar that can expand into the sidebar.

**Chosen: A, adaptive tabs** (2026-11-23). Arranging on a phone is in scope through the track-focus timeline; the piano roll stays tablet and up.

## 5. Build order (model A)

Each step is its own PR to `main`, small enough to review, and none changes the desktop layout at expanded width.

1. **Touch foundations.** `(pointer: coarse)` raises the shared `Button` icon and small sizes, dropdown and context-menu items and sidebar rows to 44 px. `(hover: none)` shows hover-only controls (script editor line tools, Delete project, Remove track, tile play overlays). Timeline clips, empty lanes and piano-roll notes get a visible ⋯ that opens the same menu the right-click does. The clip body gets `touch-none` so a touch drag moves the clip instead of scrolling. The timeline's own clip and lane menus already open as a bottom sheet on touch, because the phone timeline panel is too short for a popup. **Built on this branch; see below.**
2. **Size classes and the shell.** A `useSizeClass()` hook (compact under 600, medium 600 to 839, expanded 840 and up) replaces the single `md` switch in the shell. Compact gets the bottom tab bar (Home, Library, Create, Studio, Voices) with safe-area padding and the mini player flush above it; "You" opens a sheet with Projects, Models, Agents, Activity, Settings and the profile. Medium gets a labelled rail. Expanded keeps today's sidebar.
3. **Menus as bottom sheets on touch.** Dropdowns and context menus render as a bottom sheet when the pointer is coarse; long-press opens the same sheet as right-click.
4. **"Desktop app" labels.** Where `useCan()` hides a host feature, show it greyed with a one-line reason instead of removing it, on every device.
5. **Studio on tablet.** The side panels become a supporting pane: a bottom sheet in portrait, a side column in landscape. Pop-out is hidden on touch devices.
6. **Studio on phone.** Track-focus timeline (hidden track headers, one lane tall), a selection toolbar at the bottom for the clip menu's actions, toolbar toggles for loop, repaint window, multi-select and snap, pinch to zoom, and "Add at playhead" from the library instead of drag. Script, Library and Mixer open as sheets.
7. **Settings and the rest.** Settings section nav as a list-then-detail on compact; voice-clone file picker primary on touch; check `setSinkId` on iOS Safari and hide the output picker if it is missing.

The hosted-mode branch (`claude/mirli-cloud-client`) needs its gating reconciled with `useCan()` before step 4 lands, or the two will conflict.

### Step 1 as built

- `app/src/index.css`: a `no-hover` variant, and under `(pointer: coarse)` an invisible 44 px hit area on every shared `Button` (drawn size unchanged), 44 px dropdown, select and sidebar rows.
- Hover-only controls shown under `(hover: none)`: script line tools, Remove track, Delete project, the sidebar row action. The tile play overlays already catch a tap while invisible, so they are left alone.
- Timeline: `touch-none` on clips; a ⋯ on the selected clip and on each track header (touch only) opening the existing clip and lane menus; both menus become a bottom sheet on touch. Piano roll: a Delete note button on touch.
- Checked in Chrome with Playwright touch emulation at 375 × 812 and 1024 × 768, and without touch at 1280 × 800: hit areas measure 44 px on touch and are absent on desktop; the ⋯ buttons appear only on touch; menu rows measure 44 px.


### Step 2, first part, as built

- `app/src/components/mobile-tab-bar.tsx`: below 768 px a bottom bar of Home, Library, Create (centre, filled), Studio and Voices. Projects, Models, Agents, Settings and Activity stay in the menu behind the header's button for now; a dedicated "You" sheet is still to come.
- `--tabbar-h` in `index.css` (56 px plus the bottom safe area on phones, 0 elsewhere). The shell's bottom padding, the full-bleed studio height, the player, the three detail panels and the library's pinned composer all add it, so nothing sits under the bar and the player sits flush on top of it.
- Checked in the browser pane at 375 × 812: the bar is laid out in five columns, the Music library composer and the player end at the bar's top edge, and the Music Builder page ends at the player. At desktop width the bar is hidden and `--tabbar-h` is 0.
- Not yet: the labelled rail for 600 to 839 px, and moving the shell's switch from 768 px to the Android size classes. Today 600 to 767 px also gets the bottom bar.
