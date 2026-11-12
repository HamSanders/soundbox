/**
 * The mapping surface: what is arriving, and what it does.
 *
 * The monitor at the top is the part that earns its place. Every "MIDI does
 * not work" report is really one of three things — nothing arriving, the
 * wrong channel, or a control nobody bound — and a live readout of the last
 * message tells all three apart without anyone reading a manual. It is also
 * how you check a preset's assumptions: press the pad, read the note number,
 * and either it matches what the layout guessed or you press Learn.
 *
 * Learn is deliberately modal and deliberately loud. While it is armed the
 * panel eats notes rather than sounding them, because binding a pad you can
 * hear is worse than binding one you cannot — a stray note in the middle of a
 * take is a thing you then have to find and delete.
 */

import { CheckIcon, RadioIcon, RotateCcwIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMidiMonitor } from "@/hooks/use-midi-input";
import {
  MIDI_LAYOUTS,
  MIDI_TARGETS,
  bindingLabel,
  type MidiMappingHook,
  type MidiTargetId,
} from "@/lib/midi-mapping";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------- monitor */

/**
 * Its own component, subscribed to its own store.
 *
 * A knob sweep is ~100 messages a second. If this read from the panel's state
 * the keyboard and the take strip would re-render along with it; here, one
 * line of text does.
 */
function MidiMonitor({ connected }: { connected: boolean }): React.JSX.Element {
  const last = useMidiMonitor();

  if (!connected) {
    return (
      <p className="text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5 font-mono text-xs">
        Not connected — the monitor starts once MIDI is allowed.
      </p>
    );
  }
  if (last === null) {
    return (
      <p className="text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5 font-mono text-xs">
        Waiting — press a key, turn a knob, hit a pad.
      </p>
    );
  }

  const detail =
    last.kind === "cc"
      ? `CC ${last.data1}`
      : last.kind === "bend"
        ? "Pitch bend"
        : last.kind === "other"
          ? `Other (${last.data1})`
          : `Note ${last.data1}`;

  return (
    <p className="bg-muted/40 flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1.5 font-mono text-xs">
      <span className="text-muted-foreground truncate">{last.portName}</span>
      <span className="text-foreground font-medium">{detail}</span>
      <span className="text-muted-foreground">ch{last.channel}</span>
      <span className="text-foreground tabular-nums">
        {last.kind === "bend" ? last.value.toFixed(2) : last.data2}
      </span>
      <span className="text-muted-foreground">{last.kind}</span>
    </p>
  );
}

/* ----------------------------------------------------------------- panel */

export interface MidiMappingPanelProps {
  mapping: MidiMappingHook;
  /** Which target is waiting for a control, if any. */
  learning: MidiTargetId | null;
  onLearn: (target: MidiTargetId | null) => void;
  /** False until Web MIDI is granted — the monitor says so rather than lying. */
  connected: boolean;
}

export function MidiMappingPanel({
  mapping,
  learning,
  onLearn,
  connected,
}: MidiMappingPanelProps): React.JSX.Element {
  const layout = MIDI_LAYOUTS.find((l) => l.id === mapping.layoutId);

  return (
    <div className="grid gap-2">
      <MidiMonitor connected={connected} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-[0.7rem]">Controller layout</Label>
          <Select value={mapping.layoutId} onValueChange={mapping.chooseLayout}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MIDI_LAYOUTS.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mapping.customised && (
          <Button size="sm" variant="ghost" onClick={mapping.reset}>
            <RotateCcwIcon />
            Reset to layout
          </Button>
        )}
      </div>

      {layout && <p className="text-muted-foreground text-xs leading-relaxed">{layout.note}</p>}

      {learning !== null && (
        <p className="border-primary/40 bg-primary/10 text-foreground flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
          <RadioIcon className="text-primary size-3.5 shrink-0 animate-pulse" aria-hidden="true" />
          Move the control you want for{" "}
          <span className="font-medium">
            {MIDI_TARGETS.find((t) => t.id === learning)?.label}
          </span>
          . Notes are not sounded while this is armed.
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onLearn(null)}>
            Cancel
          </Button>
        </p>
      )}

      <ul className="grid gap-px overflow-hidden rounded-md border">
        {MIDI_TARGETS.map((target) => {
          const binding = mapping.map[target.id];
          const arming = learning === target.id;
          return (
            <li
              key={target.id}
              className={cn(
                "bg-background flex items-center gap-2 px-2 py-1.5",
                arming && "bg-primary/10",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{target.label}</p>
                <p className="text-muted-foreground truncate text-[0.7rem]">{target.hint}</p>
              </div>

              <span
                className={cn(
                  "shrink-0 font-(family-name:--font-log) text-[0.7rem] tabular-nums",
                  binding ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {binding ? bindingLabel(binding) : "—"}
              </span>

              <Button
                size="sm"
                variant={arming ? "default" : "outline"}
                className="shrink-0"
                onClick={() => onLearn(arming ? null : target.id)}
              >
                {arming ? <CheckIcon /> : <RadioIcon />}
                {arming ? "Waiting…" : "Learn"}
              </Button>

              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                aria-label={`Clear the binding for ${target.label}`}
                disabled={binding === undefined}
                onClick={() => mapping.unbind(target.id)}
              >
                <XIcon />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
