/**
 * Models: find, install, load and unload model weights.
 *
 * One search, one row of filters, one list. The list holds every model Mirli
 * knows about: the ones in your list (installed or not) and the opt-in
 * catalogue models you can add, so there is no second "more models" list with
 * its own search. A row carries the facts that separate one model from
 * another (maker, kind, VRAM, licence, status) and the one action you most
 * likely want; a click opens the rest in the docked details panel
 * (`model-detail-panel.tsx`), where the licence, files, settings and the
 * destructive actions live.
 *
 * Licence is still a headline: a non-commercial download asks you to say so
 * out loud before it starts.
 */

import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BriefcaseIcon, CpuIcon, DownloadIcon, HardDriveIcon, SearchIcon, Trash2Icon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { LicenseChip } from "@/components/license-badge";
import { UnverifiedTag } from "@/components/model-detail-panel";
import {
  EnableAction,
  KIND_LABEL,
  KIND_ORDER,
  ModelMark,
  ModelPrimaryAction,
  isDownloadable,
  ON_DISK,
  modelKind,
  useModelJob,
  type ModelKind,
} from "@/components/model-shared";
import { ModelStatusPill, modelStatusLabel } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobStream } from "@/hooks/use-job-stream";
import { formatBytes, formatMb } from "@/lib/format";
import { useDockId } from "@/lib/dock";
import { useModelDetailStore } from "@/lib/model-detail-store";
import {
  useAudioCppCatalog,
  useHealth,
  useLlmEngineInstall,
  useLlmModelDelete,
  useLlmModelDownload,
  useLlmStatus,
  useModelAction,
  useModels,
  useSetAudioCppEnabled,
  useSettings,
  useUpdateSettings,
  useCan,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { AudioCppCatalogEntry, LlmModelEntry, Model } from "@/lib/api";
import { buildPacks, INTENT_LABEL } from "@/lib/model-packs";

/* Column geometry, shared by every row. Container queries, because the
   details panel and the sidebar both take width from the page: columns drop
   as the list narrows (VRAM, then licence, then status), and at 375px what
   they held folds into the sub-line. */
const COL = {
  vram: "readout text-muted-foreground hidden w-16 shrink-0 text-right @2xl:block",
  license: "hidden w-36 shrink-0 @xl:block",
  status: "hidden w-28 shrink-0 @md:block",
  action: "flex w-24 shrink-0 justify-end",
};

/** One row of the list: a model in your list, or a catalogue model you can add. */
type Row =
  | { type: "model"; id: string; model: Model; entry?: AudioCppCatalogEntry }
  | { type: "catalog"; id: string; entry: AudioCppCatalogEntry };

function rowFacts(r: Row) {
  const m = r.type === "model" ? r.model : r.entry;
  return { name: m.name, vendor: m.vendor, description: m.description, license: m.license, kind: modelKind(m) };
}

/** Loaded first, then what is on disk, then the rest of your list, then the
 *  catalogue models you have not added. */
function rank(r: Row): number {
  if (r.type === "catalog") return 4;
  if (r.model.status === "loaded") return 0;
  if (r.model.status === "downloading") return 1;
  if (ON_DISK.has(r.model.status)) return 2;
  return 3;
}

const PILL =
  "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 [&_svg]:size-3.5";
const PILL_OFF = "border-border text-muted-foreground hover:text-foreground hover:bg-muted";
const PILL_ON = "bg-primary text-primary-foreground border-primary";

function TogglePill({
  pressed,
  onToggle,
  icon,
  label,
  title,
}: {
  pressed: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <button type="button" aria-pressed={pressed} title={title} onClick={onToggle} className={cn(PILL, pressed ? PILL_ON : PILL_OFF)}>
      {icon}
      {label}
    </button>
  );
}

/** The kind switch: one segmented row, only the kinds actually present. */
function KindSwitch({
  value,
  kinds,
  onChange,
}: {
  value: ModelKind | null;
  kinds: ModelKind[];
  onChange: (k: ModelKind | null) => void;
}) {
  const opts: (ModelKind | null)[] = [null, ...kinds];
  return (
    <div role="radiogroup" aria-label="Kind" className="bg-muted inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl p-0.5">
      {opts.map((k) => {
        const on = value === k;
        return (
          <button
            key={k ?? "all"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(k)}
            className={cn(
              "focus-visible:ring-ring/50 h-7 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3",
              on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k ? KIND_LABEL[k] : "All"}
          </button>
        );
      })}
    </div>
  );
}

function ModelRow({ row, selected }: { row: Row; selected: boolean }) {
  const open = useModelDetailStore((s) => s.open);
  const f = rowFacts(row);
  const model = row.type === "model" ? row.model : null;
  const entry = row.entry;
  return (
    <li className="group relative">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-colors",
          selected ? "bg-muted" : "group-hover:bg-muted/50",
        )}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => open(row.id)}
        className="focus-visible:ring-ring absolute inset-0 z-0 outline-none focus-visible:ring-2 focus-visible:ring-inset"
        aria-label={`${f.name} by ${f.vendor}, ${model ? modelStatusLabel(model.status) : "not in your list"}. Show details`}
        aria-current={selected || undefined}
      />
      {model ? <ModelRowBody model={model} entry={entry} /> : <CatalogRowBody entry={entry!} />}
    </li>
  );
}

function RowShell({
  vendor,
  name,
  sub,
  vram,
  license,
  status,
  action,
  below,
}: {
  vendor: string;
  name: React.ReactNode;
  sub: React.ReactNode;
  vram: string;
  license: React.ReactNode;
  status: React.ReactNode;
  action: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <>
      <div className="pointer-events-none relative flex items-center gap-3 px-3 py-2 @sm:px-4">
        <ModelMark vendor={vendor} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">{name}</div>
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">{sub}</div>
        </div>
        <div className={COL.vram}>{vram}</div>
        <div className={COL.license}>{license}</div>
        <div className={COL.status}>{status}</div>
        <div className={cn(COL.action, "pointer-events-auto z-10")}>{action}</div>
      </div>
      {below}
    </>
  );
}

function ModelRowBody({ model, entry }: { model: Model; entry?: AudioCppCatalogEntry }) {
  const { job, downloading, progressPct, busyLabel } = useModelJob(model);
  const vram = isDownloadable(model) ? formatMb(model.vram_estimate_mb) : "Remote";
  return (
    <RowShell
      vendor={model.vendor}
      name={
        <>
          <span className="truncate text-sm font-medium">{model.name}</span>
          {entry && !entry.verified && !entry.always_on && <UnverifiedTag />}
        </>
      }
      sub={
        <>
          <span className="truncate">{model.vendor}</span>
          <span aria-hidden="true">·</span>
          <span>{KIND_LABEL[modelKind(model)]}</span>
          <span className="@2xl:hidden" aria-hidden="true">·</span>
          <span className="readout @2xl:hidden">{vram}</span>
          <ModelStatusPill status={model.status} className="ml-1 @md:hidden" />
        </>
      }
      vram={vram}
      license={<LicenseChip license={model.license} />}
      status={<ModelStatusPill status={model.status} />}
      action={<ModelPrimaryAction model={model} downloading={downloading} />}
      below={
        downloading ? (
          <div className="pointer-events-none relative px-3 pb-2.5 pl-15 @sm:px-4 @sm:pl-16">
            <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
              <span className="truncate">{job?.message ?? busyLabel}</span>
              <span className="readout">{progressPct}%</span>
            </div>
            <Progress value={progressPct} />
          </div>
        ) : (
          // The reason the last download stopped, kept by the server. The row
          // opens the panel, which has the whole card and its actions.
          model.download_failure && (
            <p className="text-danger pointer-events-none relative truncate px-3 pb-2.5 pl-15 text-xs @sm:px-4 @sm:pl-16">
              Last download failed: {model.download_failure.title}
            </p>
          )
        )
      }
    />
  );
}

function CatalogRowBody({ entry }: { entry: AudioCppCatalogEntry }) {
  const { data: catalog } = useAudioCppCatalog();
  const setEnabled = useSetAudioCppEnabled();
  const pending = setEnabled.isPending && setEnabled.variables?.entry.id === entry.id;
  return (
    <RowShell
      vendor={entry.vendor}
      name={
        <>
          <span className="text-muted-foreground truncate text-sm font-medium">{entry.name}</span>
          {!entry.verified && <UnverifiedTag />}
        </>
      }
      sub={
        <>
          <span className="truncate">{entry.vendor}</span>
          <span aria-hidden="true">·</span>
          <span>{KIND_LABEL[modelKind(entry)]}</span>
        </>
      }
      vram=""
      license={<LicenseChip license={entry.license} />}
      status={<span className="text-muted-foreground text-xs">Not in your list</span>}
      action={
        <EnableAction
          entry={entry}
          pending={pending}
          onEnable={() => setEnabled.mutate({ entry, enabled: true, catalog: catalog ?? [] })}
        />
      }
    />
  );
}

export function ModelsPage() {
  const { data: models, isLoading, isError, error } = useModels();
  const { data: catalog } = useAudioCppCatalog();
  const { data: settings } = useSettings();
  const { data: health } = useHealth();
  const can = useCan();
  const selectedId = useDockId("model");

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ModelKind | null>(null);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);
  const vramTotal = health?.vram_total_mb ?? null;

  const rows = useMemo<Row[]>(() => {
    const byId = new Map((catalog ?? []).map((e) => [e.id, e]));
    const out: Row[] = (models ?? []).map((m) => ({ type: "model", id: m.id, model: m, entry: byId.get(m.id) }));
    const listed = new Set(out.map((r) => r.id));
    // Models to add from the catalog only where this server runs models itself.
    for (const e of can.local_models ? (catalog ?? []) : []) {
      if (!listed.has(e.id) && !e.always_on) out.push({ type: "catalog", id: e.id, entry: e });
    }
    return out.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
  }, [models, catalog, can.local_models]);

  const kinds = useMemo(() => {
    const seen = new Set(rows.map((r) => rowFacts(r).kind));
    return KIND_ORDER.filter((k) => seen.has(k));
  }, [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    const f = rowFacts(r);
    if (kind && f.kind !== kind) return false;
    if (q && !`${f.name} ${f.vendor} ${f.description}`.toLowerCase().includes(q)) return false;
    if (commercialOnly && f.license.commercial !== "yes") return false;
    if (installedOnly && !(r.type === "model" && ON_DISK.has(r.model.status))) return false;
    if (fitsOnly && vramTotal != null) {
      if (r.type !== "model") return false;
      if (isDownloadable(r.model) && r.model.vram_estimate_mb > vramTotal) return false;
    }
    return true;
  });
  const filtered = Boolean(q || kind || installedOnly || commercialOnly || fitsOnly);
  const installedCount = rows.filter((r) => r.type === "model" && ON_DISK.has(r.model.status)).length;

  const clear = () => {
    setQuery("");
    setKind(null);
    setInstalledOnly(false);
    setCommercialOnly(false);
    setFitsOnly(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Models</h1>
        <p className="text-muted-foreground text-sm">
          {can.local_models
            ? "The open-weight models that make your sounds. One sits in VRAM at a time; loading another unloads it."
            : "Models that run elsewhere: each render is sent to them, so there is nothing to download."}
        </p>
      </div>

      {can.downloads && !isLoading && !isError && (models?.length ?? 0) > 0 && (
        <ModelPacks models={models!} hfTokenSet={settings?.hf_token_set ?? false} />
      )}

      {isLoading ? (
        <div className="border-border overflow-hidden rounded-xl border">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="m-2 h-12 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState tone="error" title="Could not load models">
          {error instanceof Error ? error.message : "Unknown error"}
        </EmptyState>
      ) : !models?.length ? (
        <EmptyState>
          {can.local_models ? (
            "The backend reported no models."
          ) : can.custom_endpoints ? (
            <>
              No models yet. Add a server you run or a hosted API in{" "}
              <Link to="/settings?s=endpoints" className="underline underline-offset-2">
                Settings → Endpoints
              </Link>
              .
            </>
          ) : (
            "No models are available here yet."
          )}
        </EmptyState>
      ) : (
        <>
          {/* One row: search, the kind switch, then each filter as a pill. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-56 flex-1">
              <SearchIcon
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Label htmlFor="models-search" className="sr-only">
                Search models
              </Label>
              <Input
                id="models-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search names, makers and descriptions"
                className="h-9 pl-8"
              />
            </div>
            {kinds.length > 1 && <KindSwitch value={kind} kinds={kinds} onChange={setKind} />}
            {can.local_models && (
              <TogglePill
                pressed={installedOnly}
                onToggle={() => setInstalledOnly((v) => !v)}
                icon={<HardDriveIcon />}
                label={`Installed · ${installedCount}`}
              />
            )}
            <TogglePill
              pressed={commercialOnly}
              onToggle={() => setCommercialOnly((v) => !v)}
              icon={<BriefcaseIcon />}
              label="Commercial use"
              title="Only models whose licence allows commercial use without conditions."
            />
            {vramTotal != null && can.local_models && (
              <TogglePill
                pressed={fitsOnly}
                onToggle={() => setFitsOnly((v) => !v)}
                icon={<CpuIcon />}
                label="Fits my GPU"
                title={`Estimated VRAM no more than this GPU's ${formatMb(vramTotal)}.`}
              />
            )}
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clear} className="h-8" aria-label="Clear all filters">
                Clear
              </Button>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState>No models match.</EmptyState>
          ) : (
            <div className="border-border bg-card @container overflow-hidden rounded-xl border">
              <ul className="divide-border divide-y">
                {visible.map((row) => (
                  <ModelRow key={row.id} row={row} selected={row.id === selectedId} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* The prompt assistant is a local download. */}
      {can.downloads && <LlmSection />}
    </div>
  );
}

/** One catalog model's install row: not downloaded → Download (with its own
 *  job/progress, same pattern as `ModelListItem`'s row-owned job); downloaded
 *  → either "Active" (already selected in Settings) or a "Use" button that
 *  selects it, plus Delete. */
function LlmModelRow({ spec, active }: { spec: LlmModelEntry; active: boolean }) {
  const qc = useQueryClient();
  const download = useLlmModelDownload();
  const remove = useLlmModelDelete();
  const updateSettings = useUpdateSettings();
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJobStream(jobId);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      setJobId(null);
      void qc.invalidateQueries({ queryKey: ["llm-status"] });
    }
  }, [job, qc]);

  const downloading = Boolean(jobId && job?.status !== "done");
  const progressPct = Math.round((job?.progress ?? 0) * 100);

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 @sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{spec.name}</span>
          {spec.recommended && (
            <span className="text-muted-foreground shrink-0 label-caps">
              Recommended
            </span>
          )}
          {active && (
            <span className="bg-primary/10 text-primary shrink-0 rounded-sm px-1.5 py-0.5 label-caps">
              Active
            </span>
          )}
        </div>
        {downloading ? (
          <div className="mt-1 flex items-center gap-2">
            <Progress value={progressPct} className="h-1.5 max-w-40" />
            <span className="text-muted-foreground text-xs tabular-nums">{progressPct}%</span>
          </div>
        ) : (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {spec.vendor} · {formatBytes(spec.size_bytes)} · {spec.description}
          </p>
        )}
      </div>
      <div className="shrink-0">
        {downloading ? null : spec.installed ? (
          <div className="flex items-center gap-1.5">
            {!active && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateSettings.mutate({ llm_model: spec.id })}
                disabled={updateSettings.isPending}
              >
                Use
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove.mutate(spec.id)}
              disabled={remove.isPending}
              aria-label={`Delete ${spec.name}`}
            >
              <Trash2Icon />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => download.mutate(spec.id, { onSuccess: (ref) => setJobId(ref.job_id) })}
            disabled={download.isPending}
            aria-label={`Download ${spec.name}`}
          >
            <DownloadIcon />
            Download
          </Button>
        )}
      </div>
    </li>
  );
}

/** The local prompt assistant: an optional llama-server engine plus one of a
 *  few small chat models, used to rewrite terse prompts in the Generate
 *  composer. Mirrors `AudioCppCatalogSection`'s install-in-place shape —
 *  same job/progress plumbing, a different resource being installed. */
function LlmSection() {
  const { data: status, isLoading, isError } = useLlmStatus();
  const qc = useQueryClient();
  const install = useLlmEngineInstall();
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJobStream(jobId);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      setJobId(null);
      void qc.invalidateQueries({ queryKey: ["llm-status"] });
    }
  }, [job, qc]);

  if (isLoading || isError || !status) return null;

  const engineDownloading = Boolean(jobId && job?.status !== "done");
  const progressPct = Math.round((job?.progress ?? 0) * 100);

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-medium">Prompt assistant</h2>
        <p className="text-muted-foreground text-xs">
          A small local model that rewrites terse prompts into ones the sound models
          respond to. Off by default — turn it on and pick a mode in Settings.
        </p>
      </div>
      <div className="border-border bg-card @container overflow-hidden rounded-xl border">
        <ul className="divide-border divide-y">
          <li className="flex items-center gap-3 px-3 py-2.5 @sm:px-4">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">Engine</span>
              {engineDownloading ? (
                <div className="mt-1 flex items-center gap-2">
                  <Progress value={progressPct} className="h-1.5 max-w-40" />
                  <span className="text-muted-foreground text-xs tabular-nums">{progressPct}%</span>
                </div>
              ) : (
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {status.engine.installed
                    ? `llama.cpp ${status.engine.version} (${status.engine.backend})`
                    : "Runs the model — install this first."}
                </p>
              )}
            </div>
            {!engineDownloading && !status.engine.installed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => install.mutate(undefined, { onSuccess: (ref) => setJobId(ref.job_id) })}
                disabled={install.isPending}
              >
                <DownloadIcon />
                Install
              </Button>
            )}
          </li>
          {status.catalog.map((spec) => (
            <LlmModelRow key={spec.id} spec={spec} active={status.model?.id === spec.id} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Intent packs: one Install for a sensible model per kind at a chosen point
 * on the speed/quality line. See `model-packs.ts` for how the picks are made.
 */
function ModelPacks({ models, hfTokenSet }: { models: Model[]; hfTokenSet: boolean }) {
  const { data: health } = useHealth();
  const { data: catalog } = useAudioCppCatalog();
  const { download } = useModelAction();
  const packs = useMemo(
    () => buildPacks(models, health, catalog, hfTokenSet),
    [models, health, catalog, hfTokenSet],
  );
  const [open, setOpen] = useState(() => models.every((m) => !ON_DISK.has(m.status)));
  if (packs.length === 0) return null;

  return (
    <section aria-labelledby="packs" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="packs" className="font-heading text-lg font-semibold tracking-tight">
            Packs
          </h2>
          <p className="text-muted-foreground text-sm">
            One model each for sound effects, music and voice, picked for this machine. Commercial-use
            licences only; the list below has the rest.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide packs" : "Show packs"}
        </Button>
      </div>
      {open && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {packs.map((pack) => {
            const allHere = pack.toInstall.length === 0;
            return (
              <div
                key={pack.tier}
                className="bg-card ring-border/70 flex flex-col gap-3 rounded-xl p-4 ring-1"
              >
                <div>
                  <p className="text-sm font-semibold">{pack.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{pack.blurb}</p>
                </div>
                <ul className="space-y-1.5 text-xs">
                  {pack.picks.map((pick) => (
                    <li key={pick.intent} className="flex items-baseline justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">{INTENT_LABEL[pick.intent]}</span>
                      <span className="min-w-0 truncate text-right" title={pick.model.name}>
                        {pick.model.name}
                        <span className="text-muted-foreground ml-1 tabular-nums">
                          {formatMb(pick.model.vram_estimate_mb)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto space-y-1.5">
                  <p className="text-muted-foreground text-xs">
                    {allHere
                      ? "Everything in this pack is already on this machine."
                      : `About ${pack.downloadGb} GB to download.${pack.overBudget ? " Some of it is more than your GPU holds." : ""}`}
                  </p>
                  <Button
                    size="sm"
                    className="w-full"
                    variant={pack.tier === "balanced" ? "default" : "outline"}
                    disabled={allHere || download.isPending}
                    onClick={() => {
                      for (const m of pack.toInstall) download.mutate(m.id);
                    }}
                  >
                    <DownloadIcon />
                    {allHere
                      ? "Installed"
                      : `Install ${pack.toInstall.length} model${pack.toInstall.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
