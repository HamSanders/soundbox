/** The default landing page: a dashboard of quick actions, recent sounds and
 *  projects, rather than dropping straight into the chat composer. The chat/
 *  conversation flow that used to live at "/" now sits at
 *  "/chat" (see App.tsx) — this page is what a returning user sees first. */

import { Link } from "react-router-dom";
import {
  AudioLinesIcon,
  MessageSquareIcon,
  MusicIcon,
  AudioWaveformIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectThumb } from "@/components/project-thumb";
import { SoundCard } from "@/components/sound-card";
import { usePrefillStore, prefillFromSound } from "@/lib/generate-store";
import { useModels, useProjects, useSettings, useSounds } from "@/lib/queries";
import { needsModelsBanner } from "@/lib/onboarding";
import { useNewStudioPicker } from "@/components/new-studio-dialog";

/** How much of the library the dashboard shows before "See all" takes over.
 *  These are full library rows now rather than tiles, so the shelf has to be
 *  short enough that the projects above it stay on screen with it. */
const RECENT_LIMIT = 5;

const QUICK_LINKS = [
  {
    to: "/studio",
    icon: AudioWaveformIcon,
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

  const modelNames = new Map((models ?? []).map((m) => [m.id, m.name]));

  return (
    <div className="space-y-8">
      {fresh.dialog}
      {reuse.dialog}
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-muted-foreground text-sm">
          Pick up where you left off, or start something new.
        </p>
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
                Konchi cannot make anything until one is on your disk.
              </p>
            </div>
          </div>
          <Button size="sm" asChild>
            <Link to="/models">Pick a model</Link>
          </Button>
        </div>
      )}

      {/* --------------------------------------------------------- quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Not a link, because there is nowhere to link to yet: the story has
            to exist before it can be opened, and which builder makes it is
            the question the picker asks. Same door as the sidebar's. */}
        <button type="button" className="group/tile rounded-xl text-left" onClick={fresh.open}>
          <Card className="group-hover/tile:bg-accent/50 group-hover/tile:ring-border-strong/50 flex h-full flex-col gap-2 p-4 transition-[background-color,box-shadow] duration-(--duration-fast)">
            <MessageSquareIcon className="text-muted-foreground group-hover/tile:text-primary size-5 transition-colors" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">New sound</p>
              <p className="text-muted-foreground text-xs">
                A script to voice, or a track to build
              </p>
            </div>
          </Card>
        </button>
        {QUICK_LINKS.map(({ to, icon: Icon, label, hint }) => (
          <Link key={to} to={to} className="group/tile rounded-xl">
            <Card className="group-hover/tile:bg-accent/50 group-hover/tile:ring-border-strong/50 flex h-full flex-col gap-2 p-4 transition-[background-color,box-shadow] duration-(--duration-fast)">
              <Icon className="text-muted-foreground group-hover/tile:text-primary size-5 transition-colors" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-muted-foreground text-xs">{hint}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* ------------------------------------------------------------ projects */}
      {/* Above Recent: the shelf is two rows at most, while Recent is a column
          of full-height library rows that would otherwise push every project
          below the fold. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your projects</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/projects">See all</Link>
          </Button>
        </div>
        {projectsLoading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-2/3 w-full rounded-xl" />
            ))}
          </div>
        ) : projects?.length ? (
          /* A shelf of portrait covers rather than folder rows — the same
             posture as a rack of sample-pack sleeves. The library keeps the
             square variant of the identical artwork (see ProjectThumb). */
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {projects.slice(0, 8).map((project) => (
              <Link key={project.id} to={`/library?project=${project.id}`} className="group/tile">
                <div className="ring-foreground/10 group-hover/tile:ring-foreground/25 relative aspect-2/3 overflow-hidden rounded-xl ring-1 transition-shadow">
                  <ProjectThumb
                    name={project.name}
                    className="absolute inset-0 size-full transition-transform duration-300 group-hover/tile:scale-[1.03]"
                  />
                  {/* Scrim under the caption, tall enough that two lines of
                      name never sit on unshaded artwork. */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
                  />
                  <div className="absolute inset-x-0 bottom-0 p-2.5">
                    <p className="line-clamp-2 text-sm leading-tight font-medium text-white">
                      {project.name}
                    </p>
                    <p className="mt-0.5 text-xs text-white/70">
                      {project.sound_count} sound{project.sound_count === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState size="sm">No projects yet.</EmptyState>
        )}
      </div>

      {/* -------------------------------------------------------------- recent */}
      {/* The library's own rows, capped at RECENT_LIMIT — a sound that looks
          one way in the library and another on the dashboard is two things to
          learn, and the row is the one that can rename, tag, split, reuse and
          delete in place. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">See all</Link>
          </Button>
        </div>
        {recentLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: RECENT_LIMIT }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : recent?.items.length ? (
          <div className="grid gap-3">
            {recent.items.map((sound, i) => (
              <SoundCard
                key={sound.id}
                sound={sound}
                modelName={modelNames.get(sound.model)}
                className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 fill-mode-both"
                style={{ animationDelay: `${i * 30}ms` }}
                onReuse={(s) => {
                  // The prefill needs somewhere with a form in it. /chat is
                  // the conversation now and has no composer, so reusing a
                  // sound opens a builder, whose Prompt panel reads the same
                  // store — and the picker still asks which builder, because
                  // a sound reused as a bed under a script and one reused as
                  // the seed of a new track are different jobs.
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
