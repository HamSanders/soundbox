/**
 * The frame a blog page is drawn in.
 *
 * Not `DocsShell`. That one is three columns because a docs reader arrives
 * from a search result knowing one heading's name and needs to see where it
 * sits in the whole; its left column is a table of contents for the entire
 * manual. A post has no such whole to sit inside — you arrive at it, you read
 * it, you leave — so the left column would be a list of other posts, which is
 * an index pretending to be navigation.
 *
 * What is worth sharing is the scroll-spy, and that moved to
 * `components/on-this-page.tsx` rather than being copied.
 */

import type React from "react";

import { OnThisPage } from "../components/on-this-page";
import type { DocHeading } from "../../plugins/markdown";

export function BlogShell({
  headings,
  children,
}: {
  /** Omitted by the index, which has no headings of its own to offer. */
  headings?: DocHeading[];
  children: React.ReactNode;
}) {
  const hasContents = (headings?.length ?? 0) > 0;
  return (
    <div className="mx-auto flex w-full max-w-5xl gap-12 px-4 py-10 lg:py-16">
      <div className="min-w-0 flex-1">{children}</div>
      {hasContents && (
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-24 md:top-16">
            <OnThisPage headings={headings!} />
          </div>
        </aside>
      )}
    </div>
  );
}
