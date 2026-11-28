/**
 * The live state of every job a Generate turn is waiting on.
 *
 * Written only by `JobWatcher`, which is mounted once in the app shell and so
 * keeps following a job whatever page is showing. It used to be followed from
 * inside `useGenerateSession`, which only the composer pages mount: leave for
 * the Models page and nothing was watching any more, so the turn never learned
 * it had finished and nothing said so.
 */

import { create } from "zustand";

import type { Job } from "./api";

interface LiveJobsState {
  jobs: Record<string, Job>;
  /** Jobs the server no longer knows (a restarted studio), with why. */
  errors: Record<string, string>;
  set: (jobs: Record<string, Job>, errors: Record<string, string>) => void;
}

export const useLiveJobs = create<LiveJobsState>((set) => ({
  jobs: {},
  errors: {},
  set: (jobs, errors) => set({ jobs, errors }),
}));
