/**
 * Top nav for the public site — every route under `site/` renders this
 * (see `Layout` in `../layout.tsx`), so it lives above `<Outlet />` rather
 * than inside any one page.
 *
 * The mark is the Konchi spiral (`KonchiMark`), shared with the app sidebar
 * and the favicon, so the three never drift apart.
 *
 * Nine links do not fit in one row on a phone: at 375px they used to run off
 * the right edge with no way to reach Docs, Blog or Download. Below `lg` the
 * row gives way to Download (the one link worth a tap at any width) and a
 * Menu button that opens the full list under the bar.
 *
 * The bar is opaque, with a hairline under it, rather than frosted: the rest
 * of the site is panels and hairlines, and blur was the one glass surface.
 */

import { useEffect, useId, useRef, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { KonchiMark } from "@/components/konchi-mark";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { to: "/sfx", label: "Sound Effects" },
  { to: "/music", label: "Music" },
  { to: "/voices", label: "Voices" },
  { to: "/studio", label: "Studio" },
  { to: "/models", label: "Models" },
  { to: "/mcp", label: "MCP" },
  { to: "/docs", label: "Docs" },
  { to: "/blog", label: "Blog" },
  { to: "/download", label: "Download" },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-3",
    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  );

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  // A tap on a link navigates; the menu should not still be open over the
  // page it just opened.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="border-border bg-background sticky top-0 z-30 border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          to="/"
          className="focus-visible:ring-ring/50 flex items-center gap-2.5 rounded outline-none focus-visible:ring-3"
        >
          <KonchiMark className="text-shell h-6" />
          <span className="font-display text-lg leading-none tracking-tight">Konchi</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-4 text-sm lg:flex">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={linkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3 lg:hidden">
          <NavLink to="/download" className={(s) => cn(linkClass(s), "text-sm")}>
            Download
          </NavLink>
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
            className="border-border-strong text-foreground focus-visible:ring-ring/50 label-caps inline-flex h-8 items-center gap-1.5 rounded border px-2.5 outline-none focus-visible:ring-3"
          >
            {open ? <XIcon className="size-3.5" aria-hidden="true" /> : <MenuIcon className="size-3.5" aria-hidden="true" />}
            Menu
          </button>
        </div>
      </div>

      {open && (
        <nav
          id={menuId}
          aria-label="Primary"
          className="border-border bg-background border-t lg:hidden"
        >
          <ul className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-x-4 px-4 py-3 text-sm sm:grid-cols-3">
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} className={(s) => cn(linkClass(s), "block py-2")}>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
