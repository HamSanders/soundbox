/**
 * Where the marketing pages' CTAs point.
 *
 * These pages — the landing page, `/sfx`, `/music` and the model write-ups —
 * used to be built twice: once inside the app, where "open the generator"
 * could be an in-app route, and once on the public static site, where there is
 * no generator to open. Every constant here was a ternary on that difference.
 *
 * They now live *only* in `site/` (see `site/src/routes.tsx`; the app's router
 * has no marketing tier at all), so there is one answer per link rather than
 * two. What remains is the split that was always real: some of these
 * destinations are pages on the site, and some are off-site, because the thing
 * they point at is a piece of software you install rather than a page you can
 * visit.
 */

/**
 * Where the project lives on GitHub.
 *
 * Read from `VITE_REPO_URL` so a fork does not have to hunt down link
 * definitions in seven files — which is what this replaced. Every other module
 * imports `REPO_URL` from here rather than declaring its own copy.
 *
 * The fallback is the canonical repo, so a build with no env set still
 * produces working links rather than `undefined/blob/main/...`. Vite inlines
 * this at build time and only exposes `VITE_`-prefixed vars, so the name has
 * to keep that prefix to reach the browser at all.
 */
export const REPO_URL: string =
  import.meta.env.VITE_REPO_URL || "https://github.com/HamSanders/soundbox";

/** A path inside the repo, on the default branch. Saves every caller
 *  re-spelling `/blob/main/`. */
export function repoFile(path: string): string {
  return `${REPO_URL}/blob/main/${path.replace(/^\/+/, "")}`;
}

/** The public site's own origin, for the app linking back out to it. Until the
 *  site has a domain of its own this is the repository, which is where someone
 *  asking "what is this" is actually best served. */
export const SITE_URL = REPO_URL;

/**
 * "Open the generator".
 *
 * Off-site on purpose: the generator is the local app, and a visitor reading
 * the marketing site does not have it yet. Sending them to a route that only
 * exists on `127.0.0.1` would be a broken link dressed as a CTA.
 */
export const GENERATOR_HREF = "/download";

/** "What Konchi is" — the landing page, which is now the site's front door. */
export const WELCOME_HREF = "/";

/**
 * The studio write-up.
 *
 * On-site, unlike `GENERATOR_HREF`: the studio page is marketing about the
 * timeline, not the timeline itself, so there is a real prerendered URL to
 * send someone to. The landing page links here rather than inlining the
 * studio sections, which is the whole reason this constant exists.
 */
export const STUDIO_HREF = "/studio";

/** The model write-ups. No longer needs to dodge the app's own `/models`
 *  route (the download/load-into-VRAM screen), because that route is in a
 *  different build now. */
export const MODELS_HUB_HREF = "/models";

/** Whether an href leaves the site. Replaces the old build-target flag: what
 *  decides between `<a>` and `<Link>` is the destination, not which bundle is
 *  rendering — see `components/marketing-link`. */
export function isExternalHref(href: string): boolean {
  return /^[a-z]+:/i.test(href);
}
