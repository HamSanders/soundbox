/**
 * The Generate session, as a hook.
 *
 * Everything the Generate page needs to *drive* a session — model defaults,
 * prefill handoff, submit, following the job stream, folding results back
 * into their turn — lives here rather than in the page, because there are now
 * two front panels over the same session: the conversational `/app` view and
 * the hardware-style `/console` view. They render very differently but they
 * must share one store, one job stream and one set of rules (clamp cfg to the
 * model's ceiling, take the new model's own steps/cfg on switch, and so on).
 * Duplicating those rules per page is exactly how they'd drift.
 *
 * Nothing here is visual. The page decides what a turn looks like.
 *
 * Two tasks reach this composer, not one. "gen" is the original: a prompt and
 * a duration go to /api/generate. "tts" is a *one-off read* — the same box,
 * but the words you type are the words that get spoken, and it goes to
 * /api/speak as a single-line script. The Voice studio remains the place to
 * build a multi-speaker dialogue, manage the voice library and re-voice a
 * recording; this is the shortcut for "just say this", which otherwise costs a
 * page change and a five-field form. Everything downstream of submit — the job
 * stream, the turn, the rendered sound — is shared, because /api/speak creates
 * and threads a session exactly the way /api/generate does and its job result
 * has the same `{ sounds: [id] }` shape.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { voiceReferenceError } from "@/lib/voice-reference";

import { useJobStreams } from "@/hooks/use-job-stream";
import { ApiError,
  api,
  errorMessage,
  type EditKind,
  type Model,
  type GenerateRequest,
  type Sound,
  type SpeakRequest,
  type Voice,
} from "@/lib/api";
import { usePrefillStore } from "@/lib/generate-store";
import { composerBlocker } from "@/lib/composer-blocker";
import { isNotReady, notReadyReason } from "@/lib/model-ready";
import {
  clampDuration,
  clampExtendTotal,
  nextTurnId,
  preferredModel,
  useSessionStore,
  type ComposerSettings,
  type Turn,
  type TurnInsert,
} from "@/lib/session-store";
import {
  useCancelJob,
  useEnhance,
  useEnhanceLyrics,
  useLlmStatus,
  useModels,
  useGenerate,
  useProjects,
  useSetSessionProject,
  useSpeak,
  useVoices,
} from "@/lib/queries";

/**
 * How long a run should take, from this model's own recent runs.
 *
 * Where a hosted tool puts a credit price, this goes: the thing a local run
 * actually costs you is time. Measured or nothing — a model with no history
 * shows no readout rather than a guess.
 */
export function estimateDurationS(model: Model | undefined, variations: number): number | null {
  if (!model?.avg_duration_s) return null;
  return model.avg_duration_s * variations;
}

/** Turn a settings object into the exact request the API will receive. Pure,
 *  so a page can preview it (the console prints it on its "patch" readout). */
export function buildRequest(
  settings: ComposerSettings,
  model: Model | undefined,
  sessionId: string | null,
  projectId: string | null,
): GenerateRequest {
  return {
    model: settings.modelId,
    prompt: settings.prompt.trim(),
    negative_prompt:
      model?.supports.negative_prompt && settings.negativePrompt.trim()
        ? settings.negativePrompt.trim()
        : null,
    lyrics:
      model?.supports.lyrics && settings.lyrics.trim() ? settings.lyrics.trim() : null,
    track_name:
      model?.supports.lyrics && settings.trackName.trim()
        ? settings.trackName.trim()
        : null,
    duration_s: settings.duration,
    seed: settings.seedLocked ? settings.seed : null,
    steps: model?.supports.steps ? settings.steps : null,
    // Clamped here too, not just in the control's onBlur: settings can carry
    // a cfg saved before this model had a ceiling (or from switching models
    // without revisiting the field), and that stale value should never reach
    // the API and bounce as an error the user did nothing on this screen to
    // cause.
    cfg:
      model?.supports.cfg && settings.cfg != null
        ? Math.min(settings.cfg, model.max_cfg ?? Infinity)
        : model?.supports.cfg
          ? settings.cfg
          : null,
    variations: settings.variations,
    tags: settings.tags,
    // An edit rides along only when the chosen model can actually do it —
    // the server would refuse otherwise, but a request that silently became
    // a plain render would be worse than a refusal.
    ...(settings.edit && settings.sourceSound && model?.supports[settings.edit]
      ? {
          source_sound_id: settings.sourceSound.id,
          edit: settings.edit,
          edit_options: settings.editOptions,
        }
      : {}),
    // Only for a plain render: an edit already has a source, and splitting
    // the result of one is a second gesture rather than part of this request.
    ...(settings.stems && !settings.edit ? { separate: settings.stems } : {}),
    // Null on the first turn: the server creates a session titled from the
    // prompt and echoes its id on the job, which the hook picks up.
    session_id: sessionId,
    // Only takes effect when session_id is absent (a brand-new session) —
    // an existing session's project changes through `changeProject`, not by
    // generating into it again.
    project_id: sessionId ? null : projectId,
  };
}

/**
 * The same, for a one-off read on a "tts" model.
 *
 * The composer has one text box, so the prompt *is* the script — there is no
 * separate field to keep in sync, and no way to end up reading a stale prompt
 * you thought you had replaced. Duration and variations are deliberately
 * absent rather than defaulted: /api/speak takes neither (a read is as long as
 * its words), so sending them would be inventing parameters.
 */
export function buildSpeakRequest(
  settings: ComposerSettings,
  model: Model | undefined,
  voiceId: string | null,
  sessionId: string | null,
  projectId: string | null,
): SpeakRequest {
  return {
    model: settings.modelId,
    // null voice_id means "the model's own default voice", which is what the
    // picker's "Model default" entry selects.
    lines: [{ text: settings.prompt.trim(), voice_id: voiceId }],
    seed: settings.seedLocked ? settings.seed : null,
    steps: model?.supports.steps ? settings.steps : null,
    // Clamped for the same reason generate clamps it — see buildRequest.
    cfg:
      model?.supports.cfg && settings.cfg != null
        ? Math.min(settings.cfg, model.max_cfg ?? Infinity)
        : null,
    tags: settings.tags,
    session_id: sessionId,
    project_id: sessionId ? null : projectId,
  };
}

/**
 * A read, described as a GenerateRequest so it can be a Turn.
 *
 * Turns are the page's rendering unit and carry the request they came from.
 * Rather than widen that union for one task, a read is projected onto the
 * shape the turn already knows how to draw: the script sits where the prompt
 * does (which is literally where the user typed it), and `duration_s` is 0 —
 * "not applicable" — because the length isn't known until the audio exists.
 * Callers rendering a summary must therefore treat a non-positive duration as
 * absent rather than printing "0.0s".
 */
function speakTurnRequest(req: SpeakRequest): GenerateRequest {
  return {
    model: req.model,
    prompt: req.lines[0]?.text ?? "",
    negative_prompt: null,
    lyrics: null,
    track_name: null,
    duration_s: 0,
    seed: req.seed ?? null,
    steps: req.steps ?? null,
    cfg: req.cfg ?? null,
    variations: 1,
    tags: req.tags ?? [],
  };
}

/** Adds `suggested` tags the enhance assistant returned to `existing`,
 *  case-insensitively deduped — the same list the Tags pill edits, never the
 *  prompt text (see `EnhanceResponse.tags` in lib/api.ts). */
export function mergeTags(existing: string[], suggested: string[]): string[] {
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const merged = [...existing];
  for (const raw of suggested) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    merged.push(tag);
  }
  return merged;
}

/** Every voice that some installed text-to-speech model can read, for the
 *  surfaces that pick a voice *first* and take the model from it. A voice
 *  whose model is gone (uninstalled, renamed) is left out: picking it could
 *  only produce a request naming a model the backend does not have. */
export function ttsVoices(voices: Voice[], models: Model[] | undefined): Voice[] {
  const tts = new Set((models ?? []).filter((m) => m.task === "tts").map((m) => m.id));
  return voices.filter(
    (v) => (v.model_id && tts.has(v.model_id)) || (v.kind === "clone" && !v.model_id),
  );
}

export interface GenerateSessionOptions {
  /** Cmd/Ctrl+Enter generates from anywhere on the page. True for the pages
   *  where the composer *is* the page; the studio turns it off, because there
   *  the same keys belong to the script and the chat. */
  hotkey?: boolean;
}

/** The first submission of a thread that has no session yet, while it finds
 *  out which session the server opened for it. Module-level because every
 *  page's composer drives the same thread. */
let openingSession: Promise<string | null> | null = null;

/** Dispatched on `window` by anything that wants the mounted composer to
 *  submit — the command palette's Generate row. Ignored when no composer is
 *  mounted with its hotkey on, same as Ctrl+Enter would be. */
export const GENERATE_EVENT = "soundbox:generate";

export function useGenerateSession({ hotkey = true }: GenerateSessionOptions = {}) {
  const qc = useQueryClient();
  const { data: allModels, isLoading: modelsLoading } = useModels();
  // "gen" and "tts" belong in this composer, because both are driven by text
  // the user types into it and nothing else. "sep" and "vc" are not: both need
  // an *existing sound* as their input, which this composer has no way to
  // choose, so they stay on the surfaces that can supply one (a sound's "Split
  // into stems" action, and the Voice studio's convert tab). Allow-list rather
  // than deny-list, so a task added later can't silently fall through to a
  // composer that can't drive it.
  const models = useMemo(
    () => allModels?.filter((e) => e.task === "gen" || e.task === "tts"),
    [allModels],
  );

  const sessionId = useSessionStore((s) => s.sessionId);
  const setSessionId = useSessionStore((s) => s.setSessionId);
  const projectId = useSessionStore((s) => s.projectId);
  const setProjectIdStore = useSessionStore((s) => s.setProjectId);
  const settings = useSessionStore((s) => s.settings);
  const turns = useSessionStore((s) => s.turns);
  const jobId = useSessionStore((s) => s.jobId);
  const patch = useSessionStore((s) => s.patchSettings);
  const setSettings = useSessionStore((s) => s.setSettings);
  const setJobId = useSessionStore((s) => s.setJobId);
  const addTurn = useSessionStore((s) => s.addTurn);
  const patchTurn = useSessionStore((s) => s.patchTurn);
  const patchTurnByJob = useSessionStore((s) => s.patchTurnByJob);

  const model = useMemo(
    () => models?.find((e) => e.id === settings.modelId),
    [models, settings.modelId],
  );

  const modelNames = useMemo(
    () => new Map((models ?? []).map((e) => [e.id, e.name])),
    [models],
  );

  const isTts = model?.task === "tts";

  /* A read has no variations — /api/speak renders one take — so the estimate
     must not multiply by a count left over from a generate model. */
  const variations = isTts ? 1 : settings.variations;

  /* ---------------------------------------------------------------- voices */

  const { data: allVoices } = useVoices();
  /* Every tts voice, not just the current model's. On this composer the voice
     is what gets picked and the model comes with it (see `selectVoice`), so
     narrowing the list to the model already selected would hide every voice
     that could have changed it. */
  const voices = useMemo(
    () => (isTts ? ttsVoices(allVoices ?? [], models) : []),
    [allVoices, models, isTts],
  );
  const [voiceId, setVoiceId] = useState<string | null>(null);

  /** Picking a voice picks its model. A voice is tied to one model at the
   *  moment it is created, which is what lets every speech surface offer one
   *  control instead of two — see `AddVoiceDialog`. A pre-tie clone (null
   *  `model_id`) reads on whatever model is already selected. */
  const selectVoice = useCallback(
    (id: string | null) => {
      setVoiceId(id);
      const voice = (allVoices ?? []).find((v) => v.id === id);
      if (voice?.model_id && voice.model_id !== settings.modelId) {
        patch({ modelId: voice.model_id });
      }
    },
    [allVoices, patch, settings.modelId],
  );
  /* Derived rather than reset in an effect: switching models (or deleting the
     voice from the library) can strip the selection out from under us, and
     falling back to the model's default voice on read is more honest than
     posting an id the backend will reject. */
  const effectiveVoiceId = voices.some((v) => v.id === voiceId) ? voiceId : null;

  const estimateS = useMemo(
    () => estimateDurationS(model, variations),
    [model, variations],
  );
  const estimateNote = model?.avg_duration_s
    ? `Measured from this model's recent runs${variations > 1 ? `, times ${variations} variations` : ""}.`
    : null;

  const generate = useGenerate();
  const speak = useSpeak();
  const cancel = useCancelJob();

  // Every pending turn gets its own live SSE subscription, not just the
  // most-recently-submitted one — otherwise submitting a second turn tears
  // down the first's EventSource (useJobStream is keyed on a single id) and
  // its progress bar freezes wherever it last was. `turns` is already the
  // source of truth for which jobs are in flight; nothing else needs to be.
  const pendingJobIds = useMemo(
    () => turns.filter((t) => t.status === "pending" && t.jobId).map((t) => t.jobId as string),
    [turns],
  );
  const { jobs, errors: jobErrors } = useJobStreams(pendingJobIds);
  const job = jobId ? (jobs[jobId] ?? null) : null;
  const streamError = jobId ? (jobErrors[jobId] ?? null) : null;
  const { data: projects } = useProjects();
  const setSessionProject = useSetSessionProject();

  /**
   * Pick a project the same way the model is picked. Before the session
   * exists (nothing generated yet) it's just intent, held in the store; once
   * a session exists, changing it is a real PATCH so everything already in
   * the thread inherits it too.
   */
  const changeProject = useCallback(
    (id: string | null) => {
      if (sessionId) {
        setSessionProject.mutate(
          { id: sessionId, projectId: id },
          { onSuccess: () => setProjectIdStore(id) },
        );
      } else {
        setProjectIdStore(id);
      }
    },
    [sessionId, setSessionProject, setProjectIdStore],
  );

  // "Running" is the last-submitted turn still being pending, not the job
  // stream's word for it: a finished turn leaves `pendingJobIds`, which
  // drops its job from `jobs` and used to make `!job` read as "still
  // starting" forever — a Cancel square that never went away, and now a
  // button stuck on "Queued" with a strip that never stopped pulsing.
  const running = useMemo(() => {
    if (!jobId) return false;
    const turn = turns.find((t) => t.jobId === jobId);
    if (turn) return turn.status === "pending";
    return Boolean(job && (job.status === "queued" || job.status === "running"));
  }, [jobId, turns, job]);

  // The server refuses an extend that wouldn't add anything, and a model
  // that can't run the edit at all — fail here, with the reason, instead.
  const composerError = useMemo(
    () =>
      composerBlocker({
        prompt: settings.prompt,
        modelId: settings.modelId,
        model,
        modelsLoading,
        edit: settings.edit,
        duration: settings.duration,
        sourceDurationS: settings.sourceSound?.duration_s ?? null,
      }),
    [
      settings.prompt,
      settings.modelId,
      settings.edit,
      settings.duration,
      settings.sourceSound,
      model,
      modelsLoading,
    ],
  );

  const referenceError = voiceReferenceError(
    voices.find((v) => v.id === effectiveVoiceId), model,
  );
  const blocker = composerError ?? (referenceError ? {
    sentence: referenceError,
    link: { to: "/voice/lab", label: "Edit transcript in Voice Lab" },
  } : null);

  /* Pick a sensible default model once the list arrives. */
  useEffect(() => {
    if (settings.modelId || !models?.length) return;
    const preferred = preferredModel(models)!;
    patch({
      modelId: preferred.id,
      duration: clampDuration(preferred.defaults.duration_s, preferred),
      steps: preferred.defaults.steps ?? null,
      cfg: preferred.defaults.cfg ?? null,
    });
  }, [models, settings.modelId, patch]);

  /* Apply defaults + duration clamp whenever the model changes. */
  const prevModelId = useRef("");
  useEffect(() => {
    if (!model || model.id === prevModelId.current) return;
    const first = prevModelId.current === "";
    prevModelId.current = model.id;
    if (first) return; // initial selection already applied its defaults
    const s = useSessionStore.getState().settings;
    patch({
      duration: clampDuration(s.duration || model.defaults.duration_s, model),
      // Always take the new model's own tuned defaults here, never the
      // previous model's value. steps and cfg are not portable settings the
      // way duration roughly is — they're tuned per model, and a value that
      // was fine for one model can be badly out of its regime for another.
      // This was a real bug: switching from Stable Audio Open 1.0 (100 steps)
      // to Stable Audio 3 SFX (an 8-step distilled model) kept steps=100,
      // which is far outside what the distilled model was trained for and
      // rendered broadband noise instead of the requested sound — every
      // generation done this way came out broken, with no error to explain
      // why, because 100 is a perfectly valid step count for *some* model.
      steps: model.supports.steps ? (model.defaults.steps ?? null) : null,
      cfg: model.supports.cfg ? (model.defaults.cfg ?? null) : null,
      // Same reasoning extends to everything else that isn't the prompt: a
      // seed locked for one model reproduces nothing meaningful on another,
      // and a negative prompt or tags carried over describe the old take,
      // not the new one. The prompt is the only thing worth reusing across
      // models — everything else resets, even params the new model also
      // happens to support.
      negativePrompt: "",
      // An edit in progress is the exception: its words belong to the
      // source sound, not to the model, so switching models to one that
      // can still run the edit keeps them. A model that can't loses the
      // edit itself — and then the words with it, as for any switch.
      ...(s.edit && model.supports[s.edit]
        ? {}
        : { lyrics: "", trackName: "", edit: null, sourceSound: null, editOptions: {} }),
      seed: null,
      seedLocked: false,
      tags: [],
    });
  }, [model, patch]);

  /* "Reuse prompt" handoff from the Library and the sidebar's Recent list. */
  const prefill = usePrefillStore((s) => s.prefill);
  const setPrefill = usePrefillStore((s) => s.setPrefill);
  useEffect(() => {
    if (!prefill) return;
    prevModelId.current = prefill.model; // don't re-clamp over the prefill
    setSettings({
      modelId: prefill.model,
      prompt: prefill.prompt,
      negativePrompt: prefill.negative_prompt,
      lyrics: prefill.lyrics,
      trackName: prefill.track_name,
      duration: prefill.duration_s,
      seed: prefill.seed,
      seedLocked: prefill.seed !== null,
      steps: prefill.steps,
      cfg: prefill.cfg,
      variations: 1,
      tags: prefill.tags,
      edit: null,
      sourceSound: null,
      editOptions: {},
      // Reusing a prompt means the words, not the plumbing: a split is a
      // decision about this render, made on this screen.
      stems: null,
    });
    setPrefill(null);
  }, [prefill, setPrefill, setSettings]);

  /* ------------------------------------------------------------- submitting */

  /**
   * Submit, optionally changing the request in the same breath.
   *
   * The overrides exist because `patch(...)` followed by `submit()` does not
   * work and looks like it should: `submit` closes over the settings from
   * this render, so the store update has not reached it yet and the *old*
   * prompt is what gets generated. Anything driving the composer from code —
   * the assistant's "Generate", the studio's `generate_clip` — hits that,
   * and the failure is silent and confusing (you get the previous sound).
   *
   * So the settings are read fresh from the store here rather than from the
   * closure, merged with whatever the caller is changing, and written back
   * before the request is built. The composer then shows exactly what ran,
   * which is the other half of the bargain: a generation nobody can see the
   * inputs of is not reproducible.
   */
  const submitWith = useCallback(
    (overrides?: Partial<ComposerSettings>, options?: { insert?: TurnInsert }) => {
      const current = useSessionStore.getState().settings;
      const settings = overrides ? { ...current, ...overrides } : current;
      // No longer gated on `running`: several turns can be in flight at
      // once, each tracking its own job and its own SSE stream (see
      // `pendingJobIds` above) — the old single-`jobId` gate here is what
      // used to silently swallow a second Generate click while the first
      // was still going.
      if (!settings.modelId || !settings.prompt.trim()) return;
      if (overrides) {
        prevModelId.current = settings.modelId; // no re-clamp over a deliberate choice
        setSettings(settings);
      }
      // The model the *merged* settings name, which is not necessarily the
      // one this render was looking at.
      const model = models?.find((m) => m.id === settings.modelId);
      const isTts = model?.task === "tts";
      const referenceError = voiceReferenceError(
        voices.find((v) => v.id === effectiveVoiceId), model,
      );
      if (isTts && referenceError) {
        toast.error(referenceError);
        return;
      }

      const speakReq = isTts
        ? buildSpeakRequest(settings, model, effectiveVoiceId, sessionId, projectId)
        : null;
      const req = speakReq
        ? speakTurnRequest(speakReq)
        : buildRequest(settings, model, sessionId, projectId);

      // The same gate the Generate button uses, applied here because the
      // button is not the only way in: Ctrl/Cmd+Enter, the assistant and the
      // studio all land on this function, and none of them can be disabled.
      // Without it a model still downloading spends a job to say so. The turn is recorded as failed rather than dropped, so
      // the reason shows up where the sound would have been instead of the
      // shortcut appearing to do nothing.
      const turnId = nextTurnId();
      if (model && isNotReady(model)) {
        addTurn({
          id: turnId,
          request: req,
          jobId: null,
          status: "error",
          sounds: [],
          error: notReadyReason(model),
          insert: options?.insert,
        });
        return;
      }

      addTurn({
        id: turnId,
        request: req,
        jobId: null,
        status: "pending",
        sounds: [],
        error: null,
        insert: options?.insert,
      });
      // Two endpoints, one job: from here on the read is followed, folded into
      // its turn and rendered by exactly the code a generation goes through.
      // `mutateAsync` rather than per-call callbacks, which react-query only
      // keeps for the latest call — two quick submissions left the first turn
      // without a job id, "pending" forever.
      const send = (sid: string | null) =>
        isTts
          ? speak.mutateAsync(buildSpeakRequest(settings, model, effectiveVoiceId, sid, projectId))
          : generate.mutateAsync(buildRequest(settings, model, sid, projectId));
      // A thread with no session yet gets one from its first submission. A
      // second submission before the first has come back would get a second
      // session — two entries in Recent for one thread — so it waits to learn
      // the first one's instead.
      const knownSession = useSessionStore.getState().sessionId;
      let started: Promise<{ job_id: string }>;
      if (knownSession) {
        started = send(knownSession);
      } else if (openingSession) {
        started = openingSession.then(send);
      } else {
        started = send(null);
        openingSession = started
          .then((ref) => api.getJob(ref.job_id))
          .then((job) => {
            const sid = (job.request as { session_id?: string | null } | undefined)?.session_id ?? null;
            if (sid) {
              setSessionId(sid);
              void qc.invalidateQueries({ queryKey: ["sessions"] });
            }
            return sid;
          })
          .catch(() => null)
          .finally(() => {
            openingSession = null;
          });
      }
      started.then(
        (ref) => {
          setJobId(ref.job_id);
          patchTurn(turnId, { jobId: ref.job_id });
        },
        (err: Error) =>
          patchTurn(turnId, {
            status: "error",
            error: err.message,
            failure: err instanceof ApiError ? err.failure : null,
          }),
      );
    },
    [
      models,
      effectiveVoiceId,
      voices,
      generate,
      speak,
      addTurn,
      patchTurn,
      setJobId,
      setSessionId,
      setSettings,
      qc,
      sessionId,
      projectId,
    ],
  );

  const submit = useCallback(() => submitWith(), [submitWith]);

  /* Cmd/Ctrl+Enter generates from anywhere on this screen — unless something
     closer to the keypress already handled it. */
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
      }
    };
    // The command palette's "Generate" row. A window event rather than a
    // second copy of this hook in the palette, which would register a second
    // Ctrl+Enter listener and submit every prompt twice.
    const onEvent = () => submitRef.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener(GENERATE_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(GENERATE_EVENT, onEvent);
    };
  }, [hotkey]);

  /* Learn which session this thread belongs to. The server resolves (or
     creates) it at submit time and echoes it on the job's request, so the
     first turn is what teaches the composer its session id. */
  useEffect(() => {
    if (sessionId || !job) return;
    const echoed = (job.request as { session_id?: string | null } | undefined)?.session_id;
    if (echoed) {
      setSessionId(echoed);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    }
  }, [job, sessionId, setSessionId, qc]);

  /* Fold terminal job states back into their turn — every turn still
     pending, not just the most-recently-submitted one, since several can be
     in flight together now. */
  useEffect(() => {
    for (const [jid, j] of Object.entries(jobs)) {
      if (j.status === "error" || j.status === "cancelled") {
        patchTurnByJob(jid, {
          status: j.status === "error" ? "error" : "cancelled",
          error: j.error ?? null,
          failure: j.failure ?? null,
        });
      }
    }
  }, [jobs, patchTurnByJob]);

  /* Collect the finished sounds into whichever turns asked for them. Guarded
     against turns already folded to "done" so a later tick on some other
     still-running job doesn't re-fetch and re-patch one that's already
     settled. */
  useEffect(() => {
    let cancelledFetch = false;
    let sawDone = false;
    for (const [jid, j] of Object.entries(jobs)) {
      if (j.status !== "done" || !j.result?.sounds?.length) continue;
      const turn = useSessionStore.getState().turns.find((t) => t.jobId === jid);
      if (!turn || turn.status === "done") continue;
      sawDone = true;
      const ids = j.result.sounds;
      void Promise.all(ids.map((id) => api.getSound(id))).then((sounds) => {
        if (cancelledFetch) return;
        patchTurnByJob(jid, { status: "done", sounds });
      });
    }
    if (sawDone) {
      void qc.invalidateQueries({ queryKey: ["sounds"] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    }
    return () => {
      cancelledFetch = true;
    };
  }, [jobs, qc, patchTurnByJob]);

  /** Load a past turn's request back into the controls. */
  const reuseTurn = useCallback(
    (turn: Turn) => {
      const r = turn.request;
      prevModelId.current = r.model;
      setSettings({
        modelId: r.model,
        prompt: r.prompt,
        negativePrompt: r.negative_prompt ?? "",
        lyrics: r.lyrics ?? "",
        trackName: r.track_name ?? "",
        duration: r.duration_s,
        seed: r.seed ?? null,
        seedLocked: r.seed !== null && r.seed !== undefined,
        steps: r.steps ?? null,
        cfg: r.cfg ?? null,
        variations: r.variations ?? 1,
        tags: r.tags ?? [],
      edit: null,
      sourceSound: null,
      editOptions: {},
      stems: r.separate ?? null,
      });
      document.getElementById("prompt")?.focus();
    },
    [setSettings],
  );

  const removeTurn = useSessionStore((s) => s.removeTurn);

  /** Run a failed turn again, unchanged: its request goes back into the
   *  controls and straight out, and the failed turn makes way for the new
   *  one so the thread does not show the same prompt twice. */
  const retryTurn = useCallback(
    (turn: Turn) => {
      // An edit (extend, cover, repaint) needs its source sound, which the
      // turn does not carry; resubmitting would quietly become a plain
      // generation of the same prompt. Callers hide Retry for those.
      if (turn.request.edit) return;
      reuseTurn(turn);
      removeTurn(turn.id);
      submitWith();
    },
    [reuseTurn, removeTurn, submitWith],
  );

  /**
   * Replace every control at once (a preset recall) without the model-switch
   * effect stomping the recalled steps/cfg with the model's defaults a tick
   * later. Same trick prefill and reuseTurn use.
   */
  const applySettings = useCallback(
    (s: ComposerSettings) => {
      prevModelId.current = s.modelId;
      setSettings(s);
    },
    [setSettings],
  );

  /**
   * Put the composer into "extend this" / "cover this" mode on a library
   * sound. The source's own prompt and words are the starting point — an
   * extension should carry on in the same vein, and a cover keeps the
   * lyrics by definition — and the model jumps to one that can run the edit
   * if the current one can't (MiniMax Music 3 can't; ACE-Step can).
   */
  const startEdit = useCallback(
    (kind: EditKind, sound: Sound) => {
      const current = useSessionStore.getState().settings;
      const able = (m: Model) => m.category === "music" && m.supports[kind];
      const chosen =
        (model && able(model) ? model : undefined) ??
        preferredModel((models ?? []).filter(able)) ??
        model;
      if (chosen) prevModelId.current = chosen.id;
      // An extend is not clamped to the model's own maximum: a clip already at
      // the cap is precisely the one worth extending, and the server runs
      // those as windowed passes rather than refusing them.
      const duration =
        kind === "extend"
          ? clampExtendTotal(sound.duration_s + 30, sound.duration_s)
          : sound.duration_s;
      setSettings({
        ...current,
        modelId: chosen?.id ?? current.modelId,
        prompt: sound.prompt,
        negativePrompt: "",
        lyrics: sound.lyrics ?? "",
        trackName: sound.track_name ?? "",
        duration,
        seed: null,
        seedLocked: false,
        steps: chosen?.supports.steps ? (chosen.defaults.steps ?? null) : null,
        cfg: chosen?.supports.cfg ? (chosen.defaults.cfg ?? null) : null,
        variations: 1,
        tags: sound.tags,
        edit: kind,
        sourceSound: sound,
        editOptions: kind === "cover" ? { cover_strength: 1 } : {},
      });
      document.getElementById("prompt")?.focus();
    },
    [model, models, setSettings],
  );

  const clearEdit = useCallback(
    () => patch({ edit: null, sourceSound: null, editOptions: {} }),
    [patch],
  );

  const cancelCurrent = useCallback(() => {
    if (jobId) cancel.mutate(jobId);
  }, [jobId, cancel]);

  const cancelTurn = useCallback(
    (turn: Turn) => {
      if (turn.jobId) cancel.mutate(turn.jobId);
    },
    [cancel],
  );

  /* ------------------------------------------------------------- enhance */
  // Lives here rather than in the composer so /console gets it too — same
  // reasoning as everything else in this hook.

  const { data: llmStatus } = useLlmStatus();
  const enhanceMutation = useEnhance();
  const [enhanceVariations, setEnhanceVariations] = useState<string[]>([]);
  /** Tags suggested alongside whichever variations are currently showing —
   *  applied together with the prompt once one is picked, since they came
   *  from the same call. Never merged into the prompt text itself; see
   *  `EnhanceResponse.tags` in lib/api.ts for why the two stay separate. */
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [previousPrompt, setPreviousPrompt] = useState<string | null>(null);

  const enhance = useCallback(
    (n = 1) => {
      if (!settings.prompt.trim() || isTts) return;
      setEnhanceError(null);
      enhanceMutation.mutate(
        {
          prompt: settings.prompt,
          n,
          category: model?.category === "music" ? "music" : "sfx",
          lyrics: Boolean(model?.supports.lyrics && settings.lyrics.trim()),
          // Grounds the rewrite in this model's own documented prompting
          // conventions server-side (see llm/enhance.ts's FAMILY_GUIDANCE),
          // rather than generic advice.
          model: model?.id,
        },
        {
          onSuccess: (res) => {
            if (n === 1 && res.variations[0]) {
              setPreviousPrompt(settings.prompt);
              patch({ prompt: res.variations[0], tags: mergeTags(settings.tags, res.tags) });
            } else if (res.variations.length) {
              setEnhanceVariations(res.variations);
              setPendingTags(res.tags);
            }
          },
          onError: (err) => setEnhanceError(errorMessage(err)),
        },
      );
    },
    [settings.prompt, settings.lyrics, settings.tags, model, isTts, patch, enhanceMutation],
  );

  const applyVariation = useCallback(
    (text: string) => {
      setPreviousPrompt(settings.prompt);
      patch({ prompt: text, tags: mergeTags(settings.tags, pendingTags) });
      setEnhanceVariations([]);
      setPendingTags([]);
    },
    [settings.prompt, settings.tags, pendingTags, patch],
  );

  const clearVariations = useCallback(() => {
    setEnhanceVariations([]);
    setPendingTags([]);
  }, []);

  const undoEnhance = useCallback(() => {
    if (previousPrompt === null) return;
    patch({ prompt: previousPrompt });
    setPreviousPrompt(null);
  }, [previousPrompt, patch]);

  /* --------------------------------------------------------------- lyrics */
  // Writing the actual song — structure tags, syllable-balanced lines — is a
  // different skill from enhancing the one-line caption above, so it's a
  // separate call: see llm/enhance.ts's buildLyricsMessages. Whatever's
  // already in the Lyrics box is the theme/draft; the caption goes along as
  // `style` so instrumental/vocal tags stay consistent with it.

  const enhanceLyricsMutation = useEnhanceLyrics();
  const [lyricsError, setLyricsError] = useState<string | null>(null);

  const writeLyrics = useCallback(() => {
    const theme = settings.lyrics.trim() || settings.prompt.trim();
    if (!theme) return;
    setLyricsError(null);
    enhanceLyricsMutation.mutate(
      { theme, style: settings.prompt.trim() || undefined },
      {
        onSuccess: (res) => {
          if (res.lyrics) patch({ lyrics: res.lyrics });
        },
        onError: (err) => setLyricsError(errorMessage(err)),
      },
    );
  }, [settings.lyrics, settings.prompt, patch, enhanceLyricsMutation]);

  return {
    models,
    modelsLoading,
    model,
    modelNames,
    /** True when the composer is driving a one-off read rather than a
     *  generation — the page and composer adapt their wording and hide the
     *  controls /api/speak has no equivalent for. */
    isTts,
    voices,
    voiceId: effectiveVoiceId,
    setVoiceId: selectVoice,
    settings,
    patch,
    applySettings,
    sessionId,
    turns,
    job,
    jobId,
    /** Every pending turn's own live job, keyed by job id — what a list view
     *  with several turns in flight (the Library composer) should render
     *  from, instead of `job`/`jobId` which only ever track the last one
     *  submitted. */
    jobs,
    running,
    streamError,
    estimateS,
    estimateNote,
    projects,
    projectId,
    changeProject,
    /** The one reason a submit would not go through, or null. The composer
     *  renders it as a sentence with a link; `canSubmit` is its boolean. */
    blocker,
    canSubmit: blocker === null,
    submit,
    /** Submit with explicit changes applied first — see `submitWith`. Use
     *  this instead of patch-then-submit from any code path. */
    submitWith,
    cancelCurrent,
    startEdit,
    clearEdit,
    cancelTurn,
    reuseTurn,
    retryTurn,
    /** Drop a failed turn once it has been read. */
    dismissTurn: removeTurn,
    /** Whether the composer should show the enhance affordance at all. */
    llmEnabled: (llmStatus?.mode ?? "off") !== "off",
    enhance,
    enhancing: enhanceMutation.isPending,
    enhanceError,
    enhanceVariations,
    applyVariation,
    clearVariations,
    canUndoEnhance: previousPrompt !== null,
    undoEnhance,
    writeLyrics,
    writingLyrics: enhanceLyricsMutation.isPending,
    lyricsError,
  };
}
