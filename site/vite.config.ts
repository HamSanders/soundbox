import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { markdownDocs } from "./plugins/markdown";
import { blogFeed } from "./plugins/blog-feed";
import { sharedPublicFiles } from "./plugins/shared-public";
import { notFoundPage } from "./plugins/not-found";
import { writeSitemap } from "./plugins/sitemap";
import { sfxSampleFacts } from "./plugins/sfx-sample-facts";

/**
 * Where the site is served from, for hosts that put it under a path.
 *
 * `SITE_BASE=/soundbox/` builds for a GitHub Pages project site
 * (`https://hamsanders.github.io/soundbox/`); unset, the site is built for a
 * domain root, which is what Vercel (vercel.json) and `npm run site:dev` serve. The router's
 * `basename` (src/main.tsx) and every raw URL (`@/lib/asset-url`) follow
 * `import.meta.env.BASE_URL`, which Vite derives from this.
 */
const SITE_BASE = normalizeBase(process.env.SITE_BASE);

/**
 * `SITE_ORIGIN=https://hamsanders.github.io` is the short spelling of
 * `VITE_SITE_ORIGIN`, the origin canonical/og:url/RSS links are built from.
 * Copied across before Vite loads its env so `import.meta.env` and the plugins
 * reading `config.env` (blog-feed) both see it.
 *
 * On Vercel, with neither set, the project's production domain is used
 * (`VERCEL_PROJECT_PRODUCTION_URL`, a bare host). Preview deployments get it
 * too, so their canonical links point at production rather than at a
 * throwaway preview URL.
 */
const SITE_ORIGIN =
  process.env.SITE_ORIGIN ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
if (SITE_ORIGIN && !process.env.VITE_SITE_ORIGIN) {
  process.env.VITE_SITE_ORIGIN = SITE_ORIGIN.replace(/\/+$/, "");
}

/**
 * Point the site's and the borrowed app components' `react-router-dom`
 * imports at `src/router-links.tsx`, whose `Link`/`NavLink` add the trailing
 * slash each prerendered page is served at. Imports from that file itself, and
 * from anything in node_modules (vite-react-ssg's own renderer), get the real
 * package.
 */
function trailingSlashLinks(): Plugin {
  const shim = path.resolve(__dirname, "src/router-links.tsx");
  const ours = [path.resolve(__dirname, "src"), path.resolve(__dirname, "../app/src")];
  return {
    name: "soundbox:trailing-slash-links",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "react-router-dom" || !importer) return null;
      const from = path.resolve(importer.split("?")[0]);
      if (from === shim || !ours.some((dir) => from.startsWith(dir + path.sep))) return null;
      return shim;
    },
  };
}

function normalizeBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

// The public `/sfx` site: a thin second Vite entry over the same source as
// `app/` — a separate target rather than trying to make the HashRouter SPA
// crawlable in place.
//
// One design system, one player, two build targets: everything under `@/*`
// resolves straight into `../app/src`, so a component written once for the
// app "just works" here too, as long as it doesn't reach for something that
// only exists with a live backend behind it (the `/sfx` pages don't).
export default defineConfig({
  base: SITE_BASE,
  /**
   * The site build is, by definition, the public-site target.
   *
   * Baked in here rather than read from an env file, so the marketing pages
   * cannot render as the app just because a `.env` was missing. See
   * `app/src/lib/marketing-links.ts`.
   */
  define: {
    "import.meta.env.VITE_TARGET": JSON.stringify("site"),
  },
  // `markdownDocs` turns `docs/*.md?doc` into `{ title, html, headings }` at
  // build time — see the plugin for why the docs are read rather than copied.
  plugins: [
    trailingSlashLinks(),
    react(),
    tailwindcss(),
    markdownDocs(),
    blogFeed(),
    // Duration and size per sfx sample, for the prerendered sample pages.
    sfxSampleFacts(path.resolve(__dirname, "public/sfx")),
    // Files both builds serve stay in app/public; see the plugin.
    sharedPublicFiles(path.resolve(__dirname, "../app/public"), ["favicon.svg"]),
    // 404.html for static hosts, with links that carry the base path.
    notFoundPage(),
  ],
  resolve: {
    /**
     * One copy of each of these, whichever tree they are reached through.
     *
     * Two router majors live in this repo: `vite-react-ssg` needs react-router
     * 6, so 6 is a root devDependency and sits at the root, while the app it
     * borrows components from has its own 7 under `app/node_modules`. Without
     * this the app's components would resolve their own copies while the
     * site's files resolve the root's. Two Reacts is the
     * "Cannot read properties of null (reading 'useCallback')" crash: the
     * second copy's dispatcher is never installed.
     *
     * `react-router-dom` is in the list for the same reason with the opposite
     * winner — everything on this site has to agree on the v6 that
     * `vite-react-ssg` renders with.
     */
    dedupe: ["react", "react-dom", "react-router-dom", "radix-ui"],
    alias: [
      // Site-specific override: the app's SeoHead writes tags via a
      // useEffect, which produces nothing during SSR. This must be listed
      // before the general "@" alias below so it wins for this one path.
      { find: "@/components/seo-head", replacement: path.resolve(__dirname, "./src/seo-head.tsx") },
      // Escape hatch back to the real app source, used by the override above
      // to re-export the pure (non-head-writing) helpers unchanged.
      { find: "@sfx-app", replacement: path.resolve(__dirname, "../app/src") },
      { find: "@", replacement: path.resolve(__dirname, "../app/src") },
    ],
  },
  /**
   * Bundle every dependency into the SSR pass rather than leaving them for
   * Node to resolve.
   *
   * The app and the site resolve some packages from different trees (the
   * app's react-router 7 is nested under `app/node_modules`; the site renders
   * with the root's 6, which `vite-react-ssg` needs). An externalised
   * dependency is resolved by Node, not by Vite, so `lucide-react`
   * would `require("react")` and walk up to the repo root while the renderer
   * itself used the copy of `react-dom` next door. Two Reacts, and every
   * component that touches a context dies with "Cannot read properties of null
   * (reading 'useContext')" — during prerender, so the page 500s rather than
   * degrading.
   *
   * `resolve.dedupe` cannot fix that on its own: it only reaches modules Vite
   * itself resolves. Bundling makes Vite resolve all of them, and dedupe then
   * applies.
   */
  ssr: {
    // The UI packages only — everything that calls a React hook. `true` would
    // also inline React's own CJS entry points, which the module runner cannot
    // evaluate ("module is not defined"), and React itself does not need to be
    // bundled: the renderer resolves it from this directory either way.
    noExternal: [
      "lucide-react",
      "radix-ui",
      "next-themes",
      "zustand",
      "sonner",
      "wavesurfer.js",
      "class-variance-authority",
      "tailwind-merge",
    ],
  },
  // The site's own media: /sfx and /music sample MP3s + manifests and covers,
  // blog images, product screenshots. None of it ships with the app. The
  // scripts/gen-*-tracks.mjs and scripts/gen-sfx-samples.ts renderers write
  // here.
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  ssgOptions: {
    // /sfx/8bit -> /sfx/8bit/index.html, not /sfx/8bit.html — plain static
    // hosts (Vercel, Cloudflare Pages, Netlify, GitHub Pages) all serve that shape
    // at the clean URL without extra rewrite rules.
    dirStyle: "nested",
    // Dynamic routes are prerendered only for the paths their
    // getStaticPaths returns (routes.tsx) — e.g. only SFX_CATEGORIES entries
    // with `content` (see isPublished in content/sfx/types.ts). This keeps
    // the hub itself and the other static routes in the default set.
    includeAllRoutes: false,
    // Runs once every page is on disk, so the sitemap is exactly what was
    // prerendered. See plugins/sitemap.ts.
    onFinished(dir) {
      const count = writeSitemap(dir, process.env.VITE_SITE_ORIGIN ?? "", SITE_BASE);
      if (count) console.log(`[sitemap] ${count} URLs -> sitemap.xml`);
    },
  },
});
