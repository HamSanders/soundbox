import { NavLink, useLocation } from "react-router-dom";
import { MenuIcon } from "@/lib/icons";

import { TABS } from "@/components/mobile-tab-bar";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * The tablet's navigation rail: the phone tab bar's five places, stood up
 * down the left edge with their labels, for the medium size class (600 to
 * 839px). Android's adaptive default is a bottom bar when compact and a rail
 * otherwise; see docs/device-nav/DESIGN.md for the sources.
 *
 * The menu button at the top opens the full sidebar as a sheet, the way the
 * phone's header button does, so Projects, Models, Agents, Settings and
 * Activity are one tap away. Create sits under it as the filled button, then
 * the four places.
 *
 * Sizes (80px wide, a pill behind the active icon, 12px labels) follow the
 * look of Android's rail; the exact numbers are ours, matched to the tab bar.
 * Its width lives in `--rail-w` (index.css) so the page, the player and the
 * detail panels start to the right of it.
 */
export function NavRail() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const create = TABS.find((t) => t.primary);
  const places = TABS.filter((t) => !t.primary);

  const itemClass =
    "flex w-full flex-col items-center gap-1 text-xs font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg py-1";

  return (
    <nav
      aria-label="Main"
      className="bg-sidebar border-border fixed top-(--top-h,0px) bottom-0 left-0 z-40 hidden w-(--rail-w) flex-col items-center gap-3 border-r pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left,0px)] medium:flex expanded:hidden"
    >
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpenMobile(true)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2"
      >
        <MenuIcon className="size-5" />
      </button>

      {create && (
        <NavLink
          to={create.to}
          aria-current={create.match.test(pathname) ? "page" : undefined}
          className={cn(itemClass, "mb-4", create.match.test(pathname) ? "text-foreground" : "text-muted-foreground")}
        >
          <span
            className={cn(
              "flex size-12 items-center justify-center rounded-2xl",
              create.match.test(pathname) ? "bg-primary text-primary-foreground" : "bg-foreground text-background",
            )}
          >
            <create.icon className="size-5" />
          </span>
          {create.label}
        </NavLink>
      )}

      {places.map((tab) => {
        const active = tab.match.test(pathname);
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <span
              className={cn(
                "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                active && "bg-sidebar-accent",
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
            </span>
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
