/**
 * The Endpoints panel on Settings — custom audio endpoints.
 *
 * For people who already run their models somewhere (LocalAI, a gateway, a
 * homelab box) and want Soundbox to send requests there instead of
 * downloading a second copy of the weights. Each saved endpoint becomes one
 * model in the pickers, so everything after "pick a model" works unchanged.
 *
 * The body template is shown rather than hidden behind the preset. There is no
 * standard request shape for music or sound effects — two servers that both
 * expose `/v1/audio/music` disagree on the field names — so the preset is a
 * starting point and the template is the real setting. Test runs one short
 * render through the form as it stands, saved or not, which is how a wrong
 * field name shows up before a real generation fails on it.
 */

import { useState } from "react";
import { CheckCircle2Icon, EyeOffIcon, Loader2Icon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

import { errorMessage, type AudioEndpoint, type AudioEndpointInput, type EndpointPreset } from "@/lib/api";
import { useDeleteEndpoint, useEndpoints, useSaveEndpoint, useTestEndpoint } from "@/lib/queries";

const TASK_LABEL: Record<AudioEndpoint["task"], string> = {
  sfx: "Sound effects",
  music: "Music",
  speech: "Speech",
};

/** A form's worth of state. Strings for the number fields so a half-typed
 *  value doesn't snap back while the user is still typing it. */
interface Draft {
  id: string;
  name: string;
  task: AudioEndpoint["task"];
  url: string;
  apiKey: string;
  apiKeySet: boolean;
  bodyTemplate: string;
  responsePath: string;
  pcmSampleRate: string;
  maxDurationS: string;
  voices: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: "",
  name: "",
  task: "music",
  url: "",
  apiKey: "",
  apiKeySet: false,
  bodyTemplate: '{\n  "prompt": "{{prompt}}",\n  "duration": {{duration}}\n}',
  responsePath: "",
  pcmSampleRate: "24000",
  maxDurationS: "30",
  voices: "",
  enabled: true,
};

function draftFrom(ep: AudioEndpoint): Draft {
  return {
    id: ep.id,
    name: ep.name,
    task: ep.task,
    url: ep.url,
    apiKey: "",
    apiKeySet: ep.api_key_set,
    bodyTemplate: ep.body_template,
    responsePath: ep.response_path,
    pcmSampleRate: String(ep.pcm_sample_rate),
    maxDurationS: String(ep.max_duration_s),
    voices: ep.voices.join(", "),
    enabled: ep.enabled,
  };
}

function inputFrom(d: Draft): AudioEndpointInput {
  return {
    name: d.name.trim(),
    task: d.task,
    url: d.url.trim(),
    // Blank means "keep the saved key" — undefined is how the API says that.
    api_key: d.apiKey.trim() ? d.apiKey.trim() : undefined,
    headers: {},
    body_template: d.bodyTemplate,
    response_path: d.responsePath.trim(),
    pcm_sample_rate: Number(d.pcmSampleRate) || 24000,
    max_duration_s: Number(d.maxDurationS) || 30,
    voices: d.voices
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    enabled: d.enabled,
  };
}

/**
 * Whether a URL points at this machine or the local network — the same rule as
 * the server's `isLocalUrl` (server/src/endpoints/types.ts). Anything else gets
 * a notice that prompts leave the network: Soundbox says it is local-first, and
 * an endpoint is the one place a prompt can quietly stop being local.
 */
function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true; // half-typed: nothing to warn about yet
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  if (/\.(local|lan|home|internal|home\.arpa)$/.test(host)) return true;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "Homelab ACE-Step" → "homelab-ace-step": the id becomes the model id. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "endpoint"
  );
}

export function EndpointSettingsCard() {
  const { data } = useEndpoints();
  const save = useSaveEndpoint();
  const remove = useDeleteEndpoint();
  /** null: closed. `isNew` decides whether the id is still editable. */
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | null>(null);

  const endpoints = data?.endpoints ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custom endpoints</CardTitle>
        <CardDescription>
          Send generation to a server you already run — LocalAI, an OpenAI-compatible speech
          server, a gateway — instead of downloading the model here. Each endpoint appears in the
          model pickers alongside your local models.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {endpoints.length === 0 && (
          <p className="text-muted-foreground text-sm">No endpoints yet.</p>
        )}
        {endpoints.map((ep) => (
          <div
            key={ep.id}
            className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{ep.name}</span>
                <Badge variant="secondary">{TASK_LABEL[ep.task]}</Badge>
                {!isLocalUrl(ep.url) && <Badge variant="outline">Off-network</Badge>}
              </div>
              <p className="text-muted-foreground truncate font-mono text-xs">{ep.url}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={ep.enabled}
                aria-label={`${ep.enabled ? "Disable" : "Enable"} ${ep.name}`}
                disabled={save.isPending}
                onCheckedChange={(enabled) =>
                  save.mutate({ id: ep.id, input: { ...inputFrom(draftFrom(ep)), enabled } })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${ep.name}`}
                onClick={() => setEditing({ draft: draftFrom(ep), isNew: false })}
              >
                <PencilIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${ep.name}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${ep.name}? Sounds already made with it stay in the library.`)) {
                    remove.mutate(ep.id);
                  }
                }}
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={() => setEditing({ draft: { ...EMPTY_DRAFT }, isNew: true })}>
          <PlusIcon className="size-4" />
          Add endpoint
        </Button>
      </CardContent>

      {editing && (
        <EndpointDialog
          key={editing.draft.id || "new"}
          initial={editing.draft}
          isNew={editing.isNew}
          presets={data?.presets ?? []}
          variables={data?.variables ?? {}}
          takenIds={endpoints.map((e) => e.id)}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(id, input) => save.mutate({ id, input }, { onSuccess: () => setEditing(null) })}
        />
      )}
    </Card>
  );
}

function EndpointDialog({
  initial,
  isNew,
  presets,
  variables,
  takenIds,
  saving,
  onClose,
  onSave,
}: {
  initial: Draft;
  isNew: boolean;
  presets: EndpointPreset[];
  variables: Record<string, string>;
  takenIds: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (id: string, input: AudioEndpointInput) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  /** Until the id is typed into directly, it follows the name. */
  const [idTouched, setIdTouched] = useState(!isNew);
  const [presetHint, setPresetHint] = useState<EndpointPreset | null>(null);
  const test = useTestEndpoint();

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (!idTouched && "name" in patch) next.id = slugify(next.name);
      return next;
    });
    test.reset();
  };

  const applyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    const e = preset.endpoint;
    setPresetHint(preset);
    set({
      name: draft.name || preset.label,
      task: e.task,
      url: e.url,
      bodyTemplate: e.body_template,
      responsePath: e.response_path,
      pcmSampleRate: String(e.pcm_sample_rate),
      maxDurationS: String(e.max_duration_s),
      voices: e.voices.join(", "),
    });
  };

  const idClash = isNew && takenIds.includes(draft.id);
  const idValid = /^[a-z0-9][a-z0-9-]{0,47}$/.test(draft.id);
  const canSave = draft.name.trim() && draft.url.trim() && idValid && !idClash && !saving;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add an endpoint" : `Edit ${initial.name}`}</DialogTitle>
          <DialogDescription>
            Soundbox POSTs the body below to the URL and expects audio back. WAV is read directly;
            MP3, FLAC and other formats need ffmpeg on this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isNew && presets.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-preset">Start from</Label>
              <Select onValueChange={applyPreset}>
                <SelectTrigger id="ep-preset">
                  <SelectValue placeholder="Pick a preset (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {presetHint && (
                <p className="text-muted-foreground text-xs">
                  {presetHint.hint}{" "}
                  <a className="underline" href={presetHint.docs_url} target="_blank" rel="noreferrer">
                    API docs
                  </a>
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">Name</Label>
              <Input id="ep-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-task">Used for</Label>
              <Select value={draft.task} onValueChange={(v) => set({ task: v as Draft["task"] })}>
                <SelectTrigger id="ep-task">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sfx">Sound effects</SelectItem>
                  <SelectItem value="music">Music</SelectItem>
                  <SelectItem value="speech">Speech</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-id">Id</Label>
            <Input
              id="ep-id"
              value={draft.id}
              disabled={!isNew}
              className="font-mono text-xs"
              onChange={(e) => {
                setIdTouched(true);
                set({ id: e.target.value });
              }}
            />
            <p className="text-muted-foreground text-xs">
              {idClash
                ? "Another endpoint already has this id."
                : draft.id && !idValid
                  ? "Lower-case letters, digits and hyphens only."
                  : `Sounds made with it record the model as endpoint:${draft.id || "…"}. Fixed once saved.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-url">URL</Label>
            <Input
              id="ep-url"
              value={draft.url}
              placeholder="http://localhost:8080/v1/sound-generation"
              className="font-mono text-xs"
              onChange={(e) => set({ url: e.target.value })}
            />
            {draft.url.trim() && !isLocalUrl(draft.url.trim()) && (
              <p className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs">
                <span className="font-medium">{hostOf(draft.url.trim())}</span> is outside this machine and
                your local network. Prompts, lyrics and voice clips you use with this endpoint are sent
                there, and what that service keeps or charges is up to it.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-key">API key (optional)</Label>
            {draft.apiKeySet && (
              <div className="flex items-center gap-2 text-xs">
                <EyeOffIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
                <span>A key is saved. Leave this blank to keep it.</span>
              </div>
            )}
            <Input
              id="ep-key"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              placeholder={draft.apiKeySet ? "Replace saved key" : "Sent as Authorization: Bearer …"}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-body">Body template</Label>
            <Textarea
              id="ep-body"
              value={draft.bodyTemplate}
              rows={9}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(e) => set({ bodyTemplate: e.target.value })}
            />
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">
                Variables — a field that comes out empty is left out of the request
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {Object.entries(variables).map(([name, meaning]) => (
                  <div key={name} className="contents">
                    <dt className="font-mono">{`{{${name}}}`}</dt>
                    <dd className="text-muted-foreground">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-max">Longest clip (seconds)</Label>
              <Input
                id="ep-max"
                inputMode="decimal"
                value={draft.maxDurationS}
                onChange={(e) => set({ maxDurationS: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-path">Response path (JSON only)</Label>
              <Input
                id="ep-path"
                value={draft.responsePath}
                placeholder="Blank when the response is the audio"
                className="font-mono text-xs"
                onChange={(e) => set({ responsePath: e.target.value })}
              />
            </div>
          </div>

          {draft.task === "speech" && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-voices">Voices</Label>
              <Input
                id="ep-voices"
                value={draft.voices}
                placeholder="alloy, echo, nova"
                onChange={(e) => set({ voices: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                Comma-separated; the first is the default. Filled into {"{{voice}}"}.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="ep-enabled">Show in the model pickers</Label>
            <Switch id="ep-enabled" checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={!draft.url.trim() || test.isPending}
              onClick={() => test.mutate({ ...inputFrom(draft), id: isNew ? null : draft.id })}
            >
              {test.isPending && <Loader2Icon className="size-4 animate-spin" />}
              Test
            </Button>
            {test.isSuccess && (
              <p className="flex items-center gap-1.5 text-xs">
                <CheckCircle2Icon className="size-4 text-ok" aria-hidden="true" />
                Got {test.data.duration_s.toFixed(1)}s of audio at {(test.data.sample_rate / 1000).toFixed(1)} kHz,{" "}
                {test.data.channels === 1 ? "mono" : `${test.data.channels} channels`}.
              </p>
            )}
            {test.isError && <p className="text-destructive text-xs whitespace-pre-wrap">{errorMessage(test.error)}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => onSave(draft.id, inputFrom(draft))}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
