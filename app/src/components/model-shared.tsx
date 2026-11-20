/**
 * What the Models page's rows and its docked details panel share: the kind a
 * model is filed under, its mark, its download job, and the one action worth
 * having on the row.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, EjectIcon, PlusIcon, WrenchIcon, ZapIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useJobStream } from "@/hooks/use-job-stream";
import type { AudioCppCatalogEntry, Job, Model } from "@/lib/api";
import { useModelDetailStore } from "@/lib/model-detail-store";
import { useModelAction } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type ModelKind = "sfx" | "music" | "speech" | "voice-change" | "separation" | "other";

export const KIND_ORDER: ModelKind[] = ["sfx", "music", "speech", "voice-change", "separation", "other"];

export const KIND_LABEL: Record<ModelKind, string> = {
  sfx: "SFX",
  music: "Music",
  speech: "Speech",
  "voice-change": "Voice change",
  separation: "Separation",
  other: "Other",
};

/** A model's kind, from what it does (`task`) before what it is filed as. A
 *  catalogue entry has no task, so its category stands in. */
export function modelKind(m: { category: Model["category"]; task?: Model["task"] }): ModelKind {
  if (m.task === "sep") return "separation";
  if (m.task === "vc") return "voice-change";
  if (m.task === "tts") return "speech";
  switch (m.category) {
    case "sfx":
      return "sfx";
    case "music":
      return "music";
    case "voice":
      return "speech";
    case "utility":
      return "separation";
  }
  return "other";
}

/** Statuses whose weights are on this machine, whatever else is missing. */
export const ON_DISK = new Set<Model["status"]>(["installed", "loaded", "needs_runtime", "incomplete"]);

/**
 * The maker's initials on a tile. Not a logo: Mirli shows no vendor marks
 * (see the note at the top of `models-disclaimer.tsx`), because a mark reads
 * as the vendor's involvement and none of the makers publish their logos
 * under terms that cover use in someone else's app.
 */
export function ModelMark({ vendor, className }: { vendor: string; className?: string }) {
  const words = vendor
    .replace(/\(.*?\)/g, "")
    .split(/[\s/&,.-]+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w));
  const initials =
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? vendor).slice(0, 2);
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground ring-border flex size-9 shrink-0 items-center justify-center rounded-lg font-display text-base leading-none font-extrabold tracking-[0.02em] uppercase ring-1 ring-inset",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/**
 * The model's download job: picks up a job the server already has running
 * (`active_job_id`, so a reload resumes watching it), streams its progress,
 * and on its end refetches the list and keeps a failure for the panel.
 */
export function useModelJob(model: Model): { job: Job | null; downloading: boolean; progressPct: number; busyLabel: string } {
  const qc = useQueryClient();
  const jobId = useModelDetailStore((s) => s.jobs[model.id] ?? null);
  const setJob = useModelDetailStore((s) => s.setJob);
  const setFailure = useModelDetailStore((s) => s.setFailure);

  useEffect(() => {
    if (model.active_job_id && model.active_job_id !== jobId) setJob(model.id, model.active_job_id);
  }, [model.active_job_id, model.id, jobId, setJob]);

  const { job } = useJobStream(jobId);
  useEffect(() => {
    if (!job || job.id !== jobId) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      if (job.status === "error") setFailure(model.id, job);
      setJob(model.id, null);
      void qc.invalidateQueries({ queryKey: ["models"] });
    }
  }, [job, jobId, model.id, qc, setJob, setFailure]);

  const downloading = model.status === "downloading" || Boolean(jobId && job?.status === "running");
  return {
    job,
    downloading,
    progressPct: Math.round((job?.progress ?? 0) * 100),
    /** Installing dependencies is its own slow step, not "downloading". */
    busyLabel: job?.phase === "installing" ? "Installing dependencies" : "Downloading weights",
  };
}

/** Start or request a download. Non-commercial weights always take the
 *  acknowledgement detour, which lives in the details panel. */
export function useRequestDownload(model: Model) {
  const { download } = useModelAction();
  const open = useModelDetailStore((s) => s.open);
  const setJob = useModelDetailStore((s) => s.setJob);
  const setFailure = useModelDetailStore((s) => s.setFailure);
  const start = () => {
    setFailure(model.id, null);
    download.mutate(model.id, { onSuccess: (ref) => setJob(model.id, ref.job_id) });
  };
  const request = () => (model.license.commercial === "no" ? open(model.id, "download") : start());
  return { start, request, pending: download.isPending };
}

/** Which actions apply. A custom endpoint runs on somebody else's server:
 *  nothing to fetch, load or delete here. */
export function modelCan(model: Model) {
  const isEndpoint = model.provider === "endpoint";
  return {
    isEndpoint,
    download: !isEndpoint && model.status === "not_installed",
    repair: !isEndpoint && model.status === "incomplete",
    load: !isEndpoint && (model.status === "installed" || model.status === "error"),
    unload: !isEndpoint && model.status === "loaded",
    remove: !isEndpoint && model.status !== "not_installed" && model.status !== "downloading",
  };
}

/** The one action worth having on the row: Repair, Download, Load or Unload. */
export function ModelPrimaryAction({
  model,
  downloading,
  size = "sm",
  className,
}: {
  model: Model;
  downloading: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const { load, unload } = useModelAction();
  const dl = useRequestDownload(model);
  const can = modelCan(model);
  if (downloading) return null;
  if (can.repair)
    return (
      <Button size={size} variant="outline" className={className} onClick={dl.request} disabled={dl.pending} aria-label={`Repair ${model.name}: download what is missing`}>
        <WrenchIcon />
        Repair
      </Button>
    );
  if (can.download)
    return (
      <Button size={size} variant="outline" className={className} onClick={dl.request} disabled={dl.pending} aria-label={`Download ${model.name}`}>
        <DownloadIcon />
        Download
      </Button>
    );
  if (can.load)
    return (
      <Button size={size} className={className} onClick={() => load.mutate(model.id)} disabled={load.isPending} aria-label={`Load ${model.name}`}>
        <ZapIcon />
        Load
      </Button>
    );
  if (can.unload)
    return (
      <Button size={size} variant="outline" className={className} onClick={() => unload.mutate(model.id)} disabled={unload.isPending} aria-label={`Unload ${model.name}`}>
        <EjectIcon />
        Unload
      </Button>
    );
  return null;
}

/** "Add" for a catalogue model that is not in the list yet. */
export function EnableAction({
  entry,
  onEnable,
  pending,
  className,
}: {
  entry: AudioCppCatalogEntry;
  onEnable: () => void;
  pending: boolean;
  className?: string;
}) {
  return (
    <Button size="sm" variant="outline" className={className} onClick={onEnable} disabled={pending} aria-label={`Add ${entry.name} to your models`}>
      <PlusIcon />
      Add
    </Button>
  );
}
