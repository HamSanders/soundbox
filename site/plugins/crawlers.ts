/**
 * `robots.txt` and `llms.txt`, written after the prerender like the sitemap.
 *
 * Both are read only at a host's root, so they are written only for a root
 * build (Vercel). A GitHub Pages project site at `/soundbox/` would put them
 * where no crawler looks.
 *
 * `robots.txt` allows everything, AI crawlers included (GPTBot, ClaudeBot,
 * PerplexityBot and Google-Extended read the `*` group), and points at the
 * sitemap. A preview deploy (`VERCEL_ENV=preview`) disallows everything, so
 * throwaway URLs stay out of the index.
 *
 * `llms.txt` (https://llmstxt.org) is a plain markdown map of the site for
 * answer engines: one line per page, with the title and meta description
 * the page already carries, grouped by top-level section.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Page {
  rel: string;
  title: string;
  description: string;
}

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
    console.warn("[crawlers] VITE_SITE_ORIGIN is unset; no llms.txt written.");
    return;
  }
  const all = pages(dir).sort((a, b) => a.rel.localeCompare(b.rel));
  const home = all.find((p) => p.rel === "");
  const sections = new Map<string, Page[]>();
  for (const page of all) {
    if (!page.rel || page.rel.split("/").length > 3) continue;
    const section = page.rel.split("/")[0];
    sections.set(section, [...(sections.get(section) ?? []), page]);
  }
  const line = (p: Page) =>
    `- [${p.title || p.rel}](${root}/${p.rel})${p.description ? `: ${p.description}` : ""}`;
  const body = [
    `# ${home?.title || "Konchi"}`,
    "",
    `> ${home?.description || "Konchi makes sound effects, music and voices locally from open-weight models."}`,
    "",
    "Source code: https://github.com/HamSanders/soundbox",
    "",
    ...[...sections].flatMap(([name, list]) => [
      `## ${name[0].toUpperCase()}${name.slice(1)}`,
      "",
      ...list.map(line),
      "",
    ]),
  ];
  writeFileSync(path.join(dir, "llms.txt"), body.join("\n"), "utf8");
  console.log(
    `[crawlers] robots.txt${preview ? " (preview, disallow all)" : ""} + llms.txt (${all.length} pages)`,
  );
}
