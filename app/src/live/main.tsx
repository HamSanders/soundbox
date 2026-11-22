/*
 * Mirli Live: real-time voice and video calls with AI characters.
 *
 * A second entry point of the Mirli web app (app/live.html), built from the
 * same design system: tokens, fonts and components come from ../index.css and
 * @/components. It talks to the back end only through lib/live-client.ts, so
 * the same build runs against the local Call API and the cloud gateway.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import "../index.css";
import "./live.css";
import { LiveProvider } from "./live-context";
import { AccountPage } from "./routes/account";
import { CharactersPage } from "./routes/characters";
import { LandingPage } from "./routes/landing";
import { VideoCallPage } from "./routes/video-call";
import { VoiceCallPage } from "./routes/voice-call";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } });

export function LiveApp({ apiBase }: { apiBase?: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="mirli-live-theme">
      <QueryClientProvider client={queryClient}>
        <LiveProvider baseUrl={apiBase}>
          <HashRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/characters" element={<CharactersPage />} />
              <Route path="/call/:characterId" element={<VideoCallPage />} />
              <Route path="/call" element={<VideoCallPage />} />
              <Route path="/voice" element={<VoiceCallPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </LiveProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><LiveApp /></StrictMode>);
