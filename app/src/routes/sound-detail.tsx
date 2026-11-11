/**
 * `/sounds/:id` — one clip's detail page.
 *
 * Everything here already exists on the `Sound` object; this page's whole
 * job is to give it a URL and put the generation provenance (prompt, seed,
 * steps, cfg, model) somewhere it can actually be read, instead of only
 * living in a truncated `title` attribute on the library card.
 */

import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  BotIcon,
  DownloadIcon,
  ImageIcon,
  Loader2Icon,
  SlidersHorizontalIcon,
  FolderIcon,
  RotateCcwIcon,
  StarIcon,
  Trash2Icon,
  CopyIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SoundEditor } from "@/components/sound-editor";
import { StemGroup } from "@/components/stem-group";
import { downloadSound, formatBytes, formatDuration, formatHz, formatRelative } from "@/lib/format";
import {
  useDeleteSound,
  useImageStatus,
  useModels,
  useSoundArtwork,
  useStoryFromSound,
  useProjects,
  useSettings,
  useSound,
  useUpdateSound,
} from "@/lib/queries";
import { api } from "@/lib/api";
import { recipeText } from "@/lib/recipe";
import { cn } from "@/lib/utils";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="border-border/60 flex items-center justify-between gap-4 border-b py-2.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ParentLink({ parentId }: { parentId: string }) {
  const { data: parent } = useSound(parentId);
  if (!parent) return null;
  return (
    <Link
      to={`/sounds/${parent.id}`}
      className="hover:text-foreground underline-offset-4 hover:underline"
    >
      {parent.name}
    </Link>
  );
}

export function SoundDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: sound, isLoading, isError } = useSound(id ?? null);
  const { data: models } = useModels();
  const { data: projects } = useProjects();
  const { data: settings } = useSettings();
  const update = useUpdateSound();
  const artwork = useSoundArtwork();
  const imageReady = useImageStatus().data?.ready ?? false;
  const remove = useDeleteSound();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [opening, setOpening] = useState(false);
  const openInStudio = useStoryFromSound();
  // Separation is only offered when something can actually do it; without a
  // separator installed, "open in the studio" still works, just as one track.
  const sepModel = models?.find((m) => m.task === "sep");
  // A derived sound — a stem, a split half, an edit — has already been
  // taken apart as far as it goes, so it only ever opens whole.
  const splittable = Boolean(sepModel) && sound?.parent_id == null;

  if (!id) return <Navigate to="/library" replace />;
  if (isError) return <Navigate to="/library" replace />;

  if (isLoading || !sound) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const modelName = models?.find((e) => e.id === sound.model)?.name ?? sound.model;
  const currentProject = projects?.find((p) => p.id === sound.effective_project_id);
  const isOverride = sound.project_id != null;

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

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {sound.artwork && (
            <img
              src={sound.artwork}
              alt=""
              className="border-border size-16 shrink-0 rounded-lg border object-cover"
            />
          )}
          <div className="min-w-0">
            <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">
              {sound.name}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{sound.prompt}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={sound.favorite ? "Remove from favourites" : "Add to favourites"}
                aria-pressed={sound.favorite}
                onClick={() =>
                  update.mutate({ id: sound.id, patch: { favorite: !sound.favorite } })
                }
              >
                <StarIcon
                  className={cn(
                    sound.favorite && "fill-foreground text-foreground",
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Favourite</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Reuse this prompt in Generate" onClick={reuse}>
                <RotateCcwIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reuse prompt</TooltipContent>
          </Tooltip>

          {/* Shown only when artwork is configured and this is a track worth
              covering. `ready` is the server's own verdict on whether a render
              could succeed, so the button never appears just to fail. */}
          {imageReady && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={sound.artwork ? "Redraw cover art" : "Draw cover art"}
                  disabled={artwork.isPending}
                  onClick={() => artwork.mutate(sound.id)}
                >
                  {artwork.isPending ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <ImageIcon />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sound.artwork ? "Redraw cover" : "Draw cover"}</TooltipContent>
            </Tooltip>
          )}

          <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={currentProject ? `In project ${currentProject.name}. Move sound.` : "Move to a project"}
                aria-pressed={Boolean(currentProject)}
                title={currentProject ? `In ${currentProject.name}` : "Move to a project"}
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${sound.name}`}
                disabled={downloading}
                onClick={async () => {
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
                }}
              >
                <DownloadIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          {/* Open in the studio, the same action the library card offers —
              this is the page you land on when you want to *do* something with
              a sound, so it has to be here too. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  splittable
                    ? `Split ${sound.name} into tracks and open in the studio`
                    : `Open ${sound.name} in the studio`
                }
                disabled={opening}
                onClick={() => {
                  setOpening(true);
                  openInStudio.mutate(
                    { soundId: sound.id, separate: splittable },
                    {
                      onSuccess: ({ job_id }) => {
                        const stop = api.subscribeJob(job_id, (job) => {
                          if (job.status === "done") {
                            stop();
                            setOpening(false);
                            const storyId = job.result?.story_id;
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
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {splittable ? "Split into tracks and open in the studio" : "Open in the studio"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${sound.name}`}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Badge variant="secondary">{modelName}</Badge>
        {sound.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
        {sound.source === "mcp" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 font-normal">
                <BotIcon className="size-3" aria-hidden="true" />
                {sound.client ?? "agent"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Generated by an agent over MCP</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* The editor: waveform you select on, plus the tools that act on it.
          Every tool writes a new derived clip (see parent_id) rather than
          overwriting this one. */}
      <Card className="mt-6 p-4">
        <SoundEditor key={sound.id} sound={sound} />
      </Card>

      {/* Renders nothing once loaded if this sound has no stems, so it's
          safe to drop in unconditionally rather than pre-checking. */}
      <StemGroup sourceId={sound.id} className="mt-4" />

      <section aria-labelledby="provenance" className="mt-8">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="provenance" className="font-heading text-lg font-semibold tracking-tight">
              How it was made
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              Everything used to make this clip. Reuse it as a starting point from the button
              above, or copy it as text for a note or an issue.
            </p>
          </div>
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
        <dl className="bg-card ring-border/70 mt-4 rounded-2xl p-5 ring-1">
          <Fact label="Model" value={modelName} />
          <Fact label="Prompt" value={sound.prompt} />
          <Fact label="Negative prompt" value={sound.negative_prompt} />
          <Fact label="Seed" value={sound.seed} />
          <Fact label="Steps" value={sound.steps} />
          <Fact label="CFG scale" value={sound.cfg} />
          <Fact label="Duration" value={formatDuration(sound.duration_s)} />
          <Fact
            label="Sample rate"
            value={`${formatHz(sound.sample_rate)} ${sound.channels === 2 ? "stereo" : "mono"}`}
          />
          <Fact label="File size" value={formatBytes(sound.size_bytes)} />
          <Fact label="Created" value={formatRelative(sound.created_at)} />
          <Fact
            label="Source"
            value={sound.source === "mcp" ? (sound.client ?? "agent") : sound.source}
          />
          {sound.parent_id && (
            <Fact label="Derived from" value={<ParentLink parentId={sound.parent_id} />} />
          )}
        </dl>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this sound?</DialogTitle>
            <DialogDescription>
              &ldquo;{sound.name}&rdquo; and its audio file will be removed from disk. This cannot be undone.
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
