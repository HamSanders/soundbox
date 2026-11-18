#!/usr/bin/env node
/**
 * Turn a built site into a redirect copy of itself, for the old GitHub Pages
 * address (https://hamsanders.github.io/soundbox/).
 *
 * The site moved to https://mirli.app. GitHub Pages can't send a real 301, so
 * every page is replaced by a stub that does the two things search engines
 * accept from a static host as a permanent move:
 *
 * - `<link rel="canonical">` to the same path on the new origin, and
 * - `<meta http-equiv="refresh" content="0; url=…">` to it. Google treats an
 *   instant meta refresh as a permanent redirect and moves the old page's
 *   standing to the target.
 *
 * A one-line script also carries the query string and `#hash` across, which the
 * meta refresh would drop. `404.html` does the same for any path the build
 * didn't produce, so an old link to a page that no longer exists still lands on
 * mirli.app (which shows its own not-found page).
 *
 * Non-HTML files (videos, images, audio, GIFs, feeds) are kept as they are, so
 * a video or image linked from a forum post or the README keeps playing at its
 * old URL.
 *
 * Usage: node scripts/pages-redirect.mjs <dist dir> <new origin> <old base>
 *   e.g. node scripts/pages-redirect.mjs site/dist https://mirli.app /soundbox/
 */

import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [distArg, originArg, baseArg = "/"] = process.argv.slice(2);
if (!distArg || !originArg) {
  console.error("usage: pages-redirect.mjs <dist dir> <new origin> <old base>");
  process.exit(2);
}
const dist = path.resolve(distArg);
const origin = originArg.replace(/\/+$/, "");
const oldBase = `/${baseArg.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function stub(target) {
  const href = escape(target);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Moved to mirli.app</title>
    <link rel="canonical" href="${href}" />
    <meta http-equiv="refresh" content="0; url=${href}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script>location.replace(${JSON.stringify(target)} + location.search + location.hash)</script>
  </head>
  <body>
    <p>Soundbox is now Mirli, at <a href="${href}">${href}</a>.</p>
  </body>
</html>
`;
}

// 404.html: map whatever path was asked for, minus the old base, onto the
// new origin.
function notFoundStub() {
  const base = JSON.stringify(oldBase);
  const home = escape(`${origin}/`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Moved to mirli.app</title>
    <meta name="robots" content="noindex" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script>
      var p = location.pathname, b = ${base};
      if (p.indexOf(b) === 0) p = "/" + p.slice(b.length);
      location.replace(${JSON.stringify(origin)} + p + location.search + location.hash);
    </script>
  </head>
  <body>
    <p>Soundbox is now Mirli, at <a href="${home}">${home}</a>.</p>
  </body>
</html>
`;
}

let pages = 0;
function walk(dir, rel) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, `${rel}${entry.name}/`);
      continue;
    }
    if (!entry.name.endsWith(".html")) continue;
    if (rel === "" && entry.name === "404.html") {
      writeFileSync(full, notFoundStub());
      continue;
    }
    const target =
      entry.name === "index.html"
        ? `${origin}/${rel}`
        : `${origin}/${rel}${entry.name}`;
    writeFileSync(full, stub(target));
    pages++;
  }
}

walk(dist, "");
console.log(`pages-redirect: ${pages} pages now point at ${origin}/ (old base ${oldBase})`);
