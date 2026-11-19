/**
 * The files crawlers and agents read, written after the prerender like the
 * sitemap: `robots.txt`, `llms.txt`, `llms-full.txt`, and Markdown versions of
 * the pages that have a Markdown source. The standards behind each one, with
 * sources and their status, are in `docs/agents-discovery.md`.
 *
 * They are read only at a host's root, so they are written only for a root
 * build (Vercel). A GitHub Pages project site at `/soundbox/` would put them
 * where no crawler looks.
 *
 * - **`robots.txt`** allows everything and points at the sitemap. Under RFC
 *   9309 a crawler with no group of its own follows the `*` group, so GPTBot,
 *   OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended
 *   and the rest are all admitted without naming them. A preview deploy
 *   (`VERCEL_ENV=preview`) disallows everything, so throwaway URLs stay out of
 *   the index.
 * - **`llms.txt`** (https://llmstxt.org) is curated, not a dump of every page:
 *   the H1, a blockquote summary, a paragraph on the identifiers that kept the
 *   old name, then file lists. "Start here" is the developers page, "Docs"
 *   links each doc's Markdown version, "Product" is the handful of pages that
 *   say what Mirli is, and "Optional" (the spec's name for what an agent can
 *   skip) holds the catalogue: sound categories, models, music, posts.
 * - **`llms-full.txt`** (Mintlify's convention, not part of llmstxt.org) is
 *   the developers page followed by the agent-relevant docs, in one file.
 * - **Markdown versions**, per the llms.txt proposal: a page served at
 *   `/x/` gets `/x/index.md`. `/developers/index.md` is rendered from the same
 *   module as the page (`src/developers/content.ts`); each `/docs/<slug>/`
 *   gets its `docs/*.md` source with links made absolute. The React marketing
 *   pages have no Markdown source and get none.
 * - **Discovery links** (llms.txt v2): every page gets
 *   `<link rel="describedby" href="/llms.txt">`, and each page with a Markdown
 *   version gets `<link rel="alternate" type="text/markdown">` pointing at it.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readDeveloperFacts } from "./developer-facts";
import { PAGE, REPO, developersMarkdown } from "../src/developers/content";

interface Page {
  rel: string;
  title: string;
  description: string;
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

/** In llms-full.txt after the developers page, in this order. */
const FULL_DOCS = ["MCP.md", "API.md", "INSTALL.md", "INSTALL-AGENT.md", "STREAMING.md"];

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function pages(dir: string, rel = ""): Page[] {
  const out: Page[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...pages(path.join(dir, entry.name), `${rel}${entry.name}/`));
    } else if (entry.name === "index.html") {
      const html = readFileSync(path.join(dir, entry.name), "utf8");
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? "";
      const description =
        html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1] ??
        "";
      if (/<meta[^>]*name="robots"[^>]*noindex/.test(html)) continue;
      out.push({
        rel,
        title: decode(title.trim()),
        description: decode(description.trim()),
      });
    }
  }
  return out;
}

/** `docs/FOO.md` for a built `/docs/foo/` page, if there is one. */
function docSource(slug: string): string | undefined {
  const file = readdirSync(DOCS_DIR).find(
    (f) => f.endsWith(".md") && f.slice(0, -3).toLowerCase() === slug,
  );
  return file && path.join(DOCS_DIR, file);
}

/**
 * A doc's Markdown with every relative link made absolute: another doc that
 * is a page becomes that page's Markdown version (as the HTML renderer in
 * `markdown.ts` maps `FOO.md` to `/docs/foo/`), anything else in the repo
 * becomes its GitHub URL.
 */
function absoluteDoc(file: string, root: string, published: Set<string>): string {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return text.replace(/\]\(([^)\s]+)\)/g, (match, href: string) => {
    if (/^[a-z]+:|^#/i.test(href)) return match;
    const [target, hash = ""] = href.split(/(?=#)/);
    const local = /^\.?\/?([A-Z0-9_-]+)\.md$/i.exec(target);
    if (local && published.has(local[1].toLowerCase()))
      return `](${root}/docs/${local[1].toLowerCase()}/index.md${hash})`;
    const repoPath = path.posix.normalize(path.posix.join("docs", target));
    return `](${REPO}/blob/main/${repoPath}${hash})`;
  });
}

/** Add `<link>` tags before `</head>`. */
function addHeadLinks(file: string, links: string[]): void {
  const html = readFileSync(file, "utf8");
  if (!html.includes("</head>")) return;
  writeFileSync(file, html.replace("</head>", `${links.join("")}</head>`), "utf8");
}

export function writeCrawlerFiles(
  dir: string,
  origin: string,
  base: string,
): void {
  if (base !== "/") return;
  const preview = process.env.VERCEL_ENV === "preview";
  const root = origin.replace(/\/+$/, "");

  const robots = preview
    ? ["User-agent: *", "Disallow: /", ""]
    : [
        "User-agent: *",
        "Allow: /",
        "",
        ...(root ? [`Sitemap: ${root}/sitemap.xml`] : []),
        "",
      ];
  writeFileSync(path.join(dir, "robots.txt"), robots.join("\n"), "utf8");

  if (!root) {
    console.warn(
      "[crawlers] VITE_SITE_ORIGIN is unset; no llms.txt, llms-full.txt or Markdown versions written.",
    );
    return;
  }

  const all = pages(dir).sort((a, b) => a.rel.localeCompare(b.rel));
  const byRel = new Map(all.map((p) => [p.rel, p]));
  const url = (rel: string) => `${root}/${rel}`;

  /* --------------------------------------------------- Markdown versions */
  const facts = readDeveloperFacts(REPO_ROOT);
  const developersMd = developersMarkdown(facts, root);
  const mirrors = new Map<string, string>(); // page rel -> markdown
  if (byRel.has("developers/")) mirrors.set("developers/", developersMd);

  const docSlugs = all
    .map((p) => /^docs\/([^/]+)\/$/.exec(p.rel)?.[1])
    .filter((slug): slug is string => !!slug && !!docSource(slug));
  const published = new Set(docSlugs);
  for (const slug of docSlugs)
    mirrors.set(`docs/${slug}/`, absoluteDoc(docSource(slug)!, root, published));

  for (const [rel, md] of mirrors)
    writeFileSync(path.join(dir, rel, "index.md"), md, "utf8");

  for (const p of all) {
    const links = [`<link rel="describedby" href="/llms.txt">`];
    if (mirrors.has(p.rel))
      links.push(`<link rel="alternate" type="text/markdown" href="/${p.rel}index.md">`);
    addHeadLinks(path.join(dir, p.rel, "index.html"), links);
  }

  /* ------------------------------------------------------------ llms.txt */
  const line = (p: Page, href = url(p.rel), note = p.description) =>
    `- [${p.title || p.rel}](${href})${note ? `: ${note}` : ""}`;
  const listed = (rels: string[]) =>
    rels.flatMap((rel) => {
      const p = byRel.get(rel);
      return p ? [line(p)] : [];
    });

  const docs = docSlugs.map((slug) => {
    const p = byRel.get(`docs/${slug}/`)!;
    return line(p, url(`docs/${slug}/index.md`));
  });
  const PRODUCT = ["", "download/", "mcp/", "studio/", "voices/", "models/", "sfx/", "music/", "press/", "blog/"];
  const optional = all.filter(
    (p) =>
      /^(sfx|models|music|blog)\/[^/]+\/$/.test(p.rel) ||
      (/^[^/]+\/$/.test(p.rel) &&
        !PRODUCT.includes(p.rel) &&
        !["developers/", "docs/"].includes(p.rel)),
  );

  const llms = [
    "# Mirli",
    "",
    `> ${PAGE.summary}`,
    "",
    "Some identifiers kept the product's old name, Soundbox, and are what you type: the MCP tools are `soundbox.*`, the CLI `soundbox`, and the Docker image `ghcr.io/hamsanders/soundbox`. The environment variables are `MIRLI_*`; the old `SOUNDBOX_*` names still work, and are the only ones 0.5.0 and earlier read. To install or drive Mirli, read the developers page first; it has the install paths, MCP config for each client, every tool and the HTTP API on one page.",
    "",
    "## Start here",
    "",
    `- [Mirli for developers and AI agents](${url("developers/index.md")}): ${PAGE.description}`,
    `- [Everything in one file](${url("llms-full.txt")}): The developers page plus the MCP, HTTP API, install, agent-install and streaming docs.`,
    `- [Installing with a coding agent](${REPO}/blob/main/docs/INSTALL-AGENT.md): Step-by-step rules and checks for an agent installing Mirli on the machine it runs on.`,
    `- [server.json](${REPO}/blob/main/server.json): The MCP Registry entry for the server.`,
    "",
    "## Docs",
    "",
    ...docs,
    "",
    "## Product",
    "",
    ...listed(PRODUCT),
    `- [Source code](${REPO}): MIT-licensed. AGENTS.md at the root explains how to build and test it.`,
    "",
    "## Optional",
    "",
    ...optional.map((p) => line(p)),
    "",
  ];
  writeFileSync(path.join(dir, "llms.txt"), llms.join("\n"), "utf8");

  /* ------------------------------------------------------- llms-full.txt */
  const full = [
    developersMd.trimEnd(),
    ...FULL_DOCS.filter((f) => existsSync(path.join(DOCS_DIR, f))).map((f) =>
      [
        "",
        "---",
        "",
        `<!-- Source: ${REPO}/blob/main/docs/${f} -->`,
        "",
        absoluteDoc(path.join(DOCS_DIR, f), root, published).trim(),
      ].join("\n"),
    ),
    "",
  ];
  writeFileSync(path.join(dir, "llms-full.txt"), full.join("\n"), "utf8");

  console.log(
    `[crawlers] robots.txt${preview ? " (preview, disallow all)" : ""} + llms.txt + llms-full.txt + ${mirrors.size} Markdown pages (${facts.tools.length} MCP tools)`,
  );
}
