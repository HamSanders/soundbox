/**
 * A model's details as a docked artifact panel, the model twin of
 * `SoundDetailPanel`: a third panel of the shell, so the Models list stays
 * live beside it and another row swaps what it shows. On a narrow window it
 * covers the page instead.
 *
 * It holds everything the row has no room for: the description, the licence
 * and its source, gated-repo steps, failures, specs, the controls the model
 * accepts, the repo, the self-test, and the destructive actions. The two
 * confirmations (non-commercial download, delete weights) are one dialog
 * opened from here, so a row's Download can open the panel straight onto it.
 *
 * Closes on ×, on Escape, and when the route changes.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MinusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { usePanelWidth } from "@/hooks/use-panel-width";
import { FailureCard } from "@/components/failure-card";
import { LicenseChip, LicensePanel } from "@/components/license-badge";
import {
  EnableAction,
  KIND_LABEL,
  ModelMark,
  ModelPrimaryAction,
  modelCan,
  modelKind,
  useModelJob,
  useRequestDownload,
} from "@/components/model-shared";
import { ModelStatusPill } from "@/components/model-status";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { AudioCppCatalogEntry, Model, ModelSelfTest } from "@/lib/api";
import { formatHz, formatMb } from "@/lib/format";
import { repoFile } from "@/lib/marketing-links";
import { useModelDetailStore } from "@/lib/model-detail-store";
import {
  useAudioCppCatalog,
  useCan,
  useModelAction,
  useModels,
  useSetAudioCppEnabled,
  useSettings,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

export function ModelDetailPanel() {
  const panel = usePanelWidth({ id: "model-detail", initial: 416, min: 320, max: 720, edge: "left" });
  const modelId = useModelDetailStore((s) => s.modelId);
  const close = useModelDetailStore((s) => s.close);
  const { data: models } = useModels();
  const { data: catalog } = useAudioCppCatalog();

  const { pathname } = useLocation();
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (modelId && pathname !== openedOn.current) close();
    openedOn.current = pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a route change should close it
  }, [pathname]);

  useEffect(() => {
    if (!modelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modelId, close]);

  if (!modelId) return null;
  const model = models?.find((m) => m.id === modelId);
  const entry = catalog?.find((e) => e.id === modelId);
  if (!model && !entry) return null;

  const name = model?.name ?? entry!.name;
  const vendor = model?.vendor ?? entry!.vendor;
  const kind = KIND_LABEL[modelKind(model ?? entry!)];

  return (
    <aside
      aria-label={`Details for ${name}`}
      className="bg-background ring-border animate-in fade-in-0 slide-in-from-right-8 fixed right-0 left-(--rail-w,0px) top-0 bottom-[calc(var(--dock-h,0px)+var(--tabbar-h,0px))] z-30 flex flex-col duration-(--duration-base) expanded:static expanded:z-auto expanded:my-2 expanded:mr-2 expanded:relative expanded:h-[calc(100svh-1rem-var(--dock-h,0px))] expanded:w-(--panel-w) expanded:shrink-0 expanded:rounded-xl expanded:ring-1"
      style={panel.style}
    >
      {panel.handle}
      <div className="border-border flex items-start gap-3 border-b px-4 pt-4 pb-3">
        <ModelMark vendor={vendor} />
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="font-display truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase">
            {name}
          </h2>
          <p className="readout text-muted-foreground truncate">
            {vendor} · {model?.family ? `${model.family} · ` : ""}
            {kind}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {model ? (
          <ModelBody key={model.id} model={model} entry={entry} />
        ) : (
          <CatalogBody entry={entry!} catalog={catalog ?? []} />
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="label-caps text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="readout truncate">{value}</dd>
    </div>
  );
}

/** A catalogue model nobody has added yet: what it is, and Add. */
function CatalogBody({ entry, catalog }: { entry: AudioCppCatalogEntry; catalog: AudioCppCatalogEntry[] }) {
  const setEnabled = useSetAudioCppEnabled();
  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Not in your list</span>
        {!entry.verified && <UnverifiedTag />}
        <EnableAction
          entry={entry}
          className="ml-auto"
          pending={setEnabled.isPending}
          onEnable={() => setEnabled.mutate({ entry, enabled: true, catalog })}
        />
      </div>
      <p className="text-muted-foreground text-sm leading-relaxed">{entry.description}</p>
      <Section title="Licence">
        <LicensePanel license={entry.license} />
      </Section>
      <p className="text-muted-foreground text-xs leading-relaxed">
        An extra model run through the audio.cpp runtime. Add it to your list, then download it the
        same way as the rest.
      </p>
    </div>
  );
}

export function UnverifiedTag() {
  return (
    <span
      className="label-caps bg-warn/10 text-warn ring-warn/35 shrink-0 rounded-sm px-1.5 py-0.5 ring-1 ring-inset"
      title="Nobody has generated a sound with this model through Mirli yet: defaults and even the licence may be unconfirmed."
    >
      Unverified
    </span>
  );
}

function ModelBody({ model, entry }: { model: Model; entry?: AudioCppCatalogEntry }) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: catalog } = useAudioCppCatalog();
  const setEnabled = useSetAudioCppEnabled();
  const hfTokenSet = settings?.hf_token_set ?? false;
  const { remove, dismissFailure } = useModelAction();
  const confirm = useModelDetailStore((s) => s.confirm);
  const setConfirm = useModelDetailStore((s) => s.setConfirm);
  const close = useModelDetailStore((s) => s.close);
  const lastFailure = useModelDetailStore((s) => s.failures[model.id] ?? null);
  const setFailure = useModelDetailStore((s) => s.setFailure);
  const { job, downloading, progressPct, busyLabel } = useModelJob(model);
  const dl = useRequestDownload(model);
  const can = modelCan(model, useCan());
  /** The failed download to show: the server's record of it, which survives a
   *  restart, or the job this page just watched fail on a server too old to
   *  keep one. */
  const downloadFailure = model.download_failure ?? lastFailure?.failure ?? null;
  const failedAt = model.download_failure ? new Date(model.download_failure.at) : null;
  const dismissDownloadFailure = () => {
    setFailure(model.id, null);
    if (model.download_failure) dismissFailure.mutate(model.id);
  };

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

  /** Gate guidance stays up until the weights are here: a set token does not
   *  mean the licence was accepted, and that combination still 403s. */
  const needsGateSetup = model.status === "not_installed" || model.status === "error";
  /** An opt-in catalogue model that is only in the list because it was
   *  switched on, with nothing on disk: it can be taken back out. */
  const removable = entry && !entry.always_on && entry.enabled && !entry.on_disk;

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ModelStatusPill status={model.status} />
        {entry && !entry.verified && <UnverifiedTag />}
        <div className="ml-auto flex gap-1.5">
          {(can.load || can.unload) && (model.task === "gen" || model.task === "tts") && (
            <Button size="sm" variant="ghost" onClick={() => void runSelfTest()} disabled={testing}>
              <ActivityIcon className={cn(testing && "animate-pulse")} />
              {testing ? "Testing…" : "Self-test"}
            </Button>
          )}
          <ModelPrimaryAction model={model} downloading={downloading} />
        </div>
      </div>

      {downloading && (
        <div className="space-y-1.5">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span className="truncate">{job?.message ?? busyLabel}</span>
            <span className="readout">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
        </div>
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

      {(downloadFailure || lastFailure) && !downloading && (
        <FailureCard
          compact
          failure={downloadFailure}
          error={lastFailure?.error ?? "The download failed."}
          context={
            failedAt && !Number.isNaN(failedAt.getTime())
              ? `Downloading ${model.name}, ${failedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
              : `Downloading ${model.name}`
          }
          onRetry={can.repair || can.download ? dl.start : undefined}
          retryLabel={model.status === "incomplete" ? "Repair" : "Retry"}
          onDismiss={dismissDownloadFailure}
        />
      )}
      {model.status === "error" && model.error && !lastFailure && !downloadFailure && (
        <FailureCard compact failure={model.failure} error={model.error} context={model.name} />
      )}

      {model.status === "incomplete" && (
        <Notice>
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            The download did not finish, so these weights can&rsquo;t be used. Repair downloads what is
            missing; what is already on disk is kept.
          </p>
        </Notice>
      )}

      {model.gated && needsGateSetup && (
        <Notice>
          <KeyRoundIcon className="text-warn mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="text-foreground/90 space-y-1.5 leading-relaxed">
            <p>
              This is a gated repository. Downloading needs <em>both</em> steps: a token alone is not
              enough, and missing either one fails with a 403.
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
                {hfTokenSet ? "Access token added in " : "Add a read access token in "}
                <Link to="/settings" className="font-medium underline underline-offset-4" onClick={close}>
                  Settings
                </Link>
                {hfTokenSet ? ": done." : "."}
              </li>
            </ol>
          </div>
        </Notice>
      )}

      {model.status === "needs_runtime" && (
        <Notice>
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {model.auto_installable !== false ? (
            <p className="leading-relaxed">
              The weights are downloaded, but {model.name}&rsquo;s runtime isn&rsquo;t installed yet
              {model.extras.length > 0 && (
                <>
                  {" "}
                  (needs <code className="text-foreground/80">{model.extras.join(", ")}</code>)
                </>
              )}
              . Mirli installs it for you.
            </p>
          ) : (
            <div className="space-y-2 leading-relaxed">
              <p>
                {model.manual_install_reason ??
                  `${model.name} needs its own virtualenv, so Mirli can't install it automatically.`}
              </p>
              {model.install_command && (
                <code className="bg-muted/60 text-foreground/80 block overflow-x-auto rounded px-2 py-1 text-[11px]">
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
          )}
        </Notice>
      )}

      <p className="text-muted-foreground text-sm leading-relaxed">{model.description}</p>

      <Section title="Licence">
        <LicensePanel license={model.license} />
      </Section>

      <Section title="Specs">
        <dl className="space-y-1">
          <Fact label="VRAM estimate" value={can.isEndpoint ? "Remote" : formatMb(model.vram_estimate_mb)} />
          <Fact label="Max duration" value={`${model.max_duration_s}s`} />
          <Fact label="Sample rate" value={can.isEndpoint ? "—" : formatHz(model.sample_rate)} />
          <Fact label="Channels" value={model.channels === 2 ? "Stereo" : "Mono"} />
        </dl>
      </Section>

      {model.params.length > 0 && (
        <Section title="Settings it accepts">
          <ul className="flex flex-wrap gap-1.5">
            {model.params.map((p) => (
              <li key={p.name} title={p.info ?? undefined} className="bg-muted rounded-full px-2.5 py-0.5 text-xs">
                {p.label}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Files">
        {can.isEndpoint ? (
          <p className="text-muted-foreground text-xs">Edit or remove this endpoint in Settings → Endpoints.</p>
        ) : (
          <a
            href={`https://huggingface.co/${model.hf_repo}`}
            target="_blank"
            rel="noreferrer noopener"
            className="readout text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex max-w-full items-center gap-1 rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="truncate">{model.hf_repo}</span>
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        )}
      </Section>

      {(can.remove || removable) && (
        <div className="border-border flex flex-wrap gap-2 border-t pt-4">
          {can.remove && (
            <Button variant="destructive" size="sm" onClick={() => setConfirm("delete")} disabled={remove.isPending}>
              <Trash2Icon />
              Delete weights
            </Button>
          )}
          {removable && (
            <Button
              variant="outline"
              size="sm"
              disabled={setEnabled.isPending}
              onClick={() => setEnabled.mutate({ entry, enabled: false, catalog: catalog ?? [] })}
            >
              <MinusIcon />
              Remove from list
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          {confirm === "download" ? (
            <>
              <DialogHeader>
                <DialogTitle>This model forbids commercial use</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      {model.name} is released under{" "}
                      <span className="text-foreground font-medium">{model.license.name}</span>, which
                      does not permit commercial use. Audio you generate with it must not be shipped in a
                      product, a client project, or anything monetised.
                    </p>
                    {model.license.note && <p>{model.license.note}</p>}
                    <LicenseChip license={model.license} />
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setConfirm(null);
                    dl.start();
                  }}
                >
                  I understand, download anyway
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Delete cached weights?</DialogTitle>
                <DialogDescription>
                  The weights for {model.name} will be removed from disk. You can download them again
                  later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    remove.mutate(model.id);
                    setConfirm(null);
                  }}
                >
                  Delete weights
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
