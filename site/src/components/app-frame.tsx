/**
 * The app's frame, for the site pages that show what Mirli makes (/sfx and
 * /music): the moving ground behind everything, a slim icon rail down the
 * left as the app's collapsed sidebar, and the pages' own panels floating on
 * the ground beside it (`SitePanel` and `SiteRail` in
 * app/src/components/site/). The rest of the site keeps the top nav.
 *
 * The ground is the app's own `AmbientBackground`, so it follows the same
 * per-browser preference (`ui-prefs`; Smoke by default), draws one still frame
 * under reduced motion, falls back to the flat ground without WebGL, and
 * moves a little with whatever the page is playing.
 *
 * Below `md` there is no rail: the site's top nav takes its place and the
 * panels run edge to edge, as the app does on a phone.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { CloudIcon, DownloadIcon, MoonIcon, NewspaperIcon, SlidersHorizontalIcon, SunIcon, type LucideIcon } from "lucide-react";

import { AmbientBackground } from "@/components/ambient-background";
import { BrandMark } from "@/components/brand-mark";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cloudWaitlistHref } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

import { GROUPS, SiteHeader } from "./site-header";

/** Paths drawn in the app's frame rather than under the top nav. */
export function wantsAppFrame(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, "");
  return /^\/(sfx|music)(\/|$)/.test(clean);
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
    { to: "/studio", label: "Studio", icon: SlidersHorizontalIcon },
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
      className="fixed top-0 bottom-[72px] left-0 z-30 hidden w-14 flex-col items-center gap-1 py-3 md:flex"
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
  return (
    <TooltipProvider delayDuration={200}>
      {/* The flat ground, under the moving one: what a browser without WebGL
          (or with the background turned off) sees between the panels. */}
      <div aria-hidden="true" className="fixed inset-0 -z-20 bg-(--ambient-ground)" />
      <AmbientBackground />
      <div className="md:hidden">
        <SiteHeader />
      </div>
      <IconRail />
      {/* 8px of ground around the panels, as the app's inset shell; the dock
          is fixed over the bottom, so each page pads its own foot. */}
      <div className="min-h-svh md:pt-2 md:pr-2 md:pb-[80px] md:pl-14">{children}</div>
    </TooltipProvider>
  );
}
