/**
 * `/blog/rss.xml`, written straight to disk.
 *
 * The feed cannot import `src/blog/posts.ts`. That module is built around
 * `import.meta.glob` and `*.md?doc`, both of which only mean anything inside
 * Vite's own module graph — and this hook runs in plain Node, bundled into
 * `vite.config.ts` by esbuild. So it re-reads the same directory with the same
 * parser instead. Two readers, one format, one definition of `draft`.
 *
 * It also serves the feed from the dev server, because a feed you cannot look
 * at until you have run a production build is a feed nobody checks.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Plugin } from "vite";

import { parseBlogFrontmatter, splitFrontmatter, type BlogFrontmatter } from "./frontmatter";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../content/blog");

const FEED_PATH = "/blog/rss.xml";

interface FeedItem extends BlogFrontmatter {
  slug: string;
  title: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RFC 822, which is what RSS wants and ISO is not. */
function rfc822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

async function collect(): Promise<FeedItem[]> {
  let files: string[];
  try {
    files = await readdir(CONTENT_DIR);
  } catch {
    // No posts directory yet is not a build failure.
    return [];
  }

  const posts = await Promise.all(
    files
      .filter((file) => file.endsWith(".md") && file !== "README.md")
      .map(async (file) => {
        const source = await readFile(path.join(CONTENT_DIR, file), "utf8");
        const { data, body } = splitFrontmatter(source);
        const front = parseBlogFrontmatter(data, `content/blog/${file}`);
        const slug = file.slice(0, -".md".length);
        const heading = /^#[ \t]+(.+)$/m.exec(body);
        return { ...front, slug, title: front.title ?? heading?.[1]?.trim() ?? slug };
      }),
  );

  // Drafts never reach a feed, not even under VITE_DRAFTS. A reader has no dev
  // mode, and an item it has already pulled cannot be recalled.
  return posts
    .filter((post) => !post.draft)
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
}

/**
 * `root` is origin + the build's base without its trailing slash, e.g.
 * "https://hamsanders.github.io/soundbox" — or just the base path when no origin
 * is configured.
 */
function renderFeed(items: FeedItem[], root: string): string {
  const self = `${root}${FEED_PATH}`;
  // The newest post, not the build clock: stamping `Date.now()` here makes
  // every rebuild look to a reader like something changed.
  const built = items[0] ? rfc822(items[0].updated ?? items[0].date) : rfc822("1970-01-01");

  const entries = items
    .map((item) => {
      // Trailing slash: the page lives at blog/<slug>/index.html, and the
      // slashless URL is a 301 on a static host.
      const url = `${root}/blog/${item.slug}/`;
      return [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${rfc822(item.date)}</pubDate>`,
        `      <description>${escapeXml(item.description)}</description>`,
        ...item.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  // Descriptions only, not the rendered post. The HTML carries Shiki's inline
  // styles, which no reader honours, and `<content:encoded>` needs its CDATA
  // split around any `]]>` to be safe. Worth doing when someone asks for it.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Konchi</title>",
    `    <link>${escapeXml(`${root}/`)}</link>`,
    "    <description>How Konchi is built, how the models behave, and how to get better sound out of them.</description>",
    "    <language>en-gb</language>",
    `    <lastBuildDate>${built}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />`,
    entries,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function blogFeed(): Plugin {
  let isSsrBuild = false;
  let outDir = "";
  let origin = "";
  // The deploy's base path ("/" or e.g. "/soundbox/"), from Vite's `base`.
  let base = "/";
  const root = () => `${origin}${base.replace(/\/$/, "")}`;

  return {
    name: "konchi:blog-feed",

    configResolved(config) {
      isSsrBuild = Boolean(config.build.ssr);
      outDir = path.resolve(config.root, config.build.outDir || "dist");
      origin = ((config.env.VITE_SITE_ORIGIN as string) || "").replace(/\/+$/, "");
      base = config.base || "/";
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Custom middlewares run before Vite strips the base, so match it whole.
        if ((req.url ?? "").split("?")[0] !== `${base.replace(/\/$/, "")}${FEED_PATH}`) return next();
        void collect().then((items) => {
          res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
          res.end(renderFeed(items, root()));
        }, next);
      });
    },

    async closeBundle() {
      // Two builds run through this config. The SSR pass writes into
      // `.vite-react-ssg-temp/<hash>`, which is deleted as soon as prerendering
      // finishes — the feed belongs to the client pass's `dist/`, which is
      // emptied at the *start* of that build and so still exists here.
      if (isSsrBuild) return;
      if (!origin) {
        this.warn(
          "VITE_SITE_ORIGIN is unset — /blog/rss.xml will ship relative links, which most readers reject.",
        );
      }
      const items = await collect();
      await mkdir(path.join(outDir, "blog"), { recursive: true });
      await writeFile(path.join(outDir, "blog", "rss.xml"), renderFeed(items, root()), "utf8");
    },
  };
}
