# Audiobooks

Mirli turns a manuscript into a narrated audiobook on your own machine. A
book is a list of chapters; each chapter is a script (a *story*) whose
paragraphs are its lines, so a chapter also opens in the studio timeline with
everything the studio does: trims, fades, the mixer and the device rack. Any
text-to-speech model Mirli runs can read it, local or through an endpoint.

The steps below follow the order most books take: import, cast, pronounce,
render, add beds, master, export, listen. You can do them in any order and go
back to any of them.

An agent can do all of it too, through the MCP tools under
[Audiobooks in MCP.md](./MCP.md#audiobooks). The HTTP API is under
[Audiobooks in API.md](./API.md#audiobooks).

## Import

Open **Audiobooks** and choose **Import manuscript**. Mirli reads:

- EPUB, PDF, DOCX, TXT, Markdown and HTML files;
- a web page, by URL;
- text pasted straight in.

Chapters are found from the file's structure (EPUB chapters, headings).
Copyright pages, dedications, forewords, afterwords and similar sections are
marked as front or back matter, and each section has an include checkbox, so a
copyright page can stay in the book without being read. The cover, title,
author and other metadata come along where the file has them.

The review screen shows what was found before anything is created, with any
parser warnings (for example, PDF pages with no text layer). Rename, re-type or
leave out sections there.

### Start from a classic

**Classics** (on the Audiobooks page, or the **Classics** tab when importing)
opens a library of 42 public-domain works that ship with Mirli, so it works
offline:

- short stories: O. Henry, Poe, W. W. Jacobs, Kate Chopin, Conan Doyle, Chekhov
  (Constance Garnett's translation), Saki, Washington Irving and Charlotte
  Perkins Gilman (*The Yellow Wallpaper*);
- stories for children: Oscar Wilde's fairy tales, two of Kipling's *Just So
  Stories*, seven Grimm fairy tales (Margaret Hunt's translation) and fifteen of
  Aesop's fables (George Fyler Townsend's translation);
- novellas: *A Christmas Carol*, *Dr. Jekyll and Mr. Hyde* and *Alice's
  Adventures in Wonderland*, split into their chapters;
- poems by Poe, Keats, Whitman, Shelley, Christina Rossetti (*Goblin Market*)
  and Emily Dickinson, and all of Blake's *Songs of Innocence and of Experience*,
  one stanza to a paragraph with the line breaks kept.

Picking one opens the same review screen as any import. Most texts are
[Standard Ebooks](https://standardebooks.org) editions. Standard Ebooks states
they are in the US public domain and releases its own editing under CC0. Works
Standard Ebooks doesn't carry come from [Project Gutenberg](https://www.gutenberg.org)
plain-text editions, with the Project Gutenberg header, licence and footer
removed, as its licence asks when the text is passed on without them. Every
author and translator in the library died more than 70 years ago, so the works
are also out of copyright where the term is life plus 70. Some countries have
longer terms: outside the US, check your local law before publishing a recording.

To rebuild the library, run `node scripts/build-classics.mjs` in `server/`. It
fetches each listed edition once, two seconds apart, taking Gutenberg files from
its PGLAF mirror as Gutenberg's robot policy asks.

**New book** starts an empty book with one chapter instead.

## Cast

Choose **single cast** (the narrator reads everything) or **multi cast** (the
narrator plus a voice per character) in the book's settings.

- **Narrator voice.** Set it once for the book. Every paragraph without a
  character uses it.
- **Characters.** Mirli can detect who speaks each line of dialogue and
  suggest a voice for each character, which you can preview on that
  character's own lines. Assign voices on the **Cast** tab. Changing a
  character's voice changes all of their lines.
- **Per paragraph.** Any paragraph can be given to a character or read on a
  different model, and has its own delivery controls (the same ones the
  studio offers for that model family).

## Pronounce

The **Pronounce** tab holds rules for words the model gets wrong: names,
places, invented words.

- An **alias** respells the word ("Hermione" → "her-MY-oh-nee"). It works on
  every model.
- **IPA** and **CMU** rules give phonemes, for models that accept them.
- Rules apply top to bottom and the first match wins. Each can be
  case-sensitive and whole-word.
- Mirli suggests terms from the text, and plays a term in its sentence so you
  can hear the rule work.
- Rules can be imported from and exported to `.pls` files. Rules shared by
  every book live in the global dictionary.

Paragraphs a new rule affects are marked **stale**, so you can re-voice only
those.

## Render

The render bar voices the whole book, a chapter, or the paragraphs you have
selected. A run is saved, so it can be paused, resumed or cancelled, and it
picks up after a restart. Before it starts, Mirli estimates the length of the
audio and the time the render will take.

Each paragraph shows its status: **unvoiced**, **voiced**, **stale** (the text,
voice or pronunciation changed since it was read) or **locked**.

- **Takes.** Every generation is kept as a take. Listen to earlier takes,
  restore one, or delete it.
- **Lock** a paragraph you are happy with. Renders, voice changes and
  pronunciation changes never touch a locked paragraph.
- **Pacing.** The gaps between paragraphs and after chapter headings are
  placed on the timeline rather than written into the text, so they work on
  every model.

## Beds: music, ambience and effects

The **Beds** section of a chapter's inspector puts sound under the narration.

- **Music** and **ambience** beds play under the chapter. **SFX** play once,
  at a paragraph you choose, plus an offset.
- A bed comes from the library, or is generated from a prompt on an installed
  music or sound-effect model. A generated bed is saved to the library like
  any other sound.
- Each bed is clips on its own track in the chapter's story, named after the
  bed, so the timeline shows it and you can edit it there.

**Suggest soundscape** reads the chapter and proposes beds for you to review:

- a music or ambience bed for each scene (scenes are split at `* * *` style
  breaks), with its mood, its setting and a prompt, laid under just that
  scene's paragraphs;
- a sound effect at each paragraph whose text names a sound happening ("the
  door slammed", "thunder rolled", footsteps), placed at that paragraph.

With the prompt assistant on (Settings → Prompt assistant) the model reads the
text; otherwise Mirli matches keywords for places, moods and sounds, and says
so. Each suggestion shows why it was made. Edit its prompt, accept it (the
sound is generated and placed), or reject it. Nothing is added until you
accept. Suggestions start quiet: ambience at −28 dB ducked 8 dB, music at
−24 dB ducked 12 dB, effects at −12 dB.

For each bed you can set:

| Setting | What it does |
|---|---|
| Gain | The bed's level. Defaults: −18 dB music, −24 dB ambience, −6 dB SFX. |
| Plays | Whole chapter, intro only, outro only, or intro and outro. A suggested scene bed plays under its scene. |
| Intro/outro length | How long the intro and outro pieces last. |
| Loop to fill | Repeats the sound to cover its span, with a short crossfade at each seam. On by default for music and ambience. |
| Fade in, fade out | At the start and end of the bed. |
| Duck under narration | Lowers the bed wherever the narration is speaking. |

**Ducking** works like a sidechain compressor keyed on the narration. Mirli
measures the narration in 10 ms blocks; wherever it is louder than −45 dBFS,
the bed is pulled down by the **depth** (default 12 dB for music, 6 dB for
ambience). It starts pulling down **lookahead** before the voice starts
(default 250 ms), reaches full depth over the **attack** (250 ms), and comes
back up over the **release** (600 ms) once the voice stops. Gaps shorter than
400 ms stay ducked, so the bed does not pump between sentences.

Ducking is applied when the book is mixed for export, so changing it never
needs anything re-rendered. **Preview** on a bed plays 30 seconds of the
chapter with the bed ducked under the narration, using the same settings.

When the narration changes length, the bed is marked **Stale**; **Fit to
chapter** lays it out again. Edits you made to the bed's clips on the timeline
last until the bed is laid out again.

**Beds and distribution.** Check your distributor's rules before you export
with beds:

- ACX retail samples must not contain music
  ([ACX, via research §8](https://github.com/HamSanders/soundbox/blob/main/docs/audiobooks/research-elevenlabs.md#8-real-world-audiobook-production-standards)).
  When a retail sample is exported, beds are left out by default.
- A bed that plays through a whole chapter fills the pauses, so the ACX
  noise-floor check measures the bed rather than silence.
- Some distribution routes accept narration only; for example, ElevenLabs
  leaves music and SFX out of its ElevenReader exports
  ([research §3](https://github.com/HamSanders/soundbox/blob/main/docs/audiobooks/research-elevenlabs.md#3-audio)).

The export dialog shows these warnings and has an **Include beds** toggle for
each export.

## Master

Mastering presets set loudness and peak for each chapter file:

- **ACX** targets the ACX numbers below.
- **Podcast** targets a podcast loudness level.
- **None** leaves levels alone.

Room tone (a short stretch of quiet) is added at the head and tail of each
chapter file; set its length in the book's pacing settings. **Analyze** checks
every chapter against the ACX numbers and shows each check as pass or fail:
RMS, peak, noise floor, room tone at each end, and file length.

Mirli can also generate opening credits, closing credits and a retail sample
for you.

## Export

Export the whole book or chosen chapters:

- **MP3** (CBR; 192 kbps for ACX), **WAV**, **FLAC**, or **M4B** with chapter
  markers and the cover.
- **One file per chapter**, zipped and named the ACX way (`00_Opening
  Credits`, `01_...`), or **one file**. M4B is always one file.
- Book metadata and the cover are written into the files.
- Optionally, SRT and VTT captions and a read-along JSON with each
  paragraph's timing.

Every export is kept in the export history. MP3, FLAC and M4B need ffmpeg;
when it is missing, Mirli says so and how to install it.

## Listen

**Listen** is a shelf for the books you have made: continue listening first,
then finished books, then a shelf per genre and per series. Search and the
genre, tag, language and length filters switch to a grid of matches. Each book
has a detail page with its cover, description, length, narrator, table of
contents and a preview.

The player has chapters, speeds from 0.25x to 4x, a sleep timer (including
"end of chapter"), bookmarks with notes, and remembers where you stopped. It
highlights the paragraph being read and the current word: aligned timings
where they exist, otherwise estimated from the paragraph's timing. Tap any
voiced paragraph to play from there. A book can also be published as a
self-contained web player or a podcast RSS feed, with a checklist of what each
store needs.

## Compared with ElevenLabs

Features only, from ElevenLabs' public documentation as reviewed on
2026-11-20. Every ElevenLabs entry is sourced in
[research-elevenlabs.md](https://github.com/HamSanders/soundbox/blob/main/docs/audiobooks/research-elevenlabs.md). "Not found"
means the reviewed sources do not describe it, not that it does not exist.

| Feature | ElevenLabs Audiobooks / Studio / ElevenReader | Mirli |
|---|---|---|
| Import | Audiobooks flow: EPUB and PDF. Studio: EPUB, PDF, DOCX, TXT, HTML, URL (§1) | EPUB, PDF, DOCX, TXT, Markdown, HTML, URL, pasted text |
| Front and back matter detection, include per section | Yes (§1) | Yes |
| Single and multi cast, character detection, voice suggestions | Yes (§1, §2) | Yes |
| Per-paragraph voice, model and delivery | Yes (§2) | Yes |
| Pronunciation rules: alias, IPA, CMU, `.pls` | Yes (§2) | Yes |
| Takes, restore, lock | Yes (§2) | Yes |
| Pauses | Break tags, max 3 s; not on Eleven v3/v4 (§2) | Timeline gaps, on every model |
| Find and replace | Not found (§9) | Yes |
| Music and SFX tracks | Yes, on the timeline (§3) | Yes, as beds on chapter tracks |
| Ducking music under narration | Not found | Yes, with depth, attack, release and lookahead |
| Volume normalisation | A toggle; targets not published (§3) | ACX and podcast presets with stated targets |
| Loudness report against ACX numbers | Not found (§10) | Pass/fail per chapter |
| Room tone at head and tail | Not found (§3, §9) | Configurable |
| Credits and retail sample files | Not found (§10) | Generated |
| Export formats | MP3, WAV; AAF; subtitles (§4) | MP3, WAV, FLAC, M4B with chapters; SRT, VTT, read-along JSON |
| ACX file naming | Not found (§10) | Yes |
| Auto-regenerate on failed checks | Yes (§4) | Yes: silence, clipping and length checks, and a word check where a speech recognition model is installed |
| Player speed, sleep timer, bookmarks, read-along | Yes, in ElevenReader (§7.3) | Yes, in Listen |
| Runs offline on your machine | Not found | Yes, with local models |

## ACX notes

These are the figures ACX publishes, as quoted in the sources below. ACX's own
help page could not be fetched as text, so check it before you submit.

| Requirement | Value | Source |
|---|---|---|
| RMS | −23 to −18 dB | [Hindenburg ACX checklist](https://hindenburg.uservoice.com/knowledgebase/articles/2023008-acx-checklist-for-narrator-users); [archived ACX page](https://webcf.waybackmachine.org/web/20210510175948/https://www.acx.com/help/acx-audio-submission-requirements/201456300) |
| Peak | −3 dB or lower | Same; [ACX blog](https://www.acx.com/mp/blog/mastering-audiobooks-with-alex-the-audio-scientist) |
| Noise floor | −60 dB RMS or lower | Same |
| Room tone | 0.5–1 s at the head, 1–5 s at the tail | Hindenburg; [ACX help](https://help.acx.com/s/article/acx-audio-submission-requirements) |
| Format | MP3, 192 kbps or higher, CBR, 44.1 kHz | Hindenburg; archived ACX page |
| Channels | All mono or all stereo; mono recommended | ACX help |
| Files | One chapter or section per file, opening with its spoken header | [ACX blog: file management](https://www.acx.com/mp/blog/file-management-with-alex-the-audio-scientist) |
| Length | 120 minutes per file at most | ACX help |
| File names | Section number first, e.g. `00_Opening Credits`; letters, digits, dash and underscore | ACX blog: file management |
| Retail sample | 1–5 minutes, starting with narration; no credits, music or explicit content | ACX blog; ACX help |
| Narration | ACX requires human narration unless otherwise authorized (policy as quoted on 2026-04-15) | [inkfluenceai, quoting ACX](https://www.inkfluenceai.com/blog/ai-narration-audible-acx-policy-2026) |

Mirli's ACX checks use these numbers. Passing them does not mean ACX will
accept a book: ACX also reviews the audio by ear, and its narration policy
applies.
