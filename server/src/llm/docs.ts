/**
 * The manual, cut into pieces the assistant can be handed.
 *
 * Konchi ships 150KB of documentation across a README and eleven files in
 * `docs/`. A small local model has perhaps 38k tokens of context, most of
 * which is already spent on the model catalogue and the open timeline, so
 * "put the docs in the prompt" is not on the table. It has to be asked a
 * question and given the handful of sections that answer it.
 *
 * The retrieval is deliberately dumb: split on headings, score by term
 * overlap, take the best few. No embeddings, no index to rebuild, no second
 * model to run. That is not a compromise here — the corpus is twelve
 * hand-written files with descriptive headings, the vocabulary of a question
 * ("licence", "MCP", "stems", "gated") is the vocabulary of the heading that
 * answers it, and a wrong section costs the reader a paragraph rather than a
 * wrong action. Reach for something cleverer when the docs stop being written
 * by people who name their headings after what is under them.
 *
 * Read once and cached: these files ship with the app and cannot change while
 * it runs. In dev they can, which is what `reload()` is for.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `HERE` is `server/src/llm` in dev and `server/dist/llm` when built — both
 *  two levels under `server/`, which is one under the repo root. */
const REPO = resolve(HERE, "..", "..", "..");

export interface DocSection {
  /** The file it came from, as a reader would name it: "README",
   *  "docs/STUDIO.md". */
  source: string;
  /** The heading text, or the file's own title for the opening section. */
  heading: string;
  /** Heading depth, so a match on an `##` can outrank one on an `######`. */
  level: number;
  /** The headings this one sits under, outermost first. "## Connecting" has
   *  no text of its own — it is all in "### HTTP" and "### stdio" — so a
   *  question about connecting has to be able to find it through them. */
  parents: string[];
  body: string;
}

/**
 * Split a markdown file at its headings.
 *
 * Fenced code is skipped while scanning, because `# comment` inside a shell
 * block is not a heading and splitting there produces a section whose title
 * is a line of bash.
 */
export function splitSections(source: string, markdown: string): DocSection[] {
  const out: DocSection[] = [];
  let heading = source;
  let level = 1;
  let body: string[] = [];
  let fenced = false;
  /** Open headings by depth; index 0 is `#`. */
  const open: (string | undefined)[] = [];

  const flush = (): void => {
    const text = body.join("\n").trim();
    const parents = open.slice(0, level - 1).filter((h): h is string => h !== undefined);
    if (text) out.push({ source, heading, level, parents, body: text });
    body = [];
  };

  // CRLF as well as LF: a Windows checkout (and so a Windows-built installer)
  // has CRLF docs, and with a trailing \r on every line no heading matched —
  // each file came through as one section titled with its own name.
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const match = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      level = match[1]!.length;
      heading = match[2]!.trim();
      open.length = level;
      open[level - 1] = heading;
      continue;
    }
    body.push(line);
  }
  flush();
  return out;
}

let cache: DocSection[] | null = null;

function readAll(): DocSection[] {
  const files: { path: string; source: string }[] = [];
  const readme = join(REPO, "README.md");
  if (existsSync(readme)) files.push({ path: readme, source: "README" });

  const docsDir = join(REPO, "docs");
  if (existsSync(docsDir)) {
    for (const name of readdirSync(docsDir).sort()) {
      if (name.toLowerCase().endsWith(".md")) {
        files.push({ path: join(docsDir, name), source: `docs/${name}` });
      }
    }
  }

  const sections: DocSection[] = [];
  for (const file of files) {
    try {
      sections.push(...splitSections(file.source, readFileSync(file.path, "utf8")));
    } catch {
      // A doc that cannot be read is a doc the assistant does without. The
      // alternative — failing the whole conversation because a file moved —
      // is worse than answering from the other eleven.
    }
  }
  return sections;
}

export function allSections(): DocSection[] {
  if (cache === null) cache = readAll();
  return cache;
}

/** Drop the cache. For tests, and for editing docs with the server up. */
export function reload(): void {
  cache = null;
}

/** Words too common in this corpus to tell two sections apart. Not a general
 *  stopword list — "sound", "audio" and "model" are on it because nearly
 *  every section here contains them. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "it", "its", "this", "that", "at", "by", "as", "from",
  "how", "what", "where", "when", "why", "do", "does", "can", "i", "you",
  "my", "me", "we", "us", "be", "been", "not", "no", "yes", "if", "then",
  "there", "here", "about", "into", "out", "up", "down", "so", "than",
  "sound", "sounds", "audio", "model", "models", "konchi",
]);

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * Fold the endings that most often separate a question from the heading
 * that answers it — "connect" and "## Connecting", "client" and "clients".
 * Deliberately crude: it only has to make the same word meet itself, and a
 * real stemmer's edge cases matter less here than its dependency would.
 */
function stem(word: string): string {
  for (const suffix of ["ing", "ly", "ed", "es", "s"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * The sections most likely to answer a question.
 *
 * A hit in the heading counts for far more than one in the body: headings are
 * what the writer thought the section was about, and a passing mention of
 * "licence" in a paragraph about something else is exactly the match worth
 * losing to "## Licences" next door. Shallow headings win ties for the same
 * reason — an `##` covers its subject, an `#####` covers a corner of it.
 *
 * The file's own name counts a little too: everything in `docs/MCP.md` is
 * about MCP, so its "## Connecting" should beat a passing "## MCP" summary
 * in the API reference for "how do I connect an MCP client?".
 */
export function findSections(question: string, limit = 4): DocSection[] {
  const wanted = new Set(terms(question));
  if (wanted.size === 0) return [];

  return allSections()
    .map((section) => {
      const heads = new Set(terms(section.heading));
      const above = new Set(section.parents.flatMap(terms));
      const bodies = new Set(terms(section.body));
      const file = new Set(terms(section.source.replace(/\.md$/i, "")));
      let score = 0;
      for (const word of wanted) {
        if (heads.has(word)) score += 8;
        else if (above.has(word)) score += 4;
        else if (bodies.has(word)) score += 1;
        if (file.has(word)) score += 3;
      }
      // A section that matches only one word of a six-word question is
      // usually a coincidence; require either a heading hit or real overlap.
      return { section, score: score - section.level * 0.5 };
    })
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.section);
}

/** How much of a section to quote. Long enough to answer, short enough that
 *  four of them still leave room for the conversation. */
const EXCERPT_CHARS = 1200;

/** The retrieved sections as prompt text, each labelled with where it came
 *  from so the answer can say "that is in docs/STUDIO.md" and be checked. */
export function formatSections(sections: DocSection[]): string {
  if (!sections.length) return "  (nothing in the documentation matched)";
  return sections
    .map((s) => {
      const body =
        s.body.length > EXCERPT_CHARS ? `${s.body.slice(0, EXCERPT_CHARS)}…` : s.body;
      return `--- ${s.source} › ${s.heading}\n${body}`;
    })
    .join("\n\n");
}
