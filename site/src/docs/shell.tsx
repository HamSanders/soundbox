/**
 * The frame every documentation page is drawn in: contents on the left, the
 * page in the middle, its own headings on the right.
 *
 * The three-column shape is what a docs site is for — you arrive from a search
 * result knowing one heading's name and need to see where it sits in the whole
 * before you trust the answer. Both side columns collapse away under `lg`,
 * where there is no room to sit beside anything: the sidebar becomes a
 * disclosure above the page, and the on-page contents simply go, because a
 * phone screen scrolls faster than it navigates.
 *
 * The API reference (`/docs`) uses this too, with no headings of its own to
 * offer — it is generated, and its own body renders its own navigation.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { OnThisPage } from "../components/on-this-page";
import { DOC_SECTIONS, type DocPage } from "./pages";
import { DocSearch } from "./search";

function Sidebar({ current }: { current: string }) {
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      <Link
        to="/docs"
        aria-current={current === "index" ? "page" : undefined}
        className={cn(
          "block border-l-2 py-1 pl-3 transition-colors",
          current === "index"
            ? "border-primary text-foreground font-medium"
            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
        )}
      >
        All docs
      </Link>
      {DOC_SECTIONS.map((section) => (
        <div key={section.name}>
          <p className="label-caps text-muted-foreground mb-2">
            {section.name}
          </p>
          <ul className="space-y-0.5">
            {section.pages.map((page) => (
              <li key={page.slug}>
                <Link
                  to={`/docs/${page.slug}`}
                  aria-current={page.slug === current ? "page" : undefined}
                  className={cn(
                    // A teal rule down the active item rather than a filled
                    // pill: the accent is how this site says "you are here",
                    // and a block of muted grey competes with the code blocks.
                    "block border-l-2 py-1 pl-3 transition-colors",
                    page.slug === current
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                  )}
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <p className="label-caps text-muted-foreground mb-2">
          Generated
        </p>
        <Link
          to="/docs/reference"
          aria-current={current === "api-reference" ? "page" : undefined}
          className={cn(
            "block border-l-2 py-1 pl-3 transition-colors",
            current === "api-reference"
              ? "border-primary text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
          )}
        >
          API &amp; MCP reference
        </Link>
      </div>
    </nav>
  );
}

/**
 * The headings of the page you are on, tracking where you have scrolled to.
 *
 * An `IntersectionObserver` rather than a scroll handler: the question is
 * "which heading is on screen", which is the one thing that API answers
 * directly and a scroll position only approximates.
 */
export function DocsShell({
  current,
  page,
  children,
}: {
  /** Slug of the page being shown, or "api-reference" for the API & MCP page. */
  current: string;
  /** Present for a markdown page: drives the right-hand contents. */
  page?: DocPage;
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // A link inside the sidebar has been followed: on a narrow screen the
  // sidebar is covering the page it just navigated to.
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-12 px-4 py-10 lg:py-16">
      {/* ------------------------------------------------------- contents */}
      <div className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-24 space-y-7">
          <DocSearch />
          <Sidebar current={current} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-6 lg:hidden">
          <DocSearch />
          <button
            type="button"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
            className="text-muted-foreground hover:text-foreground mt-3 flex items-center gap-1 text-sm"
          >
            <ChevronRightIcon
              className={cn("size-4 transition-transform", navOpen && "rotate-90")}
            />
            All documentation
          </button>
          {navOpen && (
            <div className="border-border/60 mt-3 rounded-xl border p-3">
              <Sidebar current={current} />
            </div>
          )}
        </div>

        {children}
      </div>

      {/* --------------------------------------------------- on this page */}
      {page && page.headings.length > 0 && (
        <div className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-24">
            <OnThisPage headings={page.headings} />
          </div>
        </div>
      )}
    </div>
  );
}
