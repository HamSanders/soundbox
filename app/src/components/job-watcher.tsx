/**
 * Follows every render to the end, whatever page is open, and says when it
 * gets there.
 *
 * Mounted once in the app shell. Before it, a Generate turn was followed only
 * by `useGenerateSession`, which only the composer pages mount: queue
 * something, open the Models page, and nothing was watching. The job finished
 * on the server, the turn never heard, and the only sign was the header's
 * queue chip quietly disappearing. So this does two things that used to
 * depend on which page you were on:
 *
 *  - Turns: each pending turn's job is followed here and its outcome folded
 *    back into the turn (the sounds when it is done, the reason when it is
 *    not). Pages read the live jobs from `useLiveJobs` for their progress
 *    bars instead of opening streams of their own.
 *  - Toasts: any generation job that finishes or fails while you are
 *    somewhere it is not already shown gets one, with a link to the sound.
 *    That covers jobs from every surface (studio, voice lab, an agent), since
 *    it reads the server's job list rather than the turns.
 *
 * A job the server stops knowing about mid-render is reported as lost. On
 * the web that is a studio that restarted (it ran out of memory once), and
 * saying so beats a spinner that never ends.
 */

import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useJobStreams } from "@/hooks/use-job-stream";
import { api, type Job } from "@/lib/api";
import { describeJob, jobChanges } from "@/lib/job-label";
import { useLiveJobs } from "@/lib/live-jobs";
import { useJobs } from "@/lib/queries";
import { useSessionStore } from "@/lib/session-store";

const LOST =
  "Your studio restarted before this render finished, so it was lost. Try it again.";

/**
 * Pages that already show a render's outcome where it happens: the Generate
 * thread draws the sound (or the failure) in place, and a studio drops the
 * clip onto its timeline. A toast there says the same thing twice.
 */
function showsOutcome(pathname: string): boolean {
  return pathname === "/chat" || pathname === "/console" || pathname.startsWith("/studio/");
}

export function JobWatcher() {
  useTurnJobs();
  useJobToasts();
  return null;
}

/** Follow every pending turn's job and fold its outcome into the turn. */
function useTurnJobs() {
  const qc = useQueryClient();
  const turns = useSessionStore((s) => s.turns);
  const patchTurnByJob = useSessionStore((s) => s.patchTurnByJob);
  const setLive = useLiveJobs((s) => s.set);

  const pendingJobIds = useMemo(
    () => turns.filter((t) => t.status === "pending" && t.jobId).map((t) => t.jobId as string),
    [turns],
  );
  const { jobs, errors } = useJobStreams(pendingJobIds);

  useEffect(() => setLive(jobs, errors), [jobs, errors, setLive]);

  /* Failed, cancelled, or lost with the server. */
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
    for (const jid of Object.keys(errors)) {
      patchTurnByJob(jid, { status: "error", error: LOST, failure: null });
    }
  }, [jobs, errors, patchTurnByJob]);

  /* Done: collect the sounds into whichever turn asked for them. Guarded
     against a turn already folded, so a later tick on some other job does not
     fetch and patch it again. */
  const fetching = useRef(new Set<string>());
  useEffect(() => {
    let sawDone = false;
    for (const [jid, j] of Object.entries(jobs)) {
      if (j.status !== "done" || fetching.current.has(jid)) continue;
      const turn = useSessionStore.getState().turns.find((t) => t.jobId === jid);
      if (!turn || turn.status === "done") continue;
      sawDone = true;
      const ids = j.result?.sounds ?? [];
      fetching.current.add(jid);
      void Promise.all(ids.map((id) => api.getSound(id)))
        .then((sounds) => patchTurnByJob(jid, { status: "done", sounds }))
        .catch(() => patchTurnByJob(jid, { status: "done", sounds: [] }))
        .finally(() => fetching.current.delete(jid));
    }
    if (sawDone) {
      void qc.invalidateQueries({ queryKey: ["sounds"] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    }
  }, [jobs, qc, patchTurnByJob]);
}

/** A toast for every generation job that ends while you are elsewhere. */
function useJobToasts() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: list } = useJobs();
  const seen = useRef<Map<string, Job> | null>(null);
  const mountedAt = useRef(Date.now());
  const where = useRef(pathname);
  where.current = pathname;

  useEffect(() => {
    if (!list) return;
    const { finished, lost, next } = jobChanges(seen.current, list, mountedAt.current);
    seen.current = next;
    if (!finished.length && !lost.length) return;

    // The library and the sidebar's Recent list are stale the moment a job
    // lands, whichever page is open.
    void qc.invalidateQueries({ queryKey: ["sounds"] });
    void qc.invalidateQueries({ queryKey: ["sessions"] });

    if (showsOutcome(where.current)) return;
    for (const job of finished) {
      const name = describeJob(job);
      if (job.status === "done") {
        const sounds = job.result?.sounds ?? [];
        toast.success(`Ready: ${name}`, {
          action: sounds.length
            ? {
                label: "Open",
                onClick: () => navigate(sounds.length === 1 ? `/sounds/${sounds[0]}` : "/library"),
              }
            : undefined,
        });
      } else if (job.status === "error") {
        toast.error(`Failed: ${name}`, { description: job.error ?? undefined });
      }
      // Cancelled: you did that yourself, from wherever you were.
    }
    for (const job of lost) {
      toast.error(`Lost: ${describeJob(job)}`, { description: LOST });
    }
  }, [list, qc, navigate]);
}
