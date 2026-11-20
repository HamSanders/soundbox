/**
 * A paragraph's takes: every generation is kept. Listen, put an older take
 * back on the timeline, delete one, or select words in the text and voice
 * only those. Mounted by core on each paragraph row.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, HistoryIcon, Loader2Icon, PauseIcon, PlayIcon, ScissorsIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useClipPlayer } from "@/components/audiobook/render/use-clip";
import { formatDuration, voiceApi, type TakeRow } from "@/components/audiobook/render/voice-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { errorMessage } from "@/lib/api";
import { abk } from "@/lib/audiobook-queries";
import { cn } from "@/lib/utils";

const ORIGIN: Record<TakeRow["origin"], string> = { generate: "Generated", render: "Render", selection: "Edited" };

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function TakesPopover({ bookId, segmentId }: { bookId: string; segmentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Takes" title="Takes">
          <HistoryIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {open ? <TakesList bookId={bookId} segmentId={segmentId} /> : null}
      </PopoverContent>
    </Popover>
  );
}

export function TakesList({ bookId, segmentId }: { bookId: string; segmentId: string }) {
  const qc = useQueryClient();
  const key = ["audiobook-voice", "takes", segmentId] as const;
  const takes = useQuery({ queryKey: key, queryFn: () => voiceApi.listTakes(bookId, segmentId) });
  const player = useClipPlayer();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
    void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
  };
  const select = useMutation({
    mutationFn: (id: string) => voiceApi.selectTake(bookId, segmentId, id),
    onSuccess: refresh,
    onError: (e) => toast.error(`Could not restore the take: ${errorMessage(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => voiceApi.deleteTake(bookId, segmentId, id),
    onSuccess: refresh,
    onError: (e) => toast.error(`Could not delete the take: ${errorMessage(e)}`),
  });
  const regen = useMutation({
    mutationFn: (r: { start: number; end: number }) => voiceApi.regenerateSelection(bookId, segmentId, r),
    onSuccess: ({ plan }) => {
      setRange(null);
      refresh();
      if (plan.reason) toast.message(plan.reason);
      else toast.success("Regenerated the selected words.");
    },
    onError: (e) => toast.error(`Could not regenerate: ${errorMessage(e)}`),
  });

  const list = takes.data ?? [];
  const current = list.find((t) => t.selected) ?? list[0];
  const text = current?.source_text ?? "";

  const readSelection = () => {
    const sel = window.getSelection();
    const el = textRef.current;
    if (!sel || !el || sel.rangeCount === 0 || sel.isCollapsed) return setRange(null);
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return setRange(null);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    setRange({ start, end: start + r.toString().length });
  };

  return (
    <div className="flex max-h-[28rem] flex-col">
      <div className="border-border/70 flex items-center justify-between border-b px-3 py-2">
        <h4 className="text-sm font-medium">Takes</h4>
        <span className="text-muted-foreground text-xs">{list.length ? `${list.length} kept` : null}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1" aria-label="Takes">
        {takes.isLoading ? (
          <li className="p-3"><Loader2Icon className="text-muted-foreground size-4 animate-spin" /></li>
        ) : list.length === 0 ? (
          <li className="text-muted-foreground p-3 text-xs">Not voiced yet. Each generation will be kept here.</li>
        ) : (
          list.map((t, i) => (
            <li key={t.id} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", t.selected && "bg-accent")}>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Play take ${list.length - i}`}
                onClick={() => player.playSound(t.id, t.sound_id)}
              >
                {player.active === t.id ? player.loading ? <Loader2Icon className="animate-spin" /> : <PauseIcon /> : <PlayIcon />}
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-medium">Take {list.length - i}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">{ORIGIN[t.origin]}</Badge>
                  {t.selected ? <span className="text-muted-foreground">on timeline</span> : null}
                </div>
                <div className="text-muted-foreground truncate text-[11px]" title={t.spoken_text}>
                  {ago(t.created_at)}
                  {t.audio_s ? ` · ${formatDuration(t.audio_s)}` : ""}
                  {` · ${t.model_id.replace(/^audiocpp-/, "")}`}
                  {t.seed !== null ? ` · seed ${t.seed}` : ""}
                </div>
              </div>
              {t.selected ? (
                <CheckIcon className="text-muted-foreground size-4" aria-label="Selected" />
              ) : (
                <>
                  <Button size="xs" variant="ghost" onClick={() => select.mutate(t.id)} disabled={select.isPending}>
                    Use
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete take ${list.length - i}`} onClick={() => remove.mutate(t.id)}>
                    <Trash2Icon />
                  </Button>
                </>
              )}
            </li>
          ))
        )}
      </ul>
      {current ? (
        <div className="border-border/70 space-y-1.5 border-t p-3">
          <h5 className="text-xs font-medium">Regenerate part of it</h5>
          <p
            ref={textRef}
            onMouseUp={readSelection}
            onKeyUp={readSelection}
            className="bg-muted/50 selection:bg-primary/25 max-h-28 overflow-y-auto rounded p-2 text-xs leading-relaxed"
          >
            {text}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-[11px]">
              {range ? `“${text.slice(range.start, range.end).slice(0, 40)}”` : "Select words above."}
            </span>
            <Button size="xs" variant="outline" disabled={!range || regen.isPending} onClick={() => range && regen.mutate(range)}>
              {regen.isPending ? <Loader2Icon className="animate-spin" /> : <ScissorsIcon />}
              Regenerate words
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
