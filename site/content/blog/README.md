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

A post with `audio: /blog/audio/<slug>.mp3` in its frontmatter gets a Listen
card under the header: the narrator, the length and a play button. Once it is
playing, a player docks to the bottom of the page and the paragraph being read
is highlighted; clicking a paragraph jumps the voice to it. Soundbox makes the
recording, which is the only reason this is worth doing: the blog is narrated
by the thing the blog is about.

The narrator is **Bea**, a Chatterbox clone from the shared voice library
(exaggeration 0.3). `scripts/blog-narration.mjs` does everything but the
speaking, which goes through the Soundbox MCP as a story so each line can be
re-taken on its own:

1. **Make a story and load the script.** `soundbox.create_story` with
   `delivery: {"exaggeration": "0.3"}`, then
   `node scripts/blog-narration.mjs load <slug> <story-id>`. The script is not
   the post: fenced code, tables and images are dropped, headings become a
   1.1 s pause, links and inline code become words, and paragraphs over ~330
   characters are split on sentence ends. `blocks <slug>` prints what it will
   say, which is the thing to read before spending GPU time on it.
2. **Speak it.** `soundbox.speak_story`. Minutes, not seconds.
3. **Lay it out.** `node scripts/blog-narration.mjs layout <story-id>`. A story
   places each line when it is added, before it has a length, so a freshly
   voiced script overlaps itself until this puts the lines end to end.
4. **Export and finish.** `soundbox.export_story`, then
   `node scripts/blog-narration.mjs finish <slug> <story-id> <exported.wav>`.
   That writes the 64 kbps mono MP3 to `site/public/blog/audio/<slug>.mp3` and
   `narration/<slug>.json` here: when each paragraph starts, the waveform the
   player draws, and who reads it.

Every spoken line carries its paragraph's number in its speaker name
(`Bea #12`), and the page counts paragraphs the same way the script does. If
you edit a post after it was read, the counts stop agreeing and the player
turns the highlight off and says so in the console. Re-run the steps.

**Listen to it before you ship it.** Nothing in the build checks that a
recording is intelligible, that it read a word the way you meant, or that it
stopped where the paragraph did.

**Say that it is synthetic**, every time. The Listen card already does. A reader who works out on their own that a voice was generated has been
misled, however briefly, and this blog does not spend its credibility on that.

## What a post may claim

Only what this repository can show. Every claim about Soundbox — a model it
runs, a number it reports, a thing it does — has to be checkable against the
code, the docs or a run you can reproduce, and a claim nobody has checked does
not go on the page.
