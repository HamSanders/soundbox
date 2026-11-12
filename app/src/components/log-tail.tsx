/**
 * The server's log, as something you can read in a column.
 *
 * One component behind two surfaces: the Activity page, where it is the whole
 * screen, and the studio's Logs panel, where it is a corner of the right-hand
 * stack beside the arrangement it is explaining. `compact` is the difference,
 * and it is only chrome — the same tail, the same parse, the same filters.
 *
 * The job id is the thing worth clicking. Every generation tags its lines
 * with one, so isolating a job turns a wall of monospace into the story of
 * the render that just went wrong. In the studio the History panel hands the
 * id straight over, which is why `jobFilter` can be driven from outside.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, PauseIcon, PlayIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { LEVEL_CLASS, LOG_POLL_MS, LOG_TAIL_LINES, isProblem, parseLog } from "@/lib/logs";
import { cn } from "@/lib/utils";

export function LogTail({
  compact = false,
  jobFilter: jobFilterProp,
  onJobFilter,
  className,
}: {
  /** Panel-sized: smaller controls, no footer note, no source column. */
  compact?: boolean;
  /** Show one job only. Controlled when `onJobFilter` is given, so the studio
   *  can point the panel at a render from the History beside it. */
  jobFilter?: string | null;
  onJobFilter?: (jobId: string | null) => void;
  className?: string;
}) {
  const [follow, setFollow] = useState(true);
  const [level, setLevel] = useState<"all" | "problems">("all");
  const [q, setQ] = useState("");
  const [ownJob, setOwnJob] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const controlled = onJobFilter !== undefined;
  const jobFilter = controlled ? (jobFilterProp ?? null) : ownJob;
  const setJobFilter = (id: string | null): void => {
    if (controlled) onJobFilter(id);
    else setOwnJob(id);
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.getLogs(LOG_TAIL_LINES),
    refetchInterval: follow ? LOG_POLL_MS : false,
  });

  const entries = useMemo(() => parseLog(data?.lines ?? []), [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (level === "problems" && !isProblem(e)) return false;
      if (jobFilter && e.jobId !== jobFilter) return false;
      if (needle && !e.raw.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, level, q, jobFilter]);

  const problems = useMemo(
    () => entries.filter((e) => e.level === "ERROR" || e.level === "CRITICAL").length,
    [entries],
  );

  // Stick to the newest line while following, the way `tail -f` does.
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered, follow]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-32 flex-1">
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter lines…"
            className={cn("pl-8", compact && "h-8 text-xs")}
            aria-label="Filter log lines"
          />
        </div>

        <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
          <SelectTrigger
            className={cn(compact ? "h-8 w-32 text-xs" : "w-40")}
            aria-label="Level filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            <SelectItem value="problems">Warnings &amp; errors</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={follow ? "default" : "outline"}
          size={compact ? "sm" : "default"}
          onClick={() => setFollow((f) => !f)}
          aria-pressed={follow}
        >
          {follow ? <PauseIcon /> : <PlayIcon />}
          {follow ? "Following" : "Paused"}
        </Button>
      </div>

      {jobFilter && (
        <div className="bg-primary/10 flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="text-muted-foreground shrink-0">Showing one job:</span>
          <code className="min-w-0 truncate font-mono text-xs">{jobFilter}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => setJobFilter(null)}
            aria-label="Clear job filter"
          >
            <XIcon />
          </Button>
        </div>
      )}

      {problems > 0 && level === "all" && !jobFilter && (
        <button
          type="button"
          onClick={() => setLevel("problems")}
          className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-left text-sm ring-1 ring-red-600/25 ring-inset dark:ring-red-400/25"
        >
          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
          {problems} error{problems === 1 ? "" : "s"} in the last {LOG_TAIL_LINES} lines — show
          only problems
        </button>
      )}

      <div
        ref={scrollRef}
        className="bg-muted/40 min-h-0 flex-1 overflow-auto rounded-xl border font-mono text-xs"
      >
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: compact ? 6 : 12 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-muted-foreground p-4 font-sans text-sm">
            Could not read the log: {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground p-4 font-sans text-sm">
            {entries.length === 0
              ? "Nothing logged yet. Generate something and it will show up here."
              : "No lines match these filters."}
          </p>
        ) : (
          <ul className="divide-border/50 divide-y">
            {filtered.map((e) => (
              <li
                key={e.key}
                className={cn(
                  "flex gap-3 px-3 py-1 leading-relaxed",
                  (e.level === "ERROR" || e.level === "CRITICAL") && "bg-red-500/5",
                  e.level === "WARNING" && "bg-amber-500/5",
                )}
              >
                <span className="text-muted-foreground/70 shrink-0 tabular-nums">{e.time}</span>
                {e.level && (
                  <span className={cn("w-14 shrink-0", LEVEL_CLASS[e.level])}>{e.level}</span>
                )}
                {!compact && (
                  <span className="text-muted-foreground/70 hidden w-24 shrink-0 truncate sm:block">
                    {e.source}
                  </span>
                )}
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                  {e.jobId ? (
                    <>
                      {e.message.slice(0, e.message.indexOf(e.jobId))}
                      <button
                        type="button"
                        onClick={() => setJobFilter(e.jobId)}
                        className="text-primary underline decoration-dotted underline-offset-2"
                        title="Show only this job"
                      >
                        {e.jobId.slice(0, 8)}
                      </button>
                      {e.message.slice(e.message.indexOf(e.jobId) + e.jobId.length)}
                    </>
                  ) : (
                    e.message
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!compact && (
        <p className="text-muted-foreground text-xs">
          Showing {filtered.length} of {entries.length} lines. The full log lives in your data
          directory as <code>konchi.log</code> and survives restarts.
        </p>
      )}
    </div>
  );
}
