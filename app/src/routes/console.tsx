/**
 * Console — the same Generate session as `/app`, as a piece of hardware.
 *
 * `/app` is a conversation: type, get sounds, refine. This is the front panel
 * for people who want their hands on every parameter at once — a rack unit
 * with a model-select button bank, a length fader, steps and guidance on
 * rotary knobs, a seed readout with a lock switch, patch memory, a VU meter
 * that swings while the job runs. Every control writes to the same session
 * store the chat view reads, so you can flip between the two mid-thread and
 * nothing is lost; the plumbing is all in `useGenerateSession`.
 *
 * The retro cues are load-bearing where they can be: lamps show model state
 * (lit = in VRAM, dim = installed, off = not installed), the seven-segment
 * readouts show *what will be sent*, and disabled controls stay on the panel
 * greyed out — a knob for a parameter this model ignores is still a knob,
 * just one that isn't wired to anything, which is exactly how the hardware
 * would say it. Anything not supported by the model is dark, not gone.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DicesIcon,
  MessageSquareTextIcon,
  PencilLineIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FailureCard } from "@/components/failure-card";
import { SoundCard } from "@/components/sound-card";
import { Knob } from "@/components/console/knob";
import { Fader } from "@/components/console/fader";
import { Led, Meter, Panel, PushButton, Rocker, Seg, SelectorRow } from "@/components/console/hardware";
import { PATCH_SLOTS, usePatches } from "@/components/console/patches";
import "@/components/console/console.css";

import { useGenerateSession } from "@/hooks/use-generate-session";
import type { Model, GenerateRequest, Job } from "@/lib/api";
import { prefillFromSound, usePrefillStore } from "@/lib/generate-store";
import type { Turn } from "@/lib/session-store";
import { formatDuration, formatHz } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------- helpers */

const MAX_SEED = 2 ** 31 - 1;

/** Sensible top of the steps dial for this model — four times its tuned
 *  default, never fewer than 32, never past the API's 500. */
function stepsCeiling(model: Model | undefined): number {
  const d = model?.defaults.steps ?? 50;
  return Math.min(500, Math.max(32, d * 4));
}

function niceMarks(max: number): number[] {
  const step = max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 30;
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

const PHASE_LABEL: Record<string, string> = {
  queued: "QUEUED",
  installing: "INSTALL",
  loading: "LOADING",
  downloading: "FETCH",
  generating: "RENDER",
  encoding: "ENCODE",
  done: "DONE",
};

function summarise(req: GenerateRequest): string {
  const bits = [`${req.duration_s.toFixed(1)}s`];
  if ((req.variations ?? 1) > 1) bits.push(`${req.variations}×`);
  if (req.seed !== null && req.seed !== undefined) bits.push(`seed ${req.seed}`);
  if (req.steps) bits.push(`${req.steps} st`);
  if (req.cfg) bits.push(`cfg ${req.cfg}`);
  if (req.negative_prompt) bits.push(`no “${req.negative_prompt}”`);
  return bits.join(" · ");
}

/* -------------------------------------------------------------- page */

export function ConsolePage() {
  const s = useGenerateSession();
  const { models, model, settings, patch } = s;

  const [armed, setArmed] = useState<"store" | "clear" | null>(null);
  const patches = usePatches();

  const supports = model?.supports;
  const maxDur = model?.max_duration_s ?? 30;
  const durStep = maxDur > 60 ? 0.5 : 0.1;
  const stepsMax = stepsCeiling(model);
  const cfgMax = model?.max_cfg ?? 15;
  const cfgStep = cfgMax <= 3 ? 0.05 : 0.1;

  const notReady =
    model &&
    (model.status === "not_installed" ||
      model.status === "needs_runtime" ||
      model.status === "incomplete" ||
      model.status === "downloading");

  /* Meter: progress while running, otherwise settles at rest. */
  const [rest, setRest] = useState(0);
  useEffect(() => {
    if (s.running) return;
    // a little settle after a job finishes, then back to zero
    if (s.job?.status === "done") {
      setRest(1);
      const t = setTimeout(() => setRest(0), 900);
      return () => clearTimeout(t);
    }
    setRest(0);
  }, [s.running, s.job?.status]);
  const meterValue = s.running ? (s.job?.progress ?? 0.04) : rest;

  const errored = s.job?.status === "error" || s.turns[s.turns.length - 1]?.status === "error";
  const phase = s.running ? PHASE_LABEL[s.job?.phase ?? "queued"] ?? "BUSY" : errored ? "ERROR" : "READY";

  const roll = () => patch({ seed: Math.floor(Math.random() * (MAX_SEED + 1)), seedLocked: true });

  const recall = (i: number) => {
    const p = patches.slots[i];
    if (armed === "store") {
      patches.store(i, settings);
      setArmed(null);
      return;
    }
    if (armed === "clear") {
      patches.clear(i);
      setArmed(null);
      return;
    }
    if (!p) {
      patches.store(i, settings);
      return;
    }
    // A patch may name an model this server no longer lists; keep the rest.
    const known = models?.some((e) => e.id === p.settings.modelId);
    s.applySettings({ ...p.settings, modelId: known ? p.settings.modelId : settings.modelId });
  };

  const ordered = useMemo(() => [...s.turns].reverse(), [s.turns]);

  return (
    <div className="console mx-auto w-full max-w-6xl space-y-3">
      {/* ------------------------------------------------------ nameplate */}
      <Panel className="overflow-hidden" bodyClassName="pt-2 pb-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex flex-col leading-none">
              <span className="font-heading text-lg font-semibold tracking-[0.18em] text-[var(--cx-nameplate)] uppercase">
                Konchi
              </span>
              <span className="cx-title mt-1">Console · Mk I · text-to-sfx rack</span>
            </div>
            <div className="hidden h-8 w-px bg-[var(--cx-line)] sm:block" />
            <div className="hidden items-center gap-4 sm:flex">
              <Led on color="green" label="Power" />
              <Led on={!s.running && !errored} label="Ready" />
              <Led on={s.running} blink label="Busy" />
              <Led on={Boolean(errored)} color="red" label="Err" />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="flex flex-col items-end gap-1">
              <Seg value={phase} digits={7} size="sm" />
              <span className="cx-label" style={{ color: "var(--cx-engrave-dim)" }}>
                {s.running && s.job?.message
                  ? s.job.message.slice(0, 40)
                  : s.sessionId
                    ? `session ${s.sessionId.slice(0, 8)}`
                    : "new session"}
              </span>
            </div>
            <Meter value={meterValue} peak={s.running && (s.job?.progress ?? 0) > 0.9} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon-sm" className="text-[var(--cx-engrave)]">
                  <Link to="/chat" aria-label="Switch to the conversation view">
                    <MessageSquareTextIcon />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Conversation view (same session)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </Panel>

      {/* -------------------------------------------- model / program / go */}
      <div className="grid gap-3 lg:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)_minmax(12rem,13rem)]">
        {/* MODEL bank */}
        <Panel
          title="Model"
          aside={
            model && (
              <span className="cx-label" style={{ color: "var(--cx-engrave-dim)" }}>
                {formatHz(model.sample_rate)} · {model.channels === 1 ? "mono" : "stereo"}
              </span>
            )
          }
        >
          {s.modelsLoading ? (
            <p className="cx-label">Scanning…</p>
          ) : !models?.length ? (
            <p className="cx-label">No models reported</p>
          ) : (
            <div className="grid gap-1.5">
              {models.map((e) => {
                const status = e.status;
                const lamp = status === "loaded" || status === "installed";
                return (
                  <PushButton
                    key={e.id}
                    pressed={e.id === settings.modelId}
                    lamp={lamp}
                    lampColor={
                      status === "loaded"
                        ? "green"
                        : status === "error"
                          ? "red"
                          : "amber"
                    }
                    onClick={() => patch({ modelId: e.id })}
                    title={`${e.name} · ${status.replace("_", " ")} · max ${e.max_duration_s}s · ${e.license.name}`}
                    className={cn(!lamp && "opacity-70")}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] font-medium tracking-wide">{e.name}</span>
                      <span className="cx-label shrink-0" style={{ color: "var(--cx-engrave-dim)" }}>
                        {e.max_duration_s}s
                      </span>
                    </span>
                  </PushButton>
                );
              })}
            </div>
          )}
          {model && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="cx-label" style={{ color: model.license.commercial === "no" ? "var(--cx-red)" : "var(--cx-engrave-dim)" }}>
                {model.license.name}
              </span>
              {notReady && (
                <Link to="/models" className="cx-label underline underline-offset-2" style={{ color: "var(--cx-lamp)" }}>
                  install on Models →
                </Link>
              )}
            </div>
          )}
        </Panel>

        {/* PROGRAM */}
        <Panel
          title="Program"
          aside={
            <div className="flex items-center gap-3">
              <span className="cx-label" style={{ color: "var(--cx-engrave-dim)" }}>
                material · action · space
              </span>
              {s.llmEnabled && !s.isTts && (
                <button
                  type="button"
                  className="cx-label underline underline-offset-2 disabled:opacity-40"
                  style={{ color: "var(--cx-lamp)" }}
                  disabled={!settings.prompt.trim() || s.enhancing}
                  onClick={() => s.enhance(1)}
                >
                  {s.enhancing ? "enhancing…" : "enhance"}
                </button>
              )}
              {s.canUndoEnhance && (
                <button
                  type="button"
                  className="cx-label underline underline-offset-2"
                  style={{ color: "var(--cx-engrave-dim)" }}
                  onClick={s.undoEnhance}
                >
                  undo
                </button>
              )}
            </div>
          }
        >
          <div className="cx-tape">
            <textarea
              id="prompt"
              rows={4}
              value={settings.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="heavy wooden crate dropping onto a concrete floor, close mic, dry room"
              aria-label="Prompt"
              maxLength={2000}
            />
            <span className="cursor-bar">{settings.prompt.length}/2000</span>
          </div>
          {s.enhanceError && (
            <p className="cx-label mt-1" style={{ color: "var(--cx-red)" }}>
              {s.enhanceError}
            </p>
          )}

          <div className="mt-3 flex items-start gap-3">
            <Rocker
              label="Reject"
              checked={Boolean(supports?.negative_prompt) && rejectOn(settings.negativePrompt)}
              disabled={!supports?.negative_prompt}
              onChange={(on) => patch({ negativePrompt: on ? (settings.negativePrompt || " ") : "" })}
              hint={supports?.negative_prompt ? "Negative prompt — what to steer away from" : "This model has no negative conditioning"}
            />
            <div
              className={cn("cx-tape min-w-0 flex-1 transition-opacity", (!supports?.negative_prompt || !rejectOn(settings.negativePrompt)) && "opacity-40")}
            >
              <textarea
                rows={1}
                value={settings.negativePrompt.trimStart() === "" ? "" : settings.negativePrompt}
                onChange={(e) => patch({ negativePrompt: e.target.value })}
                onFocus={() => {
                  if (supports?.negative_prompt && !rejectOn(settings.negativePrompt)) patch({ negativePrompt: " " });
                }}
                disabled={!supports?.negative_prompt}
                placeholder={supports?.negative_prompt ? "reverb, music, voices" : "— not wired on this model —"}
                aria-label="Negative prompt"
                className="text-[12px]!"
              />
            </div>
          </div>
        </Panel>

        {/* TRANSPORT */}
        <Panel title="Transport" bodyClassName="flex flex-col items-stretch gap-3">
          <button
            type="button"
            className="cx-transport flex h-24 flex-col items-center justify-center gap-1"
            disabled={!s.canSubmit || Boolean(notReady)}
            onClick={() => s.submit()}
            aria-label={s.running ? "Queue another generation" : "Generate"}
          >
            <span className="font-heading text-xl font-semibold tracking-[0.2em] uppercase">
              Gen
            </span>
            <span className="cx-label" style={{ color: "inherit", opacity: 0.8 }}>
              {s.running ? `${Math.round((s.job?.progress ?? 0) * 100)}%` : "Ctrl + Enter"}
            </span>
          </button>
          {/* Its own switch, and only while there is something to stop. Gen
              used to become Stop while a job ran, which made the one control
              that could queue a second take cancel the first instead — on a
              front panel especially, a button that transposes into its own
              opposite is the wrong affordance. */}
          {s.running && (
            <button
              type="button"
              data-stop="true"
              className="cx-transport flex h-10 items-center justify-center"
              onClick={() => s.cancelCurrent()}
              aria-label="Stop the running job"
            >
              <span className="font-heading text-sm font-semibold tracking-[0.2em] uppercase">
                Stop
              </span>
            </button>
          )}
          <div className="flex items-center justify-between">
            <span className="cx-label">Est.</span>
            <Seg value={s.estimateS != null ? formatDuration(s.estimateS) : "--"} digits={5} size="sm" dim={s.estimateS == null} />
          </div>
          <div className="flex items-center justify-between">
            <span className="cx-label">Takes</span>
            <Seg value={String(settings.variations)} digits={1} size="sm" />
          </div>
          <div className="flex items-center justify-between">
            <span className="cx-label">Out</span>
            <Seg value={`${settings.duration.toFixed(1)}s`} digits={5} size="sm" />
          </div>
          {s.running && s.job?.status === "queued" && s.job.queue_position != null && (
            <span className="cx-label" style={{ color: "var(--cx-engrave-dim)" }}>
              #{s.job.queue_position} in queue
            </span>
          )}
        </Panel>
      </div>

      {/* ------------------------------------- parameters / memory / monitor */}
      <div className="grid gap-3 xl:grid-cols-4">
        <Panel
          className="xl:col-span-2"
          title="Parameters"
          aside={
            model && (
              <span className="cx-label" style={{ color: "var(--cx-engrave-dim)" }}>
                {model.name} · double-click a control to reset
              </span>
            )
          }
          bodyClassName="flex flex-wrap items-end justify-around gap-x-6 gap-y-5"
        >
          <Fader
            label="Length"
            value={settings.duration}
            min={0.5}
            max={maxDur}
            step={durStep}
            defaultValue={model?.defaults.duration_s}
            onChange={(v) => patch({ duration: v })}
            format={(v) => `${v.toFixed(1)}s`}
            marks={niceMarks(maxDur).filter((m) => m >= 0.5)}
            markFormat={(v) => `${v}`}
            height={168}
          />

          <SelectorRow
            label="Takes"
            options={[1, 2, 3, 4]}
            value={settings.variations}
            onChange={(v) => patch({ variations: v })}
          />

          <Knob
            label="Steps"
            value={settings.steps ?? model?.defaults.steps ?? 1}
            min={1}
            max={stepsMax}
            step={1}
            defaultValue={model?.defaults.steps ?? undefined}
            detents={model?.defaults.steps ? [model.defaults.steps] : undefined}
            disabled={!supports?.steps}
            onChange={(v) => patch({ steps: v })}
            size={64}
          />

          <Knob
            label="Guidance"
            value={settings.cfg ?? model?.defaults.cfg ?? 0}
            min={0}
            max={cfgMax}
            step={cfgStep}
            defaultValue={model?.defaults.cfg ?? undefined}
            detents={model?.defaults.cfg != null ? [model.defaults.cfg] : undefined}
            disabled={!supports?.cfg}
            onChange={(v) => patch({ cfg: v })}
            format={(v) => v.toFixed(cfgStep < 0.1 ? 2 : 1)}
            size={64}
          />

          {/* SEED module */}
          <div className="flex items-end gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-2">
                <div className="cx-seg text-sm" data-dim={!settings.seedLocked ? "true" : undefined} style={{ minWidth: "12ch" }}>
                  <span className="ghost" aria-hidden="true">
                    8888888888
                  </span>
                  <input
                    aria-label="Seed"
                    inputMode="numeric"
                    value={settings.seedLocked ? (settings.seed ?? "") : ""}
                    placeholder={settings.seedLocked ? "0" : "RANDOM"}
                    disabled={!supports?.seed}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                      if (!digits) {
                        patch({ seed: null, seedLocked: true });
                        return;
                      }
                      patch({ seed: Math.min(MAX_SEED, Number(digits)), seedLocked: true });
                    }}
                    onFocus={() => {
                      if (!settings.seedLocked) patch({ seedLocked: true, seed: settings.seed ?? 0 });
                    }}
                    style={{ textAlign: "right" }}
                  />
                </div>
                <button
                  type="button"
                  className="cx-push h-9! min-h-0! w-9! shrink-0 justify-center! px-0!"
                  onClick={roll}
                  disabled={!supports?.seed}
                  aria-label="Roll a new seed"
                  title="Roll a new seed and lock it"
                >
                  <DicesIcon className="size-4" />
                </button>
              </div>
              <span className="cx-label">Seed</span>
            </div>
            <Rocker
              label="Lock"
              checked={settings.seedLocked}
              disabled={!supports?.seed}
              onChange={(on) => patch({ seedLocked: on, seed: on ? (settings.seed ?? Math.floor(Math.random() * (MAX_SEED + 1))) : settings.seed })}
              hint="Locked: the same seed every take. Unlocked: a fresh seed per generation."
            />
          </div>
        </Panel>

        {/* PATCH MEMORY */}
        <Panel
          title="Patch memory"
          aside={
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                className={cn("cx-push min-h-0! w-auto! px-2! py-1!", armed === "store" && "text-[var(--cx-lamp)]")}
                aria-pressed={armed === "store"}
                onClick={() => setArmed(armed === "store" ? null : "store")}
                title="Arm, then press a slot to overwrite it with the current panel"
              >
                <span className="cx-label" style={{ color: "inherit" }}>
                  Store
                </span>
              </button>
              <button
                type="button"
                className={cn("cx-push min-h-0! w-auto! px-2! py-1!", armed === "clear" && "text-[var(--cx-red)]")}
                aria-pressed={armed === "clear"}
                onClick={() => setArmed(armed === "clear" ? null : "clear")}
                title="Arm, then press a slot to empty it"
              >
                <span className="cx-label" style={{ color: "inherit" }}>
                  Clr
                </span>
              </button>
            </span>
          }
        >
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: PATCH_SLOTS }, (_, i) => {
              const p = patches.slots[i];
              return (
                <button
                  key={i}
                  type="button"
                  className={cn("cx-push flex-col! items-stretch! gap-1! px-2! py-1.5!", !p && "opacity-70")}
                  onClick={() => recall(i)}
                  title={
                    p
                      ? `${p.name}\n${p.settings.modelId} · ${p.settings.duration}s${p.settings.steps ? ` · ${p.settings.steps} st` : ""}${p.settings.cfg != null ? ` · cfg ${p.settings.cfg}` : ""}\n${armed === "store" ? "Press to overwrite" : armed === "clear" ? "Press to clear" : "Press to recall"}`
                      : "Empty — press to store the current panel"
                  }
                >
                  <span className="flex items-center justify-between">
                    <span className="cx-label" style={{ letterSpacing: 0 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Led on={Boolean(p)} blink={Boolean(armed)} color={armed === "clear" ? "red" : "amber"} />
                  </span>
                  <span className="cx-label truncate text-left" style={{ color: p ? "var(--cx-engrave)" : "var(--cx-engrave-dim)", letterSpacing: "0.04em", textTransform: "none" }}>
                    {p ? p.name : "— empty —"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="cx-label mt-3" style={{ color: "var(--cx-engrave-dim)", whiteSpace: "normal", lineHeight: 1.6 }}>
            A slot holds every control, prompt included. Empty slot: press to store. Full slot: press to recall; arm Store or Clr first to overwrite or empty it. Stored in this browser only.
          </p>
        </Panel>

        {/* MONITOR — right column of the same row, so the panel that shows
            what's actually rendering sits beside the controls that drive it
            rather than pushed below the fold. */}
        <Panel
          title="Monitor"
          aside={
            <span className="cx-label" style={{ color: "var(--cx-engrave-dim)" }}>
              {s.turns.length ? `${s.turns.length} take${s.turns.length === 1 ? "" : "s"}` : "empty"}
            </span>
          }
          bodyClassName="space-y-3 max-h-[26rem] overflow-y-auto"
        >
          {ordered.length === 0 ? (
            <div className="cx-well flex items-center justify-center px-3 py-8 text-center">
              <span className="cx-label" style={{ color: "var(--cx-engrave-dim)", whiteSpace: "normal" }}>
                Output appears here. Everything you render is also in the Library.
              </span>
            </div>
          ) : (
            ordered.map((turn) => (
              <TakeRow
                key={turn.id}
                turn={turn}
                live={turn.jobId ? (s.jobs[turn.jobId] ?? null) : null}
                modelName={s.modelNames.get(turn.request.model)}
                onRecall={() => s.reuseTurn(turn)}
                onCancel={() => s.cancelTurn(turn)}
              />
            ))
          )}
          {s.streamError && (
            <p className="cx-label" style={{ color: "var(--cx-red)", whiteSpace: "normal" }}>
              Lost contact with the job stream: {s.streamError}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** The negative-prompt rocker is "on" when the field holds anything at all —
 *  including the single space the rocker writes to arm it before typing.
 *  Trailing whitespace is trimmed off before the request is built. */
function rejectOn(v: string): boolean {
  return v.length > 0;
}

/* --------------------------------------------------------------- take */

function TakeRow({
  turn,
  live,
  modelName,
  onRecall,
  onCancel,
}: {
  turn: Turn;
  live: Job | null;
  modelName?: string;
  onRecall: () => void;
  onCancel: () => void;
}) {
  const progress = live?.progress ?? 0;
  return (
    <article className="cx-well animate-in fade-in-0 overflow-hidden duration-300">
      <header className="flex items-start gap-3 px-3 py-2">
        <Led
          on
          color={turn.status === "error" ? "red" : turn.status === "pending" ? "amber" : "green"}
          blink={turn.status === "pending"}
          className="mt-1.5"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px]" title={turn.request.prompt}>
            {turn.request.prompt}
          </p>
          <p className="cx-label mt-0.5" style={{ color: "var(--cx-engrave-dim)", letterSpacing: "0.06em", textTransform: "none" }}>
            {modelName ?? turn.request.model} · {summarise(turn.request)}
          </p>
        </div>
        {turn.status === "pending" ? (
          <span className="flex items-center gap-2">
            <Seg value={`${Math.round(progress * 100)}%`} digits={4} size="sm" />
            <button type="button" className="cx-push min-h-0! w-auto! px-2! py-1!" onClick={onCancel}>
              <span className="cx-label" style={{ color: "inherit" }}>
                Stop
              </span>
            </button>
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cx-push min-h-0! w-auto! px-2! py-1!" onClick={onRecall} aria-label="Recall these settings to the panel">
                <PencilLineIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Recall to panel</TooltipContent>
          </Tooltip>
        )}
      </header>

      {turn.status === "pending" ? (
        <div className="px-3 pb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--cx-bezel)]">
            <div
              className="h-full rounded-full bg-[var(--cx-lamp)] shadow-[0_0_6px_var(--cx-lamp-glow)] transition-[width]"
              style={{ width: `${Math.max(2, progress * 100)}%` }}
            />
          </div>
          <p className="cx-label mt-1.5" style={{ color: "var(--cx-engrave-dim)" }}>
            {live ? PHASE_LABEL[live.phase] ?? live.phase : "STARTING"}
            {live?.message ? ` · ${live.message}` : ""}
          </p>
        </div>
      ) : turn.status === "error" ? (
        <div className="px-3 pb-3">
          <FailureCard compact failure={turn.failure} error={turn.error ?? "The job failed."} />
        </div>
      ) : turn.status === "cancelled" ? (
        <p className="cx-label px-3 pb-3" style={{ color: "var(--cx-engrave-dim)" }}>
          Cancelled
        </p>
      ) : (
        <div className="bg-background/60 text-foreground border-t border-[var(--cx-line)]">
          {turn.sounds.map((sound) => (
            <SoundCard
              key={sound.id}
              sound={sound}
              dense
              modelName={modelName}
              onReuse={(x) => usePrefillStore.getState().setPrefill(prefillFromSound(x))}
            />
          ))}
        </div>
      )}
    </article>
  );
}
