/**
 * The editor's top bar: cover, title and author, then the book-wide
 * settings: narrator voice, model, cast mode and pacing. The title and
 * author are edited where they're shown; Details opens the rest of the
 * metadata. Export and the render bar come from their areas.
 */

import { memo, useRef, useState } from "react";
import {
  DownloadIcon,
  HistoryIcon,
  ImageIcon,
  InfoIcon,
  SearchIcon,
  TimerIcon,
  UsersIcon,
  UserIcon,
} from "lucide-react";

import { ExportDialog } from "@/components/audiobook/export";
import { BookCover } from "@/components/audiobook/shelf/book-cover";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { bookProgress, type BookDetail, type BookPatch } from "@/lib/audiobook-api";
import { useUpdateBook, useUploadCover } from "@/lib/audiobook-queries";
import type { PacingSettings } from "@/lib/audiobook-types";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useTts, voiceModelName } from "./use-tts";
import { VoiceLabel } from "./voice-label";
import { VersionsDialog } from "./versions-dialog";

const NONE = "__none__";

const PACING_FIELDS: { key: keyof PacingSettings; label: string; hint: string; max: number }[] = [
  { key: "paragraph_gap_s", label: "Between paragraphs", hint: "Silence after each paragraph.", max: 5 },
  { key: "heading_gap_s", label: "After a heading", hint: "Extra pause after a chapter title.", max: 10 },
  { key: "head_room_tone_s", label: "Room tone at start", hint: "ACX asks for 0.5–1 s.", max: 5 },
  { key: "tail_room_tone_s", label: "Room tone at end", hint: "ACX asks for 1–5 s.", max: 10 },
  { key: "scene_break_s", label: "Scene break", hint: "Pause at a scene break (* * *) on import.", max: 30 },
];

function DetailsDialog({
  book,
  open,
  onOpenChange,
}: {
  book: BookDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateBook(book.id);
  const [draft, setDraft] = useState<BookPatch>({});
  const value = <K extends keyof BookPatch>(k: K) => (k in draft ? draft[k] : book[k as keyof BookDetail]);
  const text = (k: keyof BookPatch, label: string, opts: { area?: boolean; placeholder?: string } = {}) => {
    const v = value(k);
    const str = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    const set = (s: string) =>
      setDraft((d) => ({
        ...d,
        [k]:
          k === "genres"
            ? s.split(",").map((g) => g.trim()).filter(Boolean)
            : k === "series_index"
              ? s === "" ? null : Number(s)
              : s === "" && k !== "title" ? null : s,
      }));
    return (
      <div className={cn("space-y-1.5", opts.area && "col-span-2")}>
        <Label htmlFor={`book-${k}`} className="text-xs">
          {label}
        </Label>
        {opts.area ? (
          <Textarea id={`book-${k}`} value={str} rows={4} onChange={(e) => set(e.target.value)} />
        ) : (
          <Input id={`book-${k}`} value={str} placeholder={opts.placeholder} onChange={(e) => set(e.target.value)} />
        )}
      </div>
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setDraft({});
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Book details</DialogTitle>
          <DialogDescription>Used in credits, file metadata and the listening shelf.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
          {text("title", "Title")}
          {text("subtitle", "Subtitle")}
          {text("author", "Author")}
          {text("narrator", "Narrated by")}
          {text("series", "Series")}
          {text("series_index", "Number in series")}
          {text("genres", "Genres", { placeholder: "Mystery, Coastal" })}
          {text("language", "Language", { placeholder: "en" })}
          {text("publisher", "Publisher")}
          {text("publication_date", "Published", { placeholder: "2026-11-20" })}
          {text("isbn", "ISBN")}
          {text("description", "Description", { area: true })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={Object.keys(draft).length === 0 || update.isPending || draft.title === ""}
            onClick={() =>
              update.mutate(draft, {
                onSuccess: () => {
                  setDraft({});
                  onOpenChange(false);
                },
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookHeaderView({
  book,
  findOpen,
  onToggleFind,
  onRestored,
}: {
  book: BookDetail;
  findOpen: boolean;
  onToggleFind: () => void;
  /** A version was restored. */
  onRestored: () => void;
}) {
  const update = useUpdateBook(book.id);
  const cover = useUploadCover(book.id);
  const tts = useTts();
  const file = useRef<HTMLInputElement>(null);
  const [details, setDetails] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [versions, setVersions] = useState(false);
  const pct = bookProgress(book);
  const settings = book.settings;
  const setSettings = (patch: BookPatch["settings"]) => update.mutate({ settings: patch });

  return (
    <div className="border-border/70 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
      <button
        type="button"
        className="group relative w-11 shrink-0"
        onClick={() => file.current?.click()}
        aria-label="Change cover"
        title="Change cover"
      >
        <BookCover book={book} size="sm" />
        <span className="bg-background/70 absolute inset-0 hidden items-center justify-center rounded-md group-hover:flex">
          <ImageIcon className="size-4" />
        </span>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) cover.mutate(f);
            e.target.value = "";
          }}
        />
      </button>
      <div className="min-w-0 flex-1 basis-56">
        <InlineEdit
          as="h1"
          value={book.title}
          label="Title"
          onCommit={(title) => update.mutateAsync({ title })}
          className="font-heading truncate text-lg leading-tight font-semibold"
        />
        <p className="text-muted-foreground flex min-w-0 items-baseline truncate text-xs">
          <InlineEdit
            value={book.author ?? ""}
            label="Author"
            placeholder="Add author"
            allowEmpty
            onCommit={(author) => update.mutateAsync({ author: author || null })}
            className="min-w-0 shrink truncate"
          />
          <span className="shrink-0 whitespace-pre">
            {" "}· {book.stats.chapters} chapters · {pct}% voiced
          {book.stats.stale ? ` · ${book.stats.stale} stale` : ""}
          {book.stats.duration_s > 0 ? ` · ${formatDuration(book.stats.duration_s)}` : ""}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={settings.narrator_voice_id ?? NONE}
          onValueChange={(v) => setSettings({ narrator_voice_id: v === NONE ? null : v })}
        >
          <SelectTrigger size="sm" className="w-56" aria-label="Narrator voice">
            <SelectValue placeholder="Narrator voice" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No narrator voice</SelectItem>
            {/* The model comes with the voice: a voice reads on the model it was made on. */}
            {tts.allVoices.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                <VoiceLabel name={v.name} model={voiceModelName(v, tts.allModels)} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="border-input bg-card flex rounded-full border p-0.5" role="radiogroup" aria-label="Cast">
          {(["single", "multi"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.cast_mode === mode}
              onClick={() => setSettings({ cast_mode: mode })}
              title={mode === "single" ? "Narrator reads everything" : "Each character has a voice"}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs",
                settings.cast_mode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "single" ? <UserIcon className="size-3" /> : <UsersIcon className="size-3" />}
              {mode === "single" ? "Single cast" : "Multi cast"}
            </button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <TimerIcon />
              Pacing
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3">
            {PACING_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-[1fr_5rem] items-center gap-2">
                <div>
                  <Label htmlFor={`pace-${f.key}`} className="text-sm">
                    {f.label}
                  </Label>
                  <p className="text-muted-foreground text-xs">{f.hint}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    id={`pace-${f.key}`}
                    type="number"
                    min={0}
                    max={f.max}
                    step={0.25}
                    defaultValue={settings.pacing[f.key] ?? (f.key === "scene_break_s" ? 2 : 0)}
                    className="h-7 text-right text-sm"
                    onBlur={(e) => {
                      const n = Math.min(f.max, Math.max(0, Number(e.target.value)));
                      if (!Number.isNaN(n) && n !== settings.pacing[f.key]) {
                        setSettings({ pacing: { [f.key]: n } });
                      }
                    }}
                  />
                  <span className="text-muted-foreground text-xs">s</span>
                </div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
        <Button
          size="icon-sm"
          variant={findOpen ? "secondary" : "ghost"}
          aria-label="Find and replace"
          aria-pressed={findOpen}
          title="Find and replace (Ctrl+F)"
          onClick={onToggleFind}
        >
          <SearchIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Versions" title="Versions" onClick={() => setVersions(true)}>
          <HistoryIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Book details" title="Book details" onClick={() => setDetails(true)}>
          <InfoIcon />
        </Button>
        <Button size="sm" onClick={() => setExporting(true)}>
          <DownloadIcon />
          Export
        </Button>
      </div>
      <DetailsDialog book={book} open={details} onOpenChange={setDetails} />
      <ExportDialog bookId={book.id} open={exporting} onOpenChange={setExporting} />
      <VersionsDialog bookId={book.id} open={versions} onOpenChange={setVersions} onRestored={onRestored} />
    </div>
  );
}

/** Memoised: the editor re-renders on every paragraph selection. */
export const BookHeader = memo(BookHeaderView);
