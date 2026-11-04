# Writing a post

One markdown file per post. The filename is the URL: `why-audio-cpp.md`
becomes `/blog/why-audio-cpp`. There is no index to update and no second file
to keep in step — the site globs this directory and sorts by date.

## Frontmatter

```
---
title: Only if the post does not open with its own `# Heading`
description: The index card's line, and the page's meta description. Under ~155 characters.
date: 2026-08-25
updated: 2026-08-26
author: Anthony Saviano
tags: [engineering, audio.cpp]
draft: true
image: /blog/why-audio-cpp.jpg
---
```

`description`, `date` and `author` are required. `tags` defaults to empty and
`draft` to false. Everything else is optional.

The parser is deliberately small — `plugins/frontmatter.ts` — and it throws
rather than guesses. An unknown key is an error, because `drafts: true` is a
typo that would otherwise publish the post. Dates are `YYYY-MM-DD` and stay
strings: they sort correctly that way, and nothing lands a day early in another
timezone.

## Drafts

`draft: true` shows the post in `npm run site:dev` and removes it from a
production build entirely — no page, no entry in the index, nothing in the
feed. A draft URL is a real 404, not a page apologising for itself. To see one
in its real static shape, set `VITE_DRAFTS=1` before building (on Windows,
`$env:VITE_DRAFTS=1`). It still will not reach the feed.

## Links

**To a doc, write the repo-relative markdown path.** `./MCP.md` becomes
`/docs/mcp` on the site and stays a working link on GitHub. This is the same
rewriting the docs get, and it is the reason to prefer it over a hand-written
URL.

**To another post, write the site path.** `/blog/other-post`, not
`./other-post.md` — that second form rewrites to `/docs/other-post`, which does
not exist, and because unwritten paths emit no file it is a hard 404 with no
client-side rescue.

## Images

1200x630 for the social card, saved to `site/public/blog/<slug>.jpg` and
referenced as `image: /blog/<slug>.jpg`. `publicDir` is the app's, which is why
the path looks like it belongs to a different project — it is namespaced under
`blog/` so it is obvious which build put it there.

No `og:image` is emitted while `VITE_SITE_ORIGIN` is blank. A relative
`og:image` is ignored by every scraper, so shipping no tag beats shipping a
dead one — but it does mean social cards are inert until a domain is
configured.

## Images in the body

Ordinary markdown: `![alt text](/blog/models-page.png)`. They live in
`site/public/blog/` and are served from `/blog/…`. `prose.css` sizes them, so
nothing else is needed.

Give every image real alt text describing what it *shows*, not what it is —
"the Models page, one model resident in VRAM" beats "screenshot".

What is already there:

| File | What it is |
| --- | --- |
| `agents-page.png` | The Agents page: connected clients with versions, call and error counts, the three connect commands |
| `models-page.png` | The Models table: licence badges, VRAM per model, installed status |
| `activity-log.png` | The server log, showing a model load phase and the job timings around it |
| `<slug>.jpg` | The header plate for that post |

Two rules about screenshots, both from the site's honesty
principle:

- **Never stage one.** These are real pages with real data. A screenshot of
  seeded mock data used to illustrate real usage is the same lie as a
  placeholder sample on a `/sfx` page.
- **Never generate one.** The header plates are abstract, generated art and
  that is fine. A generated image of a *user interface* sitting in the same
  post as a real screenshot is indistinguishable to a reader, and it would
  cost the real ones their authority.

## Reading a post aloud

A post with `audio: /blog/audio/<slug>.mp3` in its frontmatter gets a player
under the header. Konchi makes the recording, which is the only reason this
is worth doing: the blog is narrated by the thing the blog is about.

The pipeline:

1. **Write the spoken script.** Not the post — the post has `curl` commands
   and tables in it, and a model reading `audiocpp-htdemucs-sep` aloud helps
   nobody. Strip fenced code, tables and images; unwrap links to their text
   and inline code to bare words; split paragraphs over ~330 characters on
   sentence boundaries, because the speech models read a couple of sentences
   better than a wall of them.
2. **Speak it in one call.** `POST /api/speak` takes up to 200 lines and a
   `gap_s` between them, and returns **one** joined WAV rather than a file per
   line. 0.55s reads as paragraph breathing.
3. **Convert.** The WAV is 24 kHz mono and roughly 4 MB a minute, so an
   eight-minute post is 33 MB — not something to put in git.

```bash
ffmpeg -i <the-wav> -ac 1 -ar 24000 -b:a 64k -codec:a libmp3lame \
  site/public/blog/audio/<slug>.mp3
```

64 kbps mono is plenty for a voice and takes that 33 MB to about 4 MB.

**Listen to it before you ship it.** Nothing in the build checks that a
recording is intelligible, that it read a word the way you meant, or that it
stopped where the paragraph did.

**Say that it is synthetic**, in the caption, every time. The player already
does. A reader who works out on their own that a voice was generated has been
misled, however briefly, and this blog does not spend its credibility on that.

## What a post may claim

Only what this repository can show. Every claim about Konchi — a model it
runs, a number it reports, a thing it does — has to be checkable against the
code, the docs or a run you can reproduce, and a claim nobody has checked does
not go on the page.
