/**
 * One Create panel for every kind of sound, as a panel of its own.
 *
 * Shaped after a music app's create page: a narrow column between the
 * sidebar and the page, with the kinds as tabs across its top and the form
 * for that kind under them, while the page beside it is that kind's list.
 * It is a shell panel (same margins and 4px gutter as the sidebar and the
 * page), shown on the three kind pages and only from md up; on a phone the
 * pages keep their own in-page composer.
 *
 * Both forms read and write the shared `useGenerateSession`, so moving them
 * here changes nothing about what they do: pending and failed rows still
 * appear in the list, and the Generate page sees the same session.
 */

import { useEffect, useMemo } from "react";
import { Navigate, NavLink, useLocation } from "react-router-dom";

import { GenerateComposer } from "@/components/generate-composer";
import { MusicRequestForm } from "@/components/music-request-form";
import { useGenerateSession } from "@/hooks/use-generate-session";
import { useModels } from "@/lib/queries";
import { clampDuration, preferredModel } from "@/lib/session-store";
import { cn } from "@/lib/utils";

type Kind = "music" | "sfx" | "voice";

const KINDS: { to: string; label: string; kind: Kind }[] = [
  { to: "/library/music", label: "Music", kind: "music" },
  { to: "/library/sfx", label: "SFX", kind: "sfx" },
  { to: "/library/speech", label: "Speech", kind: "voice" },
];

/** Which kind page this is, if any: the panel shows only on those. */
export function createKindFor(pathname: string): Kind | null {
  return KINDS.find((k) => pathname === k.to || pathname.startsWith(`${k.to}/`))?.kind ?? null;
}

/** The session's model belongs to whichever kind was used last; move it to
 *  one this kind can offer, as each page used to on its own. */
function useModelForKind(kind: Kind) {
  const session = useGenerateSession();
  const { models, model, patch } = session;
  const kindModels = useMemo(() => (models ?? []).filter((m) => m.category === kind), [models, kind]);
  useEffect(() => {
    if (!kindModels.length) return;
    if (model && model.category === kind) return;
    const preferred = preferredModel(kindModels)!;
    patch({
      modelId: preferred.id,
      duration: clampDuration(preferred.defaults.duration_s, preferred),
      steps: preferred.defaults.steps ?? null,
      cfg: preferred.defaults.cfg ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the model list or the selected model should retrigger this
  }, [kindModels, model, kind]);
  return { ...session, kindModels };
}

function MusicForm() {
  const s = useModelForKind("music");
  const { data: models } = useModels();
  return (
    <MusicRequestForm
      settings={s.settings}
      patch={s.patch}
      model={s.model}
      models={s.kindModels}
      modelsLoading={s.modelsLoading}
      llmEnabled={s.llmEnabled}
      enhance={s.enhance}
      enhancing={s.enhancing}
      enhanceError={s.enhanceError}
      writeLyrics={s.writeLyrics}
      writingLyrics={s.writingLyrics}
      lyricsError={s.lyricsError}
      running={s.running}
      canSubmit={s.canSubmit}
      submit={s.submit}
      cancelCurrent={s.cancelCurrent}
      estimateS={s.estimateS}
      estimateNote={s.estimateNote}
      projects={s.projects}
      projectId={s.projectId}
      onChangeProject={s.changeProject}
      canSeparate={Boolean(models?.some((m) => m.task === "sep"))}
    />
  );
}

function SoundForm({ kind }: { kind: "sfx" | "voice" }) {
  const s = useModelForKind(kind);
  return (
    <GenerateComposer
      settings={s.settings}
      onChange={s.patch}
      models={s.kindModels}
      modelsLoading={s.modelsLoading}
      model={s.model}
      running={s.running}
      job={s.job}
      blocker={s.blocker}
      onSubmit={s.submit}
      onCancel={s.cancelCurrent}
      estimateS={s.estimateS}
      estimateNote={s.estimateNote}
      projects={s.projects}
      projectId={s.projectId}
      onChangeProject={s.changeProject}
      voices={s.voices}
      voiceId={s.voiceId}
      onChangeVoice={s.setVoiceId}
      enhance={{
        enabled: s.llmEnabled,
        pending: s.enhancing,
        error: s.enhanceError,
        variations: s.enhanceVariations,
        canUndo: s.canUndoEnhance,
        run: s.enhance,
        apply: s.applyVariation,
        undo: s.undoEnhance,
      }}
      lyricsAssist={{
        enabled: s.llmEnabled,
        pending: s.writingLyrics,
        error: s.lyricsError,
        write: s.writeLyrics,
      }}
    />
  );
}

const LAST_KIND_KEY = "mirli.create.kind";

/** `/create`: the kind page you used last, Music the first time. */
export function CreateRedirect() {
  let to = "/library/music";
  try {
    const saved = localStorage.getItem(LAST_KIND_KEY);
    if (saved && KINDS.some((k) => k.to === saved)) to = saved;
  } catch {
    /* storage blocked: the default is fine */
  }
  return <Navigate to={to} replace />;
}

export function CreatePanel() {
  const { pathname } = useLocation();
  const kind = createKindFor(pathname);
  useEffect(() => {
    const k = KINDS.find((x) => x.kind === kind);
    if (!k) return;
    try {
      localStorage.setItem(LAST_KIND_KEY, k.to);
    } catch {
      /* storage blocked */
    }
  }, [kind]);
  if (!kind) return null;

  return (
    <aside
      aria-label="Create"
      className="bg-background ring-border my-2 mr-1 hidden h-[calc(100svh-1rem-var(--dock-h,0px))] w-[22rem] shrink-0 flex-col rounded-xl ring-1 md:flex"
    >
      <nav aria-label="Kind" className="border-border flex shrink-0 gap-4 border-b px-4">
        {KINDS.map((k) => (
          <NavLink
            key={k.to}
            to={k.to}
            className={({ isActive }) =>
              cn(
                "focus-visible:ring-ring/50 -mb-px border-b-2 py-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2",
                isActive
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )
            }
          >
            {k.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {kind === "music" ? <MusicForm /> : <SoundForm kind={kind} />}
      </div>
    </aside>
  );
}
