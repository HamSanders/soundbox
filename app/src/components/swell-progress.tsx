/**
 * Progress drawn as water.
 *
 * `value` null means the stage has no number yet (queued, loading a model):
 * a single swell crosses the waterline, one crest every third of a swell
 * period. A number is the tide coming in: a 2px fill with a small crest on
 * its leading edge. Both sit in a 6px band whose bottom 2px is the old strip,
 * so this drops in wherever a thin progress bar was.
 *
 * Why not a pulse or a spinner: those are what every web app and chat
 * product shows while it waits. An audio tool has its own picture for
 * "something is moving through", and it is a wave on a line.
 *
 * Reduced motion keeps the status and drops the movement — the crest parks a
 * third of the way in (see index.css), so an unknown stage never looks like
 * an empty, unstarted track.
 */

import { cn } from "@/lib/utils";

export function SwellProgress({
  value,
  label,
  valueText,
  className,
}: {
  /** 0–100, or null while the stage has no number. */
  value: number | null;
  /** Accessible name, e.g. "Job progress". */
  label: string;
  /** Read out in place of the number, e.g. the stage name. */
  valueText?: string;
  className?: string;
}) {
  const pct = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("konchi-swell", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={valueText ?? (pct === null ? undefined : `${Math.round(pct)}%`)}
    >
      {pct === null ? (
        <div className="konchi-swell-crest" aria-hidden="true" />
      ) : (
        <div className="konchi-tide-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
      )}
    </div>
  );
}
