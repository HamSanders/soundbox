# ElevenLabs Audiobooks / Studio / ElevenReader: feature research

Researched 2026-11-20 from public pages only (no login). Every claim cites a URL. Items marked **UNVERIFIED** were not found in any source.

## Product context

- "Projects" was renamed **Studio** in January 2025 and opened to free users ([blog](https://elevenlabs.io/blog/audio-normalization-in-projects)).
- Studio is now branded **ElevenCreative Studio**. Studio 4.0 shipped on 2026-09-21 ([blog](https://elevenlabs.io/blog/introducing-studio-4)).
- **Audiobooks** is a guided flow built on a Studio "Audio project": upload → casting → pronunciations → editor ([Audiobooks guide](https://elevenlabs.io/docs/eleven-creative/products/audiobooks)).
- Character Casting was announced on 2026-07-30 ([blog](https://elevenlabs.io/blog/introducing-character-casting-in-audiobooks)).

## Short source keys

| Key | URL |
|---|---|
| [AB] | https://elevenlabs.io/docs/eleven-creative/products/audiobooks |
| [ST] | https://elevenlabs.io/docs/product-guides/products/studio |
| [API] | https://elevenlabs.io/docs/api-reference/studio/add-project |
| [GET] | https://elevenlabs.io/docs/api-reference/studio/get-project.md |
| [BP] | https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices |
| [HC] | https://elevenlabs.io/docs/help-center/llms.txt (help-center index) |

---

## 1. Import

| Feature | Detail | Source |
|---|---|---|
| Audiobooks flow import formats | **EPUB and PDF only.** Metadata, chapters, formatting and an embedded cover are extracted automatically. | [AB]; [HC: formats](https://elevenlabs.io/docs/help-center/product/studio/audiobooks/what-file-formats-are-supported-for-audiobooks.md) |
| Generic Studio import formats | EPUB (recommended), PDF, DOCX, TXT, HTML, URL. A marketing page also lists MP4, MOV, MP3, WAV and FLAC uploads. | [HC: import formats](https://elevenlabs.io/docs/help-center/product/studio/studio/which-file-formats-can-i-import-with-studio.md); [projects-alpha](https://elevenlabs.io/blog/projects-alpha) |
| API import | `from_document` (".epub, .pdf, .txt or similar"), `from_url`, `from_content_json` (chapters → blocks → `tts_node{voice_id,text}`), or a blank project | [API] |
| Chapter detection | In EPUB, chapters split automatically when each chapter heading uses the "Heading 1" style | [HC: import formats]; [ST] |
| Formatting review (Audiobooks) | Detects copyright notice, dedication, prologue, chapters, epilogue and similar sections, with a checkbox to include or exclude each. Cover can be kept, replaced or removed. The docs warn detection "isn't always accurate". | [AB] |
| Single cast / multi cast | Chosen at import. Multi cast means a narrator plus a voice for each detected character. | [AB] |
| Model at import | Eleven Multilingual v2 ("Studio Quality", 29 languages) is recommended | [AB] |
| Auto-assign voices (API) | `auto_assign_voices` boolean, marked "[Alpha Feature]". `creation_meta.type` includes `auto_assign_voices`. | [API]; [GET] |
| Text normalization | `apply_text_normalization`: `auto` / `on` / `apply_english` / `off` | [API] |
| Book metadata on create | `title`, `author`, `description`, `genres[]`, `target_audience` (children / young adult / adult / all ages), `language` (ISO 639-1), `content_type`, `original_publication_date`, `mature_content`, `isbn_number`, `fiction` / `non-fiction` | [API]; [GET] |
| `source_type` | `blank`, `book`, `article`, `genfm`, `video`, `screenplay` | [API] |
| Failure handling | Very large or complex manuscripts can fail. The advice is to fix the structure and retry, or report the file, size, format and the stage that failed. | [HC: fails](https://elevenlabs.io/docs/help-center/product/studio/audiobooks/what-if-my-manuscript-fails-during-processing.md) |

## 2. Editor

**Structure and limits**
- **Chapters sidebar:** add with +, rename and remove through "Chapter actions", drag to reorder [ST].
- **Limits:** 500 chapters per project, 400 paragraphs per chapter, 5,000 characters per paragraph [ST].

**Paragraph model and generation**
- **Generation unit:** the paragraph. A status bar is pale grey when unconverted and dark grey when converted. Editing text or voice resets the status [ST], [AB].
- **Playback modes:** "Until end (generate one at a time)" and "Until end (generate clips ahead)". Playing audio that already exists costs no credits [ST].

**Voices**
- **Per-paragraph voice:** set in the "Edit Speech" sidebar ([HC: multi-paragraph](https://elevenlabs.io/docs/help-center/product/studio/studio/how-can-i-change-the-voice-and-settings-across-multiple-paragraphs-in-studio.md)).
- **Per-selection voice:** different voices for text within one paragraph. Each voice gets a coloured orb; `Ctrl+Alt+A` / `Cmd+Opt+A` shows all of them [ST].
- **Replace voice across project:** a dialog shows the affected paragraph count, then "Replace and clear impacted audio" [ST]; [HC: multi-paragraph].
- **Character Casting:**
  - Detects characters, proposes a voice for each, and previews each voice on real dialogue from the book.
  - Changing a character's voice updates every line that character speaks.
  - Limit of **150 detected voices per book**; no fixed limit on voices otherwise.
  - Detection can miss minor, unnamed, or hard-to-distinguish speakers.
  - Sources: [HC: casting](https://elevenlabs.io/docs/help-center/product/studio/audiobooks/what-is-character-casting.md); [HC: voices](https://elevenlabs.io/docs/help-center/product/studio/audiobooks/how-many-voices-can-i-use-in-an-audiobook.md); [AB]
- **Voice sources:** Instant clones, Professional clones, Voice Library (10,000+ voices, 90+ languages, filterable by language, accent, category, gender and age) and Voice Design [ST]; [AB].

**Voice settings** [ST]
- Project-wide by default. "Override settings" applies them to the selected text only.
- **Alias:** a project-only name for the voice, such as a character name.
- **Volume:** default 0 dB, range −30 to +5 dB.
- **Speed:** default 1.0, range 0.7–1.2.
- **Stability:** about 50 is typical.
- **Similarity:** about 75 is typical.
- **Style exaggeration:** recommended 0.
- **Speaker boost:** on or off.
- **API fields:** `stability`, `similarity_boost`, `style`, `speed`, `use_speaker_boost`, `volume_gain` [GET].

**Per-paragraph controls**
- Volume, Fade in and Fade out [AB].

**Model choice**
- Default Multilingual v2; Eleven v3, Eleven v4 and Flash are also available, in Project settings or per paragraph.
- Changing the model does not update existing audio; affected paragraphs must be regenerated [AB]; [ST].

**Regeneration**
- **2 free regenerations** per paragraph when text, voice and settings are unchanged. The button reads "Regenerate" when free and "Generate" when charged [ST].
- **Regenerate selection** (words only) works after the full paragraph has been generated ([HC: regen words](https://elevenlabs.io/docs/help-center/product/studio/studio/can-i-regenerate-individual-words-in-studio.md)).
- **Generation history (takes):** each paragraph lists prior generations that can be listened to, downloaded, restored ("Restore generation") or removed. Removal is permanent [ST].

**Lock**
- The lock icon prevents narration changes. Regenerate, voice change and history are disabled while locked. Music, SFX and video stay editable [ST].

**Breaks and pacing**
- **Insert break:** default 1 s, maximum 3 s, syntax `<break time="1.5s" />` [ST]; [BP].
- Breaks affect speech only [ST].
- **Eleven v3 and v4 do not support break tags**, and too many breaks in one generation cause instability [BP].
- Break lengths for paragraph and chapter pacing are "set once and applied throughout" ([casting blog](https://elevenlabs.io/blog/introducing-character-casting-in-audiobooks)). The UI control is UNVERIFIED.

**Emotion and delivery**
- **Audio tags** in square brackets on v3 and v4: `[whispers]`, `[laughs]`, `[sighs]`, `[sarcastic]`, `[excited]`, and SFX tags such as `[applause]` [BP].
- **Explicit dialogue tags** are more predictable than relying on context [BP].
- **"Enhance text"** AI tool refines text to guide delivery [ST].
- **Actor Mode:** a recorded or uploaded reference performance guides the delivery of the selected text [ST].
- **Other AI tools:** Remove background audio (Voice Isolator) and Voice changer [ST].

**Pronunciation**
- **Pronunciations Editor:** opened from the toolbar or the Script panel; "Connect" attaches a dictionary to the project [ST].
- **Audiobooks flow:** terms are auto-suggested (names, places, invented words). Each rule has an Alias and an Output. "Add rule" adds any word manually. A Play icon reads the term in its sentence. Empty rules are skipped [AB].
- **Rule types:** dictionaries hold alias or phoneme rules. Files are `.pls` or TXT.
- **Matching:** case sensitive; "first match wins".
- **Re-conversion:** adding a dictionary marks affected paragraphs as unconverted [BP].
- **Phoneme rules (v2):** CMU Arpabet (the more reliable option) or IPA. Flash v2 / English models only, one word per tag, stress markers required [BP]; [AB].
- **Eleven v4:** accepts inline IPA between slashes, with no tags [BP].
- **Multilingual v2:** use alias rules [BP].
- **API:** `pronunciation_dictionary_locators` (dictionary id and version id); dictionaries are versioned [API]; [GET].

**Other**
- **Undo / Redo** and **keyboard shortcuts** (Project options) [ST].
- **Search / replace:** UNVERIFIED.

## 3. Audio

- **Timeline:**
  - Shows narration, music and SFX tracks.
  - Timing between paragraphs or sentences can be adjusted.
  - Clips can be trimmed, split and duplicated; the view zooms and pans; waveforms are shown [ST]; [HC: timeline](https://elevenlabs.io/docs/help-center/product/studio/studio/what-is-the-timeline-in-studio.md).
  - Studio 4.0 added frame-level zoom, snapping and a faster playback engine for long timelines ([blog](https://elevenlabs.io/blog/introducing-studio-4)).
- **Music:** generated from a prompt, imported, or picked from the Music Marketplace. Tracks can be trimmed, moved and have their volume changed [ST]; [AB].
- **SFX:** generated from a prompt or picked from the SFX library, and can be layered. **Not included in ElevenReader exports or dynamic narration** [ST]; [AB].
- **External audio:** can be imported but **cannot be published to distribution platforms** [ST].
- **External audio asset fields:** `volume_gain_db`, `fade_in_ms` / `fade_out_ms`, start/end trim, `offset_ms`, `muted` [GET].
- **Volume normalization:**
  - A toggle in Export settings [ST].
  - API `volume_normalization`: "post-processing on download for audiobook volume requirements". The deprecated alias is `acx_volume_normalization` [API].
  - The blog describes it as meeting "audiobook distributor standards" ([blog](https://elevenlabs.io/blog/audio-normalization-in-projects)).
  - Target values are not published (UNVERIFIED).
- **Room tone / head-tail padding:** UNVERIFIED.

## 4. Export

- **Where:** Publish → Export tab [AB].
- **Scope:** the full project or individual chapters.
- **File structure:** one single file, or a ZIP with one file per chapter [AB]; [ST].
- **Media types:**
  - **Audio:** MP3 or WAV.
  - **Timeline data:** AAF.
  - **Subtitles.**
  - **Video:** needs a video track and captions [AB]; [ST].
- **Quality by plan:**
  - Lower tiers: 128 kbps MP3.
  - Pro and above: 192 kbps MP3 or 16-bit 44.1 kHz WAV.
  - Quality is fixed when the project is created [ST].
- **API `quality_preset`:**
  - `standard`: 128 kbps / 44.1 kHz
  - `high`: 192 kbps
  - `ultra`: 192 kbps
  - `ultra_lossless`: 705.6 kbps [API]
- **M4B with chapter markers:** not documented (UNVERIFIED).
- **Metadata:**
  - Export settings hold Title, Author, ISBN, Description and previous versions [ST].
  - Author and ISBN are written into MP3 metadata [API].
  - Cover is extracted on import (`cover_image_url`) [GET]; [AB]. Embedding in exported audio is UNVERIFIED.
- **Credits at export:** generated paragraphs are free. Ungenerated ones are generated at export, with a credit estimate shown first [ST]; [AB].
- **Auto-Regenerate:**
  - On by default for bulk export.
  - Checks for volume distortion, voice similarity, mispronunciations, and missing or extra words.
  - Up to 2 free retries [ST]; [HC: auto-regen](https://elevenlabs.io/docs/help-center/product/studio/studio/what-is-auto-regenerate.md).
- **Export history:** Project options → Exports, or the History tab in the Export dialog [ST].
- **API snapshots:**
  - Project and chapter snapshot list, get, stream (optionally as MP3) and archive.
  - Project and chapter `convert`.
  - `callback_url` conversion webhooks ([index](https://elevenlabs.io/docs/llms.txt); [API]).

**Distribution** (Publish tab)
- **ElevenReader:** see section 7.
- **Spotify:**
  - Export → Publish → Spotify.
  - Choose the preview chapter (its first 5 minutes are used).
  - Narrator credits default to "Digital Voice <name>"; Instant clones must be verified first.
  - Produces MP3 files, uploaded by the user to Spotify for Authors.
  - The description is prefixed "This audiobook is narrated by a digital voice" ([HC: Spotify](https://elevenlabs.io/docs/help-center/product/studio/studio/how-do-i-export-a-studio-project-to-spotify.md)).
  - Chapters and metadata carry over ([spotify-authors](https://elevenlabs.io/spotify-authors)).
- **InAudio:**
  - Same flow, but exports an **LPF** file.
  - InAudio redistributes to Barnes & Noble, Rakuten, Everand, Scribd and others ([HC: InAudio](https://elevenlabs.io/docs/help-center/product/studio/studio/how-do-i-export-a-studio-project-to-in-audio.md)).
- **Also listed:** "ElevenLabs Video" and "Audio Native" [AB].
- **Audible / ACX:** no route documented. ACX requires human narration (see section 8).

## 5. Collaboration and workflow

- **Read-only share link:** plays the timeline without allowing download, and can be revoked [ST].
- **Comments:**
  - Timestamped to the playhead; anonymous commenting allowed.
  - Threads, mentions and email notifications; threads can be resolved and reopened [ST].
  - Studio 4 adds comments on clips and assets ([blog](https://elevenlabs.io/blog/introducing-studio-4)).
- **Access levels (API):** `admin`, `editor`, `commenter`, `viewer` [GET].
- **Progress and credits (API):**
  - Per-chapter `statistics`: characters and paragraphs converted / unconverted, `credits_needed_to_convert`, per-voice breakdown.
  - `conversion_progress` and `last_conversion_error`.
  - Project `state`: creating, default, converting or in_queue [GET].
- **Credits:**
  - Spent on: generation, regeneration, voice previews with custom text, and generating missing sections at export.
  - Free: playback and quality settings [AB].
- **Versions:** per-paragraph generation history plus API snapshots. A project-level version UI is UNVERIFIED.
- **Approve status separate from lock:** UNVERIFIED.

## 6. Other notable features

- **Dynamic narration vs original audio:**
  - Dynamic narration lets listeners choose the narrator voice at playback.
  - Music, SFX and external audio are excluded from dynamic narration.
  - "Original audio" is one fixed render [AB]; [HC: dynamic](https://elevenlabs.io/docs/help-center/product/studio/audiobooks/what-is-the-difference-between-original-audio-and-dynamic-narration.md).
- **GenFM:**
  - Turns a PDF, URL, text or eBook into a podcast with two AI hosts ([HC: GenFM](https://elevenlabs.io/docs/help-center/product/distribution-publishing/gen-fm/what-is-gen-fm.md)).
  - API modes: conversation or bulletin; `duration_scale`; `intro` / `outro`; `instructions_prompt`; `highlights` ([create-podcast](https://elevenlabs.io/docs/api-reference/studio/create-podcast)).
- **Studio Agent:** an AI co-editor, video projects only [ST].
- **Languages:**
  - Pages variously state 29 (Multilingual v2), 30+, 32+, 50+ and 90+ languages.
  - ElevenReader Publishing does not translate ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/can-my-content-be-translated-into-other-languages.md)).
- **Studio API:** available on request only ([API info](https://elevenlabs.io/docs/api-reference/studio-api-information/llms.txt)).

---

## 7. ElevenReader (listening + publishing)

### 7.1 Explore / discovery catalogue (https://elevenreader.io/explore, observed 2026-11-20)

- **Page heading:** "Find your next audiobook".
- **Filter bar:**
  - **Tags:** about 100 tropes, e.g. Enemies to Lovers, Found Family, Slow Burn, Cyberpunk, Isekai.
  - **Genre:** 32 genres, Action and Adventure through Young Adult.
  - **Price:** Free, Included in Ultra, Under $1, $1–$5, $5–$10, Over $10.
  - **Rating:** 4.5+, 4.0+, 3.5+.
  - **Narrated by:** **"Recorded Track"** or **"1,000+ Voices"**.
  - **Language:** English, Brazilian Portuguese, Dutch, French, German, Italian, Polish, Portuguese, Spanish.
  - **Sort by:** Popularity, Relevance, Newest.
  - **Mature content** toggle.
- **Shelves, in order:** "Top picks", "What's trending", "Recent bestsellers", then genre shelves (Health and Wellness, Business and Economics, Biography and Memoir, Psychology, Literary Classics, Humor, True Crime, Mystery and Thriller, Education and Learning, Top Fantasy Reads).
- **Featured collections:** each links to `/collections/...`, e.g. "New Releases We Can't Put Down", "Essential HarperCollins", "New York Times & Booker Prize Bestsellers", "Best of Vinci Books".
- **Browse routes:** pages at `/genres/<genre>-audiobooks`, `/tags/<tag>-audiobooks/<id>` and `/authors/<name>-audiobooks/<id>` (observed in page links).
- **Book card:** cover, title, author, duration (e.g. "10h 9m"), rating with count, and price. Prices appear as "Free", a single price, or "$29 · $0.00". The last of these is presumably a list price plus inclusion in the subscription; that reading is UNVERIFIED.
- **Search:** a header search box is present; the matching behaviour is UNVERIFIED.
- **AI vs human labels:**
  - No explicit "AI-narrated" or "human-narrated" badge was observed.
  - The distinction shown is "Recorded Track" (a fixed audio file) versus "1,000+ Voices" (listener-chosen TTS) in the filter, plus the Format and Narrated by fields on the detail page (7.2).
  - Applying the filter through script on the web page did not change results, so its behaviour is UNVERIFIED.
- **Platform naming:** the web app is titled "Explore Audiobooks & Podcasts", but no podcast shelf appeared on this page.

### 7.2 Book detail page (observed)

Examples:
- Dynamic narration: https://elevenreader.io/audiobooks/flames-of-winter-audiobook/LNhsAZOktoalZqc7AeYs
- Recorded / original audio: https://elevenreader.io/audiobooks/frankenstein-audiobook/q8SnK4V9NhKxJuZwF73S

Fields shown:
- Breadcrumb: Explore › Genre.
- Cover, title, subtitle, "By <author>" (links to the author page).
- **Narrator line:**
  - Dynamic books: "Listen with Sir Michael Caine™ and 1,000+ voices".
  - Recorded books: an "Audio only" badge and "Narrated by Clyde".
- Buttons: **"Listen for free"** and **"Preview"**. The sample length is UNVERIFIED.
- "About this audiobook" blurb, then tag chips.
- **"Audiobook details":**
  - Rating (stars and count), Genre, Length (e.g. "10 hrs 37 mins").
  - Narrated by.
  - **Format:** "eBook with Audio" for dynamic books, "Audiobook" for recorded ones.
  - Publish date, Language.
- **Table of contents:** numbered chapter list with "Show all chapters".
- Series link, "More from <author>", "More from <collection>", "You may also like".
- **Structured data:** schema.org `Audiobook` JSON-LD with `duration` (ISO 8601), `genre`, `aggregateRating`, `offers.price` / `priceCurrency`, `readBy`, `datePublished`, `inLanguage`, plus a `BreadcrumbList`.
- **Frankenstein's description** calls it "an ElevenReader Original": full cast, original score and sound design, the first production made with Eleven v4, free and exclusive to ElevenReader.

### 7.3 Player

| Feature | Detail | Source |
|---|---|---|
| Speed | 0.25x–4x in 0.05 steps (App Store). The web page says "up to 4.0x". | [App Store](https://apps.apple.com/us/app/elevenreader-text-to-audio/id6479373050); [text-reader-app](https://elevenreader.io/text-reader-app) |
| Sleep timer | Yes, in the Free plan; a 15-minute option was added | App Store; text-reader-app |
| Bookmarks and notes | "Bookmarks — never lose your place and add notes"; bookmarks can be undone | App Store |
| Read-along | Word-by-word highlighting synced to audio; listening can start from any sentence | App Store; text-reader-app |
| Voice switching | Change voice or speed at any time; 1,000+ voices; tap a character's orb to preview its voice; choose how expressive a voice is; per-user pronunciation dictionary | App Store; text-reader-app |
| Iconic voices | Celebrity voices, e.g. Sir Michael Caine on book pages and Maya Angelou on the App Store | book page; App Store |
| Chapter list in the player | Book pages show a table of contents. Chapter navigation inside the player itself is UNVERIFIED. | book page |
| Offline | Downloads in the iOS and Android apps, listed as an **Ultra** feature | text-reader-app; App Store |
| Other | Home Screen widgets, CarPlay, Siri, Spotlight; VoiceOver and Dark mode | App Store |
| Imports (personal TTS) | Pasted text, PDF, DOCX, EPUB, Markdown/TXT, web links, camera scan, plus Kindle, Google Docs, X, Substack and AO3 (App Store "What's New"). Ultra adds "Smart imports", which skip headers and footers. | text-reader-app; App Store |
| Plans | **Free:** 10 h of text-to-audio per month, the free catalogue, sync, sleep timer, bookmarks. **Ultra:** unlimited imports, the premium catalogue (20 h of premium titles per month), offline, custom voices. | text-reader-app |

### 7.4 Library and progress sync

- "Your library syncs across web and mobile". You can pick up a document on another device ([text-reader-app](https://elevenreader.io/text-reader-app)).
- The App Store says "Sync across devices — start on phone, continue on tablet or web" ([App Store](https://apps.apple.com/us/app/elevenreader-text-to-audio/id6479373050)).
- The library supports collections, a grid view, and search that ranks title matches first (App Store "What's New").
- Whether *listening position* syncs, as distinct from library contents, is implied by "continue on tablet" but not stated precisely (UNVERIFIED).

### 7.5 ElevenReader Publishing

**Two entry points**
1. **From Studio / Audiobooks (Publish tab → ElevenReader):**
   - Steps: create or select an author profile → title, subtitle, cover image → distribution details → payouts and agreements → review and submit.
   - Series are created from Bookshelf → Create series (name, description, author profile, language) [AB].
   - The API flag `create_publishing_read` creates a draft publishing record [API].
   - The project's `publishing_read` object [GET] carries:
     - `display_mode`: text, audio-only, or text-with-audio
     - `genre[]`, `list_price`, `currency` (usd)
     - `payout_type`: none, engagement_based, or fixed_payout
     - `distribution_territories`, `contributors`, `series_id`, `volume`, `edition`, `copyright`
     - `review.review_status`: approved, edits_required, or rejected
2. **Direct manuscript upload** (elevenreader.io/app/publishing, "Bookshelf"):
   - Steps: sign up → upload EPUB, PDF, TXT, DOCX or HTML → fix formatting in the publishing editor → preview in the app by QR code → book details, legal terms and payouts → publish and submit for review ([HC: how to publish](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-do-i-publish-a-book-on-the-elevenreader-app.md); [HC: formats](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/what-formats-are-supported-for-publication.md)).
   - Only EPUB keeps images.
   - The editor supports paragraphs, chapters and H1–H3. Italics and underline may be lost.

**Publishing editor checklist** ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/what-do-i-need-to-look-out-for-in-the-publishing-editor.md))
- The upload is auto-split into chapters; chapters can be edited, added, deleted and reordered.
- Put title and author on the first page.
- The table of contents can be deleted, because the app navigates by chapter.
- Use H1–H3 for chapter titles.
- Move audio-unfriendly reference material to the back.
- Remove page references and stray blank space.

**Voice for direct uploads**
- AI narration is on by default for every published book ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/does-the-elevenreader-app-offer-ai-audio-narration-for-all-content.md)).
- The listener chooses the voice; an author **cannot pre-select one** and can only recommend a voice in a text note ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/can-i-pre-select-my-preferred-voice-narration-for-my-book.md)).
- Authors **cannot upload their own audio files** ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/can-i-provide-my-own-audio-files-for-narration.md)).
- A fixed "Recorded Track" narration therefore comes from Studio/Audiobooks "original audio", not from a direct upload. This reading is inferred from [AB] and the Frankenstein page.

**Required metadata**
- Studio path: author profile, title, subtitle, cover image, distribution details [AB].
- The full list of required fields for a direct upload is UNVERIFIED; the help page only says "book details".

**Review**
- Submitting changes the Bookshelf status from Draft to **Pending Review** ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-do-i-submit-my-book-for-review.md)).
- Rejection follows violations of the Content Guidelines, https://elevenreader.io/content-guidelines ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/why-was-my-book-rejected-for-publishing.md)).
- Review turnaround: UNVERIFIED.

**After publishing**
- Metadata can be edited at any time.
- **Manuscript updates are allowed once every 14 days, and each one resets reader progress** ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-can-i-update-my-book-after-it-has-been-published.md)).
- Sharing works by link or QR code from the Bookshelf or the View Details page. The link opens a web preview where people can add the book to their library or listen to a sample ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-can-i-share-my-book-with-my-audience.md)).
- **Reports tab** ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/what-information-is-included-in-elevenreader-publishing-reports.md)):
  - Total Users (library adds), Total Payouts, Total Listening Duration.
  - Listener Engagement: 25 / 50 / 75 / 100% completion.
  - Ratings histogram and average.
  - **Top Voices** (the voices listeners pick).
  - Ranges: last 30 days, last 90 days or custom.

**Eligibility, cost and territories**
- 18 or older, resident in a supported country, accurate account details ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/what-are-the-legal-requirements-for-publishing-with-elevenreader.md)).
- No cost to publish ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/are-there-any-costs-associated-with-elevenreader-publishing.md)).
- **All books are worldwide**; territory selection is "in development" ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/can-i-choose-in-which-geographies-my-book-will-be-available.md)).

**Pricing and payouts as publicly stated by ElevenLabs**
- **Direct sales:** 60% of revenue after store fees (app stores about 30%, web Stripe about 3%).
- **Subscription (Ultra) listening:** $0.20 per verified listening hour, capped at $2.50 per listener per book. Paid subscribers only; free-trial listening is excluded ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-are-payouts-calculated.md)).
- **Payout schedule:** weekly once the balance reaches $10; smaller balances are paid yearly ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-often-are-payouts-made.md)).
- **Earlier introductory program:** $1.10 per engaged listener. It moved to the hourly model in February 2026; the page gives both Feb 15 and Feb 19 ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/what-was-the-introductory-payment-program-and-does-it-apply-to-my-books.md)).
- **Exclusivity:** none required ([use-case page](https://elevenlabs.io/use-cases/audiobooks)).

**Distribution reach**
- ElevenReader Publishing itself distributes only to the ElevenReader iOS and Android apps and the web app (Explore section and sharing links) ([HC](https://elevenlabs.io/docs/help-center/product/distribution-publishing/elevenreader-publishing/how-is-my-content-distributed.md)).
- Other stores are reached through the separate Studio exports (Spotify MP3, InAudio LPF; section 4) or by downloading files ([HC](https://elevenlabs.io/docs/help-center/product/studio/audiobooks/can-i-publish-audiobooks-to-multiple-platforms.md)).

---

## 8. Real-world audiobook production standards

The live ACX help page renders with JavaScript and could not be fetched. The figures below come from archived ACX pages, ACX's blog, and pages that quote ACX.

| Requirement | Value | Source |
|---|---|---|
| RMS | −23 to −18 dB | [Hindenburg ACX checklist](https://hindenburg.uservoice.com/knowledgebase/articles/2023008-acx-checklist-for-narrator-users); [archived ACX](https://webcf.waybackmachine.org/web/20210510175948/https://www.acx.com/help/acx-audio-submission-requirements/201456300) (search snippet) |
| Peak | at most −3 dB | same as above; [ACX blog](https://www.acx.com/mp/blog/mastering-audiobooks-with-alex-the-audio-scientist) |
| Noise floor | no higher than −60 dB RMS | same as above |
| Room tone | 0.5–1 s at the head, 1–5 s at the tail. A snippet of the current ACX page reads "1 to 5 seconds" at both ends. | Hindenburg; [ACX help](https://help.acx.com/s/article/acx-audio-submission-requirements) (snippet) |
| Format | MP3, 192 kbps or higher, CBR, 44.1 kHz | Hindenburg; archived ACX |
| Channels | All mono or all stereo, never mixed; mono recommended | ACX help (snippet) |
| Files | One chapter or section per file, starting with its spoken header, no duplicate audio | [ACX blog: file management](https://www.acx.com/mp/blog/file-management-with-alex-the-audio-scientist) |
| Maximum file length | 120 minutes; split longer sections and use a secondary header | ACX help (snippet) |
| File naming | Section number first (`00_Opening Credits`, `01_Introduction`); alphanumerics, dash and underscore only | ACX blog: file management |
| Opening credits | Title, subtitle, author, narrator; separate file, first only | ACX blog; Hindenburg |
| Closing credits | "The End" or similar; separate file | Hindenburg |
| Retail sample | 1–5 minutes (the current page reportedly says "5 minutes or less"). Starts with narration; no credits, music or explicit content. | ACX blog; ACX help (snippet) |
| AI narration | "must be human-narrated unless otherwise authorized" (updated 2026-04-15). Audible's AI routes are Virtual Voice (KDP) and Voice Replica (invite-only). | [inkfluenceai](https://www.inkfluenceai.com/blog/ai-narration-audible-acx-policy-2026), which quotes ACX |

**Other retailers**
- **Findaway Voices (Spotify), 2018 guide:** same RMS, peak, noise floor and room tone; MP3 at 192 kbps or higher, or FLAC, at 44.1 kHz; no mixing of mono and stereo (per search results).
- **Spotify for Authors:** MP3, WAV or FLAC plus a sample file; cover PNG or JPG, 1:1, 3000×3000 recommended; live within 3 business days ([Spotify](https://support.spotify.com/us/authors/article/uploading-audiobooks/)).
- **Apple Books:** AAC/M4A, ALAC, CAF, FLAC or MP3; at most 25 tracks, each under 23 hours; chapters must not span tracks; artwork at least 3000×3000; MP3 chapter starts can go in XML metadata ([Apple spec](https://help.apple.com/itc/audiobooksspec/en.lproj/static.html); per search results).
- **M4B:** the same MP4 container as M4A, with chapter timings, which Apple Books imports ([Six Colors](https://sixcolors.com/post/2025/08/apple-makes-it-hard-to-load-audiobooks-purchased-elsewhere/)). Common tools are ffmpeg (FFMETADATA chapters) and m4b-tool. No authoritative public spec for the chapter atom was found.

---

## 9. Not verified from any source

- Search / replace in the Studio editor.
- M4B export with chapter markers.
- A room tone or head/tail padding setting.
- Volume normalization target values.
- An approve or review status separate from lock.
- A project-level version or snapshot UI (snapshots appear in the API only).
- Cover embedding in exported audio.
- The UI control for paragraph and chapter pause lengths.
- Playback speed of 0.8x–2x in the Studio editor (search snippet only).
- ElevenReader: search behaviour, the "Narrated by" filter behaviour, the meaning of "$X · $0.00" prices, sample length, chapter navigation inside the player, listening-position sync, review turnaround, and the full required metadata for direct uploads.

## 10. Gaps observed (features not found in ElevenLabs sources)

- M4B export with embedded chapters and cover.
- Published loudness targets and a pass/fail loudness report against ACX numbers.
- Configurable room-tone padding at the head and tail of each chapter file.
- Generation of separate opening-credit, closing-credit and retail-sample files.
- ACX-style file naming on export.
- Search / replace across the manuscript.
- Pause control that works on Eleven v3/v4 (break tags are unsupported there).
