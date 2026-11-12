/**
 * What is generating, what is waiting, and how to take something out.
 *
 * The queue has always been real — `JobManager` serialises one worker, numbers
 * every waiting job and can cancel one that has not started — but nothing in
 * the app ever showed it. You could stack renders from the chat composer and
 * then have no way to see them, no way to know which was third, and no way to
 * drop the one you queued by mistake short of cancelling whatever happened to
 * be playing through `cancelCurrent`.
 *
 * It lives in the header rather than beside any one composer because a job
 * queued in the Music Builder is still running while you are reading the
 * Models page, and because an MCP agent's generations land in the same queue
 * as yours. One place, visible from everywhere, or it is not a queue — it is a
 * property of whichever screen you happened to submit from.
 *
 * Hidden entirely when nothing is in flight. A permanent "0 queued" chip is
 * furniture.
 */

import { Loader2Icon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCancelJob, useJobs } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/api";

/** Kinds that run on the generation worker — the ones that queue behind each
 *  other. A model download is not one: it does not compete for the worker, and
 *  listing it here would put "downloading Chatterbox" in a render queue. */
const GENERATION_KINDS = new Set(["generate", "speak", "convert", "separate"]);

/** Readable names for a job with nothing quotable in its request. */
const KIND_LABEL: Record<string, string> = {
  generate: "Generation",
  speak: "Spoken read",
  convert: "Voice conversion",
  separate: "Stem separation",
  selftest: "Model self-test",
};

function isActive(job: Job): boolean {
  return job.status === "queued" || job.status === "running";
}

/**
 * The prompt, or the closest thing this kind of job has to one.
 *
 * A row that just says "speak" tells you nothing about which of three waiting
 * reads it is, so each kind gets its own answer: a generation has a `prompt`,
 * a read has `lines` (first line's text, since that is what you would
 * recognise it by), and everything else falls back to whatever name it was
 * given.
 */
function describe(job: Job): string {
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

function QueueRow({ job }: { job: Job }) {
  const cancel = useCancelJob();
  const running = job.status === "running";
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span className="mt-0.5 shrink-0">
        {running ? (
          <Loader2Icon className="text-primary size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <span className="text-muted-foreground font-(family-name:--font-log) text-[11px] tabular-nums">
            {job.queue_position ?? ""}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs" title={describe(job)}>
          {describe(job)}
        </p>
        <p className="text-muted-foreground text-[11px]">
          {running
            ? `${Math.round((job.progress ?? 0) * 100)}%${job.message ? ` · ${job.message}` : ""}`
            : job.eta_s != null
              ? `Waiting · about ${Math.round(job.eta_s)}s once it starts`
              : "Waiting"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        disabled={cancel.isPending}
        // "Remove" for something that has not started, "Stop" for the one that
        // has: cancelling a queued job throws nothing away, and stopping a
        // render at 80% does.
        aria-label={running ? `Stop ${describe(job)}` : `Remove ${describe(job)} from the queue`}
        title={running ? "Stop this render" : "Remove from the queue"}
        onClick={() => cancel.mutate(job.id)}
      >
        <XIcon className="size-3.5" />
      </Button>
    </li>
  );
}

export function QueueIndicator({ className }: { className?: string }) {
  const { data: jobs } = useJobs();
  const active = (jobs ?? []).filter((j) => isActive(j) && GENERATION_KINDS.has(j.kind));
  if (!active.length) return null;

  const waiting = active.filter((j) => j.status === "queued").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 gap-1.5 px-2 text-xs", className)}
          aria-label={`${active.length} job${active.length === 1 ? "" : "s"} in the queue`}
        >
          <Loader2Icon className="text-primary size-3.5 animate-spin" aria-hidden="true" />
          {waiting > 0 ? `${waiting} queued` : "Rendering"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Queue</p>
          <p className="text-muted-foreground text-xs">
            One renders at a time — the rest wait their turn.
          </p>
        </div>
        <ul className="divide-border/60 max-h-80 divide-y overflow-y-auto">
          {active.map((job) => (
            <QueueRow key={job.id} job={job} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
