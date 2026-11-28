import { NavLink, useLocation } from "react-router-dom";
import {
  HomeIcon,
  LibraryIcon,
  ChartNoAxesGanttIcon,
  MicIcon,
  PlusIcon,
  type LucideIcon,
} from "@/lib/icons";

import { cn } from "@/lib/utils";

/**
 * The phone's bottom tab bar: Home, Library, Create, Studio, Voices.
 *
 * Below `md` the sidebar is a sheet behind the header's button, which left a
 * phone with no visible way between places: open a page and you stay on it.
 * A bottom bar for a handful of top-level places is the default on both
 * platforms (Apple's tab bars, Android's navigation bar for compact width);
 * see docs/device-nav/DESIGN.md for sources and for why these five.
 *
 * Create sits in the middle and is drawn as the one filled button, the way
 * Suno's app does it: it is the verb, the other four are places. Projects,
 * Models, Agents, Settings and Activity stay in the menu behind the header's
 * button.
 *
 * Hidden from `md` up, where the sidebar is on screen. Its height lives in
 * `--tabbar-h` (index.css) so the player and pinned composers stop above it.
 */

type Tab = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Which paths light this tab. */
  match: RegExp;
  primary?: boolean;
};

export const TABS: Tab[] = [
  { to: "/dashboard", label: "Home", icon: HomeIcon, match: /^\/(dashboard|chat|console)(\/|$)/ },
  { to: "/library", label: "Library", icon: LibraryIcon, match: /^\/(library\/?$|sounds\/|projects)/ },
  {
    to: "/create",
    label: "Create",
    icon: PlusIcon,
    match: /^\/(create|library\/(music|sfx|speech))(\/|$)/,
    primary: true,
  },
  { to: "/studio", label: "Studio", icon: ChartNoAxesGanttIcon, match: /^\/studio(\/|$)/ },
  { to: "/voice/lab", label: "Voices", icon: MicIcon, match: /^\/voice(\/|$)/ },
];

export function MobileTabBar() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Main"
      className="bg-sidebar border-border fixed inset-x-0 bottom-0 z-40 grid h-(--tabbar-h) grid-cols-5 border-t pb-[env(safe-area-inset-bottom,0px)] medium:hidden"
    >
      {TABS.map((tab) => {
        const active = tab.match.test(pathname);
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {tab.primary ? (
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full",
                  active ? "bg-primary text-primary-foreground" : "bg-foreground text-background",
                )}
              >
                <Icon className="size-5" />
              </span>
            ) : (
              <>
                <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                <span className="truncate">{tab.label}</span>
              </>
            )}
            {tab.primary && <span className="sr-only">{tab.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}
