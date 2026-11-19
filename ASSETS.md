# Bundled media: provenance and licensing

Mirli's **source code** is MIT-licensed (see [LICENSE](LICENSE)). **The MIT
licence does not cover the generated media bundled with it.** The audio
and images under `site/public/` (the marketing site's media; the app itself
ships only `app/public/favicon.svg`) were made with third-party AI models, and each
model's own terms govern what that output may be used for. Those terms are
summarised below as far as they are known. Where the provenance or the terms
are not recorded, this file says so.

This file is a record of provenance and is not legal advice. If you reuse any of these files
outside Mirli, read the model licences yourself.

## Audio

| Path | What it is | How it was made | Terms that apply |
| --- | --- | --- | --- |
| `site/public/sfx/<category>/*.mp3` | Sound-effect samples for the public `/sfx` pages (manifest beside each category) | Rendered through Mirli by `scripts/gen-sfx-samples.ts`, prompts in `app/src/content/sfx/` (`categories.ts`, `expansions.ts`, `new-categories.ts`, `design-categories.ts`), encoded to MP3 (LAME VBR `-q:a 2`). Every sample names **Stable Audio 3.0 Small SFX** (`audiocpp-stable-audio-3-sfx`, also the script's default for samples with no model) or, for the handful with music or a sung line, **ACE-Step 1.5** (`audiocpp-ace-step`). The per-sample `model` field is the record. | Stable Audio: Stability AI Community License. ACE-Step 1.5: MIT ([licence](https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE)). |
| `site/public/music/*.mp3` | Example tracks for the music pages | `scripts/gen-music-tracks.mjs` (encoded to MP3 as above), prompts in `app/src/content/music/tracks.ts`. Instrumentals on **Stable Audio 3.0 Small Music** (`audiocpp-stable-audio-3-small-music`); the sung tracks on **ACE-Step 1.5 Turbo** (`audiocpp-ace-step`). | Stability AI Community License (Stable Audio); ACE-Step as above. |
| `site/public/music/artists/*.mp3` | Signature tracks for the fictional "Mirli Records" roster | `scripts/gen-artist-tracks.mjs`, same two models as above, prompts in `app/src/content/music/artists.ts`. | As above. |
| `site/public/blog/audio/*.mp3` | Narration of a blog post | Read by **Chatterbox** through Mirli (per the commit that added it). | Chatterbox's licence is listed as *Unknown / not checked* in Mirli's own model catalog; treat as unverified. |

## Downloaded on request

Not bundled and not in the repository. The app fetches these only when you ask
for them, into `<data dir>/models/instruments/`.

| What | Where it comes from | Terms that apply |
| --- | --- | --- |
| Sampled instruments for the MIDI dry take (eight sustained patches: solo violin, violin section, cello section, harp, flute, clarinet, trumpet, French horn; manifest in `server/src/instruments/vsco2ce.ts`) | **VSCO 2 Community Edition** by Versilian Studios, <https://versilian-studios.com/vsco-community/>. Downloaded file by file from the `SFZ` branch of <https://github.com/sgossner/VSCO-2-CE>, pinned to commit `6dd651d5`. | **CC0 1.0** (public domain dedication), per the `LICENSE` file at the root of that branch. Free for any use, commercial included; no attribution required, but it is credited here and in the app. |

`server/test/fixtures/vsco2ce/ClarinetSus.sfz` is a copy of one of that
library's .sfz files (CC0), used to test the parser.

## Images

| Path | What it is | How it was made | Terms that apply |
| --- | --- | --- | --- |
| `site/public/sfx/covers/*.webp`, `site/public/sfx/og/*.jpg` | Category covers for `/sfx`, and their share-card crops | Local **Stable Diffusion 3.5 Medium** via `scripts/gen_sd35.py`, then cropped and re-encoded by `scripts/compress-sfx-covers.py`. | Stability AI Community License. |
| `site/public/music/covers/*` | Track covers | Per `app/src/content/music/tracks.ts`: the first twelve with **Google's Nano Banana** (Gemini image model) via the Antigravity CLI; the other twenty-four with local **Stable Diffusion 3.5 Medium** (`scripts/gen_sd35.py`, prompts in `scripts/gen-music-covers.tsv`). The repo does not record which file is which beyond that split. | Nano Banana output: Google's Gemini API / generative AI terms (including Google's Generative AI Prohibited Use Policy). SD 3.5: Stability AI Community License. |
| `site/public/music/artists/*.webp` | Artist covers | Per `app/src/content/music/artists.ts`: local **Stable Diffusion 3.5 Medium** via `scripts/gen_sd35.py`, prompts in `scripts/gen-artist-covers.json`. | Stability AI Community License. |
| `site/public/blog/*.jpg` | Blog header plates | Generated, abstract images. **Which model made them is not recorded** in the repo. | Unknown. |
| `site/public/product/*.png`, `site/public/blog/*.png` | Product screenshots | Screenshots of the real Mirli app. | Covered with the project (MIT), like the code. |
| `site/public/og/*.jpg` | Share cards (`og:image`) | Drawn by `scripts/gen-og-cards.py` from a product screenshot and the Geist font. | Covered with the project (MIT), like the code. Geist is under the SIL Open Font License. |
| `app/public/favicon.svg` | Icon (served by both the app and the site) | Part of the source. | MIT. |

All generated artwork was prompted to be abstract, with no text, logos or
people, and the band and track names are invented.

## Model terms referred to above

- **Stability AI Community License**: <https://stability.ai/license>. Free for
  commercial use below USD 1M annual revenue; above that an Enterprise licence
  is required.
- **Google Gemini API Additional Terms of Service** and the **Generative AI
  Prohibited Use Policy**: <https://ai.google.dev/gemini-api/terms>.
- **ACE-Step**: <https://github.com/ace-step/ACE-Step/blob/main/LICENSE>
  (Apache-2.0 upstream; the GGUF conversion's licence carry-through is
  unverified).

## Removing or replacing assets

If you fork Mirli and don't want to carry these terms, the public pages
work without the media: delete the files and their manifest entries, or
regenerate them with models whose terms you prefer using the scripts listed
above.
