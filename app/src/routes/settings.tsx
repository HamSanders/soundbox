/** Settings — storage, credentials and output post-processing. */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  EyeOffIcon,
  FolderOpenIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { ArtworkSettingsCard } from "@/components/artwork-settings";
import { EndpointSettingsCard } from "@/components/endpoint-settings";
import { FolderPickerDialog } from "@/components/folder-picker";
import { SettingsLayout, SettingsSection } from "@/components/settings-layout";
import { OutputDeviceCard } from "@/components/output-device-card";
import { useUiPrefs } from "@/lib/ui-prefs";
import {
  useAudioCppRuntime,
  useHealth,
  useLlmStatus,
  useMcpStatus,
  useSettings,
  useUpdateSettings,
} from "@/lib/queries";

export function SettingsPage() {
  const { data: settings, isLoading, isError, error } = useSettings();
  const { data: health } = useHealth();
  const { data: mcpStatus } = useMcpStatus();
  const update = useUpdateSettings();

  const [token, setToken] = useState("");
  const [lufs, setLufs] = useState("-16");
  const [autoUnload, setAutoUnload] = useState("10");
  const [copied, setCopied] = useState(false);
  const [otelEndpoint, setOtelEndpoint] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmExternalModel, setLlmExternalModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [modelsDir, setModelsDir] = useState("");
  const [soundsDir, setSoundsDir] = useState("");
  const [pickingSounds, setPickingSounds] = useState(false);
  const { data: llmStatus } = useLlmStatus();
  const { data: audiocppRuntime } = useAudioCppRuntime();

  useEffect(() => {
    if (!settings) return;
    // Always the path actually in force, so the field answers "where do my
    // weights live" even in Local mode where it is read-only. Clearing it and
    // blurring sends "", which the server reads as "back to the default".
    setModelsDir(settings.audiocpp_models_dir);
    // Same idea for sounds: always the folder in force, blank-and-blur resets.
    setSoundsDir(settings.sounds_dir);
    setLufs(settings.normalize_lufs === null ? "-16" : String(settings.normalize_lufs));
    setAutoUnload(String(settings.auto_unload_minutes));
    setOtelEndpoint(settings.otel_endpoint);
    setLlmBaseUrl(settings.llm_external_base_url);
    setLlmExternalModel(settings.llm_external_model);
  }, [settings]);

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !settings) {
    return (
      <div className="border-border rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="text-sm font-medium">Could not load settings</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  const normalizeOn = settings.normalize_lufs !== null;
  // The server hands back native paths, so a placeholder built from one has
  // to follow the platform the server runs on rather than ours.
  const pathSep = settings.data_dir.includes("\\") ? "\\" : "/";

  // Read out here rather than inside the closure below: the `!settings` guard
  // above does not narrow through a function boundary.
  const savedSoundsDir = settings.sounds_dir;

  /**
   * Save the sounds folder, from the field or from the picker.
   *
   * The mutation already toasts either way; the callback here only puts the
   * field back to what the server still believes, so a path it rejected does
   * not sit there looking like it took.
   */
  function saveSoundsDir(next: string) {
    if (next === savedSoundsDir) return;
    update.mutate({ sounds_dir: next }, { onError: () => setSoundsDir(savedSoundsDir) });
  }

  return (
    <SettingsLayout>
      <SettingsSection id="audio" title="Audio">
        {/* -------------------------------------------------- playback device */}
        <OutputDeviceCard />
        {/* --------------------------------------------------------- output */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Output</CardTitle>
            <CardDescription>Applied to every sound as it is written.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="output-format">Format</Label>
                <p className="text-muted-foreground text-xs">
                  WAV keeps full quality; MP3 is transcoded on download.
                </p>
              </div>
              <Select
                value={settings.output_format}
                onValueChange={(v) => update.mutate({ output_format: v as "wav" | "mp3" })}
              >
                <SelectTrigger id="output-format" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wav">WAV</SelectItem>
                  <SelectItem value="mp3">MP3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="normalize">Normalise loudness</Label>
                  <p className="text-muted-foreground text-xs">
                    Bring every sound to a consistent integrated loudness.
                  </p>
                </div>
                <Switch
                  id="normalize"
                  checked={normalizeOn}
                  onCheckedChange={(on) =>
                    update.mutate({ normalize_lufs: on ? Number(lufs) || -16 : null })
                  }
                />
              </div>
              {normalizeOn && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="lufs" className="text-muted-foreground text-xs">
                    Target
                  </Label>
                  <Input
                    id="lufs"
                    value={lufs}
                    inputMode="decimal"
                    className="w-24 font-mono"
                    onChange={(e) => setLufs(e.target.value)}
                    onBlur={() => {
                      const n = Number(lufs);
                      if (Number.isFinite(n)) update.mutate({ normalize_lufs: n });
                    }}
                  />
                  <span className="text-muted-foreground text-xs">LUFS</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div className="space-y-0.5">
                <Label htmlFor="trim">Trim silence</Label>
                <p className="text-muted-foreground text-xs">
                  Strip leading and trailing silence from generated audio.
                </p>
              </div>
              <Switch
                id="trim"
                checked={settings.trim_silence}
                onCheckedChange={(on) => update.mutate({ trim_silence: on })}
              />
            </div>

          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection id="generation" title="Generation">
        {/* --------------------------------------------------------- compute */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compute device</CardTitle>
            <CardDescription>
              Where generation runs, and how long a model holds onto the memory
              afterwards. Auto picks the fastest available.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="device">Device</Label>
                <p className="text-muted-foreground text-xs">
                  {health?.gpu_name
                    ? `GPU detected: ${health.gpu_name}`
                    : "No GPU detected — falling back to CPU."}
                </p>
              </div>
              <Select
                value={settings.device}
                onValueChange={(v) =>
                  update.mutate({ device: v as "auto" | "cuda" | "mps" | "cpu" })
                }
              >
                <SelectTrigger id="device" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="cuda">GPU (CUDA)</SelectItem>
                  <SelectItem value="mps">GPU (MPS)</SelectItem>
                  <SelectItem value="cpu">CPU</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {health && (
              <p className="text-muted-foreground border-t pt-3 text-xs">
                Currently running on <span className="font-mono">{health.device}</span>
                {(settings.device === "cuda" || settings.device === "mps") &&
                health.device === "cpu"
                  ? ` — ${settings.device.toUpperCase()} was requested but isn't available, so this fell back to CPU.`
                  : null}
              </p>
            )}

            {/* Lives here rather than with output format, where it used to sit:
                this is about the memory the device above is holding, not about
                the audio that comes out. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div className="space-y-0.5">
                <Label htmlFor="auto-unload">Auto-unload model</Label>
                <p className="text-muted-foreground text-xs">
                  Free VRAM after this many idle minutes. 0 keeps the model resident.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="auto-unload"
                  value={autoUnload}
                  inputMode="numeric"
                  className="w-20 font-mono"
                  onChange={(e) => setAutoUnload(e.target.value.replace(/\D/g, ""))}
                  onBlur={() => {
                    const n = Number(autoUnload);
                    if (Number.isFinite(n) && n !== settings.auto_unload_minutes)
                      update.mutate({ auto_unload_minutes: n });
                  }}
                />
                <span className="text-muted-foreground text-xs">min</span>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* ----------------------------------------------------- audio engine */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audio engine</CardTitle>
            <CardDescription>
              Every model runs through audio.cpp. Point Konchi at an audio.cpp you
              already use and the two share one set of weights instead of each
              downloading its own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="audiocpp-mode">Mode</Label>
                <p className="text-muted-foreground text-xs">
                  Local uses the runtime Konchi installs and manages; External uses
                  your own audio.cpp and its models folder.
                </p>
              </div>
              <Select
                value={settings.audiocpp_mode}
                onValueChange={(v) =>
                  update.mutate({ audiocpp_mode: v as "managed" | "external" })
                }
              >
                <SelectTrigger id="audiocpp-mode" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="managed">Local</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Which binary actually won. Worth showing even in Local mode:
                KONCHI_AUDIOCPP_BIN and a copy on PATH both outrank the
                managed install, and until now nothing in the app said so. */}
            {audiocppRuntime && (
              <div className="border-border space-y-1 rounded-lg border border-dashed px-3 py-2">
                <p className="text-xs">
                  {audiocppRuntime.engine.installed ? (
                    <>
                      Using{" "}
                      <span className="font-medium">
                        {audiocppRuntime.engine.source === "managed"
                          ? `the managed runtime ${audiocppRuntime.engine.version ?? ""}`
                          : audiocppRuntime.engine.source === "env"
                            ? "your own binary (KONCHI_AUDIOCPP_BIN)"
                            : "an audiocpp_cli found on your PATH"}
                      </span>
                      {audiocppRuntime.engine.backend
                        ? ` on the ${audiocppRuntime.engine.backend} backend.`
                        : "."}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No audio.cpp runtime found — install it from the Models page.
                    </span>
                  )}
                </p>
                {audiocppRuntime.engine.path && (
                  <p className="text-muted-foreground font-mono text-[11px] break-all">
                    {audiocppRuntime.engine.path}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="audiocpp-models-dir">Models folder</Label>
              <Input
                id="audiocpp-models-dir"
                value={modelsDir}
                readOnly={settings.audiocpp_mode !== "external"}
                placeholder={audiocppRuntime?.models_dir_default ?? ""}
                className="font-mono text-xs"
                onChange={(e) => setModelsDir(e.target.value)}
                onBlur={() => {
                  if (modelsDir !== settings.audiocpp_models_dir) {
                    update.mutate({ audiocpp_models_dir: modelsDir });
                  }
                }}
              />
              <p className="text-muted-foreground text-xs">
                {settings.audiocpp_mode === "external" ? (
                  <>
                    Point this at your audio.cpp models folder and both apps will see
                    the same downloads. Leave it empty to go back to the default.
                  </>
                ) : (
                  <>
                    Managed by Konchi. Switch to External to share a folder with an
                    audio.cpp you already run.
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        {/* ------------------------------------------------ prompt assistant */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prompt assistant</CardTitle>
            <CardDescription>
              A small local model that rewrites terse prompts ("scary sound") into
              descriptive ones the sound models respond to. Off by default.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="llm-mode">Mode</Label>
                <p className="text-muted-foreground text-xs">
                  Local runs a small model Konchi manages; External points at your own
                  OpenAI-compatible server (Ollama, LM Studio, …).
                </p>
              </div>
              <Select
                value={settings.llm_mode}
                onValueChange={(v) =>
                  update.mutate({ llm_mode: v as "off" | "managed" | "external" })
                }
              >
                <SelectTrigger id="llm-mode" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="managed">Local</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Found something already running — no reason to make anyone
                install a second local model server for this one feature. */}
            {(llmStatus?.detected ?? [])
              .filter((d) => !(settings.llm_mode === "external" && settings.llm_external_base_url === d.base_url))
              .map((d) => (
                <div
                  key={d.base_url}
                  className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2"
                >
                  <p className="text-xs">
                    <span className="font-medium">{d.label}</span> is already running at{" "}
                    <span className="font-mono">{d.base_url}</span>
                    {d.models.length > 0 && ` with ${d.models.length} model(s) loaded`}.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const firstModel = d.models[0] ?? "";
                      setLlmBaseUrl(d.base_url);
                      setLlmExternalModel(firstModel);
                      update.mutate({
                        llm_mode: "external",
                        llm_external_base_url: d.base_url,
                        llm_external_model: firstModel,
                      });
                    }}
                    disabled={update.isPending}
                  >
                    Use it
                  </Button>
                </div>
              ))}

            {settings.llm_mode === "managed" && (
              <p className="text-muted-foreground border-t pt-3 text-xs">
                {llmStatus?.engine.installed && llmStatus.model?.installed ? (
                  `Using ${llmStatus.model.name}.`
                ) : (
                  <>
                    Install the engine and a model from the{" "}
                    <Link to="/models" className="underline underline-offset-2">
                      Models page
                    </Link>
                    .
                  </>
                )}
              </p>
            )}

            {settings.llm_mode === "external" && (
              <div className="space-y-3 border-t pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="llm-base-url">Base URL</Label>
                  <Input
                    id="llm-base-url"
                    value={llmBaseUrl}
                    placeholder="http://localhost:11434"
                    className="font-mono text-xs"
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    onBlur={() => {
                      if (llmBaseUrl !== settings.llm_external_base_url) {
                        update.mutate({ llm_external_base_url: llmBaseUrl.trim() });
                      }
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="llm-model-name">Model name</Label>
                  <Input
                    id="llm-model-name"
                    value={llmExternalModel}
                    placeholder="qwen3:1.7b"
                    className="font-mono text-xs"
                    onChange={(e) => setLlmExternalModel(e.target.value)}
                    onBlur={() => {
                      if (llmExternalModel !== settings.llm_external_model) {
                        update.mutate({ llm_external_model: llmExternalModel.trim() });
                      }
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="llm-api-key">API key (optional)</Label>
                  <div className="flex items-center gap-2 text-xs">
                    <EyeOffIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
                    <span
                      className={
                        settings.llm_external_api_key_set ? "text-foreground" : "text-muted-foreground"
                      }
                    >
                      {settings.llm_external_api_key_set ? "A key is saved." : "No key saved."}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="llm-api-key"
                      type="password"
                      value={llmApiKey}
                      autoComplete="off"
                      placeholder={settings.llm_external_api_key_set ? "Replace saved key" : "Most local servers don't need one"}
                      onChange={(e) => setLlmApiKey(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!llmApiKey.trim() || update.isPending}
                      onClick={() =>
                        update.mutate(
                          { llm_external_api_key: llmApiKey.trim() },
                          { onSuccess: () => setLlmApiKey("") },
                        )
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        {/* -------------------------------------------------------- artwork */}
        <ArtworkSettingsCard settings={settings} />
      </SettingsSection>

      <SettingsSection id="endpoints" title="Endpoints">
        {/* ------------------------------------------------ custom endpoints */}
        <EndpointSettingsCard />
      </SettingsSection>

      <SettingsSection id="storage" title="Storage">
        {/* -------------------------------------------------------- storage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Folders</CardTitle>
            <CardDescription>Where sounds, weights and the index live on disk.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor="data-dir">Data directory</Label>
            <div className="flex gap-2">
              <Input
                id="data-dir"
                value={settings.data_dir}
                readOnly
                className="text-muted-foreground font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy data directory path"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(settings.data_dir)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => toast.error("Could not copy to the clipboard"));
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              The open profile's folder — switch profiles from the chip in the header to
              point the app at a different library. The install root is set with the{" "}
              <span className="font-mono">KONCHI_DATA_DIR</span> environment variable
              before starting the server; downloaded models and runtimes live there and
              are shared by every profile.
            </p>
            <div className="mt-5 space-y-1.5">
              <Label htmlFor="sounds-dir">Sounds folder</Label>
              <div className="flex gap-2">
                <Input
                  id="sounds-dir"
                  value={soundsDir}
                  placeholder={`${settings.data_dir}${pathSep}sounds`}
                  className="font-mono text-xs"
                  onChange={(e) => setSoundsDir(e.target.value)}
                  onBlur={() => saveSoundsDir(soundsDir)}
                />
                <Button variant="outline" onClick={() => setPickingSounds(true)}>
                  <FolderOpenIcon />
                  Browse
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Where generated audio is written — set it independently of the data
                directory to keep sounds on their own disk. Existing sounds are moved
                across when this changes, so it cannot be done while something is
                generating. Leave it empty to go back to the default.
              </p>
              <FolderPickerDialog
                open={pickingSounds}
                onOpenChange={setPickingSounds}
                initialPath={settings.sounds_dir}
                title="Sounds folder"
                description="Folders on the machine running Konchi — that is where the audio is written. Anything you pick is created if it does not exist yet."
                onSelect={(path) => {
                  setSoundsDir(path);
                  saveSoundsDir(path);
                }}
              />
            </div>

            {/* Read-only, and deliberately so — the control that changes this
                belongs with the engine whose packages it holds. Showing it here
                anyway is what lets this card answer "where does everything
                live" without sending anyone hunting for the third folder. */}
            <div className="mt-5 space-y-1.5">
              <Label htmlFor="weights-dir">Model weights</Label>
              <Input
                id="weights-dir"
                value={settings.audiocpp_models_dir}
                readOnly
                className="text-muted-foreground font-mono text-xs"
              />
              <p className="text-muted-foreground text-xs">
                Shared by every profile, and the largest thing here by far. Change it
                under Generation &rarr; Audio engine, where pointing it at an audio.cpp
                you already run is the reason to move it.
              </p>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      {/*
       * Accounts, not "credentials".
       *
       * These two are the only settings that are about a relationship with
       * somebody else's service — one to fetch gated weights, one to spend
       * money on their GPUs. The external LLM and image keys deliberately stay
       * in their own engine cards instead of being gathered here: a base URL,
       * a model name and a key are one connection, and splitting the key out
       * would leave two halves of a single setting in two places.
       */}
      <SettingsSection id="accounts" title="Accounts">
        {/* -------------------------------------------------------- hugging face */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hugging Face</CardTitle>
            <CardDescription>
              An access token, required for gated repositories. Stored write-only — it is
              never displayed again once saved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <EyeOffIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
              <span className={settings.hf_token_set ? "text-foreground" : "text-muted-foreground"}>
                {settings.hf_token_set ? "A token is saved." : "No token saved."}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                id="hf-token"
                type="password"
                value={token}
                autoComplete="off"
                placeholder={settings.hf_token_set ? "Replace saved token" : "hf_…"}
                aria-label="Hugging Face access token"
                onChange={(e) => setToken(e.target.value)}
              />
              <Button
                disabled={!token.trim() || update.isPending}
                onClick={() => {
                  update.mutate(
                    { hf_token: token.trim() },
                    { onSuccess: () => setToken("") },
                  );
                }}
              >
                Save token
              </Button>
            </div>
            {settings.hf_token_set && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update.mutate({ hf_token: "" })}
              >
                Clear saved token
              </Button>
            )}
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection id="interface" title="Interface">
        <InterfaceCard />
      </SettingsSection>

      <SettingsSection id="advanced" title="Advanced">
        {/* ------------------------------------------------------ telemetry */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MCP telemetry</CardTitle>
            <CardDescription>
              Export every agent tool call as an OpenTelemetry trace + metrics to your own
              collector. See the <a href="#/agents" className="underline underline-offset-2">
                Agents
              </a>{" "}
              page for the call log itself — this only wires it out to somewhere else.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="otel-endpoint">OTLP/HTTP collector endpoint</Label>
              <div className="flex gap-2">
                <Input
                  id="otel-endpoint"
                  value={otelEndpoint}
                  placeholder="http://localhost:4318"
                  className="font-mono text-xs"
                  onChange={(e) => setOtelEndpoint(e.target.value)}
                  onBlur={() => {
                    if (otelEndpoint !== settings.otel_endpoint)
                      update.mutate({ otel_endpoint: otelEndpoint.trim() });
                  }}
                />
                {settings.otel_endpoint && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setOtelEndpoint("");
                      update.mutate({ otel_endpoint: "" });
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Traces go to <span className="font-mono">/v1/traces</span>, metrics to{" "}
                <span className="font-mono">/v1/metrics</span> — the standard OTLP/HTTP layout
                (Jaeger, Tempo, Honeycomb, the OTel Collector all speak this).
              </p>
            </div>

            {mcpStatus && (
              <div className="flex items-start gap-2 border-t pt-3 text-xs">
                {mcpStatus.otel.enabled ? (
                  <CheckCircle2Icon
                    className="mt-0.5 size-3.5 shrink-0 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangleIcon
                    className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <div className="text-muted-foreground space-y-0.5">
                  {mcpStatus.otel.enabled ? (
                    <p>
                      Exporting to <span className="font-mono">{mcpStatus.otel.endpoint}</span>
                      {mcpStatus.otel.source === "env" && " (from OTEL_EXPORTER_OTLP_ENDPOINT)"}
                    </p>
                  ) : (
                    <p>Not exporting — set an endpoint above to turn this on.</p>
                  )}
                  {mcpStatus.otel.source === "env" && (
                    <p>
                      OTEL_EXPORTER_OTLP_ENDPOINT is set in the server&apos;s environment, which
                      takes priority over this field.
                    </p>
                  )}
                  {mcpStatus.otel.error && (
                    <p className="text-red-500">{mcpStatus.otel.error}</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------ first run */}
        {/* The honest answer to "I skipped setup, how do I get the assistant
            now" — and to "I want to redo this on a new machine". Clearing
            `onboarded_at` is all it takes: the wizard's other condition, no
            model installed, is checked live. Which is why this says what will
            actually happen for someone who already has models. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">First-run setup</CardTitle>
            <CardDescription>
              {settings.onboarded_at
                ? `Completed ${new Date(settings.onboarded_at).toLocaleDateString()}.`
                : "Not completed yet."}{" "}
              Re-running it walks through the model picks again. It only opens
              automatically when no models are installed — with some already on
              disk, nothing will appear.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending || !settings.onboarded_at}
              onClick={() => update.mutate({ onboarded_at: "" })}
            >
              Run setup again
            </Button>
          </CardContent>
        </Card>
      </SettingsSection>
    </SettingsLayout>
  );
}

/** Per-browser interface preferences (see `ui-prefs.ts`): nothing here
 *  reaches the server, so there is no save round trip and no loading state. */
function InterfaceCard() {
  const keep = useUiPrefs((s) => s.sidebarKeepExpanded);
  const waveStyle = useUiPrefs((s) => s.waveStyle);
  const set = useUiPrefs((s) => s.set);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Interface</CardTitle>
        <CardDescription>Kept in this browser, not on the server.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="sidebar-keep">Keep the sidebar open in the studio</Label>
            <p className="text-muted-foreground text-xs">
              Leaves the navigation expanded on studio, Music and Voice Lab pages. Off: it folds
              to an icon rail there so the timeline gets the width, and opens again when you
              leave.
            </p>
          </div>
          <Switch
            id="sidebar-keep"
            checked={keep}
            onCheckedChange={(on) => set({ sidebarKeepExpanded: on })}
          />
        </div>
        <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="space-y-0.5">
            <Label htmlFor="wave-style">Waterline waveforms in the studio</Label>
            <p className="text-muted-foreground text-xs">
              Draws each clip above a visible zero line, with a fainter reflection below it, and
              marks the playhead with a buoy. Off: the usual mirrored bars.
            </p>
          </div>
          <Switch
            id="wave-style"
            checked={waveStyle === "waterline"}
            onCheckedChange={(on) => set({ waveStyle: on ? "waterline" : "bars" })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
