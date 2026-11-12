/**
 * A post's spoken version: where the recording is, who reads it, and when
 * each paragraph starts.
 *
 * Written by `scripts/blog-narration.mjs finish` into
 * `content/blog/narration/<slug>.json`, and imported here at build time so
 * the Listen card's duration and narrator are in the prerendered HTML rather
 * than appearing after a fetch. The JSON sits beside the posts rather than
 * beside the MP3 in `public/` because Vite will not import from `public/`.
 */

export interface Narration {
  /** Root-relative, the same path as the post's `audio` frontmatter. */
  audio: string;
  /** 0–1 loudness per bar, for the scrubber. Drawn before any audio loads. */
  peaks: number[];
  /** First name, as the card shows it. */
  narrator: string;
  /** One line saying what the voice is, synthetic included. */
  voice: string;
  model: string;
  /** Seconds. */
  duration: number;
  /** Start time of each readable block, in `blogReadableBlocks` order. */
  blocks: number[];
}

const files = import.meta.glob<Narration>("../../content/blog/narration/*.json", {
  eager: true,
  import: "default",
});

const BY_SLUG = new Map(
  Object.entries(files).map(([path, data]) => [path.slice(path.lastIndexOf("/") + 1, -".json".length), data]),
);

export function narrationFor(slug: string): Narration | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The elements of a rendered post that the narration reads, in order.
 *
 * Has to agree with `blocksOf()` in `scripts/blog-narration.mjs`, which walks
 * the markdown instead: a paragraph with text, a tight list item, or each
 * paragraph inside a loose one. Code, tables, images and headings are not
 * blocks. If the counts ever disagree the player says so in the console and
 * stops highlighting rather than lighting up the wrong paragraph.
 */
export function blogReadableBlocks(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("p, li")) {
    if (el.closest("pre, table")) continue;
    if (el.tagName === "LI" && el.querySelector(":scope > p")) continue;
    // A tight item's own words, not those of a list nested inside it.
    const own = el.tagName === "LI" ? ownText(el) : (el.textContent ?? "");
    if (!/[A-Za-z0-9]/.test(own)) continue;
    out.push(el);
  }
  return out;
}

function ownText(li: HTMLElement): string {
  let text = "";
  for (const node of li.childNodes) {
    if (node instanceof HTMLElement && (node.tagName === "UL" || node.tagName === "OL")) continue;
    text += node.textContent ?? "";
  }
  return text;
}

/** `4:52`, `1:02:03`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "4 minutes 52 seconds", for screen readers. */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s % 60 || !m) parts.push(`${s % 60} second${s % 60 === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** The index of the block playing at `time`: the last one that has started. */
export function blockAt(starts: number[], time: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  if (hi < 0 || time < starts[0]!) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= time + 0.05) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
