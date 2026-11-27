/**
 * What the model details panel is asking, plus the download jobs the Models
 * page is watching. Which model is open is the dock's (lib/dock.ts).
 *
 * Jobs live here rather than on a row so that a download started from the row
 * keeps reporting in the panel, and the panel's Download shows in the row.
 */

import { create } from "zustand";

import { useDock } from "@/lib/dock";
import type { Job } from "@/lib/api";

/** What the panel's dialog is asking, if anything. */
export type ModelConfirm = "download" | "delete" | null;

interface ModelDetailState {
  confirm: ModelConfirm;
  /** The model `confirm` is about: a question never carries over to another. */
  confirmFor: string | null;
  /** Running download job per model id. */
  jobs: Record<string, string>;
  /** The last failed download per model id, kept until the next attempt. */
  failures: Record<string, Job>;
  /** Opens the model's panel, optionally straight onto a confirmation. */
  open: (modelId: string, confirm?: ModelConfirm) => void;
  setConfirm: (confirm: ModelConfirm) => void;
  /** Drops the question about this model, if that's the one asked. */
  clearConfirm: (modelId: string) => void;
  setJob: (modelId: string, jobId: string | null) => void;
  setFailure: (modelId: string, job: Job | null) => void;
}

export const useModelDetailStore = create<ModelDetailState>((set) => ({
  confirm: null,
  confirmFor: null,
  jobs: {},
  failures: {},
  open: (modelId, confirm = null) => {
    useDock.getState().open({ kind: "model", id: modelId });
    set({ confirm, confirmFor: modelId });
  },
  setConfirm: (confirm) => set({ confirm }),
  clearConfirm: (modelId) => set((s) => (s.confirmFor === modelId ? { confirm: null, confirmFor: null } : s)),
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
