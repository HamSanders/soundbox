/**
 * `404.html`, for static hosts that serve one on a miss (Vercel, GitHub Pages,
 * Cloudflare Pages, Netlify).
 *
 * The router has no catch-all route, and it should not: every real page is
 * prerendered to its own `index.html`, so an unknown URL is a real miss. What
 * the host shows for it is this file rather than its own branded error page.
 * It is plain HTML on purpose: a copy of the app's shell would hydrate at a
 * URL no route matches and render nothing.
 *
 * Written per build because the links in it have to carry the deploy's base
 * path, and the page can be served at any depth, so relative links would not
 * work either.
 */

import type { Plugin } from "vite";

function page(base: string): string {
  const home = base;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="${base}favicon.svg" />
    <title>Page not found | Soundbox</title>
    <style>
      :root { color-scheme: light dark; --bg: #fafafa; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; }
      @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --line: #27272a; } }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
        font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 32rem; padding: 2rem 1rem; }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      p { color: var(--muted); margin: 0 0 1.5rem; }
      nav { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      a { color: inherit; border: 1px solid var(--line); border-radius: 0.5rem; padding: 0.375rem 0.75rem; text-decoration: none; }
      a:hover { border-color: var(--muted); }
    </style>
  </head>
  <body data-pagefind-ignore="all">
    <main>
      <h1>Page not found</h1>
      <p>Nothing is published at this address. It may have moved, or the link may be mistyped.</p>
      <nav>
        <a href="${home}">Home</a>
        <a href="${base}sfx/">Sound effects</a>
        <a href="${base}music/">Music</a>
        <a href="${base}docs/">Docs</a>
        <a href="${base}blog/">Blog</a>
      </nav>
    </main>
  </body>
</html>
`;
}

export function notFoundPage(): Plugin {
  let isSsrBuild = false;
  let base = "/";

  return {
    name: "soundbox:not-found",

    configResolved(config) {
      isSsrBuild = Boolean(config.build.ssr);
      base = config.base || "/";
    },

    generateBundle() {
      // Only the client pass's output ships; the SSR pass is a temp directory.
      if (isSsrBuild) return;
      this.emitFile({ type: "asset", fileName: "404.html", source: page(base) });
    },
  };
}
