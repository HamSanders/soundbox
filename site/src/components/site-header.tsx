/**
 * Top nav for the public site — every route under `site/` renders this
 * (see `Layout` in `../layout.tsx`), so it lives above `<Outlet />` rather
 * than inside any one page.
 *
 * The mark is the app's own (`BrandMark`, the blackbird, and the blackletter
 * `Wordmark`, as in `app/src/components/app-sidebar.tsx`) rather than a
 * second logo for the marketing site.
 */

import { Link } from "react-router-dom";

import { BrandMark, Wordmark } from "@/components/brand-mark";

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

export function SiteHeader() {
  return (
    <header className="border-border bg-background/90 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          to="/"
          className="focus-visible:ring-ring/50 flex items-center gap-2 rounded outline-none focus-visible:ring-3"
        >
          <BrandMark className="size-8" />
          <Wordmark className="text-2xl leading-none font-semibold" />
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded text-xs font-medium tracking-[0.14em] uppercase underline-offset-[6px] outline-none hover:underline focus-visible:ring-3"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
