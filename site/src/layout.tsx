import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/react";

import { SiteHeader } from "./components/site-header";
import { AppFrame, wantsAppFrame } from "./components/app-frame";

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

// Wraps every site route so next-themes' dark/light class lands on <html> the
// same way it does in the app (WaveformPlayer reads CSS vars off it). /sfx and
// /music, the pages that show what Mirli makes, are drawn in the app's own
// frame (components/app-frame.tsx); every other page keeps the top nav.
export function Layout() {
  const { pathname } = useLocation();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ScrollToTop />
      {wantsAppFrame(pathname) ? (
        <AppFrame>
          <Outlet />
        </AppFrame>
      ) : (
        <>
          <SiteHeader />
          <Outlet />
        </>
      )}
      {/* Film grain over the whole page; see `film-grain` in the app's index.css. */}
      <div className="film-grain" aria-hidden="true" />
      <Analytics />
    </ThemeProvider>
  );
}
