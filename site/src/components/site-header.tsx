/**
 * Top nav for the public site — every route under `site/` renders this
 * (see `Layout` in `../layout.tsx`), so it lives above `<Outlet />` rather
 * than inside any one page.
 *
 * The mark reuses the app's own brand tile (`AudioLinesIcon` in a rounded
 * square — see `app/src/components/app-sidebar.tsx`) rather than inventing a
 * second logo for the marketing site.
 */

import { AudioLinesIcon } from "lucide-react";
import { Link } from "react-router-dom";

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
    <header className="border-border/60 bg-background/85 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          to="/"
          className="focus-visible:ring-ring/50 flex items-center gap-2 rounded outline-none focus-visible:ring-3"
        >
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <AudioLinesIcon className="size-4" aria-hidden="true" />
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight">Konchi</span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-3"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
