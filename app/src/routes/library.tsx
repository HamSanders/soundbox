/** Library — everything Soundbox has generated, searchable and filterable.
 *
 *  Rendered twice under two different nav items (SFX and Text to Speech — see
 *  routes/sfx-library.tsx and speech-library.tsx; Music has a studio of its
 *  own, routes/music-studio.tsx, which carries its own shelf of takes)
 *  rather than once as a flat catch-all: each `category` keeps its own sounds
 *  out of the others' lists entirely, not just out of the model dropdown, so
 *  a music generation never shows up while browsing SFX. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BotIcon, ChevronDownIcon, SearchIcon, SlidersHorizontalIcon, StarIcon, XIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { GenerateComposer } from "@/components/generate-composer";
import { FailureCard } from "@/components/failure-card";
import { PendingSoundRow } from "@/components/pending-sound-row";
import { PLAYER_DOCK_HEIGHT_PX } from "@/components/player-dock";
import { SoundCard } from "@/components/sound-card";
import { useGenerateSession } from "@/hooks/use-generate-session";
import { prefillFromSound, usePrefillStore } from "@/lib/generate-store";
import { usePlayerStore } from "@/lib/player-store";
import { useModels, useProjects, useSounds, useTags } from "@/lib/queries";
import { clampDuration, preferredModel } from "@/lib/session-store";
import type { Model, SoundQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

const ALL = "__all__";

/** Matches `Model.category` — "voice" covers both the "tts" and "vc" models
 *  behind the Voice studio, which is why the nav label for it reads "Text to
 *  Speech" rather than "Voice". */
export type LibraryCategory = "sfx" | "music" | "voice";

const CATEGORY_LABEL: Record<LibraryCategory, string> = {
  sfx: "SFX",
  music: "Music",
  voice: "Text to Speech",
};

const CATEGORY_EMPTY_HINT: Record<LibraryCategory, string> = {
  sfx: "Generated sound effects are saved automatically — start one in the Music Builder.",
  music: "Generated tracks are saved automatically — start one in the Music Builder.",
  voice: "Spoken reads are saved automatically — write one in the Script Builder.",
};

export function LibraryPage({ category }: { category?: LibraryCategory }) {
  const navigate = useNavigate();
  const setPrefill = usePrefillStore((s) => s.setPrefill);
  // The "now playing" dock pins to the same viewport-bottom spot the
  // category composer does — see the matching hook in routes/generate.tsx.
  const nowPlaying = usePlayerStore((s) => s.sound !== null);
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("project");

  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string>(ALL);
  const [modelId, setModelId] = useState<string>(ALL);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [agentsOnly, setAgentsOnly] = useState(false);
  /** The filter controls fold away behind a summary line that names what is
   *  set, so a page with a tag and a model chosen still reads at a glance
   *  without three dropdowns taking the width. */
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: models } = useModels();
  const { data: tags } = useTags();
  const { data: projects } = useProjects();
  const project = projectId ? projects?.find((p) => p.id === projectId) : undefined;

  // The model dropdown only offers models in this category — there's no
  // sense letting an SFX page filter down to a music model, since it would
  // always come back empty.
  const categoryModels = useMemo(
    () => (category ? (models ?? []).filter((m) => m.category === category) : models ?? []),
    [models, category],
  );
  const categoryModelIds = useMemo(
    () => categoryModels.map((m) => m.id),
    [categoryModels],
  );

  const modelNames = useMemo(
    () => new Map((models ?? []).map((e) => [e.id, e.name])),
    [models],
  );

  const query: SoundQuery = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      q: q.trim() || undefined,
      tag: tag === ALL ? undefined : tag,
      // `SoundQuery` has no category field of its own (a sound only carries
      // its model id), so a category page asks the server to match any model
      // in the category instead of filtering the page client-side — doing it
      // client-side silently dropped a category's sounds once they fell past
      // the first page of the *unfiltered* list.
      model: modelId === ALL ? undefined : modelId,
      models: modelId === ALL && category ? categoryModelIds : undefined,
      favorite: favoritesOnly || undefined,
      project_id: projectId ?? undefined,
      source: agentsOnly ? "mcp" : undefined,
    }),
    [q, tag, modelId, favoritesOnly, agentsOnly, projectId, category, categoryModelIds],
  );

  // While `models` (the catalogue) hasn't loaded yet, `categoryModelIds` is
  // empty — querying with an empty `models` list would ask the server for
  // nothing instead of everything, flashing an empty state before the real
  // one loads. Wait for the catalogue on a category page.
  const modelsReady = !category || Boolean(models);
  const { data, isLoading, isError, error } = useSounds(query, modelsReady);

  const items = data?.items ?? [];

  // The composer that lets a category page create directly from the list
  // view, instead of a trip to Generate — shares the same session Generate
  // and Console already share, so anything made here shows up wherever a
  // session is rendered next, exactly the way Console's did.
  const {
    models: sessionModels,
    modelsLoading: sessionModelsLoading,
    model: sessionModel,
    settings,
    patch,
    running,
    job,
    turns,
    jobs,
    cancelTurn,
    retryTurn,
    dismissTurn,
    blocker,
    submit,
    cancelCurrent,
    estimateS,
    estimateNote,
    projects: sessionProjects,
    projectId: sessionProjectId,
    changeProject,
    voices,
    voiceId,
    setVoiceId,
    llmEnabled,
    enhance,
    enhancing,
    enhanceError,
    enhanceVariations,
    applyVariation,
    canUndoEnhance,
    undoEnhance,
    writeLyrics,
    writingLyrics,
    lyricsError,
  } = useGenerateSession();

  // The renders still in flight, as rows at the top of the list they are
  // about to join — the same pattern the Music studio uses, for the same
  // reason: the sound you just asked for is the one you are watching, and a
  // list that shows nothing until it lands reads as a page that ignored you.
  //
  // Filtered by the *turn's own* model rather than by the composer's current
  // one. The session is shared with Generate, the Console and the other
  // category pages, so a music render can perfectly well be in flight while
  // you are on the SFX page — and it belongs in the music list, not this one.
  const modelCategories = useMemo(
    () => new Map((models ?? []).map((m) => [m.id, m.category])),
    [models],
  );
  const pending = useMemo(
    () =>
      category
        ? turns.filter(
            (t) =>
              t.status === "pending" &&
              modelCategories.get(t.request.model) === category,
          )
        : [],
    [turns, modelCategories, category],
  );
  // A turn that failed used to vanish from this page with its pending row
  // — the only trace was a status pill elsewhere. It stays here as a card
  // until it is retried or dismissed.
  const failed = useMemo(
    () =>
      category
        ? turns.filter(
            (t) =>
              t.status === "error" &&
              modelCategories.get(t.request.model) === category,
          )
        : [],
    [turns, modelCategories, category],
  );

  // Scoped to this category alone — passing the full model list would let a
  // Music page's picker offer an SFX model, which is the exact mixing this
  // split was meant to end.
  const composerModels = useMemo(
    () => (category ? (sessionModels ?? []).filter((m) => m.category === category) : sessionModels),
    [sessionModels, category],
  );

  // If the shared session's current model belongs to a different category
  // (carried over from Generate, or from visiting another category page),
  // jump it to one in this category the moment there's one to jump to —
  // otherwise the composer would show a model the picker itself can't offer.
  useEffect(() => {
    if (!category || !composerModels?.length) return;
    if (sessionModel && sessionModel.category === category) return;
    const preferred = preferredModel(composerModels)!;
    patch({
      modelId: preferred.id,
      duration: clampDuration(preferred.defaults.duration_s, preferred),
      steps: preferred.defaults.steps ?? null,
      cfg: preferred.defaults.cfg ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the category or its model list changes, not on every settings patch
  }, [category, composerModels, sessionModel]);

  const filtered =
    q || tag !== ALL || modelId !== ALL || favoritesOnly || agentsOnly || Boolean(projectId);

  const clear = () => {
    setQ("");
    setTag(ALL);
    setModelId(ALL);
    setFavoritesOnly(false);
    setAgentsOnly(false);
    if (projectId) setSearchParams({}, { replace: true });
  };

  const title = project ? project.name : category ? CATEGORY_LABEL[category] : "Library";

  return (
    /*
     * At least a viewport tall, as a flex column, so the composer below is
     * pinned to the bottom of the screen rather than to the bottom of the
     * results.
     *
     * `sticky bottom-0` alone could not do that. Sticky only holds an element
     * against the scrollport while it *would otherwise* have scrolled past —
     * and the composer is the last child, so on a short page (one result, an
     * empty search, a category you have not used yet) its natural position is
     * already on screen and it simply sits there, floating in the middle with
     * dead space under it. Giving the column a viewport-height floor puts that
     * natural position at the bottom of the screen, and the sticky behaviour
     * still does its job once the list is long enough to scroll.
     *
     * The subtraction is the shell's header (h-12) plus `main`'s own py-6.
     */
    <div className="flex min-h-[calc(100svh-6rem)] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm">
            {data ? `${items.length} sound${items.length === 1 ? "" : "s"}` : " "}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------ filters */}
      {/* Search stays out in the open: it is the filter people reach for. The
          rest sit behind a disclosure whose summary lists what is chosen, each
          value a chip that clears just itself. */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Label htmlFor="library-search" className="sr-only">
              Search
            </Label>
            <Input
              id="library-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search names, prompts and tags"
              className="pl-8"
            />
          </div>
          <CollapsibleTrigger asChild>
            <Button
              variant={filtersOpen ? "secondary" : "outline"}
              aria-expanded={filtersOpen}
              className="gap-1.5"
            >
              <SlidersHorizontalIcon />
              Filters
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", filtersOpen && "rotate-180")}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
          {/* The summary: what is chosen, as chips, each clearing itself. */}
          {tag !== ALL && (
            <FilterChip label={`Tag: ${tag}`} onClear={() => setTag(ALL)} />
          )}
          {modelId !== ALL && (
            <FilterChip
              label={`Model: ${categoryModels.find((m: Model) => m.id === modelId)?.name ?? modelId}`}
              onClear={() => setModelId(ALL)}
            />
          )}
          {favoritesOnly && <FilterChip label="Favourites" onClear={() => setFavoritesOnly(false)} />}
          {agentsOnly && <FilterChip label="By agents" onClear={() => setAgentsOnly(false)} />}
          {project && (
            <FilterChip
              label={`Project: ${project.name}`}
              onClear={() => setSearchParams({}, { replace: true })}
            />
          )}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear all filters">
              <XIcon />
              Clear
            </Button>
          )}
        </div>

        <CollapsibleContent className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1.5">
          <Label htmlFor="library-tag">Tag</Label>
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger id="library-tag" className="w-full">
              <SelectValue placeholder="All tags" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tags</SelectItem>
              {(tags ?? []).map((t) => (
                <SelectItem key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-48 space-y-1.5">
          <Label htmlFor="library-model">Model</Label>
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger id="library-model" className="w-full">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All models</SelectItem>
              {categoryModels.map((e: Model) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant={favoritesOnly ? "secondary" : "outline"}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((f) => !f)}
        >
          <StarIcon
            className={favoritesOnly ? "fill-foreground text-foreground" : ""}
          />
          Favourites
        </Button>

        <Button
          variant={agentsOnly ? "secondary" : "outline"}
          aria-pressed={agentsOnly}
          onClick={() => setAgentsOnly((a) => !a)}
        >
          <BotIcon />
          By agents
        </Button>
        </CollapsibleContent>
      </Collapsible>

      {/* -------------------------------------------------------------- list */}
      {isLoading || !modelsReady ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState tone="error" title="Could not load the library">
          {error instanceof Error ? error.message : "Unknown error"}
        </EmptyState>
      ) : !items.length && !pending.length ? (
        <EmptyState>
          {filtered ? (
            <p className="text-sm">
              No sounds match these filters.{" "}
              <button
                type="button"
                onClick={clear}
                className="text-foreground underline underline-offset-4"
              >
                Clear them
              </button>
              .
            </p>
          ) : (
            <>
              <p className="text-foreground text-sm font-medium">Nothing here yet</p>
              <p className="max-w-xs text-sm">
                {category
                  ? CATEGORY_EMPTY_HINT[category]
                  : "Generated sounds are saved automatically — head to Generate and describe something."}
              </p>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {failed.map((turn) => (
            <FailureCard
              key={turn.id}
              failure={turn.failure}
              error={turn.error}
              context={`${turn.request.prompt.trim() || "New sound"} · ${modelNames.get(turn.request.model) ?? turn.request.model}`}
              onRetry={turn.request.edit ? undefined : () => retryTurn(turn)}
              onDismiss={() => dismissTurn(turn.id)}
            />
          ))}
          {pending.map((turn) => (
            <PendingSoundRow
              key={turn.id}
              label={turn.request.prompt.trim() || "New sound"}
              sublabel={modelNames.get(turn.request.model) ?? turn.request.model}
              job={turn.jobId ? (jobs[turn.jobId] ?? null) : null}
              onCancel={() => cancelTurn(turn)}
            />
          ))}
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
            />
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- composer */}
      {/* Only on a category page — the unfiltered library (a project's view
          across every category) has no one category to default the model
          picker to, so it stays a browse-only page. See the sticky/clip
          comment on this same composer in routes/generate.tsx; it applies
          unchanged here. */}
      {category && (
        <div
          // `mt-auto` is what actually pushes it down in the column above:
          // whichever branch rendered the results (a grid, an empty state, a
          // skeleton) does not have to remember to grow.
          // `-mb-6 pb-6` is the vertical twin of the `-mx-3 px-3` bleed
          // beside it: `main` has 24px of bottom padding, and without pulling
          // through it the composer would rest 24px above the window edge on a
          // short page while sitting flush against it on a long one.
          className="from-background via-background sticky z-20 mt-auto -mx-3 -mb-6 overflow-x-clip [overflow-clip-margin:12px] bg-gradient-to-t via-75% to-transparent px-3 pt-6 pb-6 transition-[bottom]"
          style={{ bottom: nowPlaying ? PLAYER_DOCK_HEIGHT_PX : 0 }}
        >
          <GenerateComposer
            settings={settings}
            onChange={patch}
            models={composerModels}
            modelsLoading={sessionModelsLoading}
            model={sessionModel}
            running={running}
            job={job}
            blocker={blocker}
            onSubmit={submit}
            onCancel={cancelCurrent}
            estimateS={estimateS}
            estimateNote={estimateNote}
            projects={sessionProjects}
            projectId={sessionProjectId}
            onChangeProject={changeProject}
            voices={voices}
            voiceId={voiceId}
            onChangeVoice={setVoiceId}
            enhance={{
              enabled: llmEnabled,
              pending: enhancing,
              error: enhanceError,
              variations: enhanceVariations,
              canUndo: canUndoEnhance,
              run: enhance,
              apply: applyVariation,
              undo: undoEnhance,
            }}
            lyricsAssist={{
              enabled: llmEnabled,
              pending: writingLyrics,
              error: lyricsError,
              write: writeLyrics,
            }}
          />
        </div>
      )}
    </div>
  );
}

/** One chosen filter value, as a chip whose × clears only it. */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="bg-muted text-foreground inline-flex h-8 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-full p-0.5"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
