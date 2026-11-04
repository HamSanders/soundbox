/**
 * The Artwork panel on Settings — cover art for music, avatars for voices.
 *
 * Its own file rather than another 200 lines in `settings.tsx`, and shaped
 * after the Prompt assistant panel there on purpose: the two features pose the
 * same question (nothing / something we install / something you already run),
 * and answering it in two different layouts would make them look unrelated
 * when they are the same decision twice.
 *
 * One thing this panel does that the prompt-assistant one doesn't: it installs
 * the engine and the checkpoint inline. The prompt assistant sends you to the
 * Models page, which is the right home for *audio* models — an artwork
 * checkpoint isn't one, and listing it there would put a picture model in the
 * model picker people choose sounds from.
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EyeOffIcon, ImageIcon, Loader2Icon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LicenseChip } from "@/components/license-badge";

import { formatBytes } from "@/lib/format";
import { useJobStream } from "@/hooks/use-job-stream";
import {
  useImageEngineInstall,
  useImageModelDelete,
  useImageModelDownload,
  useImageStatus,
  useUpdateSettings,
} from "@/lib/queries";
import type { ImageModelEntry, Settings } from "@/lib/api";

export function ArtworkSettingsCard({ settings }: { settings: Settings }) {
  const { data: status } = useImageStatus();
  const update = useUpdateSettings();
  const installEngine = useImageEngineInstall();

  const [baseUrl, setBaseUrl] = useState("");
  const [externalModel, setExternalModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [engineJobId, setEngineJobId] = useState<string | null>(null);
  const { job: engineJob } = useJobStream(engineJobId);
  const qc = useQueryClient();

  useEffect(() => {
    setBaseUrl(settings.image_external_base_url);
    setExternalModel(settings.image_external_model);
  }, [settings]);

  // Refetch when the job ends, not just when it starts: the install is what
  // makes `engine.installed` true, and without this the panel keeps offering
  // to install something that is already there.
  useEffect(() => {
    if (!engineJob) return;
    if (["done", "error", "cancelled"].includes(engineJob.status)) {
      setEngineJobId(null);
      void qc.invalidateQueries({ queryKey: ["image-status"] });
    }
  }, [engineJob, qc]);

  const installing = Boolean(engineJobId && engineJob?.status !== "done");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Artwork</CardTitle>
        <CardDescription>
          Cover art for music you generate, and avatars for saved voices, drawn locally
          by a small image model. Off by default — nothing is downloaded until you turn
          it on. Stem instrument icons are drawn by the app itself and need none of this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="image-mode">Mode</Label>
            <p className="text-muted-foreground text-xs">
              Local runs an image model Konchi installs; External points at a server you
              already run (Automatic1111, ComfyUI's API, anything OpenAI-compatible).
            </p>
          </div>
          <Select
            value={settings.image_mode}
            onValueChange={(v) =>
              update.mutate({ image_mode: v as "off" | "managed" | "external" })
            }
          >
            <SelectTrigger id="image-mode" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="managed">Local</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Same argument as the prompt assistant's probe: somebody already
            running Automatic1111 has no reason to download a second copy of
            Stable Diffusion to make album covers. */}
        {(status?.detected ?? [])
          .filter(
            (d) =>
              !(settings.image_mode === "external" && settings.image_external_base_url === d.base_url),
          )
          .map((d) => (
            <div
              key={d.base_url}
              className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2"
            >
              <p className="text-xs">
                <span className="font-medium">{d.label}</span> is already running at{" "}
                <span className="font-mono">{d.base_url}</span>
                {d.models.length > 0 && ` with ${d.models.length} checkpoint(s)`}.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => {
                  const first = d.models[0] ?? "";
                  setBaseUrl(d.base_url);
                  setExternalModel(first);
                  update.mutate({
                    image_mode: "external",
                    image_external_kind: d.kind,
                    image_external_base_url: d.base_url,
                    image_external_model: first,
                  });
                }}
              >
                Use it
              </Button>
            </div>
          ))}

        {settings.image_mode === "managed" && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Engine</p>
                <p className="text-muted-foreground text-xs">
                  {status?.engine.installed
                    ? `sd-server ${status.engine.version ?? "(your own build)"}${
                        status.engine.backend ? ` · ${status.engine.backend}` : ""
                      }`
                    : "stable-diffusion.cpp — one native binary, no Python."}
                </p>
              </div>
              {status?.engine.installed ? (
                <span className="text-muted-foreground text-xs">Installed</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={installing || installEngine.isPending}
                  onClick={() =>
                    installEngine.mutate(undefined, {
                      onSuccess: (job) => setEngineJobId(job.job_id),
                    })
                  }
                >
                  {installing ? (
                    <>
                      <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                      {engineJob?.message ?? "Installing…"}
                    </>
                  ) : (
                    "Install"
                  )}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Model</p>
              {(status?.catalog ?? []).map((spec) => (
                <ImageModelRow
                  key={spec.id}
                  spec={spec}
                  active={settings.image_model === spec.id}
                />
              ))}
            </div>

            {status && !status.ready && status.detail && (
              <p className="text-muted-foreground text-xs">{status.detail}</p>
            )}
          </div>
        )}

        {settings.image_mode === "external" && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="image-kind">API</Label>
                <p className="text-muted-foreground text-xs">
                  There is no common image API the way there is for chat, so this can't be
                  detected from the URL.
                </p>
              </div>
              <Select
                value={settings.image_external_kind}
                onValueChange={(v) =>
                  update.mutate({ image_external_kind: v as "openai" | "a1111" })
                }
              >
                <SelectTrigger id="image-kind" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a1111">Automatic1111</SelectItem>
                  <SelectItem value="openai">OpenAI-compatible</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="image-base-url">Base URL</Label>
              <Input
                id="image-base-url"
                value={baseUrl}
                placeholder="http://localhost:7860"
                className="font-mono text-xs"
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => {
                  if (baseUrl !== settings.image_external_base_url) {
                    update.mutate({ image_external_base_url: baseUrl.trim() });
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="image-model-name">Checkpoint (optional)</Label>
              <Input
                id="image-model-name"
                value={externalModel}
                placeholder="Leave empty to use whatever it has loaded"
                className="font-mono text-xs"
                onChange={(e) => setExternalModel(e.target.value)}
                onBlur={() => {
                  if (externalModel !== settings.image_external_model) {
                    update.mutate({ image_external_model: externalModel.trim() });
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="image-api-key">API key (optional)</Label>
              <div className="flex items-center gap-2 text-xs">
                <EyeOffIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
                <span
                  className={
                    settings.image_external_api_key_set ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {settings.image_external_api_key_set ? "A key is saved." : "No key saved."}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  id="image-api-key"
                  type="password"
                  value={apiKey}
                  autoComplete="off"
                  placeholder={
                    settings.image_external_api_key_set
                      ? "Replace saved key"
                      : "Most local servers don't need one"
                  }
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!apiKey.trim() || update.isPending}
                  onClick={() =>
                    update.mutate(
                      { image_external_api_key: apiKey.trim() },
                      { onSuccess: () => setApiKey("") },
                    )
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {settings.image_mode !== "off" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="space-y-0.5">
              <Label htmlFor="image-auto">Draw covers automatically</Label>
              <p className="text-muted-foreground text-xs">
                Queue a cover after each music render. Off by default: the image model
                wants the same VRAM the audio model is holding, so this runs after your
                audio is finished, never before it.
              </p>
            </div>
            <Switch
              id="image-auto"
              checked={settings.image_auto_artwork}
              onCheckedChange={(checked) => update.mutate({ image_auto_artwork: checked })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What a model costs to install, phrased for the row.
 *
 * A multi-file model states the count as well as the total: "11.6 GB" alone
 * hides that SD 3.5 is four separate downloads, which is exactly what someone
 * watching a progress bar restart three times wants to have been told. A model
 * whose files you supplied has no download at all, and says so.
 */
function sizeLabel(spec: ImageModelEntry): string {
  if (spec.size_bytes === 0) return "already on your disk";
  const size = formatBytes(spec.size_bytes);
  return spec.files.length > 1 ? `${size} across ${spec.files.length} files` : size;
}

/** One installable checkpoint: download, then "Use" to make it the active one.
 *  Same row shape as the prompt assistant's model list on the Models page. */
function ImageModelRow({ spec, active }: { spec: ImageModelEntry; active: boolean }) {
  const download = useImageModelDownload();
  const remove = useImageModelDelete();
  const update = useUpdateSettings();
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJobStream(jobId);
  const qc = useQueryClient();

  // Same as the engine above: the download is what flips `installed`.
  useEffect(() => {
    if (!job) return;
    if (["done", "error", "cancelled"].includes(job.status)) {
      setJobId(null);
      void qc.invalidateQueries({ queryKey: ["image-status"] });
    }
  }, [job, qc]);

  const downloading = Boolean(jobId && job?.status !== "done");

  return (
    <div className="border-border flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
      <ImageIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{spec.name}</span>
          {spec.source === "custom" && (
            <span className="text-muted-foreground shrink-0 label-caps">
              Custom
            </span>
          )}
          {spec.recommended && (
            <span className="text-muted-foreground shrink-0 label-caps">
              Recommended
            </span>
          )}
          {/* The licence is shown before the download, not after: one of these
              is non-commercial, and that is worth knowing before you build a
              release cover with it. */}
          <LicenseChip license={spec.license} />
        </div>
        <p className="text-muted-foreground text-xs">
          {spec.description} · {sizeLabel(spec)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!spec.installed && spec.size_bytes === 0 ? (
          // Nothing to fetch and not present: a model of yours whose paths
          // don't resolve. A Download button would be a lie, so say what is
          // actually wrong instead.
          <span className="text-muted-foreground text-xs">Files not found</span>
        ) : !spec.installed ? (
          <Button
            size="sm"
            variant="outline"
            disabled={downloading}
            onClick={() =>
              download.mutate(spec.id, { onSuccess: (ref) => setJobId(ref.job_id) })
            }
          >
            {downloading ? (
              <>
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                {Math.round((job?.progress ?? 0) * 100)}%
              </>
            ) : (
              "Download"
            )}
          </Button>
        ) : active ? (
          <span className="text-muted-foreground text-xs">Active</span>
        ) : (
          <Button size="sm" variant="outline" onClick={() => update.mutate({ image_model: spec.id })}>
            Use
          </Button>
        )}
        {spec.installed && spec.hf_repo && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${spec.name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(spec.id)}
          >
            <TrashIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
