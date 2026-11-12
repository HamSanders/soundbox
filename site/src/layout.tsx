import { Outlet } from "react-router-dom";
import { ThemeProvider } from "next-themes";

import { SiteHeader } from "./components/site-header";

// Wraps every site route (/sfx, /sfx/:slug, /docs) so next-themes' dark/light
// class lands on <html> the same way it does in the app (WaveformPlayer reads
// CSS vars off it), and so every route gets the same top nav.
export function Layout() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <SiteHeader />
      <Outlet />
      {/* Film grain over the whole page; see `film-grain` in the app's index.css. */}
      <div className="film-grain" aria-hidden="true" />
    </ThemeProvider>
  );
}
