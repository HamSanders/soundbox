/**
 * The model whose details are open in the docked right-hand panel, plus the
 * download jobs the Models page is watching.
 *
 * The model twin of `detail-store.ts` and `voice-detail-store.ts`. It holds an
 * id rather than a `Model`, so the panel follows the model as the list
 * refetches (a download finishes, a load changes its status).
 *
 * Jobs live here rather than on a row so that a download started from the row
 * keeps reporting in the panel, and the panel's Download shows in the row.
 */

import { create } from "zustand";

import { useDetailStore } from "@/lib/detail-store";
import { useVoiceDetailStore } from "@/lib/voice-detail-store";
import type { Job } from "@/lib/api";

/** What the panel's dialog is asking, if anything. */
export type ModelConfirm = "download" | "delete" | null;

interface ModelDetailState {
  modelId: string | null;
  confirm: ModelConfirm;
  /** Running download job per model id. */
  jobs: Record<string, string>;
  /** The last failed download per model id, kept until the next attempt. */
  failures: Record<string, Job>;
  open: (modelId: string, confirm?: ModelConfirm) => void;
  close: () => void;
  setConfirm: (confirm: ModelConfirm) => void;
  setJob: (modelId: string, jobId: string | null) => void;
  setFailure: (modelId: string, job: Job | null) => void;
}

export const useModelDetailStore = create<ModelDetailState>((set) => ({
  modelId: null,
  confirm: null,
  jobs: {},
  failures: {},
  open: (modelId, confirm = null) => {
    // One docked panel at a time.
    useDetailStore.getState().close();
    useVoiceDetailStore.getState().close();
    set({ modelId, confirm });
  },
  close: () => set({ modelId: null, confirm: null }),
  setConfirm: (confirm) => set({ confirm }),
  setJob: (modelId, jobId) =>
    set((s) => {
      const jobs = { ...s.jobs };
      if (jobId) jobs[modelId] = jobId;
      else delete jobs[modelId];
      return { jobs };
    }),
  setFailure: (modelId, job) =>
    set((s) => {
      const failures = { ...s.failures };
      if (job) failures[modelId] = job;
      else delete failures[modelId];
      return { failures };
    }),
}));
