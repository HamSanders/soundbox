/**
 * The book's export dialog: format, layout, chapters and mastering; an ACX
 * check with per-chapter numbers and fix hints; credits and a retail sample;
 * and the export history with downloads.
 *
 * Rendered by core's book header (`editor/book-header.tsx`).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  DownloadIcon,
  FileAudioIcon,
  GaugeIcon,
  HistoryIcon,
  Loader2Icon,
  MicIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { CHAPTER_KIND_LABELS, type BookDetail } from "@/lib/audiobook-api";
import { abk, useBook } from "@/lib/audiobook-queries";
import type {
  ChapterQc,
  ExportFormat,
  ExportRequest,
  MasteringPresetId,
  QcCheck,
} from "@/lib/audiobook-types";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

import { exportApi, type BookExportRecord, type FfmpegInfo } from "./api";

export interface ExportDialogProps {
  bookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ek = {
  ffmpeg: ["audiobook-ffmpeg"] as const,
  exports: (bookId: string) => [...abk.book(bookId), "exports"] as const,
};

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "mp3", label: "MP3", hint: "Constant bitrate. ACX, Spotify and most stores." },
  { id: "m4b", label: "M4B", hint: "One file with chapter markers and cover. Apple Books and audiobook players." },
  { id: "flac", label: "FLAC", hint: "Lossless, 16-bit." },
  { id: "wav", label: "WAV", hint: "16-bit, 44.1 kHz. Needs no ffmpeg." },
];

const PRESETS: { id: MasteringPresetId; label: string; hint: string }[] = [
  {
    id: "acx",
    label: "ACX / Audible",
    hint: "Mono, 44.1 kHz, RMS about -20 dB, peaks under -3 dB, room tone at both ends.",
  },
  { id: "podcast", label: "Podcast", hint: "-16 LUFS, peaks under -1 dBTP." },
  { id: "none", label: "None", hint: "The mix as it is." },
];

const NEEDS: Record<ExportFormat, keyof FfmpegInfo["encoders"] | null> = {
  wav: null,
  mp3: "mp3",
  flac: "flac",
  m4b: "aac",
};

/** What to do about a failed check. */
const FIX_HINTS: Record<string, string> = {
  audio: "Voice this chapter's paragraphs first.",
  rms: "Use the ACX preset: it sets RMS to about -20 dB.",
  loudness: "Use the podcast preset: it sets -16 LUFS.",
  peak: "Use a mastering preset: its limiter holds the true peak under the limit.",
  noise_floor: "Use the ACX preset, whose expander lowers pauses, or regenerate the noisy paragraphs.",
  digital_silence: "Use the ACX preset: it lays quiet room tone under the pauses.",
  room_tone_head: "Use the ACX preset, and set room tone at start to 0.5–1 s under Pacing.",
  room_tone_tail: "Use the ACX preset, and set room tone at end to 1–5 s under Pacing.",
  sample_rate: "Use the ACX or podcast preset: both write 44.1 kHz.",
  max_length: "Split this chapter in two: ACX allows 120 minutes per file.",
  channels: "Use the ACX preset, which writes every chapter in mono.",
};

function canEncode(format: ExportFormat, info: FfmpegInfo | undefined): boolean {
  const need = NEEDS[format];
  if (need === null) return true;
  return !!info?.available && info.encoders[need];
}

function useFfmpeg(enabled: boolean) {
  return useQuery({ queryKey: ek.ffmpeg, queryFn: () => exportApi.ffmpeg(), enabled, staleTime: 60_000 });
}

function useExports(bookId: string, enabled: boolean) {
  return useQuery({
    queryKey: ek.exports(bookId),
    queryFn: () => exportApi.listExports(bookId),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.some((e) => e.status === "queued" || e.status === "running") ? 1000 : false,
  });
}

export function ExportDialog({ bookId, open, onOpenChange }: ExportDialogProps) {
  const book = useBook(open ? bookId : null);
  const ffmpeg = useFfmpeg(open);
  const [tab, setTab] = useState("export");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export audiobook</DialogTitle>
          <DialogDescription>
            Master each chapter, check it against ACX, and write MP3, M4B, FLAC or WAV.
          </DialogDescription>
        </DialogHeader>
        {ffmpeg.data && !ffmpeg.data.available ? <FfmpegWarning info={ffmpeg.data} /> : null}
        {!book.data ? (
          <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading book…
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="export">
                <FileAudioIcon aria-hidden="true" /> Export
              </TabsTrigger>
              <TabsTrigger value="check">
                <GaugeIcon aria-hidden="true" /> ACX check
              </TabsTrigger>
              <TabsTrigger value="credits">
                <MicIcon aria-hidden="true" /> Credits &amp; sample
              </TabsTrigger>
              <TabsTrigger value="history">
                <HistoryIcon aria-hidden="true" /> History
              </TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <TabsContent value="export">
                <ExportTab book={book.data} ffmpeg={ffmpeg.data} onStarted={() => setTab("history")} />
              </TabsContent>
              <TabsContent value="check">
                <CheckTab book={book.data} />
              </TabsContent>
              <TabsContent value="credits">
                <CreditsTab book={book.data} ffmpeg={ffmpeg.data} onSample={() => setTab("history")} />
              </TabsContent>
              <TabsContent value="history">
                <HistoryTab book={book.data} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FfmpegWarning({ info }: { info: FfmpegInfo }) {
  const qc = useQueryClient();
  const recheck = useMutation({
    mutationFn: () => exportApi.ffmpeg(true),
    onSuccess: (data) => qc.setQueryData(ek.ffmpeg, data),
  });
  return (
    <div role="alert" className="border-warn/40 bg-warn/10 flex items-start gap-2 rounded-md border p-3 text-sm">
      <TriangleAlertIcon className="text-warn mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p className="font-medium">ffmpeg is not installed</p>
        <p className="text-muted-foreground">
          {info.message ?? "MP3, FLAC and M4B need ffmpeg. WAV export works without it."}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
        {recheck.isPending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
        Check again
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- export */

function ExportTab({
  book,
  ffmpeg,
  onStarted,
}: {
  book: BookDetail;
  ffmpeg: FfmpegInfo | undefined;
  onStarted: () => void;
}) {
  const qc = useQueryClient();
  const [picked, setFormat] = useState<ExportFormat>("mp3");
  // Fall back to WAV when ffmpeg turns out to be missing.
  const format: ExportFormat = ffmpeg && !canEncode(picked, ffmpeg) ? "wav" : picked;
  const [bitrate, setBitrate] = useState(192);
  const [layout, setLayout] = useState<"files" | "single">("files");
  const [mastering, setMastering] = useState<MasteringPresetId>(book.settings.mastering);
  const [cover, setCover] = useState(true);
  const [transcripts, setTranscripts] = useState(false);
  const [beds, setBeds] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(book.chapters.filter((c) => c.included).map((c) => c.id)),
  );

  const single = format === "m4b" || layout === "single";
  const start = useMutation({
    mutationFn: (req: ExportRequest) => exportApi.startExport(book.id, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ek.exports(book.id) });
      toast.success("Export started");
      onStarted();
    },
    onError: (err) => toast.error("Export failed to start", { description: errorMessage(err) }),
  });

  const chosen = book.chapters.filter((c) => selected.has(c.id));
  const bedsInfo = useQuery({
    queryKey: [...ek.exports(book.id), "beds", [...selected].sort().join(",")],
    queryFn: () => exportApi.bedsInfo(book.id, [...selected]),
    staleTime: 30_000,
  });
  const hasBeds = bedsInfo.data?.has_beds ?? true;
  const unvoiced = chosen.filter((c) => c.stats.voiced === 0);
  const duration = chosen.reduce((s, c) => s + c.stats.duration_s, 0);
  const formatHint = FORMATS.find((f) => f.id === format)?.hint;
  const presetHint = PRESETS.find((p) => p.id === mastering)?.hint;

  const submit = () =>
    start.mutate({
      format,
      bitrate_kbps: format === "mp3" ? bitrate : undefined,
      layout: single ? "single" : "files",
      chapter_ids: [...selected],
      mastering,
      include_cover: cover,
      include_transcripts: transcripts,
      include_beds: beds && hasBeds,
    });

  return (
    <div className="grid gap-4 pt-2 md:grid-cols-[1fr_16rem]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="export-format">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger id="export-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f.id} value={f.id} disabled={!canEncode(f.id, ffmpeg)}>
                    {f.label}
                    {!canEncode(f.id, ffmpeg) ? " (needs ffmpeg)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{formatHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="export-preset">Mastering</Label>
            <Select value={mastering} onValueChange={(v) => setMastering(v as MasteringPresetId)}>
              <SelectTrigger id="export-preset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{presetHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="export-layout">Files</Label>
            <Select
              value={single ? "single" : "files"}
              onValueChange={(v) => setLayout(v as "files" | "single")}
              disabled={format === "m4b"}
            >
              <SelectTrigger id="export-layout" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="files">One file per chapter (zip)</SelectItem>
                <SelectItem value="single">One file for the book</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {format === "m4b"
                ? "M4B is always one file, with a marker per chapter."
                : single
                  ? "Chapters joined in order."
                  : "Named the ACX way: 01_Chapter One.mp3."}
            </p>
          </div>
          {format === "mp3" ? (
            <div className="space-y-1.5">
              <Label htmlFor="export-bitrate">Bitrate</Label>
              <Select value={String(bitrate)} onValueChange={(v) => setBitrate(Number(v))}>
                <SelectTrigger id="export-bitrate" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[128, 192, 256, 320].map((b) => (
                    <SelectItem key={b} value={String(b)}>
                      {b} kbps CBR{b === 192 ? " (ACX)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bitrate < 192 ? <p className="text-warn text-xs">ACX needs 192 kbps or more.</p> : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Toggle id="export-cover" checked={cover} onChange={setCover} disabled={format === "wav"}>
            Embed the cover {format === "wav" ? "(not in WAV)" : null}
          </Toggle>
          <Toggle id="export-transcripts" checked={transcripts} onChange={setTranscripts}>
            Captions (SRT, VTT) and read-along JSON
          </Toggle>
          <Toggle id="export-beds" checked={beds} onChange={setBeds} disabled={!hasBeds}>
            Include music &amp; effects {!hasBeds ? "(none in these chapters)" : null}
          </Toggle>
          {beds && bedsInfo.data?.warnings.length ? (
            <ul className="text-warn space-y-0.5 text-xs">
              {bedsInfo.data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Chapters</Label>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setSelected(new Set(book.chapters.filter((c) => c.included).map((c) => c.id)))}
            >
              Included
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set(book.chapters.map((c) => c.id)))}>
              All
            </Button>
          </div>
        </div>
        <ul className="border-border max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {book.chapters.map((c) => (
            <li key={c.id}>
              <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  checked={selected.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setSelected(next);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.kind !== "chapter" ? (
                  <span className="text-muted-foreground shrink-0 text-xs">{CHAPTER_KIND_LABELS[c.kind]}</span>
                ) : null}
                {c.stats.voiced === 0 ? <span className="text-warn shrink-0 text-xs">silent</span> : null}
              </label>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          {chosen.length} chapter{chosen.length === 1 ? "" : "s"} · {formatDuration(duration)} voiced
        </p>
        {unvoiced.length ? (
          <p className="text-warn text-xs">
            {unvoiced.length} chosen chapter{unvoiced.length === 1 ? " has" : "s have"} no audio yet; the export
            will stop there.
          </p>
        ) : null}
        <Button
          className="w-full"
          onClick={submit}
          disabled={start.isPending || chosen.length === 0 || !canEncode(format, ffmpeg)}
        >
          {start.isPending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <DownloadIcon aria-hidden="true" />}
          Export {FORMATS.find((f) => f.id === format)?.label}
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked && !disabled} onCheckedChange={onChange} disabled={disabled} size="sm" />
      <Label htmlFor={id} className={cn("font-normal", disabled && "text-muted-foreground")}>
        {children}
      </Label>
    </div>
  );
}

/* ----------------------------------------------------------------- check */

const fmtDb = (v: number) => (v <= -120 ? "−∞" : v.toFixed(1));

function CheckTab({ book }: { book: BookDetail }) {
  const [mastering, setMastering] = useState<MasteringPresetId>(book.settings.mastering);
  const analyze = useMutation({
    mutationFn: () => exportApi.analyze(book.id, { mastering }),
    onError: (err) => toast.error("Check failed", { description: errorMessage(err) }),
  });
  const titles = useMemo(() => new Map(book.chapters.map((c) => [c.id, c.title])), [book.chapters]);
  const rows = analyze.data;
  const passed = rows?.filter((r) => r.checks.every((c) => c.pass)).length ?? 0;

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="check-preset">Check after mastering with</Label>
          <Select value={mastering} onValueChange={(v) => setMastering(v as MasteringPresetId)}>
            <SelectTrigger id="check-preset" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
          {analyze.isPending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <GaugeIcon aria-hidden="true" />}
          Run check
        </Button>
        {rows ? (
          <p className={cn("ml-auto text-sm", passed === rows.length ? "text-ok" : "text-warn")}>
            {passed} of {rows.length} chapters pass
          </p>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        ACX: RMS −23 to −18 dB, peak at most −3 dB, noise floor at most −60 dB, 0.5–1 s room tone at the start and
        1–5 s at the end, 44.1 kHz, up to 120 minutes per file, all mono or all stereo.
      </p>
      {rows ? (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-2 py-1.5 font-medium">Chapter</th>
                <th className="px-2 py-1.5 text-right font-medium">RMS</th>
                <th className="px-2 py-1.5 text-right font-medium">Peak</th>
                <th className="px-2 py-1.5 text-right font-medium">Floor</th>
                <th className="px-2 py-1.5 text-right font-medium">Head</th>
                <th className="px-2 py-1.5 text-right font-medium">Tail</th>
                <th className="px-2 py-1.5 text-right font-medium">Length</th>
                <th className="px-2 py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <QcRow key={r.chapter_id} qc={r} title={titles.get(r.chapter_id) ?? r.chapter_id} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function QcRow({ qc, title }: { qc: ChapterQc; title: string }) {
  const failed = qc.checks.filter((c) => !c.pass);
  const ok = failed.length === 0;
  const byId = new Map(qc.checks.map((c) => [c.id, c]));
  const cell = (id: string, text: string) => (
    <td
      className={cn(
        "px-2 py-1.5 text-right font-mono text-xs tabular-nums",
        byId.get(id)?.pass === false && "text-danger",
      )}
      title={byId.get(id)?.message}
    >
      {text}
    </td>
  );
  const noAudio = byId.has("audio");
  const r = qc.report;
  return (
    <>
      <tr className="border-border border-t">
        <td className="max-w-48 truncate px-2 py-1.5">{title}</td>
        {noAudio ? (
          <td colSpan={6} className="text-muted-foreground px-2 py-1.5 text-xs">
            no audio
          </td>
        ) : (
          <>
            {cell(byId.has("loudness") ? "loudness" : "rms", byId.has("loudness") ? `${fmtDb(r.integrated_lufs)} LU` : fmtDb(r.rms_db))}
            {cell("peak", fmtDb(r.peak_dbfs))}
            {cell("noise_floor", fmtDb(r.noise_floor_db))}
            {cell("room_tone_head", `${r.head_silence_s.toFixed(2)}s`)}
            {cell("room_tone_tail", `${r.tail_silence_s.toFixed(2)}s`)}
            {cell("max_length", formatDuration(r.duration_s))}
          </>
        )}
        <td className="px-2 py-1.5">
          {ok ? (
            <span className="text-ok inline-flex items-center gap-1 text-xs font-medium">
              <CheckIcon className="size-3.5" aria-hidden="true" /> Pass
            </span>
          ) : (
            <span className="text-danger inline-flex items-center gap-1 text-xs font-medium">
              <XIcon className="size-3.5" aria-hidden="true" /> {failed.length} to fix
            </span>
          )}
        </td>
      </tr>
      {failed.length ? (
        <tr>
          <td colSpan={8} className="px-2 pb-2">
            <ul className="bg-muted/40 space-y-1 rounded p-2 text-xs">
              {failed.map((c) => (
                <FixHint key={c.id} check={c} />
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FixHint({ check }: { check: QcCheck }) {
  return (
    <li className="flex gap-1.5">
      <XIcon className="text-danger mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>
        {check.message}
        {FIX_HINTS[check.id] ? <span className="text-muted-foreground"> {FIX_HINTS[check.id]}</span> : null}
      </span>
    </li>
  );
}

/* --------------------------------------------------------------- credits */

function CreditsTab({
  book,
  ffmpeg,
  onSample,
}: {
  book: BookDetail;
  ffmpeg: FfmpegInfo | undefined;
  onSample: () => void;
}) {
  const qc = useQueryClient();
  const hasOpening = book.chapters.some((c) => c.kind === "opening_credits");
  const hasClosing = book.chapters.some((c) => c.kind === "closing_credits");
  const narrated = book.chapters.filter((c) => c.kind === "chapter" && c.stats.voiced > 0);
  const [sampleChapter, setSampleChapter] = useState<string>(narrated[0]?.id ?? "");
  const [sampleLength, setSampleLength] = useState(240);

  const credits = useMutation({
    mutationFn: (req: Parameters<typeof exportApi.credits>[1]) => exportApi.credits(book.id, req),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: abk.book(book.id) });
      if (r.sample) {
        void qc.invalidateQueries({ queryKey: ek.exports(book.id) });
        toast.success("Sample started");
        onSample();
      } else toast.success("Credits added", { description: "Voice them like any chapter, then export." });
    },
    onError: (err) => toast.error("Couldn't make that", { description: errorMessage(err) }),
  });

  return (
    <div className="space-y-5 pt-2">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Opening and closing credits</h3>
        <p className="text-muted-foreground text-xs">
          ACX wants the title, subtitle, author and narrator in their own first file, and “The End” in a last one.
          These are added as chapters you voice like any other. The narrator is credited as a digital voice
          {book.narrator ? ` (“${book.narrator}, a digital voice”)` : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={credits.isPending}
            onClick={() => credits.mutate({ opening: true, closing: true, replace: hasOpening || hasClosing })}
          >
            {hasOpening || hasClosing ? "Rewrite credits" : "Add opening and closing credits"}
          </Button>
          {hasOpening || hasClosing ? (
            <p className="text-muted-foreground self-center text-xs">
              {[hasOpening && "Opening", hasClosing && "closing"].filter(Boolean).join(" and ")} credits are in the
              book.
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Retail sample</h3>
        <p className="text-muted-foreground text-xs">
          A 1–5 minute excerpt for store pages: it starts with the narration, ends on a paragraph, and leaves out
          credits and music. Mastered for ACX.
        </p>
        {narrated.length === 0 ? (
          <p className="text-warn text-xs">Voice a chapter first.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="sample-chapter">From</Label>
              <Select value={sampleChapter} onValueChange={setSampleChapter}>
                <SelectTrigger id="sample-chapter" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {narrated.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sample-length">Length</Label>
              <Select value={String(sampleLength)} onValueChange={(v) => setSampleLength(Number(v))}>
                <SelectTrigger id="sample-length" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[60, 120, 180, 240, 290].map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      up to {formatDuration(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={credits.isPending || !sampleChapter}
              onClick={() =>
                credits.mutate({
                  sample: {
                    chapter_id: sampleChapter,
                    target_s: sampleLength,
                    format: ffmpeg?.available && ffmpeg.encoders.mp3 ? "mp3" : "wav",
                  },
                })
              }
            >
              Make sample
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- history */

function HistoryTab({ book }: { book: BookDetail }) {
  const qc = useQueryClient();
  const list = useExports(book.id, true);
  const remove = useMutation({
    mutationFn: (id: string) => exportApi.deleteExport(book.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ek.exports(book.id) }),
    onError: (err) => toast.error("Couldn't delete", { description: errorMessage(err) }),
  });

  if (list.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (!list.data?.length) {
    return <p className="text-muted-foreground py-6 text-sm">Nothing exported yet.</p>;
  }
  return (
    <ul className="space-y-2 pt-2">
      {list.data.map((e) => (
        <HistoryRow key={e.id} record={e} onDelete={() => remove.mutate(e.id)} />
      ))}
    </ul>
  );
}

function HistoryRow({ record: e, onDelete }: { record: BookExportRecord; onDelete: () => void }) {
  const url = e.status === "done" ? exportApi.downloadUrl(e.book_id, e.id) : null;
  const running = e.status === "queued" || e.status === "running";
  const failedChecks = e.qc.filter((q) => q.checks.some((c) => !c.pass)).length;
  const preset = PRESETS.find((p) => p.id === e.request.mastering)?.label ?? e.request.mastering;
  return (
    <li className="border-border space-y-1.5 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {e.kind === "sample" ? "Retail sample" : `${e.request.format.toUpperCase()}`}
          {e.kind === "book" ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              · {e.request.layout === "single" ? "one file" : "per chapter"} · {preset}
              {e.request.bitrate_kbps ? ` · ${e.request.bitrate_kbps} kbps` : ""}
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground ml-auto text-xs">{formatRelative(e.created_at)}</span>
      </div>
      {running ? (
        <div className="space-y-1">
          <Progress value={Math.round(e.progress * 100)} />
          <p className="text-muted-foreground text-xs">{e.message ?? "Queued"}</p>
        </div>
      ) : e.status === "failed" ? (
        <p className="text-danger text-xs">{e.error ?? "Failed."}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground truncate text-xs">
            {e.filename}
            {e.size_bytes ? ` · ${formatBytes(e.size_bytes)}` : ""}
          </span>
          {e.qc.length ? (
            <span className={cn("text-xs", failedChecks ? "text-warn" : "text-ok")}>
              {failedChecks ? `${failedChecks} chapter${failedChecks === 1 ? "" : "s"} outside ACX` : "Passes ACX check"}
            </span>
          ) : null}
          <div className="ml-auto flex gap-1">
            {url ? (
              <Button size="sm" variant="outline" asChild>
                <a href={url} download={e.filename ?? undefined}>
                  <DownloadIcon aria-hidden="true" /> Download
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="Downloads are off in the preview.">
                <DownloadIcon aria-hidden="true" /> Download
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete export">
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
