/**
 * The shelf — everything you have started, in either builder.
 *
 * One index for two tools rather than two indexes, because a story is a story
 * whichever door it came through: the same timeline, the same clips, the same
 * export. What the builder decides is how you work on it, not where it is
 * kept. The tabs are how you find yours; `?builder=` is what a builder's
 * breadcrumb points at, so leaving the Script Builder lands you among scripts
 * rather than among everything.
 *
 * An index rather than a sidebar list: the list of pieces is not something you
 * need visible while working on one, and giving it a permanent column would
 * cost the builder width it uses better. You pick one, you go and work on it,
 * and the way back is the breadcrumb.
 */

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PlusIcon, SearchIcon } from "@/lib/icons";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { StoryShape } from "@/components/story-shape";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewStudioPicker } from "@/components/new-studio-dialog";
import { useProjects, useStories } from "@/lib/queries";
import { formatDuration, formatRelative } from "@/lib/format";
import { studioPath, type StoryBuilder, type TimelineClip } from "@/lib/api";

/** Below this many, a filter box is chrome — the same threshold the sidebar
 *  groups use for the same reason. */
const SEARCH_THRESHOLD = 6;

type BuilderFilter = "all" | StoryBuilder;

const BUILDER_LABEL: Record<StoryBuilder, string> = {
  script: "Script",
  music: "Music & SFX",
};

/**
 * What the timeline adds up to: how long the piece runs, and how many lanes it
 * uses. Both come off the same capped clip list the thumbnail already draws
 * from, so the shelf costs no extra request to say them — and a story long
 * enough to hit the server's cap reports the part it can see, which is why the
 * row leads with the counts the server is sure of.
 */
function summarize(clips: TimelineClip[]): { duration: number; tracks: number } {
  let duration = 0;
  const lanes = new Set<number>();
  for (const c of clips) {
    duration = Math.max(duration, c.s + c.d);
    lanes.add(c.t);
  }
  return { duration, tracks: lanes.size };
}

export function StudioIndexPage() {
  const navigate = useNavigate();
  const stories = useStories(200);
  const projects = useProjects();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const picker = useNewStudioPicker();

  // Read from the URL rather than from state so a builder's breadcrumb can
  // point at its own half of the shelf, and so the choice survives a reload.
  const raw = params.get("builder");
  const filter: BuilderFilter = raw === "script" || raw === "music" ? raw : "all";
  const setFilter = (next: BuilderFilter): void => {
    if (next === "all") setParams({}, { replace: true });
    else setParams({ builder: next }, { replace: true });
  };

  // Counted from the unfiltered list so a tab's count never drifts with the
  // search box — the tabs answer "how many of this kind exist", not "how many
  // matched what's currently typed".
  const counts = useMemo(() => {
    const all = stories.data ?? [];
    const c: Record<BuilderFilter, number> = { all: all.length, script: 0, music: 0 };
    for (const s of all) c[s.builder]++;
    return c;
  }, [stories.data]);

  // Rows name the project a story belongs to when it has one, so the shelf
  // can be read as "whose work is this" and not only "what is it called".
  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects.data ?? []) m.set(p.id, p.name);
    return m;
  }, [projects.data]);

  const items = useMemo(() => {
    const all = stories.data ?? [];
    const byBuilder = filter === "all" ? all : all.filter((s) => s.builder === filter);
    const q = search.trim().toLowerCase();
    return q ? byBuilder.filter((s) => s.title.toLowerCase().includes(q)) : byBuilder;
  }, [stories.data, search, filter]);

  return (
    <div className="space-y-5">
      {picker.dialog}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Studio</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Two builders over one timeline. Write and cast a script in the Script Builder,
            or describe a track and arrange the takes in the Music Builder.
          </p>
        </div>
        <Button onClick={picker.open}>
          <PlusIcon />
          New
        </Button>
      </div>

      {(stories.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Shown once there is more than one kind on the shelf to tell
              apart — a single-tab tab bar is a label pretending to be a
              control. */}
          {counts.script > 0 && counts.music > 0 && (
            <Tabs value={filter} onValueChange={(v) => setFilter(v as BuilderFilter)}>
              <TabsList>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                {(["script", "music"] as const).map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {BUILDER_LABEL[key]} ({counts[key]})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {(stories.data?.length ?? 0) > SEARCH_THRESHOLD && (
            <div className="relative ml-auto w-full max-w-xs sm:w-64">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                className="pl-8"
                value={search}
                placeholder="Search…"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {stories.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            // A row's height, so the shelf does not resize under itself when
            // the stories land.
            <Skeleton key={i} className="h-[5.25rem] rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          action={
            !search && (
              <Button variant="outline" onClick={picker.open}>
                <PlusIcon />
                New
              </Button>
            )
          }
        >
          {search
            ? "Nothing matches that."
            : filter !== "all"
              ? `Nothing in the ${BUILDER_LABEL[filter]} Builder yet.`
              : "Nothing started yet. Pick a builder and give it its first line."}
        </EmptyState>
      ) : (
        // Rows rather than a grid of cards: a story is a document, and this
        // is a list of documents — the same shape Projects uses, and the one
        // that keeps the titles in a single column you can run an eye down.
        <div className="grid gap-2">
          {items.map((story, i) => (
            <button
              key={story.id}
              type="button"
              onClick={() => navigate(studioPath(story))}
              className="group border-border/70 bg-card hover:border-border hover:bg-accent/40 animate-in fade-in-0 slide-in-from-bottom-1 flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left duration-300 fill-mode-both"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              {/* The thumbnail leads, the way a cover does in a track list:
                  it is what tells a script from an arrangement before you
                  have read a word. */}
              <StoryShape clips={story.timeline ?? []} className="size-16 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{story.title}</p>
                {(() => {
                  const { duration, tracks } = summarize(story.timeline ?? []);
                  return (
                    <>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {/* Which builder opens it, on the row rather than only
                            in the tabs: "All" is the tab you land on, and a
                            title alone does not say which tool a story
                            belongs to. */}
                        {BUILDER_LABEL[story.builder]} · {story.segment_count}{" "}
                        {story.builder === "script" ? "line" : "clip"}
                        {story.segment_count === 1 ? "" : "s"}
                        {/* How long it runs and how wide it is laid out — the
                            two things you actually want to know about a piece
                            before opening it, and the two the thumbnail can
                            only hint at. Both fall away on an empty story
                            rather than reading "0:00 · 0 tracks", which says
                            "broken" where "nothing yet" is the truth. */}
                        {duration > 0 ? ` · ${formatDuration(duration)}` : ""}
                        {tracks > 1 ? ` · ${tracks} tracks` : ""}
                      </p>
                      <p className="text-muted-foreground/80 mt-0.5 truncate text-xs">
                        Edited {formatRelative(story.updated_at)}
                        {story.project_id && projectName.has(story.project_id)
                          ? ` · ${projectName.get(story.project_id)}`
                          : ""}
                      </p>
                    </>
                  );
                })()}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
