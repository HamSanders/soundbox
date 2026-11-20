/** The default landing page: a dashboard of quick actions, recent sounds and
 *  projects, rather than dropping straight into the chat composer. The chat/
 *  conversation flow that used to live at "/" now sits at
 *  "/chat" (see App.tsx) — this page is what a returning user sees first. */

import { Link } from "react-router-dom";
import {
  AudioLinesIcon,
  PlusIcon,
  MusicIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LibraryShelves } from "@/components/library-shelves";
import { SoundCard } from "@/components/sound-card";
import { usePrefillStore, prefillFromSound } from "@/lib/generate-store";
import { useModels, useProjects, useSettings, useSounds, useTags } from "@/lib/queries";
import { usePlayerStore } from "@/lib/player-store";
import { useEffect } from "react";
import { needsModelsBanner } from "@/lib/onboarding";
import { useNewStudioPicker } from "@/components/new-studio-dialog";

/** How much of the library the dashboard shows before "See all" takes over.
 *  These are full library rows now rather than tiles, so the shelf has to be
 *  short enough that the projects above it stay on screen with it. */
const RECENT_LIMIT = 8;

const QUICK_LINKS = [
  {
    to: "/studio",
    icon: SparklesIcon,
    label: "Studio",
    hint: "Everything you have started",
  },
  {
    to: "/library/music",
    icon: MusicIcon,
    label: "Music",
    hint: "Tracks you have made",
  },
  {
    to: "/library/sfx",
    icon: AudioLinesIcon,
    label: "SFX",
    hint: "Effects you have made",
  },
];

export function DashboardPage() {
  // Two pickers, because they differ in one thing: starting something new
  // clears the thread and the composer, and reusing a sound must not — the
  // prefill it just dropped is the whole point of the trip.
  const fresh = useNewStudioPicker(true);
  const reuse = useNewStudioPicker(false);
  // The library's own rows can reuse a sound, and that needs the prefill.
  const setPrefill = usePrefillStore((s) => s.setPrefill);
  const { data: models } = useModels();
  const { data: settings } = useSettings();
  const { data: recent, isLoading: recentLoading } = useSounds({
    limit: RECENT_LIMIT,
    offset: 0,
  });
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: tags } = useTags();
  const setQueue = usePlayerStore((s) => s.setQueue);
  useEffect(() => {
    if (recent?.items) setQueue(recent.items);
  }, [recent?.items, setQueue]);

  const modelNames = new Map((models ?? []).map((m) => [m.id, m.name]));

  return (
    <div className="space-y-8">
      {fresh.dialog}
      {reuse.dialog}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-none font-extrabold tracking-[0.01em] uppercase">
            Welcome back
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick up where you left off, or start something new.
          </p>
        </div>
        <Button onClick={fresh.open}>
          <PlusIcon />
          New sound
        </Button>
      </div>

      {/* Setup was skipped and nothing is installed, so every card below this
          leads to a dead end. Says so once, here, rather than reopening the
          wizard — a modal someone already dismissed is not an answer. */}
      {needsModelsBanner(settings, models) && (
        <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
          <div className="flex items-start gap-2">
            <TriangleAlertIcon
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">No models installed yet</p>
              <p className="text-muted-foreground text-xs">
                Mirli cannot make anything until one is on your disk.
              </p>
            </div>
          </div>
          <Button size="sm" asChild>
            <Link to="/models">Pick a model</Link>
          </Button>
        </div>
      )}

      {/* --------------------------------------------------------- quick links */}
      <div className="grid grid-cols-3 gap-2">
        {QUICK_LINKS.map(({ to, icon: Icon, label, hint }) => (
          <Link key={to} to={to} className="group/tile rounded-xl">
            <Card className="group-hover/tile:bg-accent/50 group-hover/tile:ring-border-strong/50 flex h-full flex-col items-start gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4 transition-[background-color,box-shadow] duration-(--duration-fast)">
              <Icon className="text-muted-foreground group-hover/tile:text-primary size-5 transition-colors" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-muted-foreground hidden text-xs sm:block">{hint}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* ------------------------------------------------------------ shelves */}
      {/* The same shelves as the Library's front page: square tiles with the
          name set on them, one row each. A project opens as a collection; a
          tag opens the Library filtered to it. */}
      {projectsLoading ? (
        <div className="grid auto-cols-[8.5rem] grid-flow-col gap-3 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      ) : (
        <LibraryShelves projects={projects ?? []} tags={tags ?? []} includeEmpty />
      )}

      {/* -------------------------------------------------------------- recent */}
      {/* The library's own rows, capped at RECENT_LIMIT — a sound that looks
          one way in the library and another on the dashboard is two things to
          learn, and the row is the one that can rename, tag, split, reuse and
          delete in place. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="label-caps text-muted-foreground">Recent</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">See all</Link>
          </Button>
        </div>
        {recentLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: RECENT_LIMIT }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : recent?.items.length ? (
          <div role="list" aria-label="Recent sounds" className="@container -mx-2 grid">
            {recent.items.map((sound, i) => (
              <SoundCard
                key={sound.id}
                track
                sound={sound}
                modelName={modelNames.get(sound.model)}
                className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 fill-mode-both"
                style={{ animationDelay: `${i * 30}ms` }}
                onReuse={(s) => {
                  setPrefill(prefillFromSound(s));
                  reuse.open();
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState size="sm">
            Nothing generated yet —{" "}
            <button
              type="button"
              className="text-foreground underline underline-offset-4"
              onClick={fresh.open}
            >
              make something
            </button>
            .
          </EmptyState>
        )}
      </div>
    </div>
  );
}
