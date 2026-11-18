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

## What a post may claim

Only what this repository can show. Every claim about Mirli — a model it
runs, a number it reports, a thing it does — has to be checkable against the
code, the docs or a run you can reproduce, and a claim nobody has checked does
not go on the page.
