/**
 * Top nav for the public site — every route under `site/` renders this
 * (see `Layout` in `../layout.tsx`), so it lives above `<Outlet />` rather
 * than inside any one page.
 *
 * The mark is the app's own (`BrandMark`, the M, and the display-face
 * `Wordmark`, as in `app/src/components/app-sidebar.tsx`) rather than a
 * second logo for the marketing site.
 *
 * Nine flat links no longer fit, so the pages are grouped by who they are
 * for: what the app makes (sound effects, music, voices), the studio on its
 * own, and the developer pages (models, MCP, docs). Groups open on hover or
 * click as a panel with a line on each page. Every link is in the prerendered
 * HTML (the panels are only hidden), so crawlers still see the whole site.
 * Below `md` the same groups live in a full-width sheet behind a menu button.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AudioLinesIcon,
  BookOpenIcon,
  BoxesIcon,
  ChevronDownIcon,
  MenuIcon,
  MicVocalIcon,
  MusicIcon,
  PlugIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { BrandMark, Wordmark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Create",
    items: [
      {
        to: "/sfx",
        label: "Sound effects",
        blurb: "Foley, impacts, UI and ambience from a prompt.",
        icon: AudioLinesIcon,
      },
      {
        to: "/music",
        label: "Music",
        blurb: "Instrumentals and sung tracks, with the prompt behind each.",
        icon: MusicIcon,
      },
      {
        to: "/voices",
        label: "Voices",
        blurb: "Narration and dialogue from cloned or designed voices.",
        icon: MicVocalIcon,
      },
    ],
  },
  {
    label: "Developers",
    items: [
      {
        to: "/models",
        label: "Models",
        blurb: "Every open model it runs, with its licence.",
        icon: BoxesIcon,
      },
      {
        to: "/mcp",
        label: "MCP",
        blurb: "Let Claude Code or Cursor make sound for you.",
        icon: PlugIcon,
      },
      {
        to: "/docs",
        label: "Docs",
        blurb: "Install, the API, and how each part works.",
        icon: BookOpenIcon,
      },
    ],
  },
];

const LINKS = [
  { to: "/studio", label: "Studio" },
  { to: "/blog", label: "Blog" },
];

const LINK_CLASS =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-xs font-medium tracking-[0.14em] uppercase outline-none transition-colors focus-visible:ring-3";

/** True when the current path is `to` or a page under it. */
function isUnder(path: string, to: string): boolean {
  const clean = path.replace(/\/+$/, "") || "/";
  return clean === to || clean.startsWith(`${to}/`);
}

/** One page in a panel or the sheet: icon, name, and the line on what it is. */
function ItemLink({ item, onPick }: { item: NavItem; onPick?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onPick}
      className="group/item hover:bg-accent focus-visible:ring-ring/50 flex gap-3 rounded-sm p-3 outline-none transition-colors focus-visible:ring-3"
    >
      <span className="border-border bg-background group-hover/item:border-border-strong flex size-9 shrink-0 items-center justify-center rounded-sm border transition-colors">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{item.label}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
          {item.blurb}
        </span>
      </span>
    </Link>
  );
}

/** A group in the desktop bar: a button that opens a panel on hover or click. */
function GroupMenu({
  group,
  open,
  setOpen,
  active,
}: {
  group: NavGroup;
  open: boolean;
  setOpen: (open: boolean) => void;
  active: boolean;
}) {
  const closeTimer = useRef<number | undefined>(undefined);
  const id = `nav-${group.label.toLowerCase()}`;

  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // A short grace period so a diagonal move from the button to the panel
  // does not close it on the way.
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  return (
    <div className="relative" onPointerEnter={enter} onPointerLeave={leave}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={cn(
          LINK_CLASS,
          "flex items-center gap-1 py-2",
          (open || active) && "text-foreground",
        )}
      >
        {group.label}
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <div
        id={id}
        hidden={!open}
        className="absolute top-full left-1/2 z-40 w-[22rem] -translate-x-1/2 pt-3"
      >
        <div className="border-border bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 rounded-md border p-1.5 shadow-2xl duration-150">
          {group.items.map((item) => (
            <ItemLink key={item.to} item={item} onPick={() => setOpen(false)} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close everything on navigation, on Escape, and on a click elsewhere.
  useEffect(() => {
    setOpenGroup(null);
    setSheet(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenGroup(null);
        setSheet(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node))
        setOpenGroup(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);
  // The sheet covers the page, so the page should not scroll under it.
  useEffect(() => {
    document.documentElement.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [sheet]);

  return (
    <>
      <header className="border-border bg-background/90 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Link
            to="/"
            className="focus-visible:ring-ring/50 flex items-center gap-2 rounded outline-none focus-visible:ring-3"
          >
            <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-sm">
              <BrandMark inset={0.04} className="size-6" />
            </span>
            <Wordmark className="text-2xl leading-none font-extrabold" />
          </Link>

          <nav
            ref={navRef}
            aria-label="Primary"
            className="hidden items-center gap-6 md:flex"
          >
            {GROUPS.map((group) => (
              <GroupMenu
                key={group.label}
                group={group}
                open={openGroup === group.label}
                setOpen={(open) =>
                  setOpenGroup((current) =>
                    open
                      ? group.label
                      : current === group.label
                        ? null
                        : current,
                  )
                }
                active={group.items.some((item) => isUnder(pathname, item.to))}
              />
            ))}
            {LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  LINK_CLASS,
                  "py-2",
                  isUnder(pathname, link.to) && "text-foreground",
                )}
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/download"
              className="bg-foreground text-background hover:bg-foreground/85 focus-visible:ring-ring/50 inline-flex h-9 items-center rounded-sm px-4 text-xs font-semibold tracking-[0.14em] uppercase outline-none transition-colors focus-visible:ring-3"
            >
              Download
            </Link>
          </nav>

          <div className="flex items-center gap-2 md:hidden">
            <Link
              to="/download"
              className="bg-foreground text-background inline-flex h-9 items-center rounded-sm px-3 text-xs font-semibold tracking-[0.14em] uppercase"
            >
              Download
            </Link>
            <button
              type="button"
              aria-expanded={sheet}
              aria-controls="nav-sheet"
              aria-label={sheet ? "Close menu" : "Open menu"}
              onClick={() => setSheet(!sheet)}
              className="hover:bg-accent focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-sm outline-none focus-visible:ring-3"
            >
              {sheet ? (
                <XIcon className="size-5" aria-hidden="true" />
              ) : (
                <MenuIcon className="size-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* The phone menu: the same groups, stacked, over the page. Outside the
          header, whose backdrop blur would otherwise make it the box a fixed
          child is positioned in, squashing the sheet to the header's height. */}
      <div
        id="nav-sheet"
        hidden={!sheet}
        className="bg-background fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto px-4 pt-4 pb-10 md:hidden"
      >
        <nav aria-label="Primary" className="flex flex-col gap-6">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="label-caps text-muted-foreground px-3">
                {group.label}
              </p>
              <div className="mt-1">
                {group.items.map((item) => (
                  <ItemLink
                    key={item.to}
                    item={item}
                    onPick={() => setSheet(false)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="border-border flex flex-col border-t pt-4">
            {LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setSheet(false)}
                className="font-display hover:bg-accent rounded-sm px-3 py-2 text-3xl font-extrabold uppercase"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}
