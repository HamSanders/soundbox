/**
 * Search across everything the site publishes.
 *
 * Pagefind indexes the *built* output — it runs after `vite-react-ssg build`
 * and reads the HTML files, so there is no index to keep in sync with the
 * content and no server to run. It also means search covers the SFX and music
 * pages as well as the docs, because those are static files too.
 *
 * The index is fetched on the first keystroke, not on page load: it is a few
 * hundred kilobytes that most visitors never need, and a docs page should not
 * pay for a search box it did not use.
 *
 * In dev there is no build output, so the box says so rather than sitting
 * there swallowing keystrokes.
 */

import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/lib/icons";

import { cn } from "@/lib/utils";

/** Strip tags until none are left: one pass turns `<<b>script>` into `<script>`. */
function stripTags(html: string): string {
  let text = html;
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text;
}

interface PagefindResult {
  id: string;
  data: () => Promise<{
    url: string;
    meta: { title?: string };
    excerpt: string;
  }>;
}

interface Pagefind {
  search: (term: string) => Promise<{ results: PagefindResult[] }>;
}

interface Hit {
  url: string;
  title: string;
  excerpt: string;
}

/** Resolved once, and only when somebody types. */
let pagefind: Promise<Pagefind | null> | null = null;

function loadPagefind(): Promise<Pagefind | null> {
  pagefind ??= import(/* @vite-ignore */ `${import.meta.env.BASE_URL}pagefind/pagefind.js`)
    .then((module: unknown) => module as Pagefind)
    .catch(() => null); // not built yet — dev, or a build without the index
  return pagefind;
}

export function DocSearch() {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [missing, setMissing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    // A short wait so a fast typist makes one query rather than eight.
    const timer = setTimeout(async () => {
      const engine = await loadPagefind();
      if (!live) return;
      if (engine === null) {
        setMissing(true);
        return;
      }
      const { results } = await engine.search(query);
      const top = await Promise.all(results.slice(0, 8).map((r) => r.data()));
      if (!live) return;
      setHits(
        top.map((d) => ({
          url: d.url,
          title: d.meta.title ?? d.url,
          // Pagefind marks the matched words with <mark>; the excerpt is
          // rendered as text, so those tags are stripped rather than shown.
          excerpt: stripTags(d.excerpt),
        })),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  // Clicking anywhere else closes the results, the way a search suggestion
  // list should.
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setHits(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <SearchIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search the docs…"
        aria-label="Search the documentation"
        className={cn(
          "border-border/70 bg-background/60 focus-visible:border-ring focus-visible:ring-ring/40 h-8 w-full rounded-lg border pl-8 text-sm outline-none focus-visible:ring-3",
        )}
      />

      {missing && term.trim().length >= 2 && (
        <p className="text-muted-foreground mt-1.5 text-xs leading-snug">
          Search is built with the site. Run <code>npm run site:build</code> to try it
          locally.
        </p>
      )}

      {hits !== null && (
        <div className="border-border bg-popover absolute top-full right-0 left-0 z-30 mt-1 max-h-96 overflow-y-auto rounded-xl border p-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-sm">No matches.</p>
          ) : (
            hits.map((hit) => (
              <a
                key={hit.url}
                href={hit.url}
                className="hover:bg-accent block rounded-lg px-2 py-1.5"
              >
                <span className="block truncate text-sm font-medium">{hit.title}</span>
                <span className="text-muted-foreground line-clamp-2 block text-xs leading-snug">
                  {hit.excerpt}
                </span>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
