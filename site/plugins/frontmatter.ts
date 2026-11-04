/**
 * The frontmatter block at the top of a blog post, parsed.
 *
 * This is deliberately not a YAML parser. The field set is closed — seven keys,
 * scalars plus one list — and a real YAML dependency would buy anchors, nested
 * maps, multi-line scalars and date coercion, every one of which is a way for a
 * post to mean something other than it looks like it means.
 *
 * It is also not `frontMatter()` from `server/src/skills.ts`. That one reads two
 * flat string keys out of a `SKILL.md` and is right to; it handles neither lists
 * nor booleans, so `tags` and `draft` would both come out as strings and
 * `draft: "false"` is truthy. The precedent this repo sets is that a small
 * closed format gets a small parser written for it, not that this particular
 * parser gets extended.
 *
 * Everything here throws rather than coerces. A post with an unparseable date
 * should fail the build; the alternative is a post that publishes quietly with
 * the wrong one, and nobody re-reads a date they didn't have to fix.
 *
 * Imported by both `plugins/markdown.ts` (the Vite `load` hook) and
 * `plugins/blog-feed.ts` (a plain Node build hook), which is why it imports
 * nothing from Vite: the feed emitter is bundled into `vite.config.ts` by
 * esbuild, which cannot follow a `?doc` import.
 */

/** A frontmatter value. Lists exist for `tags`; nothing else needs one. */
export type FmValue = string | boolean | string[];

export interface BlogFrontmatter {
  /** Optional — the post's own `# Heading` is the usual source. */
  title?: string;
  /** The index card's line, and the page's meta description. Under ~155 chars. */
  description: string;
  /** `YYYY-MM-DD`. Sorts correctly as a string, which is why it stays one. */
  date: string;
  /** `YYYY-MM-DD`, when the post has been revised since it went out. */
  updated?: string;
  tags: string[];
  author: string;
  /** Drafts render in dev and are absent from a production build entirely. */
  draft: boolean;
  /** Root-relative, e.g. `/blog/why-audio-cpp.jpg`. 1200x630. */
  image?: string;
  /** Root-relative path to a spoken version of the post, e.g.
   *  `/blog/audio/why-audio-cpp.mp3`. Konchi reads its own blog. */
  audio?: string;
}

/** Leading BOM tolerated because editors add one and the failure is baffling. */
const FM_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const KNOWN_KEYS = new Set([
  "title",
  "description",
  "date",
  "updated",
  "tags",
  "author",
  "draft",
  "image",
  "audio",
]);

function unquote(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Split a source file into its frontmatter map and the markdown after it.
 *
 * A file with no frontmatter block is not an error — every file in `docs/` is
 * one, and they go through the same markdown plugin.
 */
export function splitFrontmatter(source: string): {
  data: Record<string, FmValue>;
  body: string;
} {
  const match = FM_RE.exec(source);
  if (!match) return { data: {}, body: source };
  return { data: parseBlock(match[1]!), body: source.slice(match[0].length) };
}

function parseBlock(block: string): Record<string, FmValue> {
  const out: Record<string, FmValue> = {};
  // The key whose value is a `- item` list, if the previous line opened one.
  let listKey: string | null = null;

  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;

    const item = /^[ \t]*-[ \t]+(.*)$/.exec(raw);
    if (item) {
      if (!listKey) throw new Error(`list item before any key: ${raw.trim()}`);
      (out[listKey] as string[]).push(unquote(item[1]!.trim()));
      continue;
    }

    // Indentation here means a nested map, which this format does not have.
    // Saying so beats parsing it as a key with a strange name.
    if (/^[ \t]/.test(raw)) throw new Error(`nested values are not supported: ${raw.trim()}`);

    const colon = raw.indexOf(":");
    if (colon === -1) throw new Error(`not a \`key: value\` line: ${raw.trim()}`);

    const key = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();

    if (value === "") {
      // A bare `key:` opens a `- item` list on the following lines.
      listKey = key;
      out[key] = [];
      continue;
    }

    listKey = null;

    if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = value
        .slice(1, -1)
        .split(",")
        .map((entry) => unquote(entry.trim()))
        .filter(Boolean);
    } else if (value === "true" || value === "false") {
      out[key] = value === "true";
    } else {
      out[key] = unquote(value);
    }
  }

  return out;
}

function str(data: Record<string, FmValue>, key: string, file: string): string | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${file}: \`${key}\` must be text`);
  return value;
}

/**
 * Validate a parsed block as a blog post's frontmatter.
 *
 * Unknown keys are an error rather than an oversight: `drafts: true` is a typo
 * that would otherwise publish the post.
 */
export function parseBlogFrontmatter(data: Record<string, FmValue>, file: string): BlogFrontmatter {
  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(
        `${file}: unknown frontmatter key \`${key}\` (expected one of ${[...KNOWN_KEYS].join(", ")})`,
      );
    }
  }

  const description = str(data, "description", file);
  if (!description) throw new Error(`${file}: \`description\` is required`);

  const author = str(data, "author", file);
  if (!author) throw new Error(`${file}: \`author\` is required`);

  const date = str(data, "date", file);
  if (!date) throw new Error(`${file}: \`date\` is required`);
  if (!DATE_RE.test(date)) throw new Error(`${file}: \`date\` must be YYYY-MM-DD, got \`${date}\``);

  const updated = str(data, "updated", file);
  if (updated !== undefined && !DATE_RE.test(updated)) {
    throw new Error(`${file}: \`updated\` must be YYYY-MM-DD, got \`${updated}\``);
  }

  const rawTags = data.tags ?? [];
  if (!Array.isArray(rawTags)) throw new Error(`${file}: \`tags\` must be a list`);

  const draft = data.draft ?? false;
  if (typeof draft !== "boolean") throw new Error(`${file}: \`draft\` must be true or false`);

  return {
    title: str(data, "title", file),
    description,
    date,
    updated,
    tags: rawTags,
    author,
    draft,
    image: str(data, "image", file),
    audio: str(data, "audio", file),
  };
}
