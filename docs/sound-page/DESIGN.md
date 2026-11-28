# The sound page

How `/sounds/:id` is laid out, and why. The page is modelled on the song pages
people already know, so the layout below is taken from the real ones rather
than invented. Only the layout and the order of information are borrowed;
the type, colour and wording are Mirli's own.

## What the references do

Read on 27 November 2026 by loading the public pages logged out and measuring
the DOM, plus each service's help pages. Anything behind a sign-in is marked.

### Spotify, track page

Source: <https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8> (web player).

- **Hero.** Cover on the left (215 px square at a 956 px column, 128 px at a
  416 px column), words on the right, bottom-aligned with the cover. A small
  type label, "Song", sits above the title. The title is the largest thing on
  the page (48 px, weight 800).
- **Meta line.** One line under the title, separated by "•", in this order:
  artist, album, year, length, play count.
- **Action row.** Directly under the hero, left-aligned: Play, Save, More
  ("…"). Play is the only filled button (a 56 px circle); the others are
  32 px icon buttons. Everything occasional is in the "…" menu (add to
  playlist, go to artist, view credits, share).
- **Below.** Lyrics, then the artist, then rows of related tracks.
- **Credits** are not on the page. They open from "…" as a list grouped under
  headings (Composition & Lyrics, Production & Engineering, Performers), each
  row a name with its role.
- **Phone width (375 px).** The cover moves on top, the title and meta run
  under it, and the action row stays one row.
- **Scrubber.** Clicking the time on the right switches between total length
  and time remaining
  (<https://community.spotify.com/t5/Desktop-Windows/Desktop-Other-Show-time-remaining-in-the-currently-playing-track/m-p/5198269>).
  Not verified: its hover behaviour, since the bar needs a sign-in.

### Suno, song page

Sources: <https://suno.com/song/d7f797ef-48a1-4379-9b0d-43db0bc4ac94>,
<https://suno.com/song/0cb4dcee-8e29-4c9f-9568-a0b090ef580b>.

- **Hero.** Cover on the left (300 px square), words on the right: title,
  creator, then the **style prompt** on one clipped line with a copy button
  and a "Show full styles" link when it is long, then the date and a small
  model-version badge.
- **Action row.** At the bottom of the hero. Counts and "…" on the left; on
  the right three buttons, of which Play is the one filled.
- **The "…" menu** holds the editing tools. Suno's help describes Remix/Edit
  at the top (Cover, Extend, Adjust Speed, Crop, Replace Section), "Get Stems"
  as its own item, and "Open in Studio" under Edit
  (<https://help.suno.com/en/articles/6050497>,
  <https://help.suno.com/en/articles/13925185>,
  <https://help.suno.com/en/articles/13670529>). The menu itself is behind a
  sign-in and was not seen.
- **Stems to Studio.** Get Stems asks for a split type, then extracts. In
  Studio the parts land on new tracks lined up with the original
  (<https://help.suno.com/en/articles/13670529>). Suno's help describes the
  song menu and Studio as two separate ways in; nothing says one leads to the
  other.
- **Below.** Two columns: the lyrics on the left as one plain column with line
  breaks kept, section tags shown in brackets and a copy button; a card on the
  right (comments). At 820 px the two columns collapse.
- **Playbar.** Elapsed time on the left, a thin line with a small thumb, total
  on the right. There is no waveform on the song page.

### SoundCloud, track page

Source: <https://soundcloud.com/forss/flickermood>.

- The waveform is in the hero, drawn as bars. The played part is coloured and
  the rest is not, with the elapsed and total times at its two ends.
- In the bottom bar the drag handle is hidden until the bar is hovered.

## What Mirli's page takes from them

```
+----------+  Song                                   type label   (Spotify)
|  cover   |  PAPER LANTERNS                         title
|          |  ACE-Step 1.5 • 1h ago • 0:48           meta line    (Spotify)
+----------+  indie folk, fingerpicked… [copy]       prompt line  (Suno)
              [folk] [vocal]

(Play) ☆ ⤓ | [Open in Studio] [Split into stems] …   action row   (both)

+---------------------------------------------------------------+
| waveform, played part filled, selection in yellow             | (SoundCloud)
| 0:00    0:05    0:10    0:15 …                    time ruler  |
| |< (>) loop  0:12.4 / 0:48.0          0:10.2 – 0:18.9 · 8.7s  |
| Selection: Trim, Repaint     Whole clip: Reverse, Volume, EQ… |
+---------------------------------------------------------------+

Stems            [Open stems in Studio]   | Details     [Copy recipe]
 (>) 4 stems                              | Made with   model, seed…
 vocals / drums / bass / other            | Audio       length, format…
Lyrics                             [copy] | Filed       created, project…
 [verse] …                                |              (Spotify credits)
Versions
 trims, repaints, covers of this sound
```

| Part | Where it comes from |
| --- | --- |
| Cover left, words right and bottom-aligned | Spotify, Suno |
| Type label above the title (Song, Music, Sound effect, Speech, Stem, Version) | Spotify's "Song" |
| Meta line with "•": model, age, length | Spotify's order, with the model standing where the artist does |
| Prompt on a clipped line with a copy button and "Show full prompt" | Suno's style line |
| Play first and the only filled button; "…" last | Spotify, Suno |
| Lyrics as one plain column, tags in brackets, copy button | Suno |
| Details beside the lyrics, grouped under headings | Suno's two columns; Spotify's grouped credits |
| Cover on top at phone width | Spotify at 375 px |
| Played part of the waveform filled, times on a ruler | SoundCloud |
| Click the dock's right-hand time for time remaining | Spotify |
| Dock handle grows on hover | SoundCloud |

### Mirli's own choices

These are not in the references. They are decisions, not observations.

- **Open in Studio and Split into stems sit in the action row**, named. Suno
  keeps both in the "…" menu. Here they are what the page is for, so they are
  one click away. For a sound that is not music, Split moves into the menu.
- **Split can open the Studio in the same step.** The split dialog has
  "Split" and "Split and open in Studio". After a plain split the stems
  appear on the page with "Open stems in Studio" beside them, and the toast
  offers the same. The server reuses stems that already exist, so opening
  them later does not split twice.
- **The waveform is an editor**, which none of the three have on this page:
  drag to select, then tools grouped by what they act on (the selection, or
  the whole clip). Gain and loudness share one Volume tool.
- **The time under the pointer** is shown on the waveform and on the dock's
  bar. No reference could be checked for this; it is the familiar video-player
  behaviour.
- **Versions.** Edits made from a sound are listed on its page, and a stem or
  an edit names what it was made from above its title.
- **No counts, comments or follow**: Mirli is a local library, so there are
  none to show.

## The timeline

"Timeline" here is the playback timeline: the waveform on the sound page (and
in the Details and Sample panels, which use the same editor) and the bar in
the bottom player. The Studio's arrangement timeline is a different component
and is unchanged.

- A time ruler in clock time (`0:15`, or `0:00.4` on a clip a few seconds
  long), with a step chosen for the clip's length. Click or drag it to seek.
- The time under the pointer follows it across the waveform and ruler.
- The selection has yellow grips, shows as a band on the ruler, and reads out
  as start, end and length.
- A clock that keeps its shape (`0:07.3 / 0:48.0`), back-to-start, and Loop
  for the selection or the whole clip.
- Keys, with the editor focused: Space plays, Left and Right seek 5 s (1 s
  with Shift), Home returns to the start, Escape clears the selection.
- The bottom player's bar shows the time under the pointer, lights up to
  where a click would land, takes End as well as Home, and its right-hand
  time switches to time remaining on a click.

## Screenshots

From mock mode (`npm run dev:mock`), not real renders. Before and after, in
[`shots/`](shots/).
