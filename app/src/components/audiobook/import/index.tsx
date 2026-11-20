/**
 * Import a manuscript as a new audiobook.
 *
 * Four steps: add the text (a file, pasted text or a web address); review the
 * detected sections (kind, include, rename, reorder, merge, split, with the
 * paragraphs shown); check the book's details and cover; choose the cast,
 * narrator voice and model. "Create book" commits the preview with every
 * edit. The server parses; this screen only edits the result.
 */

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BookOpenIcon,
  ClipboardPasteIcon,
  FileUpIcon,
  ImageIcon,
  LinkIcon,
  Loader2Icon,
  MergeIcon,
  ScissorsIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTts } from "@/components/audiobook/editor/use-tts";
import { errorMessage } from "@/lib/api";
import { abk } from "@/lib/audiobook-queries";
import type { ChapterKind } from "@/lib/audiobook-types";
import { cn } from "@/lib/utils";

import { ACCEPT, importApi, type ImportMetadata, type ImportPreview } from "./api";
import {
  countParagraphs,
  initialSections,
  KIND_LABEL,
  mergeWithNext,
  moveSection,
  paragraphsFor,
  splitAt,
  toEditSections,
  updateSection,
  type WorkingSection,
} from "./sections";

export interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new book's id once the import is committed. */
  onImported?: (bookId: string) => void;
}

type Step = "source" | "sections" | "details" | "voice";
const STEPS: { id: Step; label: string }[] = [
  { id: "source", label: "Text" },
  { id: "sections", label: "Sections" },
  { id: "details", label: "Details" },
  { id: "voice", label: "Voice" },
];
type SourceMode = "file" | "paste" | "url";

const NONE = "__none__";
const AUTO = "__auto__";
const KINDS = Object.keys(KIND_LABEL) as ChapterKind[];

export function ImportWizard({ open, onOpenChange, onImported }: ImportWizardProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("source");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sections, setSections] = useState<WorkingSection[]>([]);
  const [meta, setMeta] = useState<ImportMetadata | null>(null);
  const [castMode, setCastMode] = useState<"single" | "multi">("single");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("source");
    setPreview(null);
    setSections([]);
    setMeta(null);
    setError(null);
    setBusy(null);
  };

  const close = (next: boolean) => {
    if (!next) {
      if (preview) void importApi.discard(preview.id).catch(() => {});
      reset();
    }
    onOpenChange(next);
  };

  const accept = (p: ImportPreview) => {
    if (preview && preview.id !== p.id) void importApi.discard(preview.id).catch(() => {});
    setPreview(p);
    setSections(initialSections(p.sections));
    setMeta(p.metadata);
    setStep("sections");
  };

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!preview || !meta) return;
    const book = await run("Creating the book…", () =>
      importApi.commit({
        preview_id: preview.id,
        edits: { metadata: meta, sections: toEditSections(sections), cover: preview.cover ? "keep" : "remove" },
        settings: { cast_mode: castMode, narrator_voice_id: voiceId, model_id: modelId },
      }),
    );
    if (!book) return;
    void qc.invalidateQueries({ queryKey: abk.books });
    reset();
    onOpenChange(false);
    onImported?.(book.id);
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const included = sections.filter((s) => s.included);
  const canNext =
    step === "sections" ? included.length > 0 && sections.every((s) => s.title.trim()) : step === "details" ? !!meta?.title?.trim() : true;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(90vh,820px)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>Import a manuscript</DialogTitle>
          <DialogDescription>
            EPUB, PDF, Word, text, Markdown, HTML or a web page. Chapters, front matter and the cover are detected for
            you to check.
          </DialogDescription>
          <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                aria-current={s.id === step ? "step" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs",
                  s.id === step
                    ? "border-primary bg-primary text-primary-foreground"
                    : i < stepIndex
                      ? "border-border text-foreground"
                      : "border-border text-muted-foreground",
                )}
              >
                {i + 1}. {s.label}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <div role="alert" className="border-destructive/40 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          )}
          {step === "source" && <SourceStep busy={busy} run={run} onParsed={accept} />}
          {step === "sections" && preview && (
            <SectionsStep preview={preview} sections={sections} onChange={setSections} />
          )}
          {step === "details" && preview && meta && (
            <DetailsStep preview={preview} meta={meta} onMeta={setMeta} onPreview={setPreview} run={run} />
          )}
          {step === "voice" && preview && (
            <VoiceStep
              castMode={castMode}
              onCastMode={setCastMode}
              voiceId={voiceId}
              onVoice={setVoiceId}
              modelId={modelId}
              onModel={setModelId}
              summary={{
                chapters: included.length,
                paragraphs: included.reduce((n, s) => n + countParagraphs(s), 0),
                characters: included.reduce(
                  (n, s) => n + paragraphsFor(s.parts, preview.sections).reduce((m, p) => m + p.length, 0),
                  0,
                ),
              }}
            />
          )}
        </div>

        <DialogFooter className="border-t p-4">
          {busy && (
            <span className="text-muted-foreground mr-auto inline-flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {busy}
            </span>
          )}
          {stepIndex > 0 && (
            <Button variant="outline" onClick={() => setStep(STEPS[stepIndex - 1]!.id)} disabled={!!busy}>
              <ArrowLeftIcon />
              Back
            </Button>
          )}
          {step !== "source" && step !== "voice" && (
            <Button onClick={() => setStep(STEPS[stepIndex + 1]!.id)} disabled={!canNext || !!busy}>
              Next
              <ArrowRightIcon />
            </Button>
          )}
          {step === "voice" && (
            <Button onClick={() => void create()} disabled={!!busy}>
              <BookOpenIcon />
              Create book
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------- 1. source */

type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | null>;

function SourceStep({ busy, run, onParsed }: { busy: string | null; run: Run; onParsed: (p: ImportPreview) => void }) {
  const [mode, setMode] = useState<SourceMode>("file");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parseFile = async (file: File) => {
    const p = await run(`Reading ${file.name}…`, () => importApi.parseFile(file));
    if (p) onParsed(p);
  };

  return (
    <div className="space-y-4">
      <Tabs value={mode} onValueChange={(v) => setMode(v as SourceMode)}>
        <TabsList>
          <TabsTrigger value="file">
            <FileUpIcon />
            File
          </TabsTrigger>
          <TabsTrigger value="paste">
            <ClipboardPasteIcon />
            Paste text
          </TabsTrigger>
          <TabsTrigger value="url">
            <LinkIcon />
            Web page
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "file" && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void parseFile(file);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
          )}
        >
          {busy ? <Loader2Icon className="text-muted-foreground size-8 animate-spin" /> : <UploadIcon className="text-muted-foreground size-8" />}
          <span className="font-medium">Drop a manuscript here, or choose a file</span>
          <span className="text-muted-foreground text-xs">EPUB, PDF, DOCX, TXT, Markdown or HTML, up to 256 MB</span>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void parseFile(file);
            }}
          />
        </button>
      )}

      {mode === "paste" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="import-title">Title</Label>
            <Input id="import-title" value={title} placeholder="Untitled book" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-text">Text</Label>
            <Textarea
              id="import-text"
              className="min-h-56 font-serif"
              value={text}
              placeholder={"Chapter 1\n\nIt is a truth universally acknowledged…"}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Blank lines separate paragraphs. Lines like “Chapter 1”, “Prologue” or “# Part One” start a new section.
            </p>
          </div>
          <Button
            disabled={!text.trim() || !!busy}
            onClick={async () => {
              const p = await run("Reading the text…", () => importApi.parseText(text, title.trim() || null));
              if (p) onParsed(p);
            }}
          >
            <ArrowRightIcon />
            Continue
          </Button>
        </div>
      )}

      {mode === "url" && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = await run("Fetching the page…", () => importApi.parseUrl(url.trim()));
            if (p) onParsed(p);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="import-url">Address</Label>
            <Input id="import-url" type="url" inputMode="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
            <p className="text-muted-foreground text-xs">
              The page's main text is kept; menus, sidebars and footers are left out. A link to an EPUB, PDF or Word file works too.
            </p>
          </div>
          <Button type="submit" disabled={!/^https?:\/\/\S+/i.test(url.trim()) || !!busy}>
            <ArrowRightIcon />
            Fetch
          </Button>
        </form>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- 2. sections */

function SectionsStep({
  preview,
  sections,
  onChange,
}: {
  preview: ImportPreview;
  sections: WorkingSection[];
  onChange: (next: WorkingSection[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(sections[0]?.key ?? null);
  const index = Math.max(0, sections.findIndex((s) => s.key === selected));
  const current = sections[index];
  const paragraphs = useMemo(() => (current ? paragraphsFor(current.parts, preview.sections) : []), [current, preview.sections]);
  // A merged-away selection falls back to the first section (index 0 above).
  const included = sections.filter((s) => s.included).length;

  return (
    <div className="space-y-3">
      {preview.warnings.length > 0 && (
        <ul className="border-border bg-muted/50 space-y-1 rounded-md border px-3 py-2 text-sm">
          {preview.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <TriangleAlertIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-sm">
        {sections.length} sections found, {included} included. Detection isn't perfect: check what's read aloud, rename
        sections, and merge or split them where the text runs together.
      </p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ul className="space-y-1.5" aria-label="Sections">
          {sections.map((s, i) => (
            <li
              key={s.key}
              className={cn(
                "bg-card ring-border flex items-center gap-2 rounded-md p-2 ring-1",
                s.key === current?.key && "ring-primary",
                !s.included && "opacity-70",
              )}
              onClick={() => setSelected(s.key)}
            >
              <Switch
                size="sm"
                checked={s.included}
                aria-label={`Include ${s.title}`}
                onCheckedChange={(v) => onChange(updateSection(sections, s.key, { included: v }))}
                onClick={(e) => e.stopPropagation()}
              />
              <Input
                className="h-7 min-w-0 flex-1"
                value={s.title}
                aria-label="Section title"
                onFocus={() => setSelected(s.key)}
                onChange={(e) => onChange(updateSection(sections, s.key, { title: e.target.value }))}
              />
              <Select value={s.kind} onValueChange={(v) => onChange(updateSection(sections, s.key, { kind: v as ChapterKind }))}>
                <SelectTrigger size="sm" className="w-32 shrink-0" aria-label="Section kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">{countParagraphs(s)} ¶</span>
              <div className="flex shrink-0 gap-0.5">
                <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => onChange(moveSection(sections, i, -1))}>
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Move down"
                  disabled={i === sections.length - 1}
                  onClick={() => onChange(moveSection(sections, i, 1))}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Merge with next"
                  title="Merge with next"
                  disabled={i === sections.length - 1}
                  onClick={() => onChange(mergeWithNext(sections, i))}
                >
                  <MergeIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="bg-muted/40 ring-border max-h-[52vh] overflow-y-auto rounded-md p-3 ring-1 lg:sticky lg:top-0">
          {current ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="truncate font-medium">{current.title || "Untitled"}</h3>
                <Badge variant="outline">{KIND_LABEL[current.kind]}</Badge>
                {!current.included && <Badge variant="secondary">Not read</Badge>}
              </div>
              <ol className="space-y-0.5 text-sm">
                {paragraphs.map((p, i) => (
                  <li key={i} className="group">
                    {i > 0 && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground my-0.5 flex w-full items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => onChange(splitAt(sections, index, i))}
                      >
                        <ScissorsIcon className="size-3" />
                        <span className="border-border flex-1 border-t border-dashed" />
                        Split here
                      </button>
                    )}
                    <p className="leading-relaxed">{p}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No sections.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 3. details */

const FIELDS: { key: keyof ImportMetadata; label: string; wide?: boolean; multiline?: boolean }[] = [
  { key: "title", label: "Title", wide: true },
  { key: "subtitle", label: "Subtitle", wide: true },
  { key: "author", label: "Author" },
  { key: "language", label: "Language" },
  { key: "publisher", label: "Publisher" },
  { key: "publication_date", label: "Published" },
  { key: "isbn", label: "ISBN" },
  { key: "description", label: "Description", wide: true, multiline: true },
];

function DetailsStep({
  preview,
  meta,
  onMeta,
  onPreview,
  run,
}: {
  preview: ImportPreview;
  meta: ImportMetadata;
  onMeta: (m: ImportMetadata) => void;
  onPreview: (p: ImportPreview) => void;
  run: Run;
}) {
  const coverInput = useRef<HTMLInputElement>(null);
  const cover = importApi.coverUrl(preview);
  return (
    <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="bg-muted ring-border flex aspect-[2/3] items-center justify-center overflow-hidden rounded-md ring-1">
          {cover ? (
            <img src={cover} alt="Cover" className="size-full object-cover" />
          ) : (
            <ImageIcon className="text-muted-foreground size-8" aria-label="No cover" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" onClick={() => coverInput.current?.click()}>
            {cover ? "Replace cover" : "Add cover"}
          </Button>
          {cover && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const p = await run("Removing the cover…", () => importApi.removeCover(preview.id));
                if (p) onPreview(p);
              }}
            >
              Remove cover
            </Button>
          )}
          <input
            ref={coverInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const p = await run("Uploading the cover…", () => importApi.replaceCover(preview.id, file));
              if (p) onPreview(p);
            }}
          />
          {cover && <p className="text-muted-foreground text-xs">Kept with the book unless you replace or remove it.</p>}
        </div>
      </div>
      <div className="grid content-start gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const id = `import-meta-${f.key}`;
          const value = meta[f.key] ?? "";
          const set = (v: string) => onMeta({ ...meta, [f.key]: v || null });
          return (
            <div key={f.key} className={cn("space-y-1.5", f.wide && "sm:col-span-2")}>
              <Label htmlFor={id}>{f.label}</Label>
              {f.multiline ? (
                <Textarea id={id} className="min-h-24" value={value} onChange={(e) => set(e.target.value)} />
              ) : (
                <Input
                  id={id}
                  value={value}
                  aria-invalid={f.key === "title" && !value.trim() ? true : undefined}
                  onChange={(e) => set(e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- 4. voice */

function VoiceStep({
  castMode,
  onCastMode,
  voiceId,
  onVoice,
  modelId,
  onModel,
  summary,
}: {
  castMode: "single" | "multi";
  onCastMode: (m: "single" | "multi") => void;
  voiceId: string | null;
  onVoice: (id: string | null) => void;
  modelId: string | null;
  onModel: (id: string | null) => void;
  summary: { chapters: number; paragraphs: number; characters: number };
}) {
  const tts = useTts();
  const voices = modelId ? tts.allVoices.filter((v) => !v.model_id || v.model_id === modelId) : tts.allVoices;
  const minutes = Math.max(1, Math.round(summary.characters / 15 / 60));
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Cast</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cast">
          {(
            [
              ["single", "Single narrator", "One voice reads the whole book."],
              ["multi", "Multi-cast", "A narrator plus a voice for each character. Characters are detected in the editor."],
            ] as const
          ).map(([mode, title, text]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={castMode === mode}
              onClick={() => onCastMode(mode)}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                castMode === mode ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
              )}
            >
              <span className="block font-medium">{title}</span>
              <span className="text-muted-foreground text-xs">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Model</Label>
          <Select value={modelId ?? AUTO} onValueChange={(v) => onModel(v === AUTO ? null : v)}>
            <SelectTrigger className="w-full" aria-label="Model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Each voice's own model</SelectItem>
              {tts.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Narrator voice</Label>
          <Select value={voiceId ?? NONE} onValueChange={(v) => onVoice(v === NONE ? null : v)}>
            <SelectTrigger className="w-full" aria-label="Narrator voice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose later</SelectItem>
              {voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {tts.models.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No speech model is installed yet. The book is created either way; install one from Models before voicing it.
        </p>
      )}

      <div className="bg-muted/40 ring-border rounded-md p-3 text-sm ring-1">
        <p>
          <span className="font-medium">{summary.chapters}</span> sections,{" "}
          <span className="font-medium">{summary.paragraphs.toLocaleString()}</span> paragraphs,{" "}
          <span className="font-medium">{summary.characters.toLocaleString()}</span> characters to read: roughly{" "}
          {minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`} of audio.
        </p>
        <p className="text-muted-foreground mt-1 text-xs">Nothing is voiced yet. Each chapter opens in the editor, ready to generate.</p>
      </div>
    </div>
  );
}
