/**
 * Models — install, load and unload model weights.
 *
 * There are only ever a handful of models, so the page is a list you scan in
 * one screenful rather than a stack of cards you scroll: each row carries the
 * facts that separate one model from another (licence, sample rate, max
 * duration) plus the one action you are most likely to want. Everything else —
 * the full description, the licence note, VRAM, the repo, the destructive
 * action — lives in a per-model dialog opened from the row.
 *
 * Licence is still the headline, not a footnote: a model you cannot ship is a
 * different product from one you can, and the download button for a
 * non-commercial model makes you say so out loud before it starts.
 *
 * Dialog design note: the confirmation steps are *views* of the same Radix
 * dialog rather than nested dialogs. Stacking a second modal on top of an open
 * one is where focus traps and scroll locks go wrong; swapping the content of
 * one layer keeps a single trap, lets Cancel return to the detail view, and
 * lets a row's inline Download open the confirmation directly.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  DownloadIcon,
  EjectIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Trash2Icon,
  TriangleAlertIcon,
  ZapIcon,
  ActivityIcon,
  WrenchIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchInput } from "@/components/search-input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Switch } from "@/components/ui/switch";

import { ModelStatusPill, modelStatusLabel } from "@/components/model-status";
import { LicenseChip, LicensePanel } from "@/components/license-badge";
import { FailureCard } from "@/components/failure-card";
import { Notice } from "@/components/notice";
import { useJobStream } from "@/hooks/use-job-stream";
import { formatBytes, formatHz, formatMb } from "@/lib/format";
import {
  useHealth,
  useAudioCppCatalog,
  useLlmEngineInstall,
  useLlmModelDelete,
  useLlmModelDownload,
  useLlmStatus,
  useModelAction,
  useModels,
  useSetAudioCppEnabled,
  useSettings,
  useUpdateSettings,
} from "@/lib/queries";
import { repoFile } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";
import type { AudioCppCatalogEntry, Job, LlmModelEntry, Model, ModelSelfTest } from "@/lib/api";
import { api } from "@/lib/api";
import { buildPacks, INTENT_LABEL } from "@/lib/model-packs";

/* Column geometry, shared by the header strip and every row so the list reads
   as a table without being one.
 *
 * These are *container* queries, not viewport ones: the sidebar collapses, so
 * the space a row actually has bears little relation to the window width.
 * Columns drop in priority order as the list narrows — VRAM first (secondary),
 * then licence, then the two discriminating specs; name, status and the one
 * action survive to 375px, where the specs fold into the sub-line instead. */
const COL = {
  license: "hidden w-44 shrink-0 @xl:block",
  rate: "hidden w-16 shrink-0 text-right tabular-nums @md:block",
  max: "hidden w-14 shrink-0 text-right tabular-nums @md:block",
  vram: "hidden w-16 shrink-0 text-right tabular-nums @3xl:block",
  status: "hidden w-28 shrink-0 @sm:block",
  action: "flex shrink-0 justify-end @sm:w-28",
};

const CATEGORY_ORDER: Model["category"][] = ["sfx", "music", "voice", "utility"];

/** Statuses whose weights are on this machine, whatever else is missing. */
const ON_DISK = new Set<Model["status"]>(["installed", "loaded", "needs_runtime"]);

const CATEGORY_LABEL: Record<Model["category"], string> = {
  sfx: "SFX",
  music: "Music",
  voice: "Voice",
  utility: "Utility",
};

/** Case-insensitive substring match against a model/catalog entry's name,
 *  vendor and description — the three fields someone would actually
 *  remember and type part of. */
function matchesQuery(
  entry: { name: string; vendor: string; description: string },
  query: string,
): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.vendor.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q)
  );
}

/** Search box + category tabs, shared by both sections of the page. Category
 *  tabs only list categories actually present in `items`, plus "All". */
function SearchFilterBar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  items,
  placeholder,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  category: Model["category"] | "all";
  onCategoryChange: (c: Model["category"] | "all") => void;
  /** `status` is only on real model rows; the catalog section has none and
   *  gets tabs without counts. */
  items: { category: Model["category"]; status?: Model["status"] }[];
  placeholder: string;
}) {
  const present = useMemo(() => {
    const seen = new Set(items.map((i) => i.category));
    return CATEGORY_ORDER.filter((c) => seen.has(c));
  }, [items]);
  /** "2/5": on this machine out of listed. A tab that says how much of its
   *  category is actually here answers the first question before the click. */
  const counts = useMemo(() => {
    const out = new Map<Model["category"], { here: number; total: number }>();
    for (const i of items) {
      const c = out.get(i.category) ?? { here: 0, total: 0 };
      c.total++;
      if (i.status && ON_DISK.has(i.status)) c.here++;
      out.set(i.category, c);
    }
    return out;
  }, [items]);

  return (
    <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center">
      <SearchInput value={query} onChange={onQueryChange} placeholder={placeholder} />
      {present.length > 1 && (
        <Tabs value={category} onValueChange={(v) => onCategoryChange(v as Model["category"] | "all")}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {present.map((c) => (
              <TabsTrigger key={c} value={c}>
                {CATEGORY_LABEL[c]}
                {items.some((i) => i.status) && (
                  <span className="text-muted-foreground ml-1 text-[10px] tabular-nums">
                    {counts.get(c)?.here ?? 0}/{counts.get(c)?.total ?? 0}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Which of the three confirmations/panels the single dialog is showing. */
type DialogView = "detail" | "confirm-download" | "confirm-delete";

function ModelListItem({
  model,
  hfTokenSet,
}: {
  model: Model;
  hfTokenSet: boolean;
}) {
  const qc = useQueryClient();
  const { download, load, unload, remove } = useModelAction();
  const [jobId, setJobId] = useState<string | null>(null);
  const [view, setView] = useState<DialogView | null>(null);
  /** The last self-test, kept while the dialog is open. */
  const [selfTest, setSelfTest] = useState<ModelSelfTest | null>(null);
  const [testing, setTesting] = useState(false);
  const runSelfTest = async () => {
    setTesting(true);
    setSelfTest(null);
    try {
      setSelfTest(await api.selfTestModel(model.id));
      void qc.invalidateQueries({ queryKey: ["models"] });
    } catch (exc) {
      setSelfTest({
        model: model.id,
        ok: false,
        device: "unknown",
        elapsed_s: 0,
        rendered_s: null,
        error: exc instanceof Error ? exc.message : "The self-test could not start.",
      });
    } finally {
      setTesting(false);
    }
  };

  // `model.active_job_id` comes from the server's job queue, not client
  // memory, so a fresh page load or a remount after a tab switch (which
  // unmounts this row and drops `jobId`) still finds the running job and
  // resumes watching it — instead of showing "Not installed" with the
  // download button re-enabled while a job is quietly still in flight.
  useEffect(() => {
    if (model.active_job_id && model.active_job_id !== jobId) {
      setJobId(model.active_job_id);
    }
  }, [model.active_job_id, jobId]);

  // The job lives on the row, not in the dialog, so a download started from the
  // row keeps reporting progress after the dialog closes (or if it never opened).
  const { job } = useJobStream(jobId);
  const downloading =
    model.status === "downloading" || Boolean(jobId && job?.status === "running");

  // A failed download used to leave nothing behind once its job was let
  // go: the row refetched, read "Not installed" again, and the reason was
  // gone. The last failure stays on the row until the next attempt or a
  // dismiss.
  const [lastFailure, setLastFailure] = useState<Job | null>(null);
  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      if (job.status === "error") setLastFailure(job);
      setJobId(null);
      void qc.invalidateQueries({ queryKey: ["models"] });
    }
  }, [job, qc]);

  const nonCommercial = model.license.commercial === "no";
  /** Gate guidance stays up until the weights are actually here. A set token
   *  does not mean the licence was accepted — that combination still 403s,
   *  so showing the steps only when the token is missing hides the more
   *  common failure. */
  const needsGateSetup =
    model.status === "not_installed" || model.status === "error";

  /** Installing dependencies is a distinct, slow step that used to be labelled
   *  "Downloading weights" — confusing when no weights are moving yet. */
  const busyLabel =
    job?.phase === "installing" ? "Installing dependencies" : "Downloading weights";

  const startDownload = () => {
    setView(null);
    setLastFailure(null);
    download.mutate(model.id, { onSuccess: (ref) => setJobId(ref.job_id) });
  };

  /** Non-commercial weights always take the acknowledgement detour. */
  const requestDownload = () =>
    nonCommercial ? setView("confirm-download") : startDownload();

  // A custom endpoint runs on somebody else's server: there are no weights to
  // fetch, load or delete here, so none of those actions apply. It is edited
  // from Settings → Endpoints instead.
  const isEndpoint = model.provider === "endpoint";
  const canDownload = !isEndpoint && model.status === "not_installed";
  const canLoad = !isEndpoint && (model.status === "installed" || model.status === "error");
  const canUnload = !isEndpoint && model.status === "loaded";
  const canDelete =
    !isEndpoint && model.status !== "not_installed" && model.status !== "downloading";

  const specs = {
    rate: isEndpoint ? "—" : formatHz(model.sample_rate),
    max: `${model.max_duration_s}s`,
    vram: isEndpoint ? "Remote" : formatMb(model.vram_estimate_mb),
  };

  /** The one action worth having on the row itself. */
  const incomplete = model.status === "incomplete";
  const inlineAction = downloading ? null : incomplete ? (
    <Button
      size="sm"
      variant="outline"
      className="w-full"
      onClick={requestDownload}
      disabled={download.isPending}
      aria-label={`Repair ${model.name}: download what is missing`}
    >
      <WrenchIcon />
      Repair
    </Button>
  ) : canDownload ? (
    <Button
      size="sm"
      variant="outline"
      className="w-full"
      onClick={requestDownload}
      disabled={download.isPending}
      aria-label={`Download ${model.name}`}
    >
      <DownloadIcon />
      Download
    </Button>
  ) : canLoad ? (
    <Button
      size="sm"
      variant="outline"
      className="w-full"
      onClick={() => load.mutate(model.id)}
      disabled={load.isPending}
      aria-label={`Load ${model.name}`}
    >
      <ZapIcon />
      Load
    </Button>
  ) : canUnload ? (
    <Button
      size="sm"
      variant="outline"
      className="w-full"
      onClick={() => unload.mutate(model.id)}
      disabled={unload.isPending}
      aria-label={`Unload ${model.name}`}
    >
      <EjectIcon />
      Unload
    </Button>
  ) : null;

  const progressPct = Math.round((job?.progress ?? 0) * 100);

  return (
    <li className="group relative">
      {/* The tint lives on this wrapper rather than the <li>: list items pick up
          a background rule from the base layer that wins over a utility here. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-colors",
          model.status === "loaded" ? "bg-primary/5" : "group-hover:bg-muted/40",
        )}
        aria-hidden="true"
      />
      {/* The whole row is one button. Everything else is either inert
          (pointer-events-none) or explicitly raised above it. */}
      <button
        type="button"
        onClick={() => setView("detail")}
        className="focus-visible:ring-ring absolute inset-0 z-0 outline-none focus-visible:ring-2 focus-visible:ring-inset"
        aria-label={`${model.name} by ${model.vendor} — ${modelStatusLabel(
          model.status,
        )}. Show details`}
      />

      <div className="pointer-events-none relative flex items-center gap-3 px-3 py-2.5 @sm:px-4">
        {model.status === "loaded" && (
          <span
            className="bg-primary absolute inset-y-0 left-0 w-0.5"
            aria-hidden="true"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{model.name}</div>
          {/* Wraps rather than truncates: at 375px the folded-in specs would
              otherwise squeeze the vendor down to an initial. */}
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
            <span className="truncate">{model.vendor}</span>
            {/* Whatever the row is too narrow to column out folds in here. */}
            <span className="@md:hidden" aria-hidden="true">
              ·
            </span>
            <span className="tabular-nums @md:hidden">{specs.rate}</span>
            <span className="@md:hidden" aria-hidden="true">
              ·
            </span>
            <span className="tabular-nums @md:hidden">{specs.max}</span>
            <ModelStatusPill status={model.status} className="ml-1 @sm:hidden" />
          </div>
        </div>

        <div className={COL.license}>
          <LicenseChip license={model.license} />
        </div>
        <div className={cn(COL.rate, "text-muted-foreground text-xs")}>
          {specs.rate}
        </div>
        <div className={cn(COL.max, "text-muted-foreground text-xs")}>{specs.max}</div>
        <div className={cn(COL.vram, "text-muted-foreground/70 text-xs")}>
          {specs.vram}
        </div>
        <div className={COL.status}>
          <ModelStatusPill status={model.status} />
        </div>

        <div className={cn(COL.action, "pointer-events-auto z-10")}>
          {inlineAction}
        </div>
      </div>

      {downloading && (
        <div className="pointer-events-none relative px-3 pb-2.5 @sm:px-4">
          <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
            <span className="truncate">{job?.message ?? busyLabel}</span>
            <span className="font-mono tabular-nums">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
        </div>
      )}

      <Dialog open={view !== null} onOpenChange={(open) => setView(open ? "detail" : null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {view === "confirm-download" ? (
            <>
              <DialogHeader>
                <DialogTitle>This model forbids commercial use</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      {model.name} is released under{" "}
                      <span className="text-foreground font-medium">
                        {model.license.name}
                      </span>
                      , which does not permit commercial use. Audio you generate with
                      it must not be shipped in a product, a client project, or
                      anything monetised.
                    </p>
                    {model.license.note && <p>{model.license.note}</p>}
                    {model.license.url && (
                      <p>
                        <a
                          href={model.license.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-foreground underline underline-offset-4"
                        >
                          Read the full licence
                        </a>
                      </p>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView("detail")}>
                  Cancel
                </Button>
                <Button onClick={startDownload}>I understand — download anyway</Button>
              </DialogFooter>
            </>
          ) : view === "confirm-delete" ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete cached weights?</DialogTitle>
                <DialogDescription>
                  The weights for {model.name} will be removed from disk. You can
                  download them again later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView("detail")}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    remove.mutate(model.id);
                    setView(null);
                  }}
                >
                  Delete weights
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{model.name}</DialogTitle>
                <DialogDescription asChild>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{model.vendor}</span>
                    <ModelStatusPill status={model.status} />
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {model.description}
                </p>

                <LicensePanel license={model.license} />

                {model.gated && needsGateSetup && (
                  <Notice>
                    <KeyRoundIcon
                      className="mt-0.5 size-3.5 shrink-0 text-warn"
                      aria-hidden="true"
                    />
                    <div className="text-foreground/90 space-y-1.5 leading-relaxed">
                      <p>
                        This is a gated repository. Downloading needs{" "}
                        <em>both</em> steps — a token alone is not enough, and
                        missing either one fails with a 403.
                      </p>
                      <ol className="ml-4 list-decimal space-y-1">
                        <li>
                          Accept the licence on{" "}
                          <a
                            href={`https://huggingface.co/${model.hf_repo}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-medium underline underline-offset-4"
                          >
                            {model.hf_repo}
                          </a>{" "}
                          with the same Hugging Face account.
                        </li>
                        <li>
                          {hfTokenSet ? (
                            <>
                              Access token added in{" "}
                              <Link
                                to="/settings"
                                className="font-medium underline underline-offset-4"
                                onClick={() => setView(null)}
                              >
                                Settings
                              </Link>{" "}
                              — done.
                            </>
                          ) : (
                            <>
                              Add a read access token in{" "}
                              <Link
                                to="/settings"
                                className="font-medium underline underline-offset-4"
                                onClick={() => setView(null)}
                              >
                                Settings
                              </Link>
                              .
                            </>
                          )}
                        </li>
                      </ol>
                    </div>
                  </Notice>
                )}

                {lastFailure && !downloading && (
                  <FailureCard
                    compact
                    failure={lastFailure.failure}
                    error={lastFailure.error ?? "The download failed."}
                    context={`Downloading ${model.name}`}
                    onRetry={startDownload}
                    retryLabel="Download again"
                    onDismiss={() => setLastFailure(null)}
                  />
                )}

                {model.status === "error" && model.error && !lastFailure && (
                  <FailureCard
                    compact
                    failure={model.failure}
                    error={model.error}
                    context={model.name}
                  />
                )}

                {model.status === "needs_runtime" &&
                  (model.auto_installable !== false ? (
                    <Notice>
                      <TriangleAlertIcon
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <p className="leading-relaxed">
                        The weights are downloaded, but {model.name}&rsquo;s runtime
                        isn&rsquo;t installed yet
                        {model.extras.length > 0 && (
                          <>
                            {" "}
                            (needs{" "}
                            <code className="text-foreground/80">
                              {model.extras.join(", ")}
                            </code>
                            )
                          </>
                        )}
                        . Click Install below and Soundbox will handle it.
                      </p>
                    </Notice>
                  ) : (
                    <Notice>
                      <TriangleAlertIcon
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="space-y-2 leading-relaxed">
                        <p>
                          {model.manual_install_reason ??
                            `${model.name} needs its own virtualenv, so Soundbox can't install it automatically.`}
                        </p>
                        {model.install_command && (
                          <code className="block overflow-x-auto rounded bg-muted/60 px-2 py-1 text-[11px] text-foreground/80">
                            {model.install_command}
                          </code>
                        )}
                        <p>
                          See{" "}
                          <a
                            href={repoFile("docs/INSTALL.md")}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-foreground underline underline-offset-2"
                          >
                            the setup guide
                          </a>
                          .
                        </p>
                      </div>
                    </Notice>
                  ))}

                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Spec label="VRAM estimate" value={specs.vram} />
                  <Spec label="Max duration" value={specs.max} />
                  <Spec label="Sample rate" value={specs.rate} />
                  <Spec label="Channels" value={model.channels === 2 ? "Stereo" : "Mono"} />
                </dl>

                {downloading && (
                  <div className="space-y-1.5">
                    <div className="text-muted-foreground flex items-center justify-between text-xs">
                      <span>{job?.message ?? busyLabel}</span>
                      <span className="font-mono tabular-nums">{progressPct}%</span>
                    </div>
                    <Progress value={progressPct} />
                  </div>
                )}

                {isEndpoint ? (
                  <p className="text-muted-foreground text-xs">
                    Edit or remove this endpoint in Settings → Endpoints.
                  </p>
                ) : (
                  <a
                    href={`https://huggingface.co/${model.hf_repo}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded font-mono text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {model.hf_repo}
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  </a>
                )}
              </div>

              {incomplete && (
                <Notice>
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p className="leading-relaxed">
                    The download did not finish, so these weights can&rsquo;t be used. Repair
                    downloads what is missing; what is already on disk is kept.
                  </p>
                </Notice>
              )}

              {selfTest && (
                <p
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs leading-relaxed ring-1 ring-inset",
                    selfTest.ok ? "bg-ok/10 ring-ok/30" : "bg-danger/10 ring-danger/30",
                  )}
                  role="status"
                >
                  {selfTest.ok
                    ? `Rendered ${selfTest.rendered_s?.toFixed(1) ?? "?"}s of audio in ${selfTest.elapsed_s.toFixed(1)}s on ${selfTest.device}, including any load. Nothing was saved.`
                    : `The self-test failed on ${selfTest.device}: ${selfTest.error ?? "unknown error"}`}
                </p>
              )}

              {/* Actions come first in the DOM so the dialog's initial focus
                  lands on the useful action rather than on "Delete weights";
                  order-first puts the destructive one back on the left. */}
              <DialogFooter className="sm:justify-end">
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {incomplete && (
                    <Button onClick={requestDownload} disabled={downloading || download.isPending}>
                      <WrenchIcon />
                      Repair
                    </Button>
                  )}
                  {(canLoad || canUnload) && (model.task === "gen" || model.task === "tts") && (
                    <Button variant="outline" onClick={() => void runSelfTest()} disabled={testing}>
                      <ActivityIcon className={cn(testing && "animate-pulse")} />
                      {testing ? "Testing…" : "Self-test"}
                    </Button>
                  )}
                  {canDownload && (
                    <Button onClick={requestDownload} disabled={downloading || download.isPending}>
                      <DownloadIcon />
                      Download
                    </Button>
                  )}
                  {canLoad && (
                    <Button onClick={() => load.mutate(model.id)} disabled={load.isPending}>
                      <ZapIcon />
                      Load
                    </Button>
                  )}
                  {canUnload && (
                    <Button
                      variant="outline"
                      onClick={() => unload.mutate(model.id)}
                      disabled={unload.isPending}
                    >
                      <EjectIcon />
                      Unload
                    </Button>
                  )}
                </div>
                {canDelete && (
                  <div className="flex sm:order-first sm:mr-auto">
                    <Button
                      variant="destructive"
                      onClick={() => setView("confirm-delete")}
                      disabled={remove.isPending}
                    >
                      <Trash2Icon />
                      Delete weights
                    </Button>
                  </div>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** One row of the "Enable more models" section — a catalog entry the user
 *  can flip on or off, distinct from ModelListItem because there's nothing
 *  to download/load yet: enabling it is what makes it a real model row. */
function AudioCppCatalogRow({
  entry,
  catalog,
}: {
  entry: AudioCppCatalogEntry;
  catalog: AudioCppCatalogEntry[];
}) {
  const setEnabled = useSetAudioCppEnabled();
  const pendingId = setEnabled.isPending ? setEnabled.variables?.entry.id : null;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 @sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{entry.name}</span>
          {!entry.verified && (
            <span
              className="label-caps bg-warn/10 text-warn ring-warn/35 shrink-0 rounded-sm px-1.5 py-0.5 ring-1 ring-inset"
              title="Nobody has generated a sound with this model through Soundbox yet — defaults and even the licence may be unconfirmed."
            >
              Unverified
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {entry.vendor} · {entry.description}
        </p>
      </div>
      <div className="shrink-0">
        <LicenseChip license={entry.license} className="hidden @sm:inline-flex" />
      </div>
      {/* Weights on this machine enable the model in every profile, so there
          is nothing for the toggle to toggle — showing one that cannot turn
          anything off is worse than saying why. Deleting the weights (from
          the model's own row above) is what takes it back out of the list. */}
      {entry.on_disk ? (
        <span
          className="text-muted-foreground shrink-0 text-xs"
          title="Its weights are already on this machine, so it is available in every profile. Delete the weights to remove it."
        >
          On this device
        </span>
      ) : (
        <Switch
          checked={entry.enabled}
          disabled={pendingId === entry.id}
          onCheckedChange={(checked) =>
            setEnabled.mutate({ entry, enabled: checked, catalog })
          }
          aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
        />
      )}
    </li>
  );
}

/** Models the audio.cpp adapter could run but that aren't registered by
 *  default — each is a GGUF someone confirmed exists, run through the same
 *  audio.cpp binary as the always-on Stable Audio 3 SFX model above, but
 *  nobody has generated a sound with most of them yet. Flipping one on adds
 *  it to the list above immediately, no restart — flipping it off unloads it
 *  first if it happened to be the resident model. See docs/AUDIOCPP.md. */
function AudioCppCatalogSection() {
  const { data: catalog, isLoading, isError } = useAudioCppCatalog();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Model["category"] | "all">("all");

  const extras = catalog?.filter((e) => !e.always_on) ?? [];
  const filtered = extras.filter(
    (e) => (category === "all" || e.category === category) && matchesQuery(e, query),
  );

  if (isLoading || isError || extras.length === 0) return null;

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-medium">Enable more models</h2>
        <p className="text-muted-foreground text-xs">
          Additional models available through the audio.cpp runtime. Most are
          unverified — enable one to try it, same download-then-load flow as above.
        </p>
      </div>
      <SearchFilterBar
        query={query}
        onQueryChange={setQuery}
        category={category}
        onCategoryChange={setCategory}
        items={extras}
        placeholder="Search more models…"
      />
      {filtered.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm">No models match.</p>
      ) : (
        <div className="border-border bg-card @container overflow-hidden rounded-xl border">
          <ul className="divide-border divide-y">
            {filtered.map((entry) => (
              <AudioCppCatalogRow key={entry.id} entry={entry} catalog={catalog ?? []} />
            ))}
          </ul>
        </div>
      )}
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

export function ModelsPage() {
  const { data: models, isLoading, isError, error } = useModels();
  const { data: settings } = useSettings();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Model["category"] | "all">("all");

  const filtered = (models ?? []).filter(
    (m) => (category === "all" || m.category === category) && matchesQuery(m, query),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Models</h1>
        <p className="text-muted-foreground text-sm">
          One model is resident in VRAM at a time. Loading a new one unloads the old.
        </p>
      </div>

      {!isLoading && !isError && (models?.length ?? 0) > 0 && (
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
        <EmptyState>The backend reported no models.</EmptyState>
      ) : (
        <>
          <SearchFilterBar
            query={query}
            onQueryChange={setQuery}
            category={category}
            onCategoryChange={setCategory}
            items={models}
            placeholder="Search models…"
          />
          {filtered.length === 0 ? (
            <EmptyState>No models match.</EmptyState>
          ) : (
            <div className="border-border bg-card @container overflow-hidden rounded-xl border">
              <div
                className="text-muted-foreground border-border hidden items-center gap-3 border-b px-3 py-1.5 label-caps @sm:flex @sm:px-4"
                aria-hidden="true"
              >
                <div className="min-w-0 flex-1">Model</div>
                <div className={COL.license}>Licence</div>
                <div className={COL.rate}>Rate</div>
                <div className={COL.max}>Max</div>
                <div className={COL.vram}>VRAM</div>
                <div className={COL.status}>Status</div>
                <div className={COL.action} />
              </div>

              <ul className="divide-border divide-y">
                {filtered.map((model) => (
                  <ModelListItem
                    key={model.id}
                    model={model}
                    hfTokenSet={settings?.hf_token_set ?? false}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <AudioCppCatalogSection />
      <LlmSection />
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
