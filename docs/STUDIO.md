# The studio

The studio turns clips into one piece of audio. It has a timeline with lanes, a
mixer, a device rack and an export. It works on a **story**: a saved document
whose clips have a place in time and keep it when they are regenerated.

There are two ways in:

- **Voice Studio → new story.** Write a script. A TTS model reads each line and
  the lines land on the timeline in order.
- **Any sound → "Open in the studio".** The clip is placed on a lane. If a
  separator is installed, pick the stems you want and each one gets its own
  lane.

Both make the same kind of document. You can add a spoken line to a story that
started as stems, or drag a music bed under a script.

<!-- screenshot: docs/images/studio-overview.png — the studio on a multi-track story: script on the left, timeline in the middle, library and sample panels on the right -->

## The layout

Three columns. Drag the divider between two columns to resize them.

| Column    | What lives there                               |
| --------- | ---------------------------------------------- |
| Left (⅕)  | The Script panel, the Prompt panel, or both    |
| Middle    | The Timeline, with the Device rack beneath it  |
| Right (⅕) | The Library, the Sample and the History panels |

The timeline has no close button. Close every other panel and it takes the
whole page. A column with no open panels is not rendered, so closing the script
leaves no gap; the timeline moves left into the space.

Below roughly tablet width the columns stack in order: left panels, timeline,
right panels. No panel is hidden.

Panels in a column share the remaining height by weight. Drag the divider
between two open panels to trade height between them, or focus it and use the
arrow keys. The chevron collapses a panel's body but keeps it mounted. The
timeline owns the audio graph, so collapsing it does not stop playback.

### Canvas layout

The columns are one way to arrange the studio. The other is a **canvas**: every
open panel is a card you can put anywhere and make any size. Switch with the
button beside **Panels** in the header, or under **Layout** in the Panels menu.
The choice applies to every story.

| Gesture                           | What it does                                   |
| --------------------------------- | ---------------------------------------------- |
| Drag a card's header              | Move it. Edges snap to a 16px grid             |
| Hold `Alt` while dragging         | Move or resize it without snapping             |
| Drag a card's right or bottom edge, or its corner | Resize it                      |
| Focus a header, then arrow keys   | Move it one grid step                          |
| `Shift` + arrow keys on a header  | Resize it one grid step                        |
| Click anywhere on a card          | Bring it to the front                          |
| Panels → **Tidy the canvas**      | Put every open card back in the column layout  |

The first time you open the canvas, it is laid out like the columns. A panel
you open later appears near the top left of what you are looking at. Positions
are remembered per builder in this browser, including for panels you close, so
a panel you reopen returns to where you left it. Cards keep their contents
mounted while you move them, so dragging the timeline does not stop playback.

### Panels in their own windows

Any panel can leave the studio for a window of its own. You can then put it on
another monitor, for example the mixer and the library on one screen and the
timeline on the other.

- **Drag it out.** Drag a panel's header past the edge of the browser window
  and let go. While the pointer is outside the window, the panel is
  highlighted and says *Release to open in a new window*. The new window opens
  where you let go, at the size the panel had. This works in both layouts.
- **Or press the pop-out button** (↗) in the panel's header.

A popped-out panel is the same panel, not a copy. It shares the studio's state,
so a clip you move in a popped-out timeline moves in the script beside the main
window too. Its menus open in its own window. Keyboard shortcuts pressed in it
work as they do in the main window: `Space` plays, `⌘/Ctrl + Z` undoes, and the
panel shortcuts toggle panels.

To put a panel back, press the button in its window's header, close the
window, or choose **Put every window back** from the Panels menu. Closing the
panel from anywhere (its X, its shortcut, the Panels menu) also closes its
window. Popped-out panels are marked ↗ in the Panels menu.

Pop-out windows do not survive a reload. Browsers only open windows in
response to a click or a drag, so when the studio reloads every panel comes
back into the page. In a browser, a pop-up blocker can refuse the window. If
it does, the studio says so: allow pop-ups for Soundbox and try again. The
desktop app opens them as native windows.

## The panels

Every panel is available in every story. Which ones start open depends on the
kind of story. This is decided once, when its clips first load, and is not
changed afterwards.

| Panel        | Shortcut     | What it is for                                                             | Open by default                         |
| ------------ | ------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| **Timeline** | —            | The arrangement. Always open, no close button                              | Always                                  |
| **Script**   | `⌘/Ctrl + R` | The lines, their voices and their delivery; write, edit, re-read           | Yes, unless the story is an arrangement |
| **Prompt**   | `⌘/Ctrl + P` | Describe a sound or a piece of music and drop the result onto this timeline | Only on a story with no clips yet       |
| **Library**  | `⌘/Ctrl + B` | Your sounds, to drag onto a lane                                           | Only on an arrangement                  |
| **Sample**   | `⌘/Ctrl + E` | The selected clip: waveform, stems, and what generated it                  | No; double-clicking a clip opens it     |
| **Devices**  | `⌘/Ctrl + F` | One track's insert chain                                                   | No                                      |
| **History**  | `⌘/Ctrl + I` | Every prompt you have run into this timeline, kept across reloads          | No                                      |
| **MIDI**     | `⌘/Ctrl + N` | Play or import notes, and render them onto a lane                          | No                                      |
| **Piano roll** | `⌘/Ctrl + O` | The same notes, as something you edit                                    | No                                      |
| **Logs**     | `⌘/Ctrl + G` | What the server was doing while this was made                              | No                                      |

You can open and close panels from three places, which always list the same
panels:

- the **Panels** menu in the header, which shows each shortcut beside its name.
  It is the only way to reopen a panel you closed with its X;
- the shortcuts above;
- the **command palette**, `⌘/Ctrl + K`. Type to filter by name, move with the
  arrow keys and press Enter to run. It lists panels only.

Script and Prompt can be open in the left column at the same time, so you can
narrate over a generated track or generate a bed under a script.

An "arrangement" is not a stored mode. A story counts as an arrangement when
every clip has audio and none has words. So music and SFX stories open with no
script and the library already open, and writing a line from the timeline's
right-click menu brings the script back.

Panel shortcuts avoid the letters the timeline already uses (`A C D M S V X Z`,
and `Y` for redo). Both sets of shortcuts listen on `window` and neither stops
the other, so a shared letter would fire twice. That is why Script, History and
Devices use `R`, `I` and `F` instead of `S`, `Y` and `D`.

## Working with clips

A **clip** is a segment on a lane: a start time, a length, and a window into the
sound behind it. Nothing you do on a timeline modifies the underlying audio file.

### Selecting

| Gesture                        | What it does                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| Click a clip                   | Select just that one                                         |
| Shift-click, or `⌘/Ctrl`-click | Add or remove one clip, keeping the rest                     |
| Drag across empty lane         | Rubber band. Shift or `⌘/Ctrl` adds to the existing selection |
| `⌘/Ctrl + A`                   | Select every clip                                            |
| `Escape`                       | Clear the selection, and disarm the scissors                 |

One clip in the selection is the **primary**. The Sample panel describes it and
the device rack shows its track. If you shift-click the primary out of the
selection, another selected clip becomes primary, so those panels stay filled
while any clip is selected.

The rubber band selects every clip it overlaps, including clips it only partly
covers. This lets you catch a long clip by crossing it.

A press on empty lane starts as a playhead scrub. It becomes a rubber band only
after the pointer moves about four pixels. Clicking empty track moves the
playhead and does not clear the selection. Use `Escape` to clear it. `Escape` is
handled by the lane area, not the window, so click in the timeline first.

### Moving

Drag a clip to move it in time and between lanes. Drag any clip in a
multi-selection and the whole selection moves together, keeping its spacing and
lane offsets. If part of the group would go past the start of the story or past
the last lane, the move is limited for the whole group, so the clips keep their
positions relative to each other and do not pile up at the edge.

Pressing on a clip that is already in a multi-selection keeps the selection, in
case you are starting a group drag. If you release without moving, only that
clip stays selected.

A group drag is **one** undo entry.

The script reads in timeline order. Moving a clip re-orders the script to match,
in the same frame the clip lands. The timeline order always wins.

#### Snapping

Dragged edges snap to other clips' starts and ends, the playhead, time zero, and
the two nearest ruler ticks. The tolerance is 8 pixels, so it is the same at
every zoom level. **Hold `Alt` to turn snapping off.**

Both ends of a dragged clip look for a target and the closer one wins, so you
can butt a clip against the clip before it or the clip after it with the same
gesture. A clip never snaps to itself or to other clips moving with it.

### Trimming

Drag either end of a clip. Clips narrower than about 24 pixels have no trim
handles, so you can always grab the middle to drag.

Trimming changes the window into the source; it does not cut the file. Dragging
the **start** moves both where the clip begins in time and where it begins in
the source, by the same amount, so the remaining audio stays in place. Dragging
the **end** is limited by how much source is left after the in-point. A pause
has no source, so it stretches freely. Lengthen a shortened clip to get the
trimmed audio back.

### Splitting

Three ways, all the same operation:

- Select a clip with the playhead inside it and press `S`, or click the scissors
  button.
- Click the scissors with the playhead *outside* the clip to arm them, then
  click a generated clip where you want it cut. `Escape` cancels.
- Right-click a clip → **Split at playhead**, or right-click a lane → **Split all
  at playhead**, which cuts every clip the playhead crosses and reports how many.

Only a clip that has audio can be split.

### Fades and crossfades

Every clip wider than about 36 pixels has a fade handle in each top corner, set
inside the trim strips so the two never overlap. Drag a handle inward to
lengthen the fade. The fade shape is drawn over the waveform so you can see how
far into the clip it reaches. Each fade is capped at half the clip, so the two
fades never cross.

**Overlapping clips on one lane crossfade automatically** across the overlap,
whether or not you set a fade. The crossfade is capped at the length of the
shorter clip, so a short clip dropped on a long one crossfades over its own
length. Without this, the overlap would sum to a bump in level and could click
at both edges.

Fades and crossfades use equal-power curves, which keep the level flat through a
crossfade (two summed linear ramps dip by 3 dB in the middle). The client and
the export use the same rule, so the mixdown matches what you hear while
arranging.

### Duplicating, deleting, copy and paste

`⌘/Ctrl + D` duplicates and `Delete` (or `Backspace`) deletes **everything
selected**. The toolbar's duplicate, mute and delete buttons act on the primary
clip only.

`⌘/Ctrl + C` copies the primary clip. `⌘/Ctrl + X` copies the primary and deletes
the whole selection. The clipboard holds one clip, because paste lands at the
single playhead. `⌘/Ctrl + V` pastes at the playhead, on the copied clip's own
track. A copied line carries its words, speaker and voice, so pasting a written
line that has not been voiced yet keeps its text and voice settings.

Right-click a lane → **Paste here** pastes where you clicked.

### Muting and looping

`M` mutes or unmutes the primary clip. Muted clips are left out of the export.

Shift-drag the ruler to mark a loop region. It snaps like everything else, and
`Alt` turns that off too. With no region marked, the loop button loops the
selected clip. Switching the loop off keeps the region: it is drawn solid while
looping is on and dashed while it is off, so you can play the rest of the story
and come back to the same marks.

### Zoom and the playhead

The mouse wheel zooms around the pointer, so the point under the cursor stays
put. `Shift` + wheel scrolls horizontally (the browser's own scroll). The
toolbar's zoom buttons step by 1.5× between 8 and 400 pixels per second. Click
or drag the ruler, or empty lane, to move the playhead.

### Right-click

On a clip: **Read this line / Regenerate** (only for a written line), **Split at
playhead**, **Split into stems…** (when a separator model is installed),
**Duplicate**, **Extend this track** and **Cover in a new style** (when the
clip's model supports them), **Repaint**, **Mute / Unmute**, **Delete**.

**Repaint** regenerates part of a clip's audio:

1. A dialog names the time window and asks what should be there instead (leave
   it empty to reroll with the clip's own description), a strength and a mode.
2. The window is the span marked on the ruler (shift-drag it), cut down to the
   clip you right-clicked. The menu item shows the seconds, for example
   *Repaint 1.8s–5.3s*. With nothing marked it is the whole clip.
3. The result goes back in the same place. The clip does not move and is not
   re-trimmed, and the audio outside the window is unchanged.

Undo restores the previous take. Both takes stay in the library either way.
Repaint needs a model that can repaint; ACE-Step is the only one today. The
waveform editor's toolbar has the same action, where you drag out the selection
by hand for a finer range.

On empty lane the menu is headed with the time and track you clicked: **Create
voice line**, **New recording**, **New prompt** (opens the Prompt panel and puts
the cursor in it), **Insert sample** (opens the Library), **Split all at
playhead**, **Paste here**, **Add track**.

<!-- screenshot: docs/images/studio-timeline.png — the timeline with a multi-selection ringed, a clip mid-fade, and the lane right-click menu open -->

## Tracks

Each lane has a head pinned to the left edge of the scroll area, so it stays
visible when you scroll into the middle of the piece.

| Control               | What it does                                                                           |
| --------------------- | -------------------------------------------------------------------------------------- |
| The number, in colour | The lane's index and its hue. Clips, head and rack all share it                         |
| The name              | Click to rename. `Enter` commits, `Escape` cancels; blank clears it back to "Track *n*" |
| **M**                 | Mute this track                                                                         |
| **S**                 | Solo this track                                                                         |
| The slider            | Track gain, −30 to +6 dB in 1 dB steps                                                  |
| The bin (on hover)    | Remove the track                                                                        |

**Solo overrides mute.** Once any track is soloed, only soloed tracks are
audible, even if they are also muted. A lane you will not hear is drawn at half
opacity.

There are eight lane colours spread around the hue circle. Hues near the app's
teal accent are left out so a lane never looks selected. Each new lane steps
half way round the circle, so lanes 0 and 1 are opposite colours. A ninth lane
repeats the first colour.

**Adding a track**: use the **Add track** row under the last lane, the lane
right-click menu, or drag a clip down onto the empty lane at the bottom.

**Removing a track removes its clips too** (the same rule as Audacity). You are
asked to confirm when the lane has clips, and not when it is empty. Undo does
not cover it.

**New audio always lands on a new track**, below all existing tracks. This
applies to a generated clip, a recording, and a drop onto a lane that already
has something there. Clips that share a lane and a time crossfade, so new audio
is kept off existing lanes to avoid changing your arrangement without you
asking. Drag it onto another lane if you want it there.

Dropping a sound from the Library lands it on the lane you aimed at, starting
where you let go. If something already occupies that span, it goes to the next
free lane.

Track name, mute, solo and gain are stored with the story, and the export
applies all four. Clip gain is stored too, but there is no timeline control for
it; set it over the API or from an agent.

## Recording

The record button captures from your microphone onto a **new track at the
playhead**. The playhead position is taken when you press record, so moving the
playhead during the take does not move it.

While recording you see an elapsed counter and a live input level meter. Check
the meter to confirm the microphone is picking you up.

The lane right-click menu has the same action as **New recording**. The take
still goes onto a new lane of its own.

The browser picks the container (WebM/Opus on Chrome and Firefox, MP4/AAC on
Safari). Soundbox decodes it, converts it to WAV, uploads it to your library as
`Take HH:MM`, and then places the clip. Takes must be library sounds because the
timeline references clips by id and the export reads them from disk.

If permission is denied, no microphone is found or the browser is unsupported,
the record button's tooltip says so. There is no dialog.

## MIDI

> **Experimental.** The panel works end to end, but a placed take is audio, not
> notes. See "What this costs" below before relying on it.

The **MIDI** panel (`Ctrl/⌘ + N`) sits under the timeline beside the rack. Play
a line, then press **Place on timeline** to render it and drop it on a new track
at the playhead, the same way a microphone take is placed.

There are three ways to play:

| Way | When |
| --- | ---- |
| A MIDI keyboard | Where the browser has Web MIDI. Chromium does; the macOS desktop build's WKWebView does not |
| The on-screen keyboard | Always. Click the keys, or focus it and use your computer keyboard |
| **Import** a `.mid` | To bring in an existing piece of music without playing it |

### Knobs, pads and the pedal

Use **Mapping**, at the right of the keyboard row, to make a controller's knobs,
pads, wheels and pedal do something. Unmapped controls are ignored.

It has three parts:

- **The monitor.** A live readout of the last message: port, message type
  (`CC 74`, `Note 36`, pitch bend), channel and value. Check it first when a
  control does nothing. It shows whether anything is arriving, which channel it
  is on, and whether the control is bound.
- **A layout.** A starting mapping for a whole controller, listed below.
- **Learn.** Press it on any row, then move the control you want to bind.
  Notes are not sounded while Learn is armed, so setting up a mapping does not
  add stray notes to your take.

| Layout | What it assumes |
| ------ | --------------- |
| **General MIDI** | Only the three controllers the spec fixes: mod wheel (CC 1), volume (CC 7), damper pedal (CC 64). Works on any board |
| **M-Vave SMK-25 / 25 II** | The above, plus the usual 8-pad default of notes 36-43 and a CC 21-24 knob bank |
| **Sustain pedal only** | Nothing but CC 64 |
| **Nothing mapped** | Keys and wheels; Learn the rest |

Apart from the pedal and the mod wheel, the presets are common defaults and may
not match your board. The M-Vave's pads and knobs can be reassigned in its own
editor app. Check the monitor, and use Learn on any control that does not
respond. Each control drives one target: binding a control that already drives
something moves the binding to the new target.

Eleven things can be bound: **Sustain** (hold), **Record**, **Preview**,
**Clear**, **Quantise**, **Octave ±**, **Place dry** and **Generate
instrument** (momentary), and **Cover strength** and **Roll tempo**
(continuous). Sustain works like a piano pedal: a key released while it is down
keeps ringing and keeps its timing, so a pedalled phrase records as held notes.

The mapping is stored per browser, not per story, because it describes your
hardware. It applies to every story and survives a reload.

> **Blocked, not denied.** If Chrome has a remembered block for the site,
> `requestMIDIAccess` is rejected immediately without a prompt, so the panel
> has no Retry button. Allow MIDI devices from the padlock menu in the address
> bar and reload. That is the only fix.

Notes are held while you play and drawn on a strip as they arrive. **Quantise**
snaps note starts to a grid in seconds (a take played without a click has no
bar lines). It is a button that edits the take, so the roll always shows what
will be rendered. It moves starts only and leaves note ends where you played
them.

### The piano roll

The **Piano roll** panel (`Ctrl/⌘ + O`) shows the same take for editing: a
keyboard down the left edge, pitch on the vertical axis, bars across the top.

| Gesture                  | What it does                                |
| ------------------------ | ------------------------------------------- |
| Drag on empty grid       | Draw a note; keep dragging to set its length |
| Drag a note              | Move it in time and pitch                   |
| Drag its right edge      | Change its length                           |
| Arrow keys               | Nudge the selected note; `Shift` for an octave or a bar |
| `Delete`, or right-click | Remove it                                   |
| Hold `Alt`               | Defeat snapping, as on the timeline          |

Editing a note plays it, so you hear the pitch while you drag.

The MIDI panel and the piano roll edit one take. Notes you play in the MIDI
panel appear in the roll, and edits in the roll are what gets rendered. The
roll's grid is in bars and beats and uses the tempo; the MIDI panel's recorder
works in seconds.

### The instrument is a second pass

No model in the catalogue takes notes as input. The panel renders the notes
with a plain synth, then a second pass applies the timbre you describe:

```
notes ──▶ [synth] ──▶ dry clip ──▶ [Cover, ACE-Step] ──▶ "solo violin, large hall"
```

The synth gets the pitch and timing exactly right, and the model is only asked
for timbre over audio whose notes are already correct. The cover is rendered at
the source's own length, so it lines up with the take.

**Generate instrument** does both steps in one press. It places the dry take and
submits a cover of it. The performance lands on one lane and the cover on the
next, so you can solo between them and re-cover the dry take if a prompt does
not work.

The cover clip is **trimmed to the take's length**. ACE-Step will not render
shorter than about five seconds, so a three-second phrase drawn in the roll
comes back at 5.12s whatever length is requested. Longer takes track closely:
7.70s covers to 7.68s. The extra is silence at the end, because the material
sits at the start of the render. The audio past the trim is still on disk; drag
the clip's right edge to get it back.

- **Keep the notes** is the cover strength. High keeps your synth line and
  changes its sound; low lets the model write its own notes.
- **Place dry** skips the model and places only the synth render.

These controls are at the bottom of **both** the MIDI panel and the piano roll,
so you can finish a take from either one: play it in and place it without
opening the roll, or draw it in the roll without touching the keyboard.

The four **Instrument** presets are bright and harmonically rich, because the
cover pass works better from a filtered sawtooth than from a sine. The render is
normalised to -3 dBFS, so the level the model receives does not depend on how
many notes overlap.

For room sound, use the **Reverb** device instead of the prompt. Asking the
model for a room smears the note attacks; the rack's reverb can be turned down.

**What this costs:** the story keeps the WAV, not the notes, so a placed take
cannot be edited as notes afterwards. Play it again instead. Clips are audio
everywhere else in the studio, and storing notes in a clip would need a change
to the story document.

## The device rack

The rack sits under the timeline and holds **one track's** inserts. Pick the
lane with the buttons in its header. Selecting a clip also points the rack at
that clip's track.

Devices are inserts, so they sit *before* the lane's fader; a gate hears the
take, not your monitoring level. A new device is added to the end of the chain.
The **Add device** menu lists devices roughly in the order they usually go in a
chain, so adding them top to bottom gives a sensible order. There is no
drag-to-reorder: the chain runs in the order you added the devices. Each device
can be bypassed without losing its settings.

Drag a dial up and down to change it (hold `Shift` for a four-times finer
sweep). Dials also work from the keyboard: arrows nudge by one step, `Shift` +
arrow by ten, `Home` and `End` jump to the ends. Wet/dry is a horizontal slider.

> **Devices are heard on the timeline; they are not baked into the export.** The
> mixdown applies clip gain, track gain, mute, solo, trims and fades, but no
> devices. Applying the rack on export would need a second implementation of all
> eight devices in the server's DSP. The rack shows this warning where you add a
> device.
>
Racks are stored with the story, on each track next to its name, mute, solo
and volume, so they reach every window and every machine that opens the story,
and an agent can change them over MCP (`soundbox.add_device`,
`soundbox.set_device`, `soundbox.remove_device`). An open studio shows an
agent's change as it lands. When a lane is removed, the racks above it move
down with their lanes. A rack saved in the browser by 0.4 is moved to the
story the first time the story is opened.

### The devices

Values are shown in the unit you would tune in, which is why several ranges
below are in milliseconds.

| Device                                                                      | Parameter | Range                   | Default   |
| --------------------------------------------------------------------------- | --------- | ----------------------- | --------- |
| **Gate**: shuts the track between phrases, so room tone does not build up    | Thresh    | −80 to 0 dB             | −45 dB    |
|                                                                             | Smooth    | 10 to 500 ms            | 60 ms     |
| **Autotune**: pulls a sung take onto the nearest note                        | Key       | C … B                   | C         |
|                                                                             | Scale     | Chromatic, Major, Minor | Chromatic |
|                                                                             | Retune    | 0 to 400 ms             | 80 ms     |
|                                                                             | Amount    | 0 to 1                  | 1         |
| **EQ**: three bands (low, mid, high)                                         | Low       | −24 to +12 dB           | 0 dB      |
|                                                                             | Mid       | −24 to +12 dB           | 0 dB      |
|                                                                             | High      | −24 to +12 dB           | 0 dB      |
|                                                                             | Lo × Mid  | 80 to 1000 Hz           | 400 Hz    |
|                                                                             | Mid × Hi  | 1000 to 10000 Hz        | 2500 Hz   |
| **Compressor**: evens out a take that swings between quiet and loud          | Thresh    | −60 to 0 dB             | −24 dB    |
|                                                                             | Ratio     | 1:1 to 20:1             | 4:1       |
|                                                                             | Attack    | 1 to 300 ms             | 6 ms      |
|                                                                             | Release   | 10 to 1000 ms           | 150 ms    |
| **Distortion**: from light grit to heavy                                     | Drive     | 0 to 1                  | 0.3       |
|                                                                             | Mix       | 0 to 1                  | 0.5       |
| **Delay**: repeats, fed back on themselves                                   | Time      | 10 to 1000 ms           | 250 ms    |
|                                                                             | Feedback  | 0 to 0.95               | 0.3       |
|                                                                             | Mix       | 0 to 1                  | 0.25      |
| **Reverb**: puts the line in a room                                          | Decay     | 0.1 to 10 s             | 1.8 s     |
|                                                                             | Pre       | 0 to 300 ms             | 20 ms     |
|                                                                             | Mix       | 0 to 1                  | 0.25      |
| **Limiter**: a ceiling the level does not go over                            | Ceiling   | −24 to 0 dB             | −1 dB     |

Defaults are set so a newly added device is audible without wrecking the take.

Notes on specific devices:

- **Limiter**: put it last in the chain. Anything after it can push the level
  past the ceiling.
- **Autotune** runs a pitch detector on the incoming signal sixty times a second
  and feeds the result to a pitch shifter. Its default scale is **Chromatic**,
  which contains every note, so it pulls a flat note onto the nearest semitone
  without imposing a key. Use it when you do not know the key. **Retune** sets
  how fast the correction happens. Long values follow the singer's own drift and
  sound natural; at the bottom of the range the note snaps into place on the
  attack, which gives the well-known hard-tuned effect.
- The pitch detector uses normalized autocorrelation and ignores weak or noisy
  frames. Unvoiced consonants such as "s" and "t" have no pitch, so the shifter
  is left alone when the detector has no answer. This stops it jumping on
  sibilants.
- **Reverb**: changing decay or pre-delay re-renders the impulse response. The
  audio updates when you stop dragging; the reading on the card updates while
  you drag.

Parameter changes are ramped onto the running audio graph, so you can turn a
knob while listening. Adding, removing or bypassing a device rebuilds only that
lane's chain and does not re-schedule any clips.

<!-- screenshot: docs/images/studio-devices.png — the device rack open under the timeline, showing a compressor and a reverb on a coloured lane -->

## Keyboard shortcuts

These shortcuts are bound to the window, so they work wherever focus is, with
two exceptions:

- **While you are typing in a text field, all of these shortcuts are off**, so
  `⌘/Ctrl + Z` in the script undoes your typing.
- `Escape` is handled by the lane area, not the window. Click in the timeline
  first.

### Panels

| Keys         | Action                   |
| ------------ | ------------------------ |
| `⌘/Ctrl + K` | Command palette          |
| `⌘/Ctrl + R` | Toggle the Script panel  |
| `⌘/Ctrl + P` | Toggle the Prompt panel  |
| `⌘/Ctrl + B` | Toggle the Library panel |
| `⌘/Ctrl + E` | Toggle the Sample panel  |
| `⌘/Ctrl + F` | Toggle the Devices panel |
| `⌘/Ctrl + I` | Toggle the History panel |
| `⌘/Ctrl + N` | Toggle the MIDI panel    |
| `⌘/Ctrl + O` | Toggle the Piano roll    |
| `⌘/Ctrl + G` | Toggle the Logs panel    |
| `⌘/Ctrl + L` | Toggle the Timeline      |

Holding `Alt` disables the panel shortcuts, so `Alt` combinations go to the
browser.

### Timeline

| Keys                         | Action                                                       |
| ---------------------------- | ------------------------------------------------------------ |
| `Space`                      | Play or stop                                                 |
| `⌘/Ctrl + Z`                 | Undo                                                         |
| `⌘/Ctrl + Y`, `⌘/Ctrl + ⇧ Z` | Redo                                                         |
| `⌘/Ctrl + A`                 | Select every clip                                            |
| `Escape`                     | Clear the selection; cancel an armed scissors                |
| `⌘/Ctrl + C`                 | Copy the primary clip                                        |
| `⌘/Ctrl + X`                 | Copy the primary clip, delete the whole selection            |
| `⌘/Ctrl + V`                 | Paste at the playhead, on the copied clip's track            |
| `⌘/Ctrl + D`                 | Duplicate the whole selection                                |
| `Delete`, `Backspace`        | Delete the whole selection                                   |
| `M`                          | Mute or unmute the primary clip                              |
| `S`                          | Split the primary clip at the playhead, when it is inside it |
| `Alt` (held while dragging)  | Defeat snapping                                              |
| `Shift` + drag the ruler     | Mark a loop region                                           |
| `Shift` + click a clip       | Add or remove it from the selection                          |
| Wheel                        | Zoom about the pointer                                       |
| `Shift` + wheel              | Scroll horizontally                                          |

While an agent holds the story, undo, redo, playing and selecting still work.
Every other editing action is paused.

When an agent rewrites the story, the **undo stack is cleared**, because the
recorded undo steps may refer to clips that have moved or changed.

## Generating into the timeline

The **Prompt panel** (`⌘/Ctrl + P`) is the same request form the Music studio
uses, with the submit button labelled **Generate & insert**. Describe a sound or
a piece of music, pick a model, and the result lands on this timeline instead
of in a shelf.

Where it lands:

- **In time**: at the playhead if the story is playing, otherwise at the start of
  the selected clip, otherwise at zero.
- **On which lane**: the lane the device rack is pointed at, which follows your
  selection.

If the request asked for the take to be **separated**, all the stems come back
as one take and each stem gets its own lane, stacked above the highest lane in
use. **Variations** are alternatives, so only the first is inserted; the rest
stay in the shelf for you to drag in.

Every attempt (running, done or failed) is recorded in the **History** panel
(`⌘/Ctrl + I`). History is per story and survives a reload. It is a separate
panel so the Prompt panel does not get shorter each time you generate.

See [Generating](./GENERATING.md) for prompt technique and what each model
wants.

## Driving the studio with words

An instruction bar runs along the bottom of the whole studio. Type what you want
done and press `Enter` (`Shift + Enter` for a newline). Use it for edits that
would take many clicks, such as "name all of the tracks".

**It shows you the plan before running it.** Each edit is listed in plain
terms: clips by their words or their sound's name, tracks by number and name.
Destructive edits are marked. **Apply** runs the plan, **Discard** throws it
away.

The bar uses the local prompt assistant, which is **off by default**. With
nothing configured, the bar says so.

### What works

The request is classified first, then planned by a separate step for its type.
Roughly:

- **Editing what is already there**: "mute 1 and 3", "rename the tracks", "move
  the vocal to the cursor", "delete the last clip", "put a delay on the drums",
  "drop track 2 by 6 dB".
- **Making something new for this timeline**: "add some drums", "put rain under
  this", "add a bassline on track 2". This goes through the Prompt panel's own
  submit path, so the take arrives the same way a typed prompt's would and
  appears in the History beside it.
- **Describing a whole finished piece** with no reference to this timeline: "a
  hardcore instrumental where distorted guitars thrash over a double-kick kit".
  This is sent to the Prompt panel.
- **Working the interface**: "show the library", "open the script", "start
  recording".

References are matched by meaning: "the vocals" finds the track holding a clip
labelled *breathy female vocal hook*. Track numbers are literal: "mute 1 and 3"
means tracks 1 and 3, never positions in a list. "Here" and "at the cursor" mean
the playhead; "these" and "the selected ones" mean your selection. Nothing has
to be selected.

### The action vocabulary

The assistant does not run anything itself and can only refer to clips and
tracks it was sent. It returns a list of actions. The page applies each one
through the same handler a click uses, so assistant edits update the page
immediately and **go on the undo stack like manual ones**.

| Action                         | What it does                                       |
| ------------------------------ | -------------------------------------------------- |
| `rename_track`                 | Give a track a name                                |
| `set_track`                    | Mute, solo, or set a track's gain                  |
| `move_clip`                    | Move a clip in time, onto another track, or both   |
| `set_clip`                     | Mute a clip, or rewrite its words                  |
| `delete_clip`                  | Remove a clip. The one action flagged destructive  |
| `add_clip`                     | Write a new line onto a track at a time            |
| `add_device` / `remove_device` | Put a device on a track's rack, or take one off    |
| `generate_clip`                | Generate audio from a prompt and place it          |
| `show_panel`                   | Open or close a panel                              |
| `start_recording`              | Start a take                                       |

Every action that names a clip id or a track index is checked against the
timeline that was sent. Actions that refer to something that does not exist are
dropped before you see the plan, and the bar tells you how many were dropped.
Device kinds are checked against the eight the rack can build.

This part of the studio is under active development. Rely on the actions above,
not on any particular phrasing.

## Export

**Export** mixes the arrangement down to one file in your library:

- Clips are placed at their real start times; gaps stay silent.
- Clips on different lanes sum, with crossfades applied where clips overlap on a
  lane.
- Clip gain and track gain both apply; muted clips and un-soloed tracks are left
  out.
- Trims are applied, so a shortened clip is short in the file too.
- Devices are **not** applied. See the rack, above.

The result is a normal sound. It appears in your library with the story's title
and can be dropped onto another timeline.

## For agents (MCP)

An agent connected over [MCP](./MCP.md) can build and edit a story without the
page being open. While an agent is working, the studio shows a notice and pauses
editing; the work usually takes seconds. The agent's changes stream into the
open page as they happen, so you do not need to refresh.

The studio-relevant tools:

| Tool                      | What it does                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| `soundbox.create_story`   | Start a story. Sets the default delivery for every line            |
| `soundbox.list_stories`   | Stories, most recently worked on first                             |
| `soundbox.get_story`      | Every line: text, voice, timing, and whether it has been voiced    |
| `soundbox.add_lines`      | Append lines: spoken lines, pauses, or existing library sounds     |
| `soundbox.update_line`    | Words, voice, delivery, start, track, gain, mute, and trim         |
| `soundbox.delete_line`    | Remove one line. Its audio stays in the library                    |
| `soundbox.split_line`     | Cut a voiced line at a point in its own audio                      |
| `soundbox.speak_story`    | Read every line that has no audio yet. This is the slow one        |
| `soundbox.open_in_studio` | Put a library sound on a timeline, split into stems where possible |
| `soundbox.mix_track`      | Name, mute, solo or set the level of one lane                      |
| `soundbox.add_device`     | Put a device on a lane's rack, optionally with its knobs set        |
| `soundbox.set_device`     | Turn a device's knobs, or bypass it                                |
| `soundbox.remove_device`  | Take a device off a lane's rack                                    |
| `soundbox.remove_track`   | Delete a lane and the clips on it. Lanes above slide down          |
| `soundbox.export_story`   | Mix the arrangement down to one sound                              |

Changing a line's words or delivery does not re-read it. Voice the line again to
hear the change.

Splitting a voiced line keeps all the words on the first half, because there is
no reliable way to tell which words fall on each side of the cut.

An agent can change the same track properties the export applies: name, mute,
solo and gain. There is no MCP tool for the device rack, because the export
ignores it.

The studio runs on an ordinary HTTP API: `/api/stories`, its `/tracks` and
`/segments`, and `/export`. See [the API reference](./API.md) to call it
directly.
