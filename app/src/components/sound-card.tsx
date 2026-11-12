/** One saved sound: rename, play, tag, favourite, download, reuse, delete. */

import { useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AudioLinesIcon,
  BotIcon,
  DownloadIcon,
  ExpandIcon,
  RepeatIcon,
  FolderIcon,
  FolderOpenIcon,
  Maximize2Icon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ScrollTextIcon,
  SendIcon,
  RotateCcwIcon,
  ScissorsIcon,
  SlidersHorizontalIcon,
  StarIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StemPickerDialog } from "@/components/stem-picker";
import { useVoice } from "@/components/voice-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PeakGlyph } from "@/components/peak-glyph";
import { WaveformPlayer } from "@/components/waveform-player";
import { downloadSound, formatBytes, formatRelative } from "@/lib/format";
import {
  useStories,
  useDeleteSound,
  useModels,
  useProjects,
  useRevealSound,
  useSeparateSound,
  useStoryFromSound,
  useSettings,
  useUpdateSound,
} from "@/lib/queries";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/lib/player-store";
import { instrumentIcon } from "@/lib/instrument-icons";
import { recipeLine } from "@/lib/recipe";
import { cn } from "@/lib/utils";
import type { EditKind, Sound } from "@/lib/api";

interface SoundCardProps {
  sound: Sound;
  /** Display name of the model, if known. Falls back to the raw id. */
  modelName?: string;
  onReuse?: (sound: Sound) => void;
  /**
   * Quiet table-style row instead of a card: no border, no shadow, a divider
   * and a hover highlight. Used inside a Generate turn, where the prompt is
   * already stated by the turn itself and a stack of cards reads as noise.
   * The Library keeps the card, which is why this is a prop rather than a
   * change to the default.
   */
  dense?: boolean;
  /** Offer "Extend" / "Cover" on this sound. The surface that has a
   *  composer to put the edit into (the Music studio) passes this; the menu
   *  only shows each entry when some generation model can run it. */
  onEdit?: (kind: EditKind, sound: Sound) => void;
  className?: string;
  style?: CSSProperties;
}

/** How recent a sound has to be, when its row first mounts, to count as one
 *  that has just arrived rather than one the page is merely listing. */
const FRESH_MS = 20_000;

export function SoundCard({
  sound,
  modelName,
  onReuse,
  dense,
  onEdit,
  className,
  style,
}: SoundCardProps) {
  const [editing, setEditing] = useState(false);
  // Made in the last few seconds: this row is a generation landing, and gets
  // the arrival treatment once (see `.sb-arrive` in index.css). Read at mount
  // only, so a re-render later never replays it.
  const [fresh] = useState(() => Date.now() - Date.parse(sound.created_at) < FRESH_MS);
  const [draftName, setDraftName] = useState(sound.name);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const update = useUpdateSound();
  const remove = useDeleteSound();
  const reveal = useRevealSound();
  const { data: settings } = useSettings();
  const [downloading, setDownloading] = useState(false);
  const { data: projects } = useProjects();
  const { data: models } = useModels();
  const separate = useSeparateSound();
  const openInStudio = useStoryFromSound();
  const { data: stories } = useStories(20);
  /** Drop this sound onto a story's timeline, after whatever is already
   *  there, and say where it went. */
  const addToStory = (storyId: string, title: string) => {
    api
      .createSegment(storyId, { sound_id: sound.id, text: "" })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["stories"] });
        void qc.invalidateQueries({ queryKey: ["story", storyId] });
        const story = stories?.find((st) => st.id === storyId);
        toast.success(`Added to “${title}”`, {
          action: story
            ? { label: "Open", onClick: () => navigate(`/studio/${story.builder}/${storyId}`) }
            : undefined,
        });
      })
      .catch((exc: unknown) => {
        toast.error(exc instanceof Error ? exc.message : `Could not add it to “${title}”`);
      });
  };
  const playSound = usePlayerStore((s) => s.play);
  const setNowPlaying = usePlayerStore((s) => s.setSound);
  const [opening, setOpening] = useState(false);
  const navigate = useNavigate();
  const [separating, setSeparating] = useState(false);
  /** Which split the picker is open for: the plain one, or the one that opens
   *  the result in the studio. Both ask the same two questions. */
  const [stemPicker, setStemPicker] = useState<"library" | "studio" | null>(null);
  const qc = useQueryClient();
  // First available stem-separation model, if any — sep models aren't
  // model-per-sound configurable from here, so "split into stems" always
  // uses whichever one the catalog offers.
  const sepModel = models?.find((e) => e.task === "sep");
  // A derived sound — a stem, a split half, an edit — has already been
  // taken apart as far as it goes, so it only ever opens whole.
  const splittable = Boolean(sepModel) && sound.parent_id == null;
  const canExtend = Boolean(onEdit) && Boolean(models?.some((m) => m.task === "gen" && m.supports.extend));
  const canCover = Boolean(onEdit) && Boolean(models?.some((m) => m.task === "gen" && m.supports.cover));
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const currentProject = projects?.find((p) => p.id === sound.effective_project_id);
  // An override (sound.project_id set directly) reads the same as an
  // inherited filing — "what project is this in" — but only the override
  // can be cleared back to "unfiled" rather than falling back to the
  // session's project, so the two states get worded differently below.
  const isOverride = sound.project_id != null;

  const commitName = () => {
    const name = draftName.trim();
    setEditing(false);
    if (!name || name === sound.name) {
      setDraftName(sound.name);
      return;
    }
    update.mutate({ id: sound.id, patch: { name } });
  };

  /** Play this sound in the fixed bottom player — a click on the title or
   *  the cover tile means "play it and keep it on screen", not "play it
   *  inline here and lose it the moment I scroll away". The row's own
   *  compact waveform still has its own local play button for a quick
   *  in-place preview. */
  const playInBar = () => {
    playSound(sound.id);
    setNowPlaying(sound);
  };

  // The fixed bottom player is a list-view idiom — "play it and keep it on
  // screen while I browse elsewhere". On the Generate/Console chat pages
  // (`dense`), the sound is already on screen as part of the conversation,
  // so title/cover stay inert there; the row's own inline waveform still has
  // its own play button for that case.
  const nameControl = dense ? (
    <span className="max-w-full truncate text-sm font-medium">{sound.name}</span>
  ) : (
    <button
      type="button"
      onClick={playInBar}
      className="focus-visible:ring-ring/50 max-w-full rounded text-left outline-none focus-visible:ring-3"
      aria-label={`Play ${sound.name}`}
    >
      <span className="hover:text-primary truncate text-sm font-medium underline-offset-4 hover:underline">
        {sound.name}
      </span>
    </button>
  );

  const renameDialog = (
    <Dialog
      open={editing}
      onOpenChange={(open) => {
        if (open) setDraftName(sound.name);
        setEditing(open);
      }}
    >
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
  );

  const confirmDialog = (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this sound?</DialogTitle>
          <DialogDescription>
            &ldquo;{sound.name}&rdquo; and its audio file will be removed from disk. This
            cannot be undone.
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
            }}
          >
            Delete sound
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /**
   * The split, wherever it was asked for.
   *
   * One dialog for both entry points because the questions are identical and
   * only the destination differs: the Library's split leaves the stems in the
   * library, "open in studio" lays the same stems out on lanes.
   */
  const stemDialog = sepModel && (
    <StemPickerDialog
      open={stemPicker !== null}
      onOpenChange={(o) => !o && setStemPicker(null)}
      busy={separating || opening}
      confirmLabel={stemPicker === "studio" ? "Split and open" : "Split"}
      description={
        stemPicker === "studio"
          ? `“${sound.name}” opens on a timeline with a lane per stem you keep.`
          : `Each stem you keep becomes its own sound in the library, under “${sound.name}”.`
      }
      onConfirm={(stems) => {
        if (stemPicker === "studio") {
          setOpening(true);
          openInStudio.mutate(
            { soundId: sound.id, separate: true, stems },
            {
              onSuccess: ({ job_id }) => {
                const stop = api.subscribeJob(job_id, (job) => {
                  if (job.status === "done") {
                    stop();
                    setOpening(false);
                    setStemPicker(null);
                    void qc.invalidateQueries({ queryKey: ["sounds"] });
                    const storyId = job.result?.story_id as string | undefined;
                    // Stems on lanes with nothing written: the Music Builder's
                    // shape, and what the server files it as.
                    if (storyId) navigate(`/studio/music/${storyId}`);
                  } else if (job.status === "error" || job.status === "cancelled") {
                    stop();
                    setOpening(false);
                    toast.error(job.error || "Could not open this in the studio");
                  }
                });
              },
              onError: () => setOpening(false),
            },
          );
          return;
        }
        setSeparating(true);
        separate.mutate(
          { modelId: sepModel.id, sourceSoundId: sound.id, stems },
          {
            onSuccess: ({ job_id }) => {
              const stop = api.subscribeJob(job_id, (job) => {
                if (job.status === "done") {
                  stop();
                  setSeparating(false);
                  setStemPicker(null);
                  void qc.invalidateQueries({ queryKey: ["sounds"] });
                  const n = (job.result?.sounds as string[] | undefined)?.length ?? 0;
                  toast.success(n ? `Split into ${n} stem${n === 1 ? "" : "s"}` : "Stems ready");
                } else if (job.status === "error" || job.status === "cancelled") {
                  stop();
                  setSeparating(false);
                  toast.error(job.error || "Stem separation failed");
                }
              });
            },
            onError: () => setSeparating(false),
          },
        );
      }}
    />
  );

  const stats = (
    <span className="readout flex items-center gap-2">
      {sound.seed !== null && sound.seed !== undefined && (
        <span title="Seed">seed {sound.seed}</span>
      )}
      <span>{formatBytes(sound.size_bytes)}</span>
      <span>{formatRelative(sound.created_at)}</span>
    </span>
  );

  /** Who asked for this — only worth a badge for MCP, since that's the case
   *  a human wouldn't otherwise be able to tell from looking at the sound. */
  const sourceBadge =
    sound.source === "mcp" ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 font-normal">
            <BotIcon className="size-3" aria-hidden="true" />
            {sound.client ?? "agent"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Generated by an agent over MCP</TooltipContent>
      </Tooltip>
    ) : null;

  /* ---------------------------------------------------------------- row */
  /* One row: a generated cover tile, name/model/tags, the waveform, and a
   *  compact action rail. Shared by the dense (Generate-turn) rendering and
   *  the Library's own row below it — the only difference between the two
   *  is the outer wrapper, a plain divider versus a `Card`. */
  const row = (
    <>
        {/* The square where album art goes. Three cases, best first: real
            generated cover art if this track has any; the instrument's own
            icon if this is a stem, which is a fact we know without generating
            anything; and otherwise the gradient tile that reads as "no art"
            rather than imitating one. In list view, clicking it plays the
            sound in the fixed bottom player, same as the title next to it
            (see the `dense` note on `nameControl` above). */}
        {dense ? (
          <div
            aria-hidden="true"
            className="order-1 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-foreground/55 ring-1 ring-inset ring-border"
          >
            <SoundTileArt sound={sound} />
          </div>
        ) : (
          <button
            type="button"
            onClick={playInBar}
            aria-label={`Play ${sound.name}`}
            className="focus-visible:ring-ring/50 order-1 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-foreground/55 ring-1 ring-inset ring-border outline-none focus-visible:ring-3"
          >
            <SoundTileArt sound={sound} />
          </button>
        )}

        <div className="order-2 min-w-0 flex-1 basis-full sm:basis-48">
          {nameControl}
          {/* The recipe line: the model and the settings that made this, so a
              row can be told from its neighbour that was the same prompt with
              another seed. Tags follow, as before. */}
          <p
            className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs"
            title={recipeLine(sound, modelName)}
          >
            <UserRoundIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{recipeLine(sound, modelName)}</span>
            {sound.tags.length > 0 && (
              <>
                <span aria-hidden="true">|</span>
                <span className="truncate">{sound.tags.join(", ")}</span>
              </>
            )}
          </p>
          {sourceBadge && <div className="mt-1">{sourceBadge}</div>}
        </div>

        <WaveformPlayer
          sound={sound}
          compact
          className="order-4 min-w-0 basis-full sm:order-3 sm:flex-[2] sm:basis-0"
        />

        <div className="order-3 ml-auto flex shrink-0 items-center gap-1 sm:order-4 sm:ml-0">
          <span className="text-muted-foreground hidden text-xs lg:inline-flex">{stats}</span>

          {onReuse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reuse this prompt in Generate"
                  onClick={() => onReuse(sound)}
                >
                  <RotateCcwIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reuse prompt</TooltipContent>
            </Tooltip>
          )}

          <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  currentProject
                    ? `In project ${currentProject.name}. Move sound.`
                    : "Add to a project"
                }
                aria-pressed={Boolean(currentProject)}
                title={currentProject ? `In ${currentProject.name}` : "Add to a project"}
              >
                <FolderIcon className={cn(currentProject && "text-foreground")} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1.5">
              <p className="text-foreground mb-2 px-1.5 text-xs font-semibold tracking-tight">
                Project
              </p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                <li>
                  <button
                    type="button"
                    aria-current={!currentProject}
                    onClick={() => {
                      update.mutate({ id: sound.id, patch: { project_id: null } });
                      setProjectMenuOpen(false);
                    }}
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring/50 w-full rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                      !currentProject && "bg-muted font-medium",
                    )}
                  >
                    No project
                  </button>
                </li>
                {(projects ?? []).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-current={p.id === sound.effective_project_id}
                      onClick={() => {
                        update.mutate({ id: sound.id, patch: { project_id: p.id } });
                        setProjectMenuOpen(false);
                      }}
                      className={cn(
                        "hover:bg-muted focus-visible:ring-ring/50 w-full rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                        p.id === sound.effective_project_id && "bg-muted font-medium",
                      )}
                    >
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!isOverride && currentProject && (
                <p className="text-muted-foreground mt-1.5 px-1.5 text-xs leading-relaxed">
                  Inherited from its session. Moving it here sets a direct override.
                </p>
              )}
            </PopoverContent>
          </Popover>

          {/* Everything less frequent — open, favourite, studio, split,
              delete — folds behind one kebab instead of five more icons
              fighting the waveform for width. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${sound.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link to={`/sounds/${sound.id}`}>
                  <Maximize2Icon />
                  Open details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDraftName(sound.name);
                  setEditing(true);
                }}
              >
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              {canExtend && (
                <DropdownMenuItem onClick={() => onEdit!("extend", sound)}>
                  <ExpandIcon />
                  Extend this track
                </DropdownMenuItem>
              )}
              {canCover && (
                <DropdownMenuItem onClick={() => onEdit!("cover", sound)}>
                  <RepeatIcon />
                  Cover in a new style
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => update.mutate({ id: sound.id, patch: { favorite: !sound.favorite } })}
              >
                <StarIcon className={cn(sound.favorite && "fill-foreground text-foreground")} />
                {sound.favorite ? "Remove from favourites" : "Add to favourites"}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={downloading}
                onClick={async () => {
                  setDownloading(true);
                  try {
                    const delivered = await downloadSound(
                      sound.file,
                      sound.name,
                      settings?.output_format,
                    );
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
                }}
              >
                <DownloadIcon />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => reveal.mutate(sound.id)}>
                <FolderOpenIcon />
                Open in Finder
              </DropdownMenuItem>
              {/* Where a sound goes next. Three destinations, one verb, so the
                  menu does not grow a row per place a sound could land. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SendIcon />
                  Send to
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {(stories ?? []).length > 0 && (
                    <>
                      {(stories ?? []).slice(0, 6).map((story) => (
                        <DropdownMenuItem
                          key={story.id}
                          onClick={() => addToStory(story.id, story.title)}
                        >
                          <ScrollTextIcon />
                          <span className="truncate">Add to “{story.title}”</span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    disabled={opening}
                    onClick={() => {
                      // Splitting is a choice — which stems, and what happens to
                      // the rest — so it gets asked. Opening something whole has
                      // nothing to ask about and just goes.
                      if (splittable) {
                        setStemPicker("studio");
                        return;
                      }
                      setOpening(true);
                      openInStudio.mutate(
                        { soundId: sound.id, separate: splittable },
                        {
                          onSuccess: ({ job_id }) => {
                            const stop = api.subscribeJob(job_id, (job) => {
                              if (job.status === "done") {
                                stop();
                                setOpening(false);
                                void qc.invalidateQueries({ queryKey: ["sounds"] });
                                const storyId = job.result?.story_id as string | undefined;
                                // Stems on lanes with nothing written: the Music Builder's
                        // shape, and what the server files it as.
                        if (storyId) navigate(`/studio/music/${storyId}`);
                              } else if (job.status === "error" || job.status === "cancelled") {
                                stop();
                                setOpening(false);
                                toast.error(job.error || "Could not open this in the studio");
                              }
                            });
                          },
                          onError: () => setOpening(false),
                        },
                      );
                    }}
                  >
                    <SlidersHorizontalIcon />
                    {splittable ? "Split into tracks and open in studio…" : "Open in the studio"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/voice/lab?from=${sound.id}`)}>
                    <MicIcon />
                    Make a voice from this
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {sepModel && (
                <DropdownMenuItem disabled={separating} onClick={() => setStemPicker("library")}>
                  <ScissorsIcon />
                  Split into stems…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
    </>
  );

  if (dense) {
    return (
      <div
        className={cn(
          "border-border/60 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-2 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40",
          fresh && "sb-arrive",
          className,
        )}
        style={style}
      >
        {row}
        {renameDialog}
        {confirmDialog}
        {stemDialog}
      </div>
    );
  }

  /* ------------------------------------------------------------------ row (Library) */
  return (
    <Card
      className={cn(
        "flex-row flex-wrap items-center gap-x-4 gap-y-2 rounded-lg p-2.5 transition-[background-color,box-shadow] duration-(--duration-fast) hover:bg-muted/30 hover:ring-border-strong/40",
        fresh && "sb-arrive",
        className,
      )}
      style={style}
    >
      {row}
      {renameDialog}
      {confirmDialog}
      {stemDialog}
    </Card>
  );
}

/**
 * What goes inside a sound's 44px tile.
 *
 * Split out because the dense and card layouts wrap it in different elements
 * (a div and a play button) and duplicating the three-way choice between them
 * is how the two drift apart.
 *
 * The stem case leans on `instrumentIcon`'s `matched` flag rather than on
 * "the name ends in brackets": non-destructive edits also produce names like
 * "Kick (trim)", and giving those a random instrument icon would be worse than
 * giving them none.
 */
function SoundTileArt({ sound }: { sound: Sound }) {
  const [failed, setFailed] = useState(false);
  const stem = instrumentIcon(stemSuffix(sound.name) ?? "");
  // A spoken sound has no cover of its own, but the voice that read it may
  // have an avatar — one shared query, so a page of rows costs one fetch.
  // The voice may since have been deleted, in which case this finds nothing
  // and the row falls through to the icon like any other art-less sound.
  // Unconditionally, not folded into the `??` chain below: short-circuiting
  // past it would make the hook conditional on the sound having its own cover.
  const voice = useVoice(sound.voice_id);
  const art = sound.artwork ?? voice?.artwork ?? null;

  if (art && !failed) {
    return (
      <img
        src={art}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    );
  }
  if (stem.matched) {
    const { Icon } = stem;
    return <Icon className="text-foreground/70 size-5" aria-hidden="true" />;
  }
  if (sound.peaks?.length) return <PeakGlyph peaks={sound.peaks} />;
  return <AudioLinesIcon className="text-foreground/70 size-5" aria-hidden="true" />;
}

/** The "(vocals)" out of "Cold Corner (vocals)", or null. */
function stemSuffix(name: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(name);
  return m ? m[1]! : null;
}
