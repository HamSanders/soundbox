/**
 * `/sounds/:id` — one sound's page.
 *
 * Laid out the way a song page is on the services people already know (the
 * sources and what was taken from each are in `docs/sound-page/DESIGN.md`):
 *
 *   hero         cover on the left; a type label, the title, a one-line
 *                "who · when · how long" and the prompt on the right
 *   actions      one row under the hero: a filled Play first, then the few
 *                things you do most, each named, and a ··· menu for the rest
 *   timeline     the waveform editor (`SoundEditor`)
 *   body         stems, lyrics and versions in the main column; the details
 *                ("credits") in a card beside them
 *
 * Splitting and the studio are the two things this page exists to hand a
 * sound on to, so neither is hidden: **Open in Studio** puts the sound on a
 * track in one click, **Split into stems** asks which stems and can open them
 * in the studio in the same step, and once stems exist their section carries
 * its own "Open stems in Studio".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  ScissorsIcon,
  SlidersHorizontalIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LicenseChip } from "@/components/license-badge";
import { PeakGlyph } from "@/components/peak-glyph";
import { SoundTileArt } from "@/components/sound-card";
import { SoundEditor, type SoundEditorHandle } from "@/components/sound-editor";
import { StemGroup } from "@/components/stem-group";
import { StemPickerDialog } from "@/components/stem-picker";
import { useVoice } from "@/components/voice-avatar";
import { useJobStream } from "@/hooks/use-job-stream";
import {
  downloadSound,
  formatBytes,
  formatClock,
  formatDuration,
  formatHz,
  formatRelative,
} from "@/lib/format";
import {
  useCan,
  useDeleteSound,
  useImageStatus,
  useModels,
  useProjects,
  useRevealSound,
  useSeparateSound,
  useSettings,
  useSound,
  useSoundArtwork,
  useSounds,
  useStoryFromSound,
  useUpdateSound,
} from "@/lib/queries";
import { recipeText } from "@/lib/recipe";
import { cn } from "@/lib/utils";
import type { Model, Sound, StemSelection } from "@/lib/api";

/* ------------------------------------------------------------------ parts */

/** What kind of thing this is, for the small label above the title. */
function kindLabel(sound: Sound, model: Model | undefined, isStem: boolean): string {
  if (isStem) return "Stem";
  if (sound.parent_id) return "Version";
  if (model?.task === "tts" || sound.voice_id) return "Speech";
  if (model?.category === "music") return sound.lyrics?.trim() ? "Song" : "Music";
  if (model?.category === "sfx") return "Sound effect";
  return "Sound";
}

/** Stems in the order a mixer lays them out, whatever order they were
 *  written in: the voice on top, the leftovers at the bottom. */
const STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other", "rest"];
function stemRank(name: string): number {
  const stem = /\(([^()]+)\)\s*$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const at = STEM_ORDER.indexOf(stem);
  return at === -1 ? STEM_ORDER.length : at;
}

/** The cover: generated art, or the voice's avatar for a read, or the sound's
 *  own envelope drawn large — never a blank square. */
function Cover({ sound, className }: { sound: Sound; className?: string }) {
  const [failed, setFailed] = useState(false);
  const voice = useVoice(sound.voice_id);
  const art = sound.artwork ?? voice?.artwork ?? null;
  return (
    <div
      className={cn(
        "bg-muted ring-border text-foreground/55 flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-inset",
        className,
      )}
    >
      {art && !failed ? (
        <img src={art} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <PeakGlyph peaks={sound.peaks} bars={21} className="h-2/5 w-auto" />
      )}
    </div>
  );
}

/** The prompt under the title: clamped to two lines until asked for, with a
 *  copy button, because it is the thing people come back to this page for. */
function PromptLine({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [prompt, open]);
  if (!prompt.trim()) return null;
  return (
    <div className="mt-3 max-w-2xl">
      <div className="flex items-start gap-1">
        <p
          ref={ref}
          className={cn("text-muted-foreground min-w-0 text-sm leading-relaxed", !open && "line-clamp-2")}
        >
          {prompt}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy prompt"
              className="text-muted-foreground -mt-0.5 shrink-0"
              onClick={() => {
                void navigator.clipboard.writeText(prompt).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy prompt"}</TooltipContent>
        </Tooltip>
      </div>
      {(clamped || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mt-0.5 rounded text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {open ? "Show less" : "Show full prompt"}
        </button>
      )}
    </div>
  );
}

/** Lyrics as written: one column, line breaks kept, section tags in brackets
 *  set apart as the small labels they are. */
function Lyrics({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <section aria-labelledby="lyrics">
      <div className="flex items-center justify-between gap-2">
        <h2 id="lyrics" className="font-heading text-lg font-semibold tracking-tight">
          Lyrics
        </h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy lyrics"
              className="text-muted-foreground"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy lyrics"}</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-3 space-y-5">
        {blocks.map((block, i) => (
          <p key={i} className="text-base leading-7">
            {block.split("\n").map((line, j) => {
              const tag = /^\s*\[[^\]]+\]\s*$/.test(line);
              return (
                <span key={j} className={cn("block", tag && "label-caps text-muted-foreground")}>
                  {line}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </section>
  );
}

/** One group of the details card: a heading and its label / value rows. */
function FactGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="label-caps text-muted-foreground">{title}</h3>
      <dl className="mt-1">{children}</dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="border-border/60 flex items-baseline justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words tabular-nums">{value}</dd>
    </div>
  );
}

function ParentLink({ parentId }: { parentId: string }) {
  const { data: parent } = useSound(parentId);
  if (!parent) return null;
  return (
    <Link
      to={`/sounds/${parent.id}`}
      className="text-foreground font-medium underline-offset-4 hover:underline"
    >
      {parent.name}
    </Link>
  );
}

/** A derived sound as a row that opens its own page. */
function VersionRow({ sound }: { sound: Sound }) {
  return (
    <li>
      <Link
        to={`/sounds/${sound.id}`}
        className="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-center gap-3 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2"
      >
        <span
          aria-hidden="true"
          className="bg-muted text-foreground/55 ring-border flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm ring-1 ring-inset"
        >
          <SoundTileArt sound={sound} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{sound.name}</span>
          <span className="readout text-muted-foreground block truncate">
            {sound.edit ? `${sound.edit} · ` : ""}
            {formatRelative(sound.created_at)}
          </span>
        </span>
        <span className="readout text-muted-foreground tabular-nums">{formatClock(sound.duration_s)}</span>
        <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------- page */

/** A split or a studio hand-off in flight. A plain split stays on this page;
 *  the other two end in a story to go to. */
interface Work {
  jobId: string;
  kind: "split" | "split-open" | "open";
}

export function SoundDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: sound, isLoading, isError } = useSound(id ?? null);
  const { data: models } = useModels();
  const { data: projects } = useProjects();
  const { data: settings } = useSettings();
  const { data: children } = useSounds({ parent_id: id ?? "", limit: 50 }, Boolean(id));
  const update = useUpdateSound();
  const artwork = useSoundArtwork();
  const imageReady = useImageStatus().data?.ready ?? false;
  const remove = useDeleteSound();
  const reveal = useRevealSound();
  const can = useCan();
  const separate = useSeparateSound();
  const openInStudio = useStoryFromSound();

  const editorRef = useRef<SoundEditorHandle>(null);
  const stemsRef = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [work, setWork] = useState<Work | null>(null);
  const { job } = useJobStream(work?.jobId ?? null);

  // Separation is only offered when something can actually do it; without a
  // separator installed, "open in the studio" still works, just as one track.
  const sepModel = models?.find((m) => m.task === "sep");
  const sepIds = useMemo(
    () => new Set((models ?? []).filter((m) => m.task === "sep").map((m) => m.id)),
    [models],
  );
  // A sound's children are its stems and its edits. A stem is what a
  // separator wrote; everything else derived from this sound is a version.
  const stems = useMemo(
    () =>
      (children?.items ?? [])
        .filter((s) => sepIds.has(s.model))
        .sort((a, b) => stemRank(a.name) - stemRank(b.name)),
    [children, sepIds],
  );
  const versions = useMemo(
    () => (children?.items ?? []).filter((s) => !sepIds.has(s.model)),
    [children, sepIds],
  );

  // The split or hand-off finishing: go to the studio, or show the stems.
  useEffect(() => {
    if (!work || !job || job.id !== work.jobId) return;
    if (job.status === "done") {
      setWork(null);
      setPickerOpen(false);
      void qc.invalidateQueries({ queryKey: ["sounds"] });
      const storyId = job.result?.story_id;
      if (work.kind !== "split" && storyId) {
        // Clips on lanes with nothing written: the Music Builder's shape, and
        // what the server files it as.
        navigate(`/studio/music/${storyId}`);
        return;
      }
      const n = job.result?.sounds?.length ?? 0;
      toast.success(n ? `Split into ${n} stem${n === 1 ? "" : "s"}` : "Stems ready", {
        action: { label: "Open in Studio", onClick: () => startOpen(true) },
      });
      // Past the next paint, so the section the stems land in exists.
      window.setTimeout(
        () => stemsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        300,
      );
    } else if (job.status === "error" || job.status === "cancelled") {
      setWork(null);
      toast.error(
        job.error ||
          (work.kind === "split" ? "Stem separation failed" : "Could not open this in the studio"),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the job is the trigger
  }, [job, work]);

  /** Put this sound in the studio: whole on one track, or (with `asStems`)
   *  a lane per stem. The server reuses stems that already exist. */
  function startOpen(asStems: boolean, selection: StemSelection | null = null) {
    if (!id) return;
    openInStudio.mutate(
      { soundId: id, separate: asStems, stems: selection },
      { onSuccess: ({ job_id }) => setWork({ jobId: job_id, kind: asStems ? "split-open" : "open" }) },
    );
  }

  function startSplit(selection: StemSelection) {
    if (!sepModel || !id) return;
    separate.mutate(
      { modelId: sepModel.id, sourceSoundId: id, stems: selection },
      { onSuccess: ({ job_id }) => setWork({ jobId: job_id, kind: "split" }) },
    );
  }

  if (!id) return <Navigate to="/library" replace />;
  if (isError) return <Navigate to="/library" replace />;

  if (isLoading || !sound) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
          <Skeleton className="size-36 rounded-md sm:size-48 lg:size-56" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="mt-8 h-56 w-full" />
      </div>
    );
  }

  const model = models?.find((e) => e.id === sound.model);
  const modelName = model?.name ?? sound.model;
  const currentProject = projects?.find((p) => p.id === sound.effective_project_id);
  const isStem = sound.parent_id != null && sepIds.has(sound.model);
  // A derived sound — a stem, a split half, an edit — has already been
  // taken apart as far as it goes, so it only ever opens whole.
  const splittable = Boolean(sepModel) && sound.parent_id == null;
  // Stems are a music idea. A door slam can still be split, but the offer
  // moves into the menu instead of sitting beside Play.
  const splitUpFront = splittable && (model === undefined || model.category === "music");
  const busy = work !== null || separate.isPending || openInStudio.isPending;
  const percent = job && work && job.id === work.jobId ? Math.round(job.progress * 100) : 0;

  const reuse = () => {
    navigate("/chat", {
      state: {
        reuse: {
          model: sound.model,
          prompt: sound.prompt,
          negative_prompt: sound.negative_prompt,
          duration_s: sound.duration_s,
          seed: sound.seed,
          steps: sound.steps,
          cfg: sound.cfg,
        },
      },
    });
  };

  const download = async () => {
    setDownloading(true);
    try {
      const delivered = await downloadSound(sound.file, sound.name, settings?.output_format);
      if (settings?.output_format === "mp3" && delivered === "wav") {
        toast.info("Downloaded as WAV — mp3 needs ffmpeg on the server", {
          description: "Install ffmpeg and it'll transcode automatically next time.",
        });
      }
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const commitName = () => {
    const name = draftName.trim();
    setRenaming(false);
    if (name && name !== sound.name) update.mutate({ id: sound.id, patch: { name } });
  };

  const hasLyrics = Boolean(sound.lyrics?.trim());
  const splitting = work?.kind === "split";
  const hasMain = hasLyrics || stems.length > 0 || versions.length > 0 || splitting;
  const created = new Date(sound.created_at);

  const details = (
    <section aria-labelledby="details" className="bg-card ring-border/70 rounded-xl p-5 ring-1">
      <div className="flex items-center justify-between gap-2">
        <h2 id="details" className="font-heading text-lg font-semibold tracking-tight">
          Details
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(recipeText(sound, modelName))
              .then(() => toast.success("Recipe copied"));
          }}
        >
          <CopyIcon />
          Copy recipe
        </Button>
      </div>
      <div className={cn("mt-4 grid gap-x-8 gap-y-5", !hasMain && "sm:grid-cols-2 lg:grid-cols-3")}>
        <FactGroup title="Made with">
          <Fact label="Model" value={modelName} />
          <Fact label="Seed" value={sound.seed} />
          <Fact label="Steps" value={sound.steps} />
          <Fact label="CFG scale" value={sound.cfg} />
          <Fact label="Negative prompt" value={sound.negative_prompt} />
          {sound.parent_id && (
            <Fact label="Made from" value={<ParentLink parentId={sound.parent_id} />} />
          )}
        </FactGroup>
        <FactGroup title="Audio">
          <Fact label="Length" value={formatDuration(sound.duration_s)} />
          <Fact
            label="Format"
            value={`${formatHz(sound.sample_rate)} ${sound.channels === 2 ? "stereo" : "mono"}`}
          />
          <Fact label="File size" value={formatBytes(sound.size_bytes)} />
        </FactGroup>
        <FactGroup title="Filed">
          <Fact
            label="Created"
            value={created.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          />
          <Fact
            label="Made by"
            value={
              sound.source === "mcp"
                ? (sound.client ?? "an agent")
                : sound.source === "api"
                  ? "the API"
                  : "you, in the app"
            }
          />
          <Fact label="Project" value={currentProject?.name ?? "None"} />
          {model?.license && <Fact label="Licence" value={<LicenseChip license={model.license} />} />}
        </FactGroup>
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl pb-8">
      {/* Hero: cover left, words right and bottom-aligned with it. On a
          phone the cover goes on top and the words run under it. */}
      <header className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-6">
        <Cover sound={sound} className="w-36 sm:w-48 lg:w-56" />
        <div className="min-w-0 flex-1">
          <p className="label-caps text-muted-foreground">
            {kindLabel(sound, model, isStem)}
            {sound.parent_id && (
              <>
                {" of "}
                <ParentLink parentId={sound.parent_id} />
              </>
            )}
          </p>
          <h1 className="font-display mt-1 text-4xl leading-[0.95] font-extrabold tracking-[0.01em] break-words uppercase sm:text-5xl lg:text-6xl">
            {sound.name}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">{modelName}</span>
            <span aria-hidden="true" className="text-muted-foreground">
              •
            </span>
            <span className="text-muted-foreground" title={created.toLocaleString()}>
              {formatRelative(sound.created_at)}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              •
            </span>
            <span className="text-muted-foreground tabular-nums">{formatClock(sound.duration_s)}</span>
            {sound.source === "mcp" && (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  •
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <BotIcon className="size-3.5" aria-hidden="true" />
                      {sound.client ?? "agent"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Generated by an agent over MCP</TooltipContent>
                </Tooltip>
              </>
            )}
          </p>
          <PromptLine prompt={sound.prompt} />
          {sound.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sound.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Actions: Play first and filled; the rest named, in the order they
          are reached for; everything occasional behind the ··· menu. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          size="icon-lg"
          className="size-12 rounded-full"
          aria-label={playing ? "Pause" : `Play ${sound.name}`}
          onClick={() => editorRef.current?.toggle()}
        >
          {playing ? (
            <PauseIcon className="size-5 fill-current" />
          ) : (
            <PlayIcon className="ml-0.5 size-5 fill-current" />
          )}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={sound.favorite ? "Remove from favourites" : "Add to favourites"}
              aria-pressed={sound.favorite}
              onClick={() => update.mutate({ id: sound.id, patch: { favorite: !sound.favorite } })}
            >
              <StarIcon className={cn("size-5", sound.favorite && "fill-signal text-signal")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{sound.favorite ? "Favourited" : "Favourite"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={`Download ${sound.name}`}
              disabled={downloading}
              onClick={() => void download()}
            >
              {downloading ? (
                <Loader2Icon className="size-5 animate-spin" />
              ) : (
                <DownloadIcon className="size-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>

        <span aria-hidden="true" className="bg-border mx-1 hidden h-6 w-px sm:block" />

        <Button variant="outline" size="lg" disabled={busy} onClick={() => startOpen(false)}>
          {work?.kind === "open" ? <Loader2Icon className="animate-spin" /> : <SlidersHorizontalIcon />}
          Open in Studio
        </Button>
        {splitUpFront && (
          <Button variant="outline" size="lg" disabled={busy} onClick={() => setPickerOpen(true)}>
            {work && work.kind !== "open" ? <Loader2Icon className="animate-spin" /> : <ScissorsIcon />}
            {stems.length ? "Split again" : "Split into stems"}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label={`More options for ${sound.name}`}>
              <MoreHorizontalIcon className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={reuse}>
              <RotateCcwIcon />
              Reuse prompt
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/voice/new/clone?from=${sound.id}`)}>
              <MicIcon />
              Make a voice from this
            </DropdownMenuItem>
            {splittable && !splitUpFront && (
              <DropdownMenuItem disabled={busy} onClick={() => setPickerOpen(true)}>
                <ScissorsIcon />
                Split into stems…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setDraftName(sound.name);
                setRenaming(true);
              }}
            >
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderIcon />
                {currentProject ? "Move to another project" : "Add to a project"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                <DropdownMenuItem
                  onClick={() => update.mutate({ id: sound.id, patch: { project_id: null } })}
                >
                  <span className="flex-1">No project</span>
                  {!currentProject && <CheckIcon />}
                </DropdownMenuItem>
                {(projects ?? []).map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => update.mutate({ id: sound.id, patch: { project_id: p.id } })}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.id === sound.effective_project_id && <CheckIcon />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* Offered only when artwork is set up: `ready` is the server's own
                verdict on whether a render could succeed. */}
            {imageReady && (
              <DropdownMenuItem disabled={artwork.isPending} onClick={() => artwork.mutate(sound.id)}>
                <ImageIcon />
                {sound.artwork ? "Redraw cover" : "Draw cover"}
              </DropdownMenuItem>
            )}
            {can.reveal && (
              <DropdownMenuItem onClick={() => reveal.mutate(sound.id)}>
                <FolderOpenIcon />
                Show the file
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The timeline: waveform you select on, plus the tools that act on it.
          Every tool writes a new derived clip (see parent_id) rather than
          overwriting this one. The hero's Play drives this transport. */}
      <section
        aria-label="Timeline"
        className="bg-card ring-border/70 mt-6 rounded-xl p-4 ring-1 sm:p-5"
      >
        <SoundEditor
          key={sound.id}
          ref={editorRef}
          sound={sound}
          onPlayingChange={setPlaying}
          waveHeight={144}
        />
      </section>

      <div className={cn("mt-8 grid gap-8", hasMain && "lg:grid-cols-[minmax(0,1fr)_21rem]")}>
        {hasMain && (
          <div className="min-w-0 space-y-10">
            {(stems.length > 0 || splitting) && (
              <section ref={stemsRef} aria-labelledby="stems" className="scroll-mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 id="stems" className="font-heading text-lg font-semibold tracking-tight">
                      Stems
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {stems.length
                        ? "Play them together, mute any of them, or take them to the studio."
                        : "Pulling the track apart."}
                    </p>
                  </div>
                  {stems.length > 0 && (
                    <Button disabled={busy} onClick={() => startOpen(true)}>
                      {work?.kind === "split-open" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <SlidersHorizontalIcon />
                      )}
                      Open stems in Studio
                    </Button>
                  )}
                </div>
                {splitting && (
                  <div className="bg-muted/40 mt-3 rounded-lg p-3" role="status">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="inline-flex items-center gap-2">
                        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                        Splitting into stems
                      </span>
                      <span className="readout text-muted-foreground tabular-nums">{percent}%</span>
                    </div>
                    <Progress value={percent} className="mt-2 h-1" />
                  </div>
                )}
                {stems.length > 0 && <StemGroup sourceId={sound.id} stems={stems} className="mt-3" />}
              </section>
            )}

            {hasLyrics && <Lyrics text={sound.lyrics!} />}

            {versions.length > 0 && (
              <section aria-labelledby="versions">
                <h2 id="versions" className="font-heading text-lg font-semibold tracking-tight">
                  Versions
                </h2>
                <p className="text-muted-foreground text-sm">
                  Edits made from this sound. The original is never overwritten.
                </p>
                <ul className="mt-2">
                  {versions.map((v) => (
                    <VersionRow key={v.id} sound={v} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">{details}</div>
      </div>

      {sepModel && (
        <StemPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          busy={busy}
          description={`Each stem you keep becomes its own sound under “${sound.name}”. Open them in the studio now, or later from this page.`}
          confirmLabel="Split"
          onConfirm={(selection) => {
            // A plain split shows its progress on the page, where the stems
            // will land, so the dialog gets out of the way.
            setPickerOpen(false);
            startSplit(selection);
          }}
          secondaryLabel="Split and open in Studio"
          onSecondary={(selection) => startOpen(true, selection)}
        />
      )}

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename this sound</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draftName}
            aria-label="Sound name"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={commitName}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this sound?</DialogTitle>
            <DialogDescription>
              &ldquo;{sound.name}&rdquo; and its audio file will be removed from disk. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                remove.mutate(sound.id);
                setConfirmOpen(false);
                navigate("/library");
              }}
            >
              Delete sound
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
