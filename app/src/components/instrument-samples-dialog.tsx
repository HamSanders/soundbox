/**
 * Download or remove the sampled instruments the dry render can use.
 *
 * VSCO 2 Community Edition, eight sustained patches of 25-75 MB each. They are
 * never part of the install: a row's Download is the only thing that fetches
 * one, and until it is installed the Instrument menu does not offer it.
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useJobStream } from "@/hooks/use-job-stream";
import type { InstrumentInfo } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import {
  qk,
  useInstrumentDelete,
  useInstrumentDownload,
  useInstruments,
} from "@/lib/queries";
import { forgetInstrument } from "@/lib/sampler";

export function InstrumentSamplesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: instruments, error } = useInstruments();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sampled instruments</DialogTitle>
          <DialogDescription>
            Real orchestral recordings for the dry take, from VSCO 2 Community
            Edition by Versilian Studios (CC0, free for any use). The cover pass
            keeps the notes better from a real instrument than from the synth.
            Each one is a separate download.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-destructive text-sm">{error.message}</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {(instruments ?? []).map((instrument) => (
              <InstrumentRow key={instrument.id} instrument={instrument} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InstrumentRow({ instrument }: { instrument: InstrumentInfo }) {
  const qc = useQueryClient();
  const download = useInstrumentDownload();
  const remove = useInstrumentDelete();
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, active } = useJobStream(jobId);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      if (job.status === "error") toast.error(job.error ?? `${instrument.label} did not download`);
      if (job.status === "done") toast.success(`${instrument.label} samples installed`);
      forgetInstrument(instrument.id);
      setJobId(null);
      void qc.invalidateQueries({ queryKey: qk.instruments });
    }
  }, [job, instrument.id, instrument.label, qc]);

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{instrument.label}</div>
        <div className="text-muted-foreground text-xs capitalize">
          {instrument.family} · {formatBytes(instrument.size_bytes)}
        </div>
        {active && (
          <div className="mt-1 flex items-center gap-2">
            <Progress value={Math.round((job?.progress ?? 0) * 100)} className="h-1.5 max-w-40" />
            <span className="text-muted-foreground text-[0.7rem] tabular-nums">
              {job?.message ?? "Starting…"}
            </span>
          </div>
        )}
      </div>
      {instrument.installed ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={remove.isPending}
          onClick={() => {
            forgetInstrument(instrument.id);
            remove.mutate(instrument.id);
          }}
          aria-label={`Remove ${instrument.label}`}
        >
          <Trash2Icon />
          Remove
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={active || download.isPending}
          onClick={() =>
            download.mutate(instrument.id, { onSuccess: (ref) => setJobId(ref.job_id) })
          }
        >
          <DownloadIcon />
          {active ? "Downloading…" : "Download"}
        </Button>
      )}
    </li>
  );
}
