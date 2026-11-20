/**
 * Slim top bar inside the content pane: sidebar trigger + current page title.
 * Navigation, device status and theme live in the sidebar now.
 */

import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { HeaderSlot } from "@/components/header-slot";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { QueueIndicator } from "@/components/queue-indicator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSound } from "@/lib/queries";

const TITLES: Record<string, string> = {
  "/dashboard": "Home",
  "/agents": "Agents",
  "/console": "Console",
  "/chat": "Generate",
  "/library": "Library",
  "/library/sfx": "SFX",
  "/library/music": "Music",
  "/library/speech": "Text to Speech",
  "/studio": "Studio",
  "/voice/lab": "Voice Lab",
  "/voice/new": "Voice Creation",
  "/voice/new/clone": "Clone a Voice",
  "/voice/new/builtin": "Built-in Voice",
  "/projects": "Projects",
  "/models": "Models",
  "/activity": "Activity",
  "/settings": "Settings",
};

/** `/sounds/:id` isn't a top-level page — it drills into the Library — so
 *  its crumb extends "Mirli / Library" instead of replacing it. */
function SoundCrumb({ id }: { id: string }) {
  const { data: sound } = useSound(id);
  return (
    <>
      <span aria-hidden="true">/</span>
      <Link to="/library" className="hover:text-foreground">
        Library
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-foreground max-w-64 truncate font-medium">
        {sound?.name ?? "…"}
      </span>
    </>
  );
}

export function AppHeader() {
  const { pathname } = useLocation();
  // AppHeader sits beside <Routes>, not inside the matched Route, so
  // useParams() can't see :id here — read it off the pathname directly.
  const soundId = pathname.startsWith("/sounds/") ? pathname.slice("/sounds/".length) : null;
  // A story drills into the Studio the way a sound drills into the Library,
  // and it names itself: the builder puts its own title in the slot below, so
  // the crumb stops at the shelf and doubles as the way back. Which builder
  // you are in is worth saying — it is the difference between the two tools —
  // and the crumb links to that half of the shelf.
  const builder = /^\/studio\/(script|music)\//.exec(pathname)?.[1] ?? null;

  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <HistoryButtons />
      <nav aria-label="Breadcrumb" className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
        <span>Mirli</span>
        {soundId ? (
          <SoundCrumb id={soundId} />
        ) : builder !== null ? (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/studio?builder=${builder}`} className="hover:text-foreground">
              {builder === "script" ? "Script Builder" : "Music Builder"}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">/</span>
            <span className="text-foreground font-medium">{TITLES[pathname] ?? "Mirli"}</span>
          </>
        )}
      </nav>

      {/* Whatever the open page wants in this bar: a title, the tools that act
          on it. Empty on most pages, which costs nothing. */}
      <HeaderSlot />

      {/* Renders nothing at all while the queue is empty. Here rather than
          beside a composer because a job outlives the page it was submitted
          from — see `queue-indicator.tsx`. */}
      <QueueIndicator />

      {/* Last in the bar, after whatever the page put in the slot — which
          already takes the free space with `flex-1`. Which library you are
          generating into is context for the whole window, not a control
          belonging to the page in front of you. */}
      <div className="flex shrink-0 items-center">
        <ProfileSwitcher />
      </div>
    </header>
  );
}

/**
 * Back and forward, between the sidebar toggle and the breadcrumb, the way a
 * browser or a music app puts them. The desktop app has no browser chrome, so
 * without these the only way back from a sound or a story is the crumb.
 *
 * Whether there is somewhere to go comes from the Navigation API where the
 * webview has it (WebView2 and WebKitGTK do), and from React Router's own
 * history index otherwise. Re-read on every location change.
 */
function HistoryButtons() {
  const navigate = useNavigate();
  useLocation();
  const nav = (window as unknown as { navigation?: { canGoBack: boolean; canGoForward: boolean } })
    .navigation;
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  const canBack = nav ? nav.canGoBack && idx > 0 : idx > 0;
  const canForward = nav ? nav.canGoForward : true;
  return (
    <div className="flex items-center">
      <Button variant="ghost" size="icon-sm" aria-label="Back" disabled={!canBack} onClick={() => navigate(-1)}>
        <ChevronLeftIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Forward" disabled={!canForward} onClick={() => navigate(1)}>
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
