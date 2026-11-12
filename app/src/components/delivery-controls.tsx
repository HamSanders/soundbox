/**
 * How a line should be read — the model's own knobs, in the script.
 *
 * The controls here are not designed; they are *reported*. Every one of them
 * comes from audio.cpp's parameter table for the selected family, with its own
 * range and default, because the alternative — a tidy invented set of
 * Emotion/Speed/Intensity sliders mapped onto whatever we hoped each model
 * accepted — is how you ship a panel of controls that silently do nothing.
 * What a model does not list, this does not show.
 *
 * Two things make that honest rather than lazy:
 *
 *  - **A family with no entry gets a sentence, not an empty panel.** Fish
 *    Audio and Higgs list nothing, which means the words and the voice are the
 *    only controls they have, and saying so is more use than a disabled slider.
 *  - **Only changed values are sent.** A slider sitting at its default sends
 *    nothing at all, so "I have not decided" stays distinguishable from "I
 *    want exactly the default" — which matters because these are stored on the
 *    line and inherited from the story.
 *
 * Grouping is ours: "Delivery" first because that is the question someone
 * writing a script is asking, everything else behind a disclosure. A flat list
 * of thirteen sliders means reading all thirteen to find the one that matters.
 */

import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ModelParam } from "@/lib/api";

/** The order groups appear in, and what to call them. Anything not listed is
 *  not shown — see `advanced`, which is deliberately last and dullest. */
const GROUPS: { id: ModelParam["group"]; label: string; hint: string }[] = [
  { id: "delivery", label: "Delivery", hint: "How the line is performed." },
  { id: "sampling", label: "Variation", hint: "How far the model may wander from its safest read." },
  { id: "phrasing", label: "Phrasing", hint: "Where it breaks and breathes." },
  { id: "quality", label: "Quality", hint: "Time spent against fidelity." },
  { id: "voice", label: "Voice", hint: "Mostly superseded by Soundbox's own voice library." },
  { id: "advanced", label: "Advanced", hint: "Everything else this family accepts." },
];

export interface DeliveryControlsProps {
  params: ModelParam[];
  /** Only the values actually chosen here — never the defaults. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** What an unset knob falls back to, when this panel is editing a line and
   *  the story underneath it has its own default. Shown, not merged, so it
   *  stays clear which level a value is coming from. */
  inherited?: Record<string, string>;
  /** Named in the "nothing set" line — "the story", "the model". */
  inheritedLabel?: string;
  disabled?: boolean;
}

export function DeliveryControls({
  params,
  value,
  onChange,
  inherited = {},
  inheritedLabel = "the model's defaults",
  disabled = false,
}: DeliveryControlsProps) {
  const [showAll, setShowAll] = useState(false);

  if (params.length === 0) {
    return (
      <p className="text-muted-foreground p-3 text-xs">
        This model takes no delivery settings. The words, the punctuation and the voice you
        cast are its only controls — which is worth knowing before you write around it.
      </p>
    );
  }

  const set = (name: string, next: string | null): void => {
    const out = { ...value };
    if (next === null) delete out[name];
    else out[name] = next;
    onChange(out);
  };

  const groups = GROUPS.map((group) => ({
    ...group,
    items: params.filter((p) => p.group === group.id),
  })).filter((g) => g.items.length > 0);

  // Delivery is always open; the rest is one disclosure rather than one per
  // group, because "show me the rest" is a single decision.
  const primary = groups.filter((g) => g.id === "delivery");
  const rest = groups.filter((g) => g.id !== "delivery");
  const changed = Object.keys(value).length;

  return (
    <div className="space-y-3">
      {(primary.length > 0 ? primary : rest.slice(0, 1)).map((group) => (
        <Group key={group.id} group={group}>
          {group.items.map((param) => (
            <ParamRow
              key={param.name}
              param={param}
              value={value[param.name]}
              inherited={inherited[param.name]}
              disabled={disabled}
              onChange={(next) => set(param.name, next)}
            />
          ))}
        </Group>
      ))}

      {(primary.length > 0 ? rest : rest.slice(1)).length > 0 && (
        <>
          {showAll &&
            (primary.length > 0 ? rest : rest.slice(1)).map((group) => (
              <Group key={group.id} group={group}>
                {group.items.map((param) => (
                  <ParamRow
                    key={param.name}
                    param={param}
                    value={value[param.name]}
                    inherited={inherited[param.name]}
                    disabled={disabled}
                    onChange={(next) => set(param.name, next)}
                  />
                ))}
              </Group>
            ))}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground px-1 text-xs underline underline-offset-2"
            onClick={() => setShowAll((open) => !open)}
          >
            {showAll ? "Fewer settings" : `Everything else this model accepts`}
          </button>
        </>
      )}

      <div className="text-muted-foreground flex items-center justify-between gap-2 px-1 text-[11px]">
        <span>
          {changed === 0
            ? `Nothing set — reading with ${inheritedLabel}.`
            : `${changed} setting${changed === 1 ? "" : "s"} on this read.`}
        </span>
        {changed > 0 && (
          <button
            type="button"
            className="hover:text-foreground underline underline-offset-2"
            onClick={() => onChange({})}
            disabled={disabled}
          >
            Reset all
          </button>
        )}
      </div>
    </div>
  );
}

function Group({
  group,
  children,
}: {
  group: { label: string; hint: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-xs font-medium">{group.label}</p>
        <p className="text-muted-foreground text-[11px]">{group.hint}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * One knob.
 *
 * The value is a string throughout, because `--request-option key=value` is
 * where it ends up and converting to a number here only to stringify it two
 * layers down would invent a rounding step nobody asked for.
 */
function ParamRow({
  param,
  value,
  inherited,
  disabled,
  onChange,
}: {
  param: ModelParam;
  value: string | undefined;
  inherited: string | undefined;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const fallback = inherited ?? String(param.default);
  const current = value ?? fallback;
  const set = value !== undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label
          className={cn("text-xs font-normal", set ? "text-foreground" : "text-muted-foreground")}
          htmlFor={`param-${param.name}`}
        >
          {param.label}
          {param.requires && (
            // Worth saying out loud: VibeVoice lists `temperature` but samples
            // greedily until `do_sample` is on, so a lone temperature slider
            // looks broken. The server sets the companion; this explains why.
            <span className="text-muted-foreground ml-1 text-[10px]">
              (turns on {param.requires.name})
            </span>
          )}
        </Label>
        <div className="flex items-center gap-1">
          {param.type !== "bool" && param.type !== "text" && (
            <span
              className={cn(
                "font-(family-name:--font-log) text-[11px] tabular-nums",
                set ? "text-foreground" : "text-muted-foreground/70",
              )}
            >
              {current}
            </span>
          )}
          {set && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5"
              aria-label={`Reset ${param.label}`}
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              <RotateCcwIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {param.type === "slider" || (param.type === "number" && param.maximum != null) ? (
        <Slider
          id={`param-${param.name}`}
          value={[Number(current)]}
          min={param.minimum ?? 0}
          max={param.maximum ?? 1}
          step={param.step ?? (param.precision === 0 ? 1 : 0.01)}
          disabled={disabled}
          onValueChange={([next]) => onChange(String(next))}
        />
      ) : param.type === "bool" ? (
        <Switch
          id={`param-${param.name}`}
          checked={current === "true"}
          disabled={disabled}
          onCheckedChange={(next) => onChange(String(next))}
        />
      ) : param.type === "choice" ? (
        <select
          id={`param-${param.name}`}
          value={current}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
        >
          {(param.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={`param-${param.name}`}
          value={value ?? ""}
          placeholder={param.placeholder ?? fallback}
          disabled={disabled}
          className="h-8 text-xs"
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      )}

      {param.info && <p className="text-muted-foreground text-[10px]">{param.info}</p>}
    </div>
  );
}
