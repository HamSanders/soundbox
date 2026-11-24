/**
 * A page of the public site, drawn as the app draws a page: a floating panel
 * on the moving ground, with the app's slim bar along its top (back and
 * forward, then where you are as `Mirli / Sound effects / Video game`).
 *
 * The ground, the icon rail and the ambient field around these panels are the
 * site's layout (site/src/components/app-frame.tsx), which also wraps the
 * site's own pages in this panel. /sfx and /music render it themselves, since
 * their rail panel sits beside it, so it lives here with them in app/src.
 *
 * `--site-dock` is the height of the player docked along the bottom (set by
 * the frame: 72px on /sfx and /music, 0 elsewhere); panels stop 8px above it.
 *
 * Unlike the app, the page scrolls the document rather than the panel: the
 * prerendered HTML stays one long page for crawlers and for `#anchor` links,
 * and the panel simply runs on past the fold.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon, CloudIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCategory } from "@/content/sfx/categories";
import { isPublished } from "@/content/sfx/types";
import { trackBySlug } from "@/content/music/tracks";
import { cloudWaitlistHref } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  to: string;
}

/** Where a /sfx or /music path sits, as the app's header names a page. */
function siteCrumbs(pathname: string): Crumb[] {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const [root, slug, leaf] = parts;
  if (root === "sfx") {
    const trail: Crumb[] = [{ label: "Sound effects", to: "/sfx" }];
    const category = getCategory(slug);
    if (!category || !isPublished(category)) return trail;
    trail.push({ label: category.name, to: `/sfx/${category.slug}` });
    const sample = leaf ? category.content.samples.find((s) => s.slug === leaf) : undefined;
    if (sample) trail.push({ label: sample.title, to: `/sfx/${category.slug}/${sample.slug}` });
    return trail;
  }
  if (root === "music") {
    const trail: Crumb[] = [{ label: "Music", to: "/music" }];
    const track = slug ? trackBySlug(slug) : undefined;
    if (track) trail.push({ label: track.title, to: `/music/${track.slug}` });
    return trail;
  }
  return [];
}

/** The app's header bar, for a site panel. `trail` names the page for paths
 *  outside /sfx and /music, whose names this side of the build cannot see. */
export function SitePanelBar({ trail: given }: { trail?: Crumb[] }) {
  const { pathname } = useLocation();
  const trail = given ?? siteCrumbs(pathname);
  return (
    <div className="bg-background/85 supports-[backdrop-filter]:bg-background/70 z-30 md:sticky md:top-0 flex h-12 items-center gap-1 px-3 backdrop-blur-md md:rounded-t-xl">
      <div className="hidden items-center sm:flex">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => window.history.back()}>
          <ChevronLeftIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" onClick={() => window.history.forward()}>
          <ChevronRightIcon />
        </Button>
      </div>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 px-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="text-muted-foreground shrink-0">
            {trail.length === 0 ? (
              <span aria-current="page" className="text-foreground font-medium">
                Mirli
              </span>
            ) : (
              <Link to="/" className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-3">
                Mirli
              </Link>
            )}
          </li>
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={c.to} className={cn("flex min-w-0 items-center gap-1.5", !last && "shrink-0 max-sm:hidden")}>
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
                {last ? (
                  <span aria-current="page" className="truncate font-medium">
                    {c.label}
                  </span>
                ) : (
                  <Link
                    to={c.to}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 truncate rounded-sm outline-none focus-visible:ring-3"
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {/* Below md the site's own top nav carries these. */}
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <a
          href={cloudWaitlistHref("panel-bar")}
          className="label-caps border-border-strong text-foreground hover:bg-accent focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 outline-none transition-colors focus-visible:ring-3"
        >
          <CloudIcon className="size-3.5" aria-hidden="true" />
          Mirli Cloud
        </a>
        <Link
          to="/download"
          className="label-caps bg-foreground text-background hover:bg-foreground/85 focus-visible:ring-ring/50 inline-flex h-8 items-center rounded-full px-3.5 outline-none transition-colors focus-visible:ring-3"
        >
          Download
        </Link>
      </div>
    </div>
  );
}

/**
 * A page panel: the app's `SidebarInset` look (solid fill, rounded, a hairline
 * ring) from `md` up, edge to edge below it, with the bar along its top.
 */
export function SitePanel({
  children,
  className,
  trail,
}: {
  children: ReactNode;
  className?: string;
  trail?: Crumb[];
}) {
  return (
    <div
      className={cn(
        "bg-background text-foreground min-w-0 md:min-h-[calc(100svh-1rem-var(--site-dock,0px))] md:rounded-xl md:ring-1 md:ring-border",
        className,
      )}
    >
      <SitePanelBar trail={trail} />
      {children}
    </div>
  );
}
