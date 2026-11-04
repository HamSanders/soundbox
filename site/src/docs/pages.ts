/**
 * Which markdown files are pages, and in what order.
 *
 * Listed rather than globbed: the order *is* the reading order, and a
 * directory listing would put "API" first because of the alphabet. A new doc
 * is a line here, which is also where you decide whether it belongs in the
 * "Start here" half or the reference half.
 */

import * as install from "../../../docs/INSTALL.md?doc";
import * as architecture from "../../../docs/ARCHITECTURE.md?doc";
import * as generating from "../../../docs/GENERATING.md?doc";
import * as studio from "../../../docs/STUDIO.md?doc";
import * as library from "../../../docs/LIBRARY.md?doc";
import * as artwork from "../../../docs/ARTWORK.md?doc";
import * as endpoints from "../../../docs/ENDPOINTS.md?doc";
import * as audiocpp from "../../../docs/AUDIOCPP.md?doc";
import * as desktop from "../../../docs/DESKTOP.md?doc";
import * as api from "../../../docs/API.md?doc";
import * as mcp from "../../../docs/MCP.md?doc";
import type { DocHeading } from "../../plugins/markdown";
import { MCP_TOOLS } from "@/content/mcp/tools";

export interface DocPage {
  slug: string;
  /** Sidebar label. Usually shorter than the document's own `# Title`. */
  label: string;
  section: string;
  title: string;
  html: string;
  headings: DocHeading[];
  /** One line under the title, and the page's meta description unless `description` is set. */
  blurb: string;
  /** `<title>` when the document's own `# Title` is not what anyone searches for. */
  metaTitle?: string;
  /** Meta description, when the on-page blurb is too short to be one. */
  description?: string;
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: "install",
    label: "Install",
    section: "Start here",
    blurb: "Get Konchi running, with models, on your own machine.",
    metaTitle: "Install and run Konchi from source on Windows, macOS or Linux",
    description:
      "Run Konchi from a clone with Node 22: the audio.cpp runtime and its GPU backends, downloading models, gated models, where files live, and Windows notes.",
    ...install,
  },
  {
    slug: "generating",
    label: "Generating sound",
    section: "Using Konchi",
    blurb:
      "Prompt, model, seed and takes: how a generation runs, and what each parameter changes.",
    ...generating,
  },
  {
    slug: "studio",
    label: "The studio",
    section: "Using Konchi",
    blurb:
      "Arranging: lanes and clips, trimming, fades and crossfades, the mixer, the device rack, and the export.",
    ...studio,
  },
  {
    slug: "library",
    label: "Library & projects",
    section: "Using Konchi",
    blurb:
      "Where everything you make goes, how to find it again, and how editing works without destroying the original.",
    ...library,
  },
  {
    // GENERATING.md and API.md both link here; without a page those links
    // were dead on the site.
    slug: "artwork",
    label: "Artwork",
    section: "Using Konchi",
    blurb: "Cover art for generated music, avatars for saved voices, and the image models behind them.",
    ...artwork,
  },
  {
    slug: "endpoints",
    label: "Custom endpoints",
    section: "Using Konchi",
    blurb: "Send generation to a server you already run, such as LocalAI or an OpenAI-compatible speech server.",
    ...endpoints,
  },
  {
    slug: "architecture",
    label: "Architecture",
    section: "Internals",
    blurb:
      "One process, one port: the app, the API, the MCP server, the database and where your files live.",
    ...architecture,
  },
  {
    slug: "audiocpp",
    label: "audio.cpp",
    section: "Internals",
    blurb:
      "The inference engine: one binary, no Python and no CUDA install, and how Konchi picks a backend for your machine.",
    ...audiocpp,
  },
  {
    slug: "desktop",
    label: "Desktop app",
    section: "Internals",
    blurb: "Building and shipping Konchi as a Tauri desktop app.",
    ...desktop,
  },
  {
    slug: "api",
    label: "HTTP API",
    section: "Reference",
    blurb: "The local server's endpoints, and what they take and return.",
    ...api,
  },
  {
    slug: "mcp",
    label: "MCP tools",
    section: "Reference",
    blurb: "The tools an agent gets when it connects to Konchi over MCP.",
    metaTitle: "MCP server reference: tools and connecting a client",
    description: `The ${MCP_TOOLS.length} tools an agent gets over MCP, and how to connect Claude Code or any HTTP or stdio MCP client to Konchi running on your own machine.`,
    ...mcp,
  },
];

/** The sections in the order they should appear, each with its pages. */
export const DOC_SECTIONS: { name: string; pages: DocPage[] }[] = DOC_PAGES.reduce(
  (sections, page) => {
    const existing = sections.find((s) => s.name === page.section);
    if (existing) existing.pages.push(page);
    else sections.push({ name: page.section, pages: [page] });
    return sections;
  },
  [] as { name: string; pages: DocPage[] }[],
);

export function docBySlug(slug: string): DocPage | null {
  return DOC_PAGES.find((p) => p.slug === slug) ?? null;
}
