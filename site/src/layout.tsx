import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/react";

import { SiteHeader } from "./components/site-header";

/**
 * A new page opens at the top, unless the link says where: `/docs/install#gpu`
 * scrolls to that element. Back and forward are left to the browser, which
 * returns you to where you were. The router does none of this on its own, so
 * without it a link followed from halfway down a page lands halfway down the
 * next one. The first render is skipped so a reload keeps its position.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const type = useNavigationType();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (type === "POP") return;
    if (hash) {
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // A malformed escape: use the raw text.
      }
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash, type]);

  return null;
}

// Wraps every site route (/sfx, /sfx/:slug, /docs) so next-themes' dark/light
// class lands on <html> the same way it does in the app (WaveformPlayer reads
// CSS vars off it), and so every route gets the same top nav.
export function Layout() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ScrollToTop />
      <SiteHeader />
      <Outlet />
      {/* Film grain over the whole page; see `film-grain` in the app's index.css. */}
      <div className="film-grain" aria-hidden="true" />
      <Analytics />
    </ThemeProvider>
  );
}
