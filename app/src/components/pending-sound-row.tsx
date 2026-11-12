/**
 * The one row that stands for a render that hasn't finished yet.
 *
 * Every surface that both lists sounds and can start one needs the same
 * thing: the sound you just asked for, sitting in the list it is about to
 * join, saying what stage it is at. The Music studio grew this first; the SFX
 * and Text to Speech pages need it for the same reason, and three hand-rolled
 * copies of a spinner-plus-phase row is how three pages end up disagreeing
 * about what "queued" looks like.
 *
 * `job` is the live stream for this row's job, or null. Null is not an error
 * state — a submission that has not been picked up yet, or one queued behind
 * another, has no stream of its own to read — so the row falls back to
 * "Queued" and a zero-width bar rather than showing nothing.
 */

import { Button } from "@/components/ui/button";
import { LoadingVerb } from "@/components/loading-verb";
import { SwellProgress } from "@/components/swell-progress";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { isBusyPhase } from "@/lib/loading-verbs";
import type { Job } from "@/lib/api";

/** `Job.phase`, in the words a person would use. Shared so the Generate
 *  thread, the Music studio and the category lists all name a stage the same
 *  way. Unknown phases fall through to the raw value rather than to a blank. */
export const PHASE_LABEL: Record<string, string> = {
  queued: "Queued",
  loading: "Loading model",
  generating: "Generating",
  encoding: "Encoding",
  done: "Done",
};

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function PendingSoundRow({
  label,
  sublabel,
  job,
  onCancel,
  className,
}: {
  /** What was asked for — the prompt, or the script for a read. */
  label: string;
  /** Model name, usually. Omitted rather than guessed when unknown. */
  sublabel?: string;
  job?: Job | null;
  onCancel?: () => void;
  className?: string;
}) {
  const phase = job ? (PHASE_LABEL[job.phase] ?? job.phase) : "Queued";
  const percent = Math.round((job?.progress ?? 0) * 100);
  const cycling = isBusyPhase(job?.phase);
  return (
    <div
      className={cn(
        "border-border/60 bg-muted/40 animate-in fade-in-0 rounded-xl border px-3 py-2.5 duration-300",
        className,
      )}
      aria-busy="true"
    >
      <div className="flex items-center gap-3">
        {/* The Generate key's record dot, riding the swell: the same mark
            for "this is being made" wherever a render is waiting. */}
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="bg-primary konchi-swell-dot size-2 rounded-full" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{label}</p>
          {sublabel && (
            <p className="text-muted-foreground truncate text-xs">{sublabel}</p>
          )}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums" aria-live="polite">
          {cycling ? <LoadingVerb /> : phase}
          {job && job.progress > 0 ? ` · ${percent}%` : ""}
        </span>
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground -mr-1 shrink-0"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
      <SwellProgress
        value={job && job.progress > 0 ? percent : null}
        label={`${label}: ${phase}`}
        valueText={job && job.progress > 0 ? `${phase}, ${percent}%` : phase}
        className="mt-1.5"
      />
      {job?.status === "queued" && job.queue_position != null && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {ordinal(job.queue_position)} in queue
          {job.eta_s != null ? `, ~${formatDuration(job.eta_s)} ahead of you` : ""}
        </p>
      )}
    </div>
  );
}
