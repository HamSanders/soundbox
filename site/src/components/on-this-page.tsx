/**
 * The right-hand contents rail, with the scroll-spy that highlights where you
 * are.
 *
 * Lifted out of `src/docs/shell.tsx` when the blog needed it. It was already
 * generic — it read nothing from a `DocPage` but the headings — and an
 * `IntersectionObserver` reimplemented per surface is the kind of duplication
 * that drifts silently, because both copies keep working while only one gets
 * the fix.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import type { DocHeading } from "../../plugins/markdown";

export function OnThisPage({ headings }: { headings: DocHeading[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        // The topmost heading currently on screen, in document order — with
        // several visible at once, the one you are "at" is the first.
        const first = headings.find((h) => seen.has(h.id));
        if (first) setActive(first.id);
      },
      // Only the top third counts as "here": a heading entering the bottom of
      // a tall window is not what you are reading yet.
      { rootMargin: "0px 0px -66% 0px" },
    );
    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="label-caps text-muted-foreground mb-2">
        On this page
      </p>
      <ul className="space-y-1">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.depth === 3 ? "pl-3" : undefined}>
            <a
              href={`#${heading.id}`}
              aria-current={heading.id === active ? "location" : undefined}
              className={cn(
                "block leading-snug transition-colors",
                heading.id === active
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
