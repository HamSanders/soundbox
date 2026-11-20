/**
 * How a job is named to a person: in the queue, and in the toast that says it
 * finished. One definition, so the two never call the same job different
 * things.
 */

import type { Job } from "./api";

/** Kinds that run on the generation worker — the ones that queue behind each
 *  other. A model download is not one: it does not compete for the worker, and
 *  listing it here would put "downloading Chatterbox" in a render queue. */
export const GENERATION_KINDS = new Set(["generate", "speak", "convert", "separate"]);

/** Readable names for a job with nothing quotable in its request. */
const KIND_LABEL: Record<string, string> = {
  generate: "Generation",
  speak: "Spoken read",
  convert: "Voice conversion",
  separate: "Stem separation",
  selftest: "Model self-test",
};

/**
 * The prompt, or the closest thing this kind of job has to one.
 *
 * A row that just says "speak" tells you nothing about which of three waiting
 * reads it is, so each kind gets its own answer: a generation has a `prompt`,
 * a read has `lines` (first line's text, since that is what you would
 * recognise it by), and everything else falls back to whatever name it was
 * given.
 */
export function describeJob(job: Job): string {
  const req = job.request as Record<string, unknown>;
  const direct = req.prompt ?? req.name;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const lines = req.lines;
  if (Array.isArray(lines)) {
    const first = lines.find(
      (l): l is { text: string } =>
        typeof (l as { text?: unknown })?.text === "string" &&
        (l as { text: string }).text.trim().length > 0,
    );
    if (first) return first.text.trim();
  }
  return KIND_LABEL[job.kind] ?? job.kind;
}

const ACTIVE = new Set(["queued", "running"]);

export interface JobChanges {
  finished: Job[];
  lost: Job[];
  next: Map<string, Job>;
}

/**
 * Which jobs ended between two reads of the job list. Pure, so the rule is
 * easy to see: a job that was queued or running and is now done, failed or
 * cancelled has finished; one that was queued or running and is gone from
 * the list entirely was lost with the server that held it. A job never seen
 * running counts too when it finished after `since` (ms): a short render can
 * be queued and done between two reads of the list.
 */
export function jobChanges(prev: Map<string, Job> | null, list: readonly Job[], since = 0): JobChanges {
  const next = new Map(list.filter((j) => GENERATION_KINDS.has(j.kind)).map((j) => [j.id, j]));
  const finished: Job[] = [];
  const lost: Job[] = [];
  if (prev) {
    for (const [id, before] of prev) {
      if (!ACTIVE.has(before.status)) continue;
      const now = next.get(id);
      if (!now) lost.push(before);
      else if (!ACTIVE.has(now.status)) finished.push(now);
    }
    for (const [id, now] of next) {
      if (prev.has(id) || ACTIVE.has(now.status)) continue;
      const at = Date.parse(now.finished_at ?? "");
      if (Number.isFinite(at) && at >= since) finished.push(now);
    }
  }
  return { finished, lost, next };
}
