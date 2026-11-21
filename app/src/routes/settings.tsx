/**
 * Settings: grouped by what a person is trying to do, searchable, saved on
 * change. The groups, labels and search words live in
 * `components/settings-index.ts`; this file only wires each row to its
 * control and its default.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangleIcon, CheckCircle2Icon, CheckIcon, CopyIcon, EyeOffIcon, FolderOpenIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  ConfirmAction,
  Embedded,
  SettingRow,
  SettingsGroup,
  SettingsLayout,
  useMarkSaved,
  useSettingSave,
} from "@/components/settings-layout";
import { OutputDeviceCard } from "@/components/output-device-card";
import { UpdateSettingsCard } from "@/components/update-settings";
import { useOutputStore } from "@/lib/audio-output";
import { useUiPrefs } from "@/lib/ui-prefs";
import {
  useAudioCppRuntime,
  useHealth,
  useLlmStatus,
  useMcpStatus,
  useSettings,
  useUpdateStatus,
} from "@/lib/queries";
import type { Settings } from "@/lib/api";

/** The server's defaults (server/src/config.ts `DEFAULT_SETTINGS`). */
const DEFAULTS = {
  output_format: "wav",
  normalize_lufs: -16,
  trim_silence: true,
  auto_unload_minutes: 10,
  device: "auto",
  audiocpp_mode: "managed",
  llm_mode: "off",
  otel_endpoint: "",
  update_check: true,
} as const;

export function SettingsPage() {
  const { data: settings, isLoading, isError, error } = useSettings();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
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

  return (
    <SettingsLayout>
      <div className="space-y-8">
        <SoundGroup settings={settings} />
        <PerformanceGroup settings={settings} />
        <ModelsGroup settings={settings} />
        <HelpersGroup settings={settings} />
        <SetupGroup settings={settings} />
        <StorageGroup settings={settings} />
        <InterfaceGroup />
        <PrivacyGroup settings={settings} />
        <DangerGroup settings={settings} />
      </div>
    </SettingsLayout>
  );
}

/** A text field that saves on blur or Enter, and follows the server value. */
function useDraft(server: string) {
  const [value, setValue] = useState(server);
  useEffect(() => setValue(server), [server]);
  return [value, setValue] as const;
}

// --------------------------------------------------------------- sound

function SoundGroup({ settings }: { settings: Settings }) {
  const { save } = useSettingSave();
  const sinkId = useOutputStore((s) => s.sinkId);
  const setSinkId = useOutputStore((s) => s.setSinkId);
  const markSaved = useMarkSaved();
  const [lufs, setLufs] = useDraft(
    settings.normalize_lufs === null ? "-16" : String(settings.normalize_lufs),
  );
  const normalizeOn = settings.normalize_lufs !== null;

  return (
    <SettingsGroup id="sound">
      <SettingRow
        id="output-device"
        stack
        modified={sinkId !== ""}
        onReset={() => {
          setSinkId("");
          markSaved("output-device");
        }}
      >
        <Embedded>
          <OutputDeviceCard />
        </Embedded>
      </SettingRow>

      <SettingRow
        id="output-format"
        htmlFor="output-format"
        modified={settings.output_format !== DEFAULTS.output_format}
        onReset={() => save("output-format", { output_format: DEFAULTS.output_format })}
        control={
          <Select
            value={settings.output_format}
            onValueChange={(v) => save("output-format", { output_format: v as "wav" | "mp3" })}
          >
            <SelectTrigger id="output-format" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wav">WAV</SelectItem>
              <SelectItem value="mp3">MP3</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <SettingRow
        id="normalize"
        htmlFor="normalize"
        modified={settings.normalize_lufs !== DEFAULTS.normalize_lufs}
        onReset={() => save("normalize", { normalize_lufs: DEFAULTS.normalize_lufs })}
        control={
          <div className="flex items-center gap-3">
            {normalizeOn && (
              <div className="flex items-center gap-1.5">
                <Input
                  id="lufs"
                  aria-label="Target loudness in LUFS"
                  value={lufs}
                  inputMode="decimal"
                  className="w-20 font-mono"
                  onChange={(e) => setLufs(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={() => {
                    const n = Number(lufs);
                    if (Number.isFinite(n) && n !== settings.normalize_lufs)
                      save("normalize", { normalize_lufs: n });
                  }}
                />
                <span className="readout text-muted-foreground">LUFS</span>
              </div>
            )}
            <Switch
              id="normalize"
              checked={normalizeOn}
              onCheckedChange={(on) =>
                save("normalize", { normalize_lufs: on ? Number(lufs) || -16 : null })
              }
            />
          </div>
        }
      />

      <SettingRow
        id="trim-silence"
        htmlFor="trim"
        modified={settings.trim_silence !== DEFAULTS.trim_silence}
        onReset={() => save("trim-silence", { trim_silence: DEFAULTS.trim_silence })}
        control={
          <Switch
            id="trim"
            checked={settings.trim_silence}
            onCheckedChange={(on) => save("trim-silence", { trim_silence: on })}
          />
        }
      />
    </SettingsGroup>
  );
}

// --------------------------------------------------------- performance

function PerformanceGroup({ settings }: { settings: Settings }) {
  const { save } = useSettingSave();
  const { data: health } = useHealth();
  const [autoUnload, setAutoUnload] = useDraft(String(settings.auto_unload_minutes));

  return (
    <SettingsGroup id="performance">
      <SettingRow
        id="device"
        htmlFor="device"
        modified={settings.device !== DEFAULTS.device}
        onReset={() => save("device", { device: DEFAULTS.device })}
        control={
          <Select
            value={settings.device}
            onValueChange={(v) => save("device", { device: v as Settings["device"] })}
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
        }
      >
        <p className="readout text-muted-foreground">
          {health?.gpu_name ? `GPU detected: ${health.gpu_name}` : "No GPU detected — falling back to CPU."}
          {health && (
            <>
              {" "}
              Running on <span className="text-foreground">{health.device}</span>
              {(settings.device === "cuda" || settings.device === "mps") && health.device === "cpu"
                ? ` — ${settings.device.toUpperCase()} was requested but isn't available, so this fell back to CPU.`
                : "."}
            </>
          )}
        </p>
      </SettingRow>

      <SettingRow
        id="auto-unload"
        htmlFor="auto-unload"
        modified={settings.auto_unload_minutes !== DEFAULTS.auto_unload_minutes}
        onReset={() => save("auto-unload", { auto_unload_minutes: DEFAULTS.auto_unload_minutes })}
        control={
          <div className="flex items-center gap-1.5">
            <Input
              id="auto-unload"
              value={autoUnload}
              inputMode="numeric"
              className="w-20 font-mono"
              onChange={(e) => setAutoUnload(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={() => {
                const n = Number(autoUnload);
                if (autoUnload !== "" && Number.isFinite(n) && n !== settings.auto_unload_minutes)
                  save("auto-unload", { auto_unload_minutes: n });
              }}
            />
            <span className="readout text-muted-foreground">min</span>
          </div>
        }
      />
    </SettingsGroup>
  );
}

// -------------------------------------------------------------- models

function ModelsGroup({ settings }: { settings: Settings }) {
  const { save, pending } = useSettingSave();
  const { data: runtime } = useAudioCppRuntime();
  const [modelsDir, setModelsDir] = useDraft(settings.audiocpp_models_dir);
  const [token, setToken] = useState("");
  const external = settings.audiocpp_mode === "external";
  const modelsDefault = runtime?.models_dir_default;

  return (
    <SettingsGroup id="models">
      <SettingRow
        id="audiocpp-mode"
        htmlFor="audiocpp-mode"
        modified={settings.audiocpp_mode !== DEFAULTS.audiocpp_mode}
        onReset={() => save("audiocpp-mode", { audiocpp_mode: DEFAULTS.audiocpp_mode })}
        control={
          <Select
            value={settings.audiocpp_mode}
            onValueChange={(v) => save("audiocpp-mode", { audiocpp_mode: v as "managed" | "external" })}
          >
            <SelectTrigger id="audiocpp-mode" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="managed">Local</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        {/* Which binary actually won: MIRLI_AUDIOCPP_BIN and a copy on PATH
            both outrank the managed install. */}
        {runtime && (
          <div className="readout text-muted-foreground space-y-0.5">
            <p>
              {runtime.engine.installed ? (
                <>
                  Using{" "}
                  <span className="text-foreground">
                    {runtime.engine.source === "managed"
                      ? `the managed runtime ${runtime.engine.version ?? ""}`
                      : runtime.engine.source === "env"
                        ? "your own binary (MIRLI_AUDIOCPP_BIN)"
                        : "an audiocpp_cli found on your PATH"}
                  </span>
                  {runtime.engine.backend ? ` on the ${runtime.engine.backend} backend.` : "."}
                </>
              ) : (
                <>
                  No audio.cpp runtime found — install it from the{" "}
                  <Link to="/models" className="underline underline-offset-2">
                    Models page
                  </Link>
                  .
                </>
              )}
            </p>
            {runtime.engine.path && <p className="break-all">{runtime.engine.path}</p>}
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="models-dir"
        stack
        modified={external && !!modelsDefault && settings.audiocpp_models_dir !== modelsDefault}
        onReset={external ? () => save("models-dir", { audiocpp_models_dir: "" }) : undefined}
        htmlFor="audiocpp-models-dir"
        control={
          <div className="space-y-1">
            <Input
              id="audiocpp-models-dir"
              value={modelsDir}
              readOnly={!external}
              placeholder={modelsDefault ?? ""}
              className={cn_path(!external)}
              onChange={(e) => setModelsDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={() => {
                if (modelsDir !== settings.audiocpp_models_dir)
                  save("models-dir", { audiocpp_models_dir: modelsDir });
              }}
            />
            <p className="text-muted-foreground text-xs">
              {external
                ? "Point this at your audio.cpp models folder and both apps see the same downloads. Empty goes back to the default."
                : "Managed by Mirli. Switch the audio engine to External to share a folder with an audio.cpp you already run."}
            </p>
          </div>
        }
      />

      <SettingRow id="endpoints" stack>
        <Embedded>
          <EndpointSettingsCard />
        </Embedded>
      </SettingRow>

      <SettingRow
        id="hf-token"
        stack
        htmlFor="hf-token"
        control={
          <div className="space-y-2">
            <p className="readout text-muted-foreground flex items-center gap-1.5">
              <EyeOffIcon className="size-3.5" aria-hidden="true" />
              <span className={settings.hf_token_set ? "text-foreground" : undefined}>
                {settings.hf_token_set ? "A token is saved." : "No token saved."}
              </span>
            </p>
            <div className="flex gap-2">
              <Input
                id="hf-token"
                type="password"
                value={token}
                autoComplete="off"
                placeholder={settings.hf_token_set ? "Replace saved token" : "hf_…"}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button
                disabled={!token.trim() || pending}
                onClick={() => save("hf-token", { hf_token: token.trim() }, { onSuccess: () => setToken("") })}
              >
                Save token
              </Button>
            </div>
          </div>
        }
      />
    </SettingsGroup>
  );
}

function cn_path(readOnly: boolean): string {
  return readOnly ? "text-muted-foreground font-mono text-xs" : "font-mono text-xs";
}

// ------------------------------------------------------------- helpers

function HelpersGroup({ settings }: { settings: Settings }) {
  const { save, pending } = useSettingSave();
  const { data: llmStatus } = useLlmStatus();
  const [baseUrl, setBaseUrl] = useDraft(settings.llm_external_base_url);
  const [model, setModel] = useDraft(settings.llm_external_model);
  const [apiKey, setApiKey] = useState("");

  return (
    <SettingsGroup id="helpers">
      <SettingRow
        id="llm-mode"
        htmlFor="llm-mode"
        modified={settings.llm_mode !== DEFAULTS.llm_mode}
        onReset={() => save("llm-mode", { llm_mode: DEFAULTS.llm_mode })}
        control={
          <Select
            value={settings.llm_mode}
            onValueChange={(v) => save("llm-mode", { llm_mode: v as Settings["llm_mode"] })}
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
        }
      >
        <p className="text-muted-foreground text-xs">
          Local runs a small model Mirli manages; External points at your own OpenAI-compatible
          server (Ollama, LM Studio, …).
        </p>

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
                disabled={pending}
                onClick={() => {
                  const first = d.models[0] ?? "";
                  setBaseUrl(d.base_url);
                  setModel(first);
                  save("llm-mode", {
                    llm_mode: "external",
                    llm_external_base_url: d.base_url,
                    llm_external_model: first,
                  });
                }}
              >
                Use it
              </Button>
            </div>
          ))}

        {settings.llm_mode === "managed" && (
          <p className="readout text-muted-foreground">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="llm-base-url">Base URL</Label>
              <Input
                id="llm-base-url"
                value={baseUrl}
                placeholder="http://localhost:11434"
                className="font-mono text-xs"
                onChange={(e) => setBaseUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                onBlur={() => {
                  if (baseUrl !== settings.llm_external_base_url)
                    save("llm-mode", { llm_external_base_url: baseUrl.trim() });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-model-name">Model name</Label>
              <Input
                id="llm-model-name"
                value={model}
                placeholder="qwen3:1.7b"
                className="font-mono text-xs"
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                onBlur={() => {
                  if (model !== settings.llm_external_model)
                    save("llm-mode", { llm_external_model: model.trim() });
                }}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="llm-api-key">
                API key (optional) ·{" "}
                <span className="text-muted-foreground font-normal">
                  {settings.llm_external_api_key_set ? "a key is saved" : "no key saved"}
                </span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="llm-api-key"
                  type="password"
                  value={apiKey}
                  autoComplete="off"
                  placeholder={
                    settings.llm_external_api_key_set ? "Replace saved key" : "Most local servers don't need one"
                  }
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!apiKey.trim() || pending}
                  onClick={() =>
                    save("llm-mode", { llm_external_api_key: apiKey.trim() }, { onSuccess: () => setApiKey("") })
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </SettingRow>

      <SettingRow id="artwork" stack>
        <Embedded>
          <ArtworkSettingsCard settings={settings} />
        </Embedded>
      </SettingRow>
    </SettingsGroup>
  );
}

// ------------------------------------------------------------- storage

function StorageGroup({ settings }: { settings: Settings }) {
  const { save } = useSettingSave();
  const [copied, setCopied] = useState(false);
  const [soundsDir, setSoundsDir] = useDraft(settings.sounds_dir);
  const [picking, setPicking] = useState(false);
  // The server hands back native paths, so the default follows its platform.
  const sep = settings.data_dir.includes("\\") ? "\\" : "/";
  const soundsDefault = `${settings.data_dir}${sep}sounds`;

  function saveSounds(next: string) {
    if (next === settings.sounds_dir) return;
    // Put the field back if the server refused the path.
    save("sounds-dir", { sounds_dir: next }, { onError: () => setSoundsDir(settings.sounds_dir) });
  }

  return (
    <SettingsGroup id="storage">
      <SettingRow
        id="data-dir"
        stack
        htmlFor="data-dir"
        control={
          <div className="flex gap-2">
            <Input id="data-dir" value={settings.data_dir} readOnly className={cn_path(true)} />
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
        }
      >
        <p className="text-muted-foreground text-xs">
          Switch profiles from the chip in the header to point the app at a different library.
          Downloaded models and runtimes live in the install root and are shared by every profile.
        </p>
      </SettingRow>

      <SettingRow
        id="sounds-dir"
        stack
        htmlFor="sounds-dir"
        modified={settings.sounds_dir !== soundsDefault}
        onReset={() => save("sounds-dir", { sounds_dir: "" })}
        control={
          <div className="flex gap-2">
            <Input
              id="sounds-dir"
              value={soundsDir}
              placeholder={soundsDefault}
              className="font-mono text-xs"
              onChange={(e) => setSoundsDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={() => saveSounds(soundsDir)}
            />
            <Button variant="outline" onClick={() => setPicking(true)}>
              <FolderOpenIcon />
              Browse
            </Button>
            <FolderPickerDialog
              open={picking}
              onOpenChange={setPicking}
              initialPath={settings.sounds_dir}
              title="Sounds folder"
              description="Folders on the machine running Mirli — that is where the audio is written. Anything you pick is created if it does not exist yet."
              onSelect={(path) => {
                setSoundsDir(path);
                saveSounds(path);
              }}
            />
          </div>
        }
      />

      <SettingRow
        id="weights-dir"
        stack
        htmlFor="weights-dir"
        control={
          <div className="space-y-1">
            <Input id="weights-dir" value={settings.audiocpp_models_dir} readOnly className={cn_path(true)} />
            <Link
              to="/settings?s=models-dir"
              className="text-muted-foreground text-xs underline underline-offset-2"
            >
              Change it under Models folder
            </Link>
          </div>
        }
      />
    </SettingsGroup>
  );
}

// ----------------------------------------------------------- interface

function InterfaceGroup() {
  const keep = useUiPrefs((s) => s.sidebarKeepExpanded);
  const set = useUiPrefs((s) => s.set);
  const markSaved = useMarkSaved();
  const change = (on: boolean) => {
    set({ sidebarKeepExpanded: on });
    markSaved("sidebar-keep");
  };
  return (
    <SettingsGroup id="interface">
      <SettingRow
        id="sidebar-keep"
        htmlFor="sidebar-keep"
        modified={keep}
        onReset={() => change(false)}
        control={<Switch id="sidebar-keep" checked={keep} onCheckedChange={change} />}
      />
    </SettingsGroup>
  );
}

// ------------------------------------------------------------- privacy

function SetupGroup({ settings }: { settings: Settings }) {
  const { save } = useSettingSave();
  return (
    <SettingsGroup id="setup">
      <SettingRow
        id="setup-simple"
        htmlFor="setup-simple"
        control={
          <Switch
            id="setup-simple"
            checked={settings.setup === "simple"}
            onCheckedChange={(on) => save("setup-simple", { setup: on ? "simple" : "full" })}
          />
        }
      />
      <SettingRow
        id="setup-include-local"
        htmlFor="setup-include-local"
        control={
          <Switch
            id="setup-include-local"
            checked={settings.setup_include_local ?? false}
            onCheckedChange={(on) => save("setup-include-local", { setup_include_local: on })}
          />
        }
      />
    </SettingsGroup>
  );
}

function PrivacyGroup({ settings }: { settings: Settings }) {
  const { save } = useSettingSave();
  const { data: mcpStatus } = useMcpStatus();
  const { data: updateStatus } = useUpdateStatus();
  const [otel, setOtel] = useDraft(settings.otel_endpoint);
  const forcedOff = updateStatus?.disabled_by === "env";

  return (
    <SettingsGroup id="privacy">
      <SettingRow
        id="update-check"
        stack
        modified={!forcedOff && settings.update_check !== DEFAULTS.update_check}
        onReset={() => save("update-check", { update_check: DEFAULTS.update_check })}
      >
        <Embedded>
          <UpdateSettingsCard />
        </Embedded>
      </SettingRow>

      <SettingRow
        id="otel-endpoint"
        stack
        htmlFor="otel-endpoint"
        modified={settings.otel_endpoint !== DEFAULTS.otel_endpoint}
        onReset={() => save("otel-endpoint", { otel_endpoint: "" })}
        control={
          <div className="space-y-1.5">
            <Label htmlFor="otel-endpoint" className="text-muted-foreground text-xs font-normal">
              OTLP/HTTP collector endpoint
            </Label>
            <Input
              id="otel-endpoint"
              value={otel}
              placeholder="http://localhost:4318"
              className="font-mono text-xs"
              onChange={(e) => setOtel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={() => {
                if (otel !== settings.otel_endpoint) save("otel-endpoint", { otel_endpoint: otel.trim() });
              }}
            />
            <p className="text-muted-foreground text-xs">
              Traces go to <span className="font-mono">/v1/traces</span>, metrics to{" "}
              <span className="font-mono">/v1/metrics</span> (Jaeger, Tempo, Honeycomb and the OTel
              Collector all speak this). The call log itself is on the{" "}
              <Link to="/agents" className="underline underline-offset-2">
                Agents
              </Link>{" "}
              page.
            </p>
          </div>
        }
      >
        {mcpStatus && (
          <div className="flex items-start gap-2 text-xs">
            {mcpStatus.otel.enabled ? (
              <CheckCircle2Icon className="text-ok mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangleIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            )}
            <div className="text-muted-foreground space-y-0.5">
              {mcpStatus.otel.enabled ? (
                <p>
                  Exporting to <span className="font-mono">{mcpStatus.otel.endpoint}</span>
                  {mcpStatus.otel.source === "env" && " (from OTEL_EXPORTER_OTLP_ENDPOINT)"}
                </p>
              ) : (
                <p>Not exporting — set an endpoint to turn this on.</p>
              )}
              {mcpStatus.otel.source === "env" && (
                <p>OTEL_EXPORTER_OTLP_ENDPOINT is set in the server&apos;s environment, which takes priority over this field.</p>
              )}
              {mcpStatus.otel.error && <p className="text-danger">{mcpStatus.otel.error}</p>}
            </div>
          </div>
        )}
      </SettingRow>
    </SettingsGroup>
  );
}

// -------------------------------------------------------------- danger

function DangerGroup({ settings }: { settings: Settings }) {
  const { save, pending } = useSettingSave();
  return (
    <SettingsGroup id="danger">
      <SettingRow
        id="clear-hf-token"
        control={
          <ConfirmAction
            label="Clear token"
            title="Clear the Hugging Face token?"
            description="The saved token is deleted. Downloads from gated repositories fail until you save a token again."
            confirmLabel="Clear token"
            disabled={!settings.hf_token_set || pending}
            onConfirm={() => save("clear-hf-token", { hf_token: "" })}
          />
        }
      />
      <SettingRow
        id="rerun-setup"
        control={
          <ConfirmAction
            label="Run setup again"
            title="Run first-run setup again?"
            description="The setup wizard is marked as not done. It opens by itself only when no models are installed; with models already on disk, nothing will appear."
            confirmLabel="Run setup again"
            disabled={pending || !settings.onboarded_at}
            onConfirm={() => save("rerun-setup", { onboarded_at: "" })}
          />
        }
      >
        <p className="readout text-muted-foreground">
          {settings.onboarded_at
            ? `Completed ${new Date(settings.onboarded_at).toLocaleDateString()}.`
            : "Not completed yet."}
        </p>
      </SettingRow>
    </SettingsGroup>
  );
}
