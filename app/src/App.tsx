import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Suspense, lazy, useEffect } from "react";
import {
  Navigate,
  Route,
  HashRouter as Router,
  Routes,
  useLocation,
} from "react-router-dom";

import { AccessGate } from "@/components/access-gate";
import { AppCommandPalette } from "@/components/app-command-palette";
import { AppHeader } from "@/components/app-header";
import { HeaderSlotProvider } from "@/components/header-slot";
import { AppSidebar } from "@/components/app-sidebar";
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog";
import { NowPlayingBar } from "@/components/now-playing-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DashboardPage } from "@/routes/dashboard";

/*
 * Every page but the landing one loads on first visit. As one bundle the app
 * was 1.4 MB of JavaScript before the dashboard could draw — the studio alone
 * (timeline, MIDI, Tone.js, the device rack) is most of that, and plenty of
 * sessions never open it.
 */
const GeneratePage = lazy(() => import("@/routes/generate").then((m) => ({ default: m.GeneratePage })));
const ConsolePage = lazy(() => import("@/routes/console").then((m) => ({ default: m.ConsolePage })));
const LibraryPage = lazy(() => import("@/routes/library").then((m) => ({ default: m.LibraryPage })));
const SfxLibraryPage = lazy(() => import("@/routes/sfx-library").then((m) => ({ default: m.SfxLibraryPage })));
const SpeechLibraryPage = lazy(() => import("@/routes/speech-library").then((m) => ({ default: m.SpeechLibraryPage })));
const MusicStudioPage = lazy(() => import("@/routes/music-studio").then((m) => ({ default: m.MusicStudioPage })));
const ProjectsPage = lazy(() => import("@/routes/projects").then((m) => ({ default: m.ProjectsPage })));
const StudioIndexPage = lazy(() => import("@/routes/studio-index").then((m) => ({ default: m.StudioIndexPage })));
const StudioPage = lazy(() => import("@/routes/studio").then((m) => ({ default: m.StudioPage })));
const VoiceLabPage = lazy(() => import("@/routes/voice-lab").then((m) => ({ default: m.VoiceLabPage })));
const ModelsPage = lazy(() => import("@/routes/models").then((m) => ({ default: m.ModelsPage })));
const AgentsPage = lazy(() => import("@/routes/agents").then((m) => ({ default: m.AgentsPage })));
const SettingsPage = lazy(() => import("@/routes/settings").then((m) => ({ default: m.SettingsPage })));
const ActivityPage = lazy(() => import("@/routes/activity").then((m) => ({ default: m.ActivityPage })));
const SoundDetailPage = lazy(() => import("@/routes/sound-detail").then((m) => ({ default: m.SoundDetailPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Every route change starts scrolled to the top, matching normal browser
 *  navigation — without this, switching pages (e.g. via the sidebar) kept
 *  whatever scroll position the previous, longer page had left behind. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Routes that want the whole width. The shell's `max-w-6xl` column is right
 *  for reading and for grids, but an editor with a timeline beside it wants
 *  every pixel — capping it at 1152px wastes half a wide monitor. */
function isFullBleed(pathname: string): boolean {
  return pathname.startsWith("/studio/") || pathname === "/library/music";
}

/** The app shell: sidebar, header, and the routes that live inside them. */
function AppShell() {
  const { pathname } = useLocation();
  const fullBleed = isFullBleed(pathname);
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      {/* The header and the page it belongs to share a provider so a page can
          render controls into the bar above it — see `header-slot`. */}
      <HeaderSlotProvider>
      {/* Capped at the viewport for full-bleed pages, and only for them.
          The wrapper above is `min-h-svh` — a floor, not a ceiling — so
          without this nothing stops a studio frame from growing with its
          own content: the document picks up a scrollbar and the panels
          that were supposed to scroll internally push the composer off
          the bottom instead. `svh` rather than `vh` so a mobile browser
          collapsing its toolbar does not crop the last row. Ordinary
          pages keep their natural height and the document scroll they
          have always had. */}
      <SidebarInset
        className={`bg-background text-foreground min-w-0${
          fullBleed ? " h-svh overflow-hidden" : ""
        }`}
      >
        <AppHeader />
        {/* The full-bleed column is a flex column with `min-h-0`, which is
            what lets a studio page fill the window: `h-full` cannot do it,
            because this element's own height comes from `flex-1` rather than
            from a height, and a percentage against that resolves to the
            page's own content height instead. A page that asks for `flex-1`
            here gets the free space under the header and above the dock, and
            a page that does not is laid out exactly as before. */}
        <main
          className={
            fullBleed
              ? "flex w-full min-h-0 min-w-0 flex-1 flex-col px-4 py-6"
              : "mx-auto w-full max-w-6xl flex-1 px-4 py-6"
          }
        >
          <Suspense fallback={null}>
          <Routes>
            {/* The default landing page — a dashboard of quick actions,
                recent sounds and projects — rather than dropping straight
                into the chat composer. */}
            <Route path="/dashboard" element={<DashboardPage />} />
            {/* The conversation/chat composer. */}
            <Route path="/chat" element={<GeneratePage />} />
            {/* Same session as /chat, hardware front panel. Shares the store
                and job stream via useGenerateSession, so it is a view switch,
                not a fork. */}
            <Route path="/console" element={<ConsolePage />} />
            {/* The two builders, and the shelf they share.

                They are one component with a `builder` prop rather than two
                pages, because the timeline, the library, the chat, the device
                rack and every keyboard shortcut are the same in both — see
                routes/studio.tsx. What differs is what you start from: words
                in the Script Builder, a prompt in the Music Builder. Mounting
                them as two routes is what makes the choice a real one: the
                URL says which tool you are in, a link opens the right one, and
                neither has to guess from the story's contents. */}
            <Route path="/studio" element={<StudioIndexPage />} />
            <Route
              path="/studio/script/:storyId"
              element={<StudioPage builder="script" />}
            />
            <Route path="/studio/music/:storyId" element={<StudioPage builder="music" />} />
            {/* The Lab is a third thing and stays where it was: cloning,
                recording and auditioning a voice is a sitting of its own, and
                what comes out of it is an input to the Script Builder rather
                than a piece of work in it. */}
            <Route path="/voice/lab" element={<VoiceLabPage />} />
            {/* The unfiltered library still exists, unlinked from the nav —
                it's where a Projects sidebar/list entry deep-links to
                (`/library?project=…`), spanning every category rather than
                just one. */}
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/sfx" element={<SfxLibraryPage />} />
            <Route path="/library/music" element={<MusicStudioPage />} />
            <Route path="/library/speech" element={<SpeechLibraryPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/sounds/:id" element={<SoundDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>
        </main>
        {/* Inside `SidebarInset`, not a sibling of it — its box already
            excludes the sidebar's width, so `position="sticky"` here never
            draws over the sidebar the way a viewport-`fixed` dock would. */}
        <NowPlayingBar />
      </SidebarInset>
      {/* Inside the shell, not the app root: it offers the shell's pages and
          reads the route to know when to stand down. */}
      <AppCommandPalette />
      {/* Same reasoning, and one more: it reads settings and models through
          react-query, so it cannot live above the provider. */}
      <OnboardingDialog />
      </HeaderSlotProvider>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <TooltipProvider>
          <AccessGate>
          <Router>
            <ScrollToTop />
            {/* Every route here is the app. The marketing surface — the
                landing page, the /sfx and /music collections and the model
                write-ups — lives only in `site/` now (see site/src/routes.tsx),
                so this router no longer has a "beside the shell" tier at all.
                The API & MCP reference is not here either: it is a component
                rendered by the site's /docs/reference, not a second in-app
                copy to drift (see components/api-mcp-reference.tsx). */}
            <Routes>
              <Route path="*" element={<AppShell />} />
            </Routes>
          </Router>
          </AccessGate>
          <Toaster position="bottom-right" closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
