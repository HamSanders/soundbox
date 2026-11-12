/**
 * Serve a few named files from another directory as if they were in this
 * build's `publicDir`.
 *
 * The site's own `publicDir` is `site/public` — the marketing media that the
 * app never loads. A handful of files (today just `favicon.svg`) belong to both
 * builds; they stay in `app/public`, the app's `publicDir`, and this plugin
 * hands them to the site too: from the dev server as a middleware, and in the
 * build as emitted assets at the same root-relative path. One copy on disk, so
 * the two cannot drift.
 *
 * Only for small, shared, root-level files. Anything that is site-only belongs
 * in `site/public`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function sharedPublicFiles(dir: string, files: string[]): Plugin {
  let isSsrBuild = false;
  let base = "/";

  return {
    name: "konchi:shared-public",

    configResolved(config) {
      isSsrBuild = Boolean(config.build.ssr);
      base = config.base || "/";
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Custom middlewares see the URL before Vite strips the base.
        const url = (req.url ?? "").split("?")[0];
        const name = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
        if (!files.includes(name)) return next();
        const type = CONTENT_TYPES[path.extname(name)];
        if (type) res.setHeader("Content-Type", type);
        res.end(readFileSync(path.join(dir, name)));
      });
    },

    generateBundle() {
      // The SSR pass writes into a temp directory that is thrown away after
      // prerendering; only the client pass's output is what ships.
      if (isSsrBuild) return;
      for (const name of files) {
        this.emitFile({ type: "asset", fileName: name, source: readFileSync(path.join(dir, name)) });
      }
    },
  };
}
