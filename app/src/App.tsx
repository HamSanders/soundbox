import { MobileTabBar } from "@/components/mobile-tab-bar";
import { NavRail } from "@/components/nav-rail";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Suspense, lazy, useEffect, type CSSProperties } from "react";
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
import { WindowTitleBar, WINDOW_TITLE_BAR_HEIGHT_PX } from "@/components/window-title-bar";
import { isDesktop } from "@/lib/desktop";
import { SidebarPeekEdge } from "@/components/sidebar-peek";
import { HeaderSlotProvider } from "@/components/header-slot";
import { AppSidebar } from "@/components/app-sidebar";
import { AmbientBackground } from "@/components/ambient-background";
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog";
import { NowPlayingBar } from "@/components/now-playing-bar";
import { ListenPlayerHost } from "@/components/listen/mini-player"; // [audiobooks:listen]
import { CreatePanel, CreateRedirect } from "@/components/create-panel";
import { DetailDock } from "@/components/detail-dock";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PLAYER_DOCK_HEIGHT_PX } from "@/components/player-dock";
import { usePlayerStore } from "@/lib/player-store";
import { useCapabilities } from "@/lib/queries";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DashboardPage } from "@/routes/dashboard";
import { CALLS_ENABLED } from "@/lib/features";

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
const ProjectsPage = lazy(() => import("@/routes/projects").then((m) => ({ default: m.ProjectsPage })));
const StudioIndexPage = lazy(() => import("@/routes/studio-index").then((m) => ({ default: m.StudioIndexPage })));
const StudioPage = lazy(() => import("@/routes/studio").then((m) => ({ default: m.StudioPage })));
const VoiceCreatePage = lazy(() => import("@/routes/voice-create").then((m) => ({ default: m.VoiceCreatePage })));
const VoiceCloneCreatePage = lazy(() => import("@/routes/voice-create").then((m) => ({ default: m.VoiceCloneCreatePage })));
const VoiceBuiltinCreatePage = lazy(() => import("@/routes/voice-create").then((m) => ({ default: m.VoiceBuiltinCreatePage })));
const VoiceLabPage = lazy(() => import("@/routes/voice-lab").then((m) => ({ default: m.VoiceLabPage })));
const ModelsPage = lazy(() => import("@/routes/models").then((m) => ({ default: m.ModelsPage })));
const AgentsPage = lazy(() => import("@/routes/agents").then((m) => ({ default: m.AgentsPage })));
const SettingsPage = lazy(() => import("@/routes/settings").then((m) => ({ default: m.SettingsPage })));
const ActivityPage = lazy(() => import("@/routes/activity").then((m) => ({ default: m.ActivityPage })));
const TrashPage = lazy(() => import("@/routes/trash").then((m) => ({ default: m.TrashPage })));
const AudiobooksPage = lazy(() => import("@/routes/audiobooks").then((m) => ({ default: m.AudiobooksPage }))); // [audiobooks:core]
const AudiobookPage = lazy(() => import("@/routes/audiobook").then((m) => ({ default: m.AudiobookPage }))); // [audiobooks:core]
const ListenPage = lazy(() => import("@/routes/listen").then((m) => ({ default: m.ListenPage }))); // [audiobooks:listen]
const ListenExplorePage = lazy(() => import("@/routes/listen-explore").then((m) => ({ default: m.ListenExplorePage }))); // [audiobooks:listen]
const ListenBookPage = lazy(() => import("@/routes/listen-book").then((m) => ({ default: m.ListenBookPage }))); // [audiobooks:listen]
const CallsHomePage = lazy(() => import("@/routes/calls/calls-home").then((m) => ({ default: m.CallsHomePage })));
const VoiceCallPage = lazy(() => import("@/routes/calls/voice-call").then((m) => ({ default: m.VoiceCallPage })));
const CharacterEditorPage = lazy(() => import("@/routes/calls/character-editor").then((m) => ({ default: m.CharacterEditorPage })));
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
    // On desktop the page scrolls inside its panel, not the window.
    document.querySelector('[data-slot="sidebar-inset"]')?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Routes that want the whole width. The shell's `max-w-6xl` column is right
 *  for reading and for grids, but an editor with a timeline beside it wants
 *  every pixel — capping it at 1152px wastes half a wide monitor. */
function isFullBleed(pathname: string): boolean {
  // A call fills the window: the reply's big type wants every pixel.
  return (
    pathname.startsWith("/studio/") ||
    pathname.startsWith("/audiobooks/") || // [audiobooks:core]
    pathname.startsWith("/calls/voice")
  );
}

/** The app shell: sidebar, header, and the routes that live inside them. */
function AppShell() {
  // What this server allows decides what the shell draws: wait for it (one
  // small request) rather than flash controls that are about to disappear.
  const capabilities = useCapabilities();
  if (capabilities.isPending) return null;
  if (capabilities.isError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm">Mirli can't reach its server.</p>
        <p className="text-muted-foreground max-w-sm text-xs">
          {capabilities.error instanceof Error ? capabilities.error.message : String(capabilities.error)}
        </p>
        <Button size="sm" variant="outline" onClick={() => void capabilities.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <AppShellReady />;
}

function AppShellReady() {
  const { pathname } = useLocation();
  const fullBleed = isFullBleed(pathname);
  const nowPlaying = usePlayerStore((s) => s.sound !== null);
  // The desktop app has no native title bar: it draws its own across the top
  // of the window, and every panel starts below it.
  const desktop = isDesktop();
  const topPx = desktop ? WINDOW_TITLE_BAR_HEIGHT_PX : 0;
  return (
    // Floating shell: the sidebar and the page are two panels on the
    // sidebar's ground (the `inset` variant), and the player runs full width
    // along the bottom under both, outside either panel. `--dock-h` is how
    // much room that strip takes, so both panels stop above it.
    <SidebarProvider
      defaultOpen={false}
      // --top-h: the slim header bar above every panel. --panel-h: what is
      // left for a panel between that bar and the player, less the panels'
      // own 8px margins. Every panel's height reads it.
      // The ground is see-through so the ambient field behind it shows in
      // the gaps between panels; the panels keep their own fills.
      className="pt-(--top-h) pl-(--rail-w,0px) pb-[calc(var(--dock-h)+var(--tabbar-h,0px))] has-data-[variant=inset]:bg-transparent"
      style={
        {
          "--dock-h": nowPlaying ? `${PLAYER_DOCK_HEIGHT_PX}px` : "0px",
          "--top-h": `${topPx}px`,
          "--panel-h": `calc(100svh - 1rem - ${topPx + (nowPlaying ? PLAYER_DOCK_HEIGHT_PX : 0)}px)`,
        } as CSSProperties
      }
    >
      {/* The header and the page share a provider so a page can render its
          own controls into the bar above it — see `header-slot`. The bar is a
          slim strip across the window, above the panels, not inside one. */}
      <HeaderSlotProvider>
      {/* The moving ground, behind every panel: see ambient-background.tsx. */}
      <AmbientBackground />
      {desktop && <WindowTitleBar />}
      <AppSidebar />
      <SidebarPeekEdge />
      {/* Between the sidebar and the page on the kind pages: see create-panel.tsx. */}
      <CreatePanel />
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
        // On desktop the panel is exactly the window less its 8px margins and
        // the player strip, and the page scrolls inside it, so the panel's
        // rounded bottom edge always sits just above the player.
        className={`bg-background text-foreground min-w-0 expanded:h-(--panel-h)${
          fullBleed
            ? // The Studio's own panels are the shell's panels here: the page
              // panel has no fill, frame or padding of its own around them.
              " max-expanded:h-[calc(100svh-var(--dock-h,0px)-var(--tabbar-h,0px))] overflow-hidden expanded:bg-transparent! expanded:ring-0!" : " expanded:overflow-y-auto"
        }`}
      >
        {!desktop && <AppHeader />}
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
              ? "flex w-full min-h-0 min-w-0 flex-1 flex-col px-4 py-6 expanded:p-0"
              : "w-full flex-1 px-6 py-6 [&_p]:max-w-prose"
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
            <Route path="/voice/new" element={<VoiceCreatePage />} />
            <Route path="/voice/new/clone" element={<VoiceCloneCreatePage />} />
            <Route path="/voice/new/builtin" element={<VoiceBuiltinCreatePage />} />
            {/* Calls: real-time voice calls with characters. Pulled from
                releases until they are ready (lib/features.ts); without the
                flag an old /calls link lands on the home page. */}
            {CALLS_ENABLED ? (
              <>
              <Route path="/calls" element={<CallsHomePage />} />
              <Route path="/calls/new" element={<CharacterEditorPage />} />
              <Route path="/calls/characters/:characterId" element={<CharacterEditorPage />} />
              <Route path="/calls/voice" element={<VoiceCallPage />} />
              <Route path="/calls/voice/:characterId" element={<VoiceCallPage />} />
              </>
            ) : (
              <Route path="/calls/*" element={<Navigate to="/" replace />} />
            )}
            {/* The unfiltered library still exists, unlinked from the nav —
                it's where a Projects sidebar/list entry deep-links to
                (`/library?project=…`), spanning every category rather than
                just one. */}
            <Route path="/create" element={<CreateRedirect />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/sfx" element={<SfxLibraryPage />} />
            <Route path="/library/music" element={<LibraryPage category="music" />} />
            <Route path="/library/speech" element={<SpeechLibraryPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/audiobooks" element={<AudiobooksPage />} /> {/* [audiobooks:core] */}
            <Route path="/audiobooks/:id" element={<AudiobookPage />} /> {/* [audiobooks:core] */}
            <Route path="/listen" element={<ListenPage />} /> {/* [audiobooks:listen] */}
            <Route path="/listen/explore" element={<ListenExplorePage />} /> {/* [audiobooks:listen] */}
            <Route path="/listen/:id" element={<ListenBookPage />} /> {/* [audiobooks:listen] */}
            <Route path="/sounds/:id" element={<SoundDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>
        </main>
        {/* Inside `SidebarInset`, not a sibling of it — its box already
            excludes the sidebar's width, so `position="sticky"` here never
            draws over the sidebar the way a viewport-`fixed` dock would. */}
        <NowPlayingBar />
        <ListenPlayerHost /> {/* [audiobooks:listen] */}
      </SidebarInset>
      {/* Phones only: the five places you go most, always one tap away.
          Everything else stays in the menu behind the header's button. See
          docs/device-nav/DESIGN.md, model A. */}
      <MobileTabBar />
      <NavRail />
      {/* Docked beside the page, in the shell's row: see detail-dock.tsx. */}
      <DetailDock />
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
