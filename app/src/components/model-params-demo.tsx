/**
 * One composer, every model's real controls — switchable, so the point makes
 * itself.
 *
 * The claim this exists to carry is easy to state and impossible to believe
 * from prose: *the interface generates itself from what each model actually
 * accepts*. A screenshot of one model's knobs proves nothing, because the
 * interesting part is what happens when you pick a different model. So this is
 * a real tab switch between two families whose parameter sets genuinely differ
 * — Chatterbox's four sliders against VibeVoice's seven mixed controls — and
 * the panel rebuilds.
 *
 * The parameters, types, defaults and ranges below are transcribed from
 * `server/src/models/audiocpp_model_params.json`, which is itself vendored
 * from audio.cpp's own `webui/configs/model_params.json`. That provenance is
 * the reason the section is worth writing at all: the alternative — a table of
 * guesses about what each model listens to — is what `params.ts` says it
 * already learned the worth of.
 *
 * Two honest details the copy keeps rather than smoothing over, because they
 * are what makes this a real system instead of a skin:
 *
 *   - `do_sample` gates `temperature` on VibeVoice. A listed parameter can
 *     still do nothing until another one is on, which the real UI models with
 *     `requires` — so the demo greys the dependent control rather than
 *     pretending every knob is live.
 *   - Only changed values are sent. audio.cpp accepts unknown keys silently,
 *     so an untouched control staying out of the request is what keeps a
 *     default meaning the model's default.
 *
 * Static and local: no backend, nothing generated, no state beyond which tab
 * is showing and which knobs have been nudged.
 */

import { useState } from "react";

import { cn } from "@/lib/utils";

type ParamType = "slider" | "number" | "bool" | "text";

interface Param {
  name: string;
  type: ParamType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  /** Reproduces the real `requires` rule: this control does nothing until the
   *  named boolean is on. */
  requires?: string;
  /** Which group the real UI files it under — `ParamGroup` in
   *  `server/src/models/params.ts`, minus the ones these two families do not
   *  use. */
  group: "delivery" | "sampling" | "quality" | "voice" | "phrasing";
}

interface Family {
  id: string;
  label: string;
  /** What the family is, in one clause — so switching tabs is informative
   *  rather than just different. */
  note: string;
  params: Param[];
}

/** Two families whose parameter sets differ in kind, not just in count: one is
 *  four sliders, the other mixes numbers, a boolean and a text field. */
const FAMILIES: Family[] = [
  {
    id: "chatterbox",
    label: "chatterbox",
    note: "Four sliders. `exaggeration` is this family's own control — no other model here has it.",
    params: [
      { name: "exaggeration", type: "slider", default: 0.5, min: 0, max: 2, step: 0.05, group: "delivery" },
      { name: "guidance_scale", type: "slider", default: 0.5, min: 0, max: 1, step: 0.05, group: "quality" },
      { name: "temperature", type: "slider", default: 0.8, min: 0, max: 2, step: 0.05, group: "sampling" },
      { name: "repetition_penalty", type: "slider", default: 1.2, min: 1, max: 2, step: 0.01, group: "sampling" },
    ],
  },
  {
    id: "vibevoice",
    label: "vibevoice",
    note: "Seven controls across four groups, including a boolean that gates one of the others.",
    params: [
      { name: "num_inference_steps", type: "number", default: 10, min: 1, step: 1, group: "quality" },
      { name: "guidance_scale", type: "slider", default: 1.3, min: 0, max: 5, step: 0.1, group: "quality" },
      { name: "max_length_times", type: "number", default: 2, min: 0.1, max: 4, step: 0.1, group: "phrasing" },
      { name: "temperature", type: "slider", default: 1, min: 0.05, max: 2, step: 0.05, requires: "do_sample", group: "sampling" },
      { name: "top_p", type: "slider", default: 1, min: 0.05, max: 1, step: 0.01, requires: "do_sample", group: "sampling" },
      { name: "do_sample", type: "bool", default: false, group: "sampling" },
      { name: "voice_samples", type: "text", default: "", group: "voice" },
    ],
  },
];

const GROUP_LABEL: Record<string, string> = {
  delivery: "Delivery",
  sampling: "Sampling",
  quality: "Quality",
  voice: "Voice",
  phrasing: "Phrasing",
};

function Control({
  param,
  value,
  disabled,
  onChange,
}: {
  param: Param;
  value: number | boolean | string;
  disabled: boolean;
  onChange: (v: number | boolean | string) => void;
}) {
  const touched = value !== param.default;

  return (
    <div className={cn("min-w-0", disabled && "opacity-40")}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-muted-foreground truncate font-mono text-[11px]">{param.name}</label>
        <span
          className={cn(
            "shrink-0 font-(family-name:--font-log) text-[11px] tabular-nums",
            // A changed value is the one that will actually be sent, so it is
            // the one that gets the accent.
            touched ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          {param.type === "bool" ? String(value) : param.type === "text" ? value || "—" : String(value)}
        </span>
      </div>

      {param.type === "slider" || param.type === "number" ? (
        <input
          type="range"
          disabled={disabled}
          min={param.min ?? 0}
          max={param.max ?? (param.type === "number" ? 40 : 1)}
          step={param.step ?? 0.01}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="accent-primary mt-1.5 h-1 w-full cursor-pointer"
        />
      ) : param.type === "bool" ? (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          className={cn(
            "mt-1.5 flex h-4 w-8 items-center rounded-full px-0.5 transition-colors",
            value ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "bg-background size-3 rounded-full transition-transform",
              value && "translate-x-4",
            )}
          />
        </button>
      ) : (
        <div className="border-border/60 text-muted-foreground/50 mt-1.5 truncate rounded border px-1.5 py-1 font-mono text-[10px]">
          comma-separated wav paths
        </div>
      )}
    </div>
  );
}

export function ModelParamsDemo() {
  const [familyId, setFamilyId] = useState(FAMILIES[0].id);
  const family = FAMILIES.find((f) => f.id === familyId)!;
  const [values, setValues] = useState<Record<string, number | boolean | string>>({});

  const valueOf = (p: Param) => values[`${family.id}.${p.name}`] ?? p.default;
  const setValue = (p: Param, v: number | boolean | string) =>
    setValues((prev) => ({ ...prev, [`${family.id}.${p.name}`]: v }));

  const groups = [...new Set(family.params.map((p) => p.group))];
  const changed = family.params.filter((p) => valueOf(p) !== p.default);

  return (
    <div className="border-border/60 bg-card/80 overflow-hidden rounded-xl border">
      {/* The model switch. This is the control that carries the argument, so it
          is the first thing in the panel rather than a footnote under it. */}
      <div className="border-border/60 flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <span className="label-caps text-muted-foreground mr-1">
          Model
        </span>
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFamilyId(f.id)}
            aria-pressed={f.id === familyId}
            className={cn(
              "focus-visible:ring-ring/50 cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] outline-none focus-visible:ring-2",
              "transition-colors duration-200 motion-reduce:transition-none",
              f.id === familyId
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border/50 text-muted-foreground/70 hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="p-3">
        <p className="text-muted-foreground/80 mb-3 text-[11px] leading-relaxed">{family.note}</p>

        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group}>
              <p className="label-caps text-muted-foreground/60 mb-1.5">
                {GROUP_LABEL[group] ?? group}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {family.params
                  .filter((p) => p.group === group)
                  .map((p) => {
                    const gate = p.requires
                      ? !(values[`${family.id}.${p.requires}`] ?? false)
                      : false;
                    return (
                      <Control
                        key={p.name}
                        param={p}
                        value={valueOf(p)}
                        disabled={gate}
                        onChange={(v) => setValue(p, v)}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {/* What would actually be sent. The empty state is the interesting one:
            touch nothing and nothing is sent, so the model's defaults stand. */}
        <div className="border-border/50 mt-4 border-t pt-3">
          <p className="label-caps text-muted-foreground/60">
            Sent with the request
          </p>
          <pre className="text-muted-foreground mt-1.5 overflow-x-auto font-mono text-[11px]">
            {changed.length === 0
              ? "{}  — nothing changed, so the model's own defaults stand"
              : `{ ${changed.map((p) => `"${p.name}": ${JSON.stringify(valueOf(p))}`).join(", ")} }`}
          </pre>
        </div>
      </div>
    </div>
  );
}
