/**
 * Music — a studio, not a list.
 *
 * Laid out as two panes: the request on the left as one tall column you read
 * top to bottom (model, voice or no voice, the styles that describe the
 * track, its name, how many takes), and what came back on the right as a list
 * you keep scrolling while the next render is still going.
 *
 * The two panes are deliberately not a conversation. /app is the thread —
 * "same again but slower" reads as one turn after another there. Music is the
 * other mode: one set of controls you keep adjusting, and a growing shelf of
 * takes to compare. Both drive the same session (`useGenerateSession`), the
 * same job stream and the same store, so a track made here shows up on the
 * Generate thread and in the Library exactly as before — this file only
 * decides what the controls look like.
 *
 * The right pane is the Library's own query, scoped to music models, split in
 * two: "My Work" is everything, "Collection" is the favourites. It covers
 * what the old /library/music page did, which is why that route lands here.
 *
 * Both halves borrow the Voice studio's furniture rather than inventing their
 * own: the same pointer-driven divider between the panes (`splitPct`), and
 * the same `ArtifactStack` around the takes, so the shelf is a panel you can
 * collapse and — once there is ever a second thing worth showing beside it —
 * trade height with, exactly as the timeline and the selected clip do there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ArtifactStack } from "@/components/artifact-stack";
import { MusicRequestForm } from "@/components/music-request-form";
import { PendingSoundRow } from "@/components/pending-sound-row";
import { SoundCard } from "@/components/sound-card";
import { useGenerateSession } from "@/hooks/use-generate-session";
import { prefillFromSound, usePrefillStore } from "@/lib/generate-store";
import { useModels, useSounds } from "@/lib/queries";
import { clampDuration, preferredModel } from "@/lib/session-store";
import type { SoundQuery } from "@/lib/api";

/* ------------------------------------------------------------------ page */

export function MusicStudioPage() {
  const navigate = useNavigate();
  const setPrefill = usePrefillStore((s) => s.setPrefill);

  const {
    models: sessionModels,
    modelsLoading,
    model,
    settings,
    patch,
    running,
    job,
    canSubmit,
    submit,
    cancelCurrent,
    startEdit,
    estimateS,
    estimateNote,
    projects,
    projectId,
    changeProject,
    llmEnabled,
    enhance,
    enhancing,
    enhanceError,
    writeLyrics,
    writingLyrics,
    lyricsError,
  } = useGenerateSession();

  const musicModels = useMemo(
    () => (sessionModels ?? []).filter((m) => m.category === "music"),
    [sessionModels],
  );

  // The session is shared with /app and /console, so its model can arrive
  // here belonging to another category. Jump it to a music model the moment
  // there is one — otherwise the picker would be showing a model it cannot
  // itself offer. (Same effect, same reason, as the Library's composer.)
  useEffect(() => {
    if (!musicModels.length) return;
    if (model && model.category === "music") return;
    const preferred = preferredModel(musicModels)!;
    patch({
      modelId: preferred.id,
      duration: clampDuration(preferred.defaults.duration_s, preferred),
      steps: preferred.defaults.steps ?? null,
      cfg: preferred.defaults.cfg ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the model list or the selected model should retrigger this, not every settings patch
  }, [musicModels, model]);

  /* --------------------------------------------------------------- takes */

  const [tab, setTab] = useState<"work" | "collection">("work");
  const [q, setQ] = useState("");
  const { data: models } = useModels();
  const musicModelIds = useMemo(
    () => (models ?? []).filter((m) => m.category === "music").map((m) => m.id),
    [models],
  );
  const modelNames = useMemo(
    () => new Map((models ?? []).map((m) => [m.id, m.name])),
    [models],
  );

  const query: SoundQuery = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      q: q.trim() || undefined,
      // A sound carries only its model id, so "music" is asked for as "any
      // of these models" — filtering client-side drops a category's sounds
      // once they fall past the first page of the unfiltered list.
      models: musicModelIds,
      favorite: tab === "collection" || undefined,
    }),
    [q, musicModelIds, tab],
  );
  // An empty `models` list asks the server for nothing rather than
  // everything, so wait for the catalogue before querying at all.
  const { data, isLoading, isError, error } = useSounds(
    query,
    musicModelIds.length > 0,
  );
  const items = data?.items ?? [];

  /* --------------------------------------------------------------- split */
  /** Where the divider sits, as a percentage of the row. Local state, not
   *  persisted — the same call the Voice studio makes: it is a "give me room
   *  for this bit right now" gesture, and a remembered width is one more
   *  thing to be wrong the next time the page opens. */
  const [splitPct, setSplitPct] = useState(32);
  const rowRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<number | null>(null);

  const onResizeDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    // Capture keeps the moves coming while the pointer is dragged off the
    // 8px divider, which it will be immediately. It is an optimisation, not
    // the drag itself, so a browser that refuses the capture still gets a
    // working divider rather than a dead one.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* no capture available; the pointer handlers still fire on the divider */
    }
    resizeRef.current = event.pointerId;
  };
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current !== event.pointerId || rowRef.current === null)
      return;
    const rect = rowRef.current.getBoundingClientRect();
    // Clamped so neither side can be dragged away entirely — a pane you
    // cannot see is a pane you cannot drag back.
    const pct = ((event.clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.min(60, Math.max(22, pct)));
  };
  const onResizeUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current === event.pointerId) resizeRef.current = null;
  };
  const nudgeSplit = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const by =
      event.key === "ArrowLeft" ? -2 : event.key === "ArrowRight" ? 2 : 0;
    if (by === 0) return;
    event.preventDefault();
    setSplitPct((p) => Math.min(60, Math.max(22, p + by)));
  };

  /** The list itself, as one node per tab: the panel body is a single
   *  scroller, so the tab panels sit inside it rather than each owning a
   *  scroll region of their own. */
  const takes = (["work", "collection"] as const).map((value) => (
    <TabsContent key={value} value={value} className="mt-0">
      {isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState tone="error" title="Could not load your tracks">
          {error instanceof Error ? error.message : "Unknown error"}
        </EmptyState>
      ) : !items.length ? (
        <EmptyState title={value === "collection" ? "Nothing saved yet" : "Nothing here yet"}>
            {value === "collection"
              ? "Star a track and it joins your collection."
              : q
                ? "No tracks match that search."
                : "Describe a track on the left and press Create — every take is saved automatically."}
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {items.map((sound, i) => (
            <SoundCard
              key={sound.id}
              sound={sound}
              modelName={modelNames.get(sound.model)}
              className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 fill-mode-both"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              onReuse={(s) => {
                setPrefill(prefillFromSound(s));
                navigate("/chat");
              }}
              onEdit={startEdit}
            />
          ))}
        </div>
      )}
    </TabsContent>
  ));

  return (
    // Container queries rather than viewport ones, for the reason the Voice
    // studio states: what decides whether these two panes can sit side by
    // side is how much room *this* element got inside the shell, not how wide
    // the window happens to be. The @container and the flex row have to be
    // two elements — an element cannot query its own size.
    //
    // Full height, taken from the shell rather than from `svh`: the
    // full-bleed column is a flex column pinned to what is left under the
    // header (see the note in App.tsx), and the now-playing dock sits in that
    // same flow, so growing into it lands on the free space and keeps landing
    // there when the dock appears. A viewport calc would have to guess at
    // both, and be a few pixels wrong for the rest of its life.
    //
    // Full height is a two-column idea only. Stacked, the page is a page: it
    // scrolls, and neither pane is trapped in a viewport-sized box with its
    // own scrollbar inside another one.
    <div
      // Sizing lives on the row below, not here: this element *is* the
      // container being queried, and an element cannot query its own size —
      // an `@3xl:` class on it would never match.
      className="@container flex min-h-0 w-full min-w-0 flex-1 flex-col"
      style={{ "--split": `${splitPct}%` } as React.CSSProperties}
    >
      <div
        ref={rowRef}
        className="flex flex-col gap-4 @3xl:min-h-0 @3xl:flex-1 @3xl:flex-row @3xl:gap-3"
      >
        {/* -------------------------------------------------------- controls */}
        <aside className="flex min-w-0 flex-col gap-3 md:hidden @3xl:min-h-0 @3xl:flex-none @3xl:basis-[var(--split)] @3xl:overflow-y-auto @3xl:pr-1">
          <MusicRequestForm
            settings={settings}
            patch={patch}
            model={model}
            models={musicModels}
            modelsLoading={modelsLoading}
            llmEnabled={llmEnabled}
            enhance={enhance}
            enhancing={enhancing}
            enhanceError={enhanceError}
            writeLyrics={writeLyrics}
            writingLyrics={writingLyrics}
            lyricsError={lyricsError}
            running={running}
            canSubmit={canSubmit}
            submit={submit}
            cancelCurrent={cancelCurrent}
            estimateS={estimateS}
            estimateNote={estimateNote}
            projects={projects}
            projectId={projectId}
            onChangeProject={changeProject}
            canSeparate={Boolean(models?.some((m) => m.task === "sep"))}
          />
        </aside>

        {/* The divider is only a divider where there is something either side
            of it to divide; stacked, the panes are simply one above the
            other. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the controls and takes panes"
          tabIndex={0}
          className="hover:bg-primary/40 active:bg-primary/60 focus-visible:bg-primary/60 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none rounded-full transition-colors"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={nudgeSplit}
        />

        {/* ----------------------------------------------------------- takes */}
        {/* Stacked, the shelf gets a height of its own rather than whatever is
            left over — below the controls there is nothing left over. */}
        <section className="flex h-[32rem] min-h-0 w-full min-w-0 flex-col @3xl:h-auto @3xl:flex-1">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "work" | "collection")}
            className="min-h-0 flex-1"
          >
            <ArtifactStack
              className="flex-1"
              artifacts={[
                {
                  id: "takes",
                  label: "Takes",
                  // The only panel in the column: nothing to collapse it
                  // against, so no chevron, and the tabs name it without an
                  // icon.
                  pinned: true,
                  // The tabs are the panel's header, the way the sound
                  // artifact's header is its transport: what the panel is
                  // showing is the one control that belongs up there.
                  title: (
                    <TabsList variant="line" className="h-8 gap-3 px-0">
                      <TabsTrigger
                        value="work"
                        className="text-sm font-semibold"
                      >
                        My Work
                      </TabsTrigger>
                      <TabsTrigger
                        value="collection"
                        className="text-sm font-semibold"
                      >
                        Collection
                      </TabsTrigger>
                    </TabsList>
                  ),
                  trailing: (
                    <div className="relative w-40 shrink-0 sm:w-56">
                      <SearchIcon
                        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <Label htmlFor="music-search" className="sr-only">
                        Search tracks
                      </Label>
                      <Input
                        id="music-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search tracks"
                        className="h-8 pl-8"
                      />
                    </div>
                  ),
                  body: (
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                      {/* The render in flight, at the top of the list it is
                          about to join — the same place the finished track
                          will appear. Sticky, because it is the one row you
                          are waiting on: scrolling back through older takes
                          while it renders must not cost you sight of it. */}
                      {running && (
                        <div className="bg-card sticky top-0 z-10 -mx-3 px-3 py-3">
                          <PendingSoundRow
                            label={
                              settings.trackName.trim() ||
                              settings.prompt.trim() ||
                              "New track"
                            }
                            job={job}
                            onCancel={cancelCurrent}
                          />
                        </div>
                      )}
                      <div className={running ? undefined : "pt-3"}>
                        {takes}
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Tabs>
        </section>
      </div>
    </div>
  );
}
