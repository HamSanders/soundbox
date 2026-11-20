/**
 * The Generate conversation.
 *
 * The durable record is the server: every generation belongs to a session
 * (see /api/sessions), and a session can be reopened from the sidebar's
 * Recent list. This store is the *live view* of one of them — the turns on
 * screen, plus whatever is still in flight — and `sessionId` is what ties
 * the two together: it rides on every GenerateRequest so the server groups
 * new sounds into the same thread, and it is what a Recent click sets before
 * pulling that session's sounds down and rebuilding the turns from them.
 *
 * It is a store rather than component state for one reason: bouncing to the
 * Library and back unmounts the page, and losing your thread of refinements to
 * a round trip through another screen would be maddening. An in-flight job
 * survives that too — both the real SSE endpoint and the mock emit the job's
 * current state to a late subscriber, so the stream simply picks back up.
 */

import { create } from "zustand";
import type {
  ClipMidi,
  EditKind,
  Failure,
  EditOptions,
  GenerateRequest,
  Model,
  Sound,
  StemSelection,
} from "./api";

/** Everything the composer edits. Mirrors the fields of a GenerateRequest,
 *  plus the seed-lock toggle, which is a UI concept only. */
export interface ComposerSettings {
  modelId: string;
  prompt: string;
  negativePrompt: string;
  /** Lyrics for a lyrics-conditioned vocal model (ACE-Step). Empty string
   *  means "no lyrics" the same way negativePrompt does. */
  lyrics: string;
  trackName: string;
  duration: number;
  seed: number | null;
  seedLocked: boolean;
  steps: number | null;
  cfg: number | null;
  variations: number;
  tags: string[];
  /** An audio-to-audio edit of an existing library sound, or null for a
   *  plain render. The sound rides along so the form can show what is being
   *  extended/covered without a fetch. Cleared by `reset`. */
  edit: EditKind | null;
  sourceSound: Sound | null;
  editOptions: EditOptions;
  /**
   * Split the take before it comes back, and keep only these stems.
   *
   * Null — not an empty selection — is "don't split", because an empty `keep`
   * already means "all of them" everywhere else. Picking stems here is what
   * turns one prompt into a set of tracks: the job does the separation itself
   * and does not report done until the stems exist.
   */
  stems: StemSelection | null;
}

/**
 * Where a turn's result should land on a studio timeline, captured when it
 * was submitted — the playhead and selection move while the job runs.
 *
 * On the turn rather than in the studio, because the studio can unmount (you
 * looked at the Library, or another story) while the job runs, and a second
 * submission must not overwrite the first's target. Whichever studio for
 * `storyId` is mounted when the turn settles places it, once.
 */
export interface TurnInsert {
  storyId: string;
  startS: number;
  trackIndex: number;
  /** Trim the first clip to this, when the caller knows better than the
   *  render does — a cover's length follows its source. */
  durationS?: number;
  /** Set the moment a studio claims the result, so it is placed once. */
  placed?: boolean;
  /** A MIDI take's notes, stamped on the clip the result lands as — the
   *  cover of a dry take carries them too, so either clip can be reopened. */
  midi?: ClipMidi;
  /** Replace the audio of the clip already holding this take's cover (same
   *  `midi.take_id`, role "cover") instead of placing a new one. A re-render
   *  of an edited take; with no such clip left, it places as usual. */
  replaceTake?: boolean;
}

export interface Turn {
  id: string;
  /** Exactly what was asked for, so a turn can be replayed into the composer
   *  without a round trip to the server. */
  request: GenerateRequest;
  jobId: string | null;
  status: "pending" | "done" | "error" | "cancelled";
  sounds: Sound[];
  error: string | null;
  /** The server's classified failure, when the job reported one. */
  failure?: Failure | null;
  insert?: TurnInsert;
}

/**
 * Which model a picker should land on when the user hasn't chosen one.
 *
 * Loaded beats installed beats "the first one". A metered model (one that
 * costs money per render) is only the default when there is nothing else.
 */
export function preferredModel<T extends Model>(models: readonly T[]): T | undefined {
  // A ready model beats one that isn't, and a free one beats a metered one at
  // each step. Only when no free model is ready does a ready metered one win,
  // since landing on a model you'd have to download first renders nothing.
  const ready = (m: T) => m.status === "loaded" || m.status === "installed";
  const free = models.filter((m) => !m.metered);
  return (
    free.find((m) => m.status === "loaded") ??
    free.find((m) => m.status === "installed") ??
    models.find((m) => m.metered && ready(m)) ??
    free[0] ??
    models[0]
  );
}

export function clampDuration(value: number, model: Model | undefined): number {
  const max = model?.max_duration_s ?? 30;
  return Math.min(Math.max(0.5, value), max);
}

/**
 * The longest total an *extend* may ask for, which is not the model's own
 * maximum.
 *
 * A model's `max_duration_s` is how much it can render in one pass. Extending
 * past it is not refused: the server feeds the clip its own tail and runs
 * several passes (see `extendWindowed`), so the ceiling here is the API's, not
 * the model's. Clamping to the model's cap instead would make a clip that is
 * already at it impossible to extend at all — which is exactly the case where
 * you most want to.
 */
export const MAX_EXTEND_TOTAL_S = 300;

export function clampExtendTotal(value: number, sourceDurationS: number): number {
  return Math.min(Math.max(sourceDurationS + 1, value), MAX_EXTEND_TOTAL_S);
}

const EMPTY_SETTINGS: ComposerSettings = {
  modelId: "",
  prompt: "",
  negativePrompt: "",
  lyrics: "",
  trackName: "",
  duration: 5,
  seed: null,
  seedLocked: false,
  steps: null,
  cfg: null,
  variations: 1,
  tags: [],
  edit: null,
  sourceSound: null,
  editOptions: {},
  stems: null,
};

interface SessionState {
  /** The server-side session these turns belong to. Null until the first
   *  generation comes back with one, or until a Recent entry is opened. */
  sessionId: string | null;
  /** The project the current session is filed in, if any — mirrors the
   *  session's own `project_id`. Set by the composer's project picker
   *  *before* the session exists (a brand-new thread has no id yet, only
   *  the intent), and kept in sync once it does. */
  projectId: string | null;
  settings: ComposerSettings;
  turns: Turn[];
  jobId: string | null;
  setSessionId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
  /**
   * Open an existing session: replace the on-screen turns with ones rebuilt
   * from its persisted sounds. Sounds are grouped into turns by prompt +
   * settings, oldest first, so a session with three takes of one prompt
   * reads as one turn with three results — the way it was made — rather
   * than three identical prompt bubbles.
   */
  loadSession: (id: string, sounds: Sound[], projectId?: string | null) => void;
  patchSettings: (p: Partial<ComposerSettings>) => void;
  setSettings: (s: ComposerSettings) => void;
  setJobId: (id: string | null) => void;
  addTurn: (turn: Turn) => void;
  patchTurn: (id: string, p: Partial<Turn>) => void;
  patchTurnByJob: (jobId: string, p: Partial<Turn>) => void;
  /** Drop one turn: a failed one the user has read and dismissed. */
  removeTurn: (id: string) => void;
  /** "New sound": empty conversation, empty prompt, model choice kept. */
  reset: () => void;
}

let turnSeq = 0;
export const nextTurnId = () => `turn-${++turnSeq}`;

/** Rebuild turns from a session's sounds. Exported so it can be unit-tested
 *  without a store. */
export function turnsFromSounds(sounds: Sound[]): Turn[] {
  const ordered = [...sounds].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const turns: Turn[] = [];
  for (const s of ordered) {
    const req: GenerateRequest = {
      model: s.model,
      prompt: s.prompt,
      negative_prompt: s.negative_prompt ?? null,
      lyrics: s.lyrics ?? null,
      track_name: s.track_name ?? null,
      duration_s: s.duration_s,
      seed: s.seed ?? null,
      steps: s.steps ?? null,
      cfg: s.cfg ?? null,
      variations: 1,
      tags: s.tags,
      source_sound_id: s.parent_id ?? null,
      edit: s.edit ?? null,
      edit_options: s.edit_options ?? null,
    };
    // Variations of one submission share everything but the seed and were
    // written within the same job, so "same prompt/model/duration/steps/cfg
    // as the previous turn" is a faithful reconstruction of the grouping.
    const prev = turns[turns.length - 1];
    const sameTurn =
      prev &&
      prev.request.model === req.model &&
      prev.request.prompt === req.prompt &&
      prev.request.duration_s === req.duration_s &&
      (prev.request.steps ?? null) === (req.steps ?? null) &&
      (prev.request.cfg ?? null) === (req.cfg ?? null) &&
      (prev.request.negative_prompt ?? null) === (req.negative_prompt ?? null) &&
      (prev.request.lyrics ?? null) === (req.lyrics ?? null) &&
      (prev.request.edit ?? null) === (req.edit ?? null) &&
      (prev.request.source_sound_id ?? null) === (req.source_sound_id ?? null);
    if (sameTurn) {
      prev.sounds.push(s);
      prev.request.variations = prev.sounds.length;
    } else {
      turns.push({
        id: nextTurnId(),
        request: req,
        jobId: null,
        status: "done",
        sounds: [s],
        error: null,
      });
    }
  }
  return turns;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  projectId: null,
  settings: EMPTY_SETTINGS,
  turns: [],
  jobId: null,
  setSessionId: (sessionId) => set({ sessionId }),
  setProjectId: (projectId) => set({ projectId }),
  loadSession: (id, sounds, projectId = null) =>
    set((s) => {
      const turns = turnsFromSounds(sounds);
      const last = turns[turns.length - 1];
      return {
        sessionId: id,
        projectId,
        turns,
        jobId: null,
        // Land with the last turn's settings in the composer, so continuing
        // the thread starts from where it left off rather than from defaults.
        settings: last
          ? {
              ...s.settings,
              modelId: last.request.model,
              prompt: "",
              negativePrompt: last.request.negative_prompt ?? "",
              lyrics: last.request.lyrics ?? "",
              trackName: last.request.track_name ?? "",
              duration: last.request.duration_s,
              steps: last.request.steps ?? null,
              cfg: last.request.cfg ?? null,
              tags: last.request.tags ?? [],
              edit: null,
              sourceSound: null,
              editOptions: {},
            }
          : s.settings,
      };
    }),
  patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setSettings: (settings) => set({ settings }),
  setJobId: (jobId) => set({ jobId }),
  addTurn: (turn) => set((s) => ({ turns: [...s.turns, turn] })),
  patchTurn: (id, p) =>
    set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
  patchTurnByJob: (jobId, p) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.jobId === jobId ? { ...t, ...p } : t)),
    })),
  removeTurn: (id) => set((s) => ({ turns: s.turns.filter((t) => t.id !== id) })),
  reset: () =>
    set((s) => ({
      sessionId: null,
      projectId: null,
      turns: [],
      jobId: null,
      settings: {
        ...s.settings,
        prompt: "",
        negativePrompt: "",
        lyrics: "",
        trackName: "",
        tags: [],
        edit: null,
        sourceSound: null,
        editOptions: {},
      },
    })),
}));
