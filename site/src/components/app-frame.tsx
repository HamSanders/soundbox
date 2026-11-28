/**
 * The app's frame, around every page of the site: the moving ground behind
 * everything, a slim icon rail down the left as the app's collapsed sidebar,
 * and the page floating on the ground beside it in a panel (`SitePanel` in
 * app/src/components/site/). /sfx and /music draw their own panels, with a
 * rail panel beside the page and the player docked along the bottom; every
 * other page is put in one here, by `FramedPage`.
 *
 * The ground is the app's own `AmbientBackground`, so it follows the same
 * per-browser preference (`ui-prefs`; Pixel by default), draws one still frame
 * under reduced motion, falls back to the flat ground without WebGL, and
 * moves a little with whatever the page is playing.
 *
 * Below `md` there is no rail: the site's top nav takes its place and the
 * panels run edge to edge, as the app does on a phone.
 */

import type { CSSProperties, ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { CloudIcon, DownloadIcon, MoonIcon, NewspaperIcon, ChartNoAxesGanttIcon, SunIcon, type LucideIcon } from "@/lib/icons";

import { AmbientBackground } from "@/components/ambient-background";
import { BrandMark } from "@/components/brand-mark";
import { SitePanel, type Crumb } from "@/components/site/site-frame";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getModel } from "@/content/models/models";
import { cloudWaitlistHref } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

import { postBySlug } from "../blog/posts";
import { docBySlug } from "../docs/pages";
import { getLander } from "../landers/content";
import { GROUPS, SiteHeader } from "./site-header";

/** /sfx and /music: pages that draw their own panels and dock a player. */
function drawsOwnPanel(pathname: string): boolean {
  return /^\/(sfx|music)(\/|$)/.test(pathname);
}

// The top-level pages' names, as the nav names them.
const PAGE_NAMES: Record<string, string> = {
  ...Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.to.slice(1), i.label]))),
  studio: "Studio",
  blog: "Blog",
  press: "Press",
  download: "Download",
};

/** Where a site page sits, for the panel bar: `Mirli / Docs / Install`. */
function pageCrumbs(pathname: string): Crumb[] {
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  if (!clean) return [];
  const lander = getLander(clean);
  if (lander) return [{ label: lander.eyebrow, to: `/${clean}` }];
  const [root, slug] = clean.split("/");
  const trail: Crumb[] = [{ label: PAGE_NAMES[root] ?? root, to: `/${root}` }];
  if (!slug) return trail;
  const leaf =
    root === "docs"
      ? slug === "reference"
        ? "Reference"
        : docBySlug(slug)?.title
      : root === "blog"
        ? postBySlug(slug)?.title
        : root === "models"
          ? getModel(slug)?.name
          : undefined;
  if (leaf) trail.push({ label: leaf, to: `/${root}/${slug}` });
  return trail;
}

/** The routed page, in a panel unless it draws its own. */
export function FramedPage() {
  const pathname = useLocation().pathname.replace(/\/+$/, "") || "/";
  if (drawsOwnPanel(pathname)) return <Outlet />;
  // Clipped so a page's full-bleed band keeps to the panel's rounded corners;
  // `clip` makes no scroll box, so the bar and the docs' sidebars still stick.
  return (
    <SitePanel trail={pageCrumbs(pathname)} className="md:overflow-clip">
      <Outlet />
    </SitePanel>
  );
}

interface RailItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// The site's own nav, as icons: what Mirli makes, then the developer pages,
// then the two plain links. One list, so the rail and the top nav cannot drift.
const RAIL: RailItem[][] = [
  ...GROUPS.map((g) => g.items.map(({ to, label, icon }) => ({ to, label, icon }))),
  [
    { to: "/studio", label: "Studio", icon: ChartNoAxesGanttIcon },
    { to: "/blog", label: "Blog", icon: NewspaperIcon },
  ],
];

function isUnder(path: string, to: string): boolean {
  const clean = path.replace(/\/+$/, "") || "/";
  return clean === to || clean.startsWith(`${to}/`);
}

/** One icon in the rail: the app sidebar's frosted-glass button, with its name
 *  in a tooltip. `data-sidebar`/`data-active` pick up the glass styles in the
 *  app's index.css. */
function RailButton({
  label,
  active,
  children,
}: {
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-sidebar="menu-button"
          data-active={active ? "true" : undefined}
          className={cn(
            "text-sidebar-foreground/75 hover:text-sidebar-foreground flex size-9 items-center justify-center rounded-lg [&_a]:flex [&_a]:size-full [&_a]:items-center [&_a]:justify-center [&_a]:rounded-lg [&_a]:outline-none [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-sidebar-ring [&_button]:flex [&_button]:size-full [&_button]:items-center [&_button]:justify-center [&_button]:rounded-lg [&_button]:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-sidebar-ring [&_svg]:size-4.5",
            active && "text-sidebar-foreground",
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <RailButton label={dark ? "Light theme" : "Dark theme"}>
      <button type="button" aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => setTheme(dark ? "light" : "dark")}>
        {/* Both drawn and one hidden by the theme class, so the prerendered
            HTML is right before next-themes knows the theme. */}
        <SunIcon className="hidden dark:block" aria-hidden="true" />
        <MoonIcon className="dark:hidden" aria-hidden="true" />
      </button>
    </RailButton>
  );
}

function IconRail() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Mirli"
      className="fixed top-0 bottom-(--site-dock) left-0 z-30 hidden w-14 flex-col items-center gap-1 py-3 md:flex"
    >
      <Link
        to="/"
        aria-label="Mirli home"
        className="bg-sidebar-primary text-sidebar-primary-foreground focus-visible:ring-sidebar-ring mb-3 flex size-9 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
      >
        <BrandMark inset={0.04} className="size-7" />
      </Link>
      {RAIL.map((group, i) => (
        <ul key={i} className={cn("flex flex-col items-center gap-1", i > 0 && "border-sidebar-border mt-2 border-t pt-3")}>
          {group.map((item) => {
            const Icon = item.icon;
            const active = isUnder(pathname, item.to);
            return (
              <li key={item.to}>
                <RailButton label={item.label} active={active}>
                  <Link to={item.to} aria-label={item.label} aria-current={active ? "page" : undefined}>
                    <Icon aria-hidden="true" />
                  </Link>
                </RailButton>
              </li>
            );
          })}
        </ul>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        <RailButton label="Mirli Cloud">
          <a href={cloudWaitlistHref("rail")} aria-label="Mirli Cloud">
            <CloudIcon aria-hidden="true" />
          </a>
        </RailButton>
        <RailButton label="Download Mirli">
          <Link to="/download" aria-label="Download Mirli">
            <DownloadIcon aria-hidden="true" />
          </Link>
        </RailButton>
        <ThemeButton />
      </div>
    </nav>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // The docked player's height, which the rail and the panels stop above.
  const dock = drawsOwnPanel(pathname.replace(/\/+$/, "")) ? "72px" : "0px";
  return (
    <TooltipProvider delayDuration={200}>
      <div style={{ "--site-dock": dock } as CSSProperties} className="contents">
      {/* The flat ground, under the moving one: what a browser without WebGL
          (or with the background turned off) sees between the panels. */}
      <div aria-hidden="true" className="fixed inset-0 -z-20 bg-(--ambient-ground)" />
      <AmbientBackground />
      <div className="md:hidden">
        <SiteHeader />
      </div>
      <IconRail />
      {/* 8px of ground around the panels, as the app's inset shell, and room
          for the dock where there is one. */}
      <div className="min-h-svh md:pt-2 md:pr-2 md:pb-[calc(var(--site-dock)+0.5rem)] md:pl-14">{children}</div>
      </div>
    </TooltipProvider>
  );
}
