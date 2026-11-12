import { Outlet } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/react";

import { SiteHeader } from "./components/site-header";

// Wraps every site route (/sfx, /sfx/:slug, /docs) so next-themes' dark/light
// class lands on <html> the same way it does in the app (WaveformPlayer reads
// CSS vars off it), and so every route gets the same top nav.
export function Layout() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <SiteHeader />
      <Outlet />
      <Analytics />
    </ThemeProvider>
  );
}
