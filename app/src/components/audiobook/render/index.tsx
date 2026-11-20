/**
 * Render the book or one chapter: an estimate first, then a persisted run
 * with progress, pause, resume and cancel, and the QC log of every retry.
 * Mounted by core under the book header.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, ClipboardListIcon, Loader2Icon, PauseIcon, PlayIcon, SquareIcon, WandSparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { audiobookApi } from "@/lib/audiobook-api";
import { abk, useBook } from "@/lib/audiobook-queries";
import type { RenderScope } from "@/lib/audiobook-types";

import { formatDuration, voiceApi, type RenderRunView } from "./voice-api";

const BOOK = "__book__";
const ACTIVE = new Set(["queued", "running", "paused"]);
const CHECK_LABEL: Record<string, string> = {
  silence: "silence",
  clipping: "clipping",
  length: "length",
  words: "word check",
  error: "error",
};

export function RenderBar({ bookId }: { bookId: string }) {
  const qc = useQueryClient();
  const book = useBook(bookId);
  const [target, setTarget] = useState(BOOK);
  const [overwrite, setOverwrite] = useState(false);
  const [asr, setAsr] = useState(false);
  const runsKey = ["audiobook-voice", "renders", bookId] as const;
  const runs = useQuery({ queryKey: runsKey, queryFn: () => voiceApi.listRenders(bookId) });
  const chapterId = target === BOOK ? null : target;
  const estimate = useQuery({
    queryKey: ["audiobook-voice", "estimate", bookId, chapterId, overwrite],
    queryFn: () => voiceApi.estimate(bookId, chapterId, overwrite),
  });

  // Live progress from the book's event stream.
  useEffect(
    () =>
      audiobookApi.subscribe(bookId, (e) => {
        if (e.type !== "render" || !e.run) return;
        const run = e.run as RenderRunView;
        qc.setQueryData<RenderRunView[]>(runsKey, (prev) => {
          const list = prev ?? [];
          const i = list.findIndex((r) => r.id === run.id);
          if (i === -1) return [run, ...list];
          const next = [...list];
          next[i] = { ...next[i], ...run };
          return next;
        });
        if (!ACTIVE.has(run.status)) {
          void qc.invalidateQueries({ queryKey: ["audiobook-voice", "estimate", bookId] });
          void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId, qc],
  );

  const start = useMutation({
    mutationFn: () => {
      const scope: RenderScope = chapterId ? { kind: "chapter", chapter_id: chapterId } : { kind: "book" };
      return voiceApi.startRender(bookId, { scope, overwrite, asr_check: asr });
    },
    onSuccess: (run) => qc.setQueryData<RenderRunView[]>(runsKey, (p) => [run, ...(p ?? [])]),
    onError: (e) => toast.error(`Could not start the render: ${errorMessage(e)}`),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) => voiceApi.renderAction(bookId, id, action),
    onSuccess: (run) => qc.setQueryData<RenderRunView[]>(runsKey, (p) => (p ?? []).map((r) => (r.id === run.id ? run : r))),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const latest = runs.data?.[0] ?? null;
  const active = latest && ACTIVE.has(latest.status) ? latest : null;
  const chapters = useMemo(() => [...(book.data?.chapters ?? [])].sort((a, b) => a.position - b.position), [book.data]);
  const est = estimate.data;
  const measured = est?.basis.every((b) => b.measured) ?? false;

  return (
    <div className="border-border/70 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2 text-xs">
      {active ? (
        <RunProgress run={active} onAction={(action) => act.mutate({ id: active.id, action })} busy={act.isPending} />
      ) : (
        <>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="h-7 w-44 text-xs" aria-label="What to render">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BOOK}>Whole book</SelectItem>
              {chapters.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.title || "Untitled chapter"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="text-muted-foreground flex items-center gap-1.5" title="Re-voice paragraphs that already have audio (locked ones are never touched)">
            <Switch size="sm" checked={overwrite} onCheckedChange={setOverwrite} />
            Re-voice all
          </label>
          {est?.asr_model ? (
            <label className="text-muted-foreground flex items-center gap-1.5" title="Check each paragraph's words with the installed speech-recognition model. Slower: the models swap per paragraph.">
              <Switch size="sm" checked={asr} onCheckedChange={setAsr} />
              Word check
            </label>
          ) : null}
          <span className="text-muted-foreground min-w-0 flex-1" aria-live="polite">
            {estimate.isLoading ? (
              "Estimating…"
            ) : est ? (
              est.total.to_voice === 0 ? (
                `Nothing to voice · about ${formatDuration(est.total.audio_s)} of audio`
              ) : (
                <>
                  {est.total.to_voice} paragraph{est.total.to_voice === 1 ? "" : "s"} · {est.total.characters.toLocaleString()} characters · about{" "}
                  {formatDuration(est.total.audio_s)} of audio · about {formatDuration(est.total.render_s)} to render
                  {measured ? "" : " (estimated; gets better once some paragraphs are voiced)"}
                </>
              )
            ) : null}
          </span>
          {latest ? <LastRun run={latest} /> : null}
          <Button size="xs" onClick={() => start.mutate()} disabled={start.isPending || (est ? est.total.to_voice === 0 : false)}>
            {start.isPending ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
            Render
          </Button>
        </>
      )}
    </div>
  );
}

function RunProgress({ run, onAction, busy }: { run: RenderRunView; onAction: (a: "pause" | "resume" | "cancel") => void; busy: boolean }) {
  const handled = run.done + run.failed + run.skipped;
  const pct = run.total ? Math.round((handled / run.total) * 100) : 0;
  return (
    <>
      <span className="font-medium">{run.status === "paused" ? "Paused" : run.status === "queued" ? "Queued" : "Rendering"}</span>
      <Progress value={pct} className="h-1.5 w-40" aria-label="Render progress" />
      <span className="text-muted-foreground min-w-0 flex-1">
        {handled} of {run.total} paragraphs · {run.done} voiced
        {run.skipped ? ` · ${run.skipped} skipped` : ""}
        {run.failed ? ` · ${run.failed} failed QC` : ""}
      </span>
      <QcLog run={run} />
      {run.status === "paused" ? (
        <Button size="xs" variant="outline" onClick={() => onAction("resume")} disabled={busy}>
          <PlayIcon />
          Resume
        </Button>
      ) : (
        <Button size="xs" variant="outline" onClick={() => onAction("pause")} disabled={busy}>
          <PauseIcon />
          Pause
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={() => onAction("cancel")} disabled={busy}>
        <SquareIcon />
        Cancel
      </Button>
    </>
  );
}

function LastRun({ run }: { run: RenderRunView }) {
  if (run.status === "done" && !run.failed && !run.log.length) return null;
  return (
    <span className="text-muted-foreground flex items-center gap-1">
      {run.status === "failed" ? <AlertTriangleIcon className="text-destructive size-3.5" /> : null}
      Last run {run.status === "done" ? "finished" : run.status}
      {run.failed ? `, ${run.failed} failed QC` : ""}
      {run.error ? `: ${run.error}` : ""}
      <QcLog run={run} />
    </span>
  );
}

function QcLog({ run }: { run: RenderRunView }) {
  if (!run.log.length) return null;
  const retries = run.log.filter((l) => l.outcome === "retry").length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" aria-label="QC log">
          <ClipboardListIcon />
          {retries} retr{retries === 1 ? "y" : "ies"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-border/70 border-b px-3 py-2 text-sm font-medium">Quality checks</div>
        <ul className="max-h-80 overflow-y-auto p-2 text-xs">
          {run.log.slice().reverse().map((l, i) => (
            <li key={`${l.segment_id}-${l.attempt}-${i}`} className="border-border/50 border-b py-1.5 last:border-0">
              <span className={l.outcome === "failed" ? "text-destructive font-medium" : "font-medium"}>
                {l.outcome === "retry" ? `Retry ${l.attempt}` : l.outcome === "failed" ? "Kept best of 3" : "Note"}
              </span>
              {l.checks.length ? <span className="text-muted-foreground"> · {l.checks.map((c) => CHECK_LABEL[c] ?? c).join(", ")}</span> : null}
              <div className="text-muted-foreground">{l.message}</div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
