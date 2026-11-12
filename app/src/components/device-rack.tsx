/**
 * The device rack — one track's inserts, as cards you can actually turn.
 *
 * Two decisions shape it:
 *
 * - **One track at a time.** A rack showing every lane at once is a mixer, and
 *   a mixer needs a window; this is a panel in a studio already carrying a
 *   script, a timeline and the clip you have selected. Which track it is
 *   showing follows the clip you have selected, because that is already how
 *   you say "this one" here.
 * - **Dials, not number fields.** Attack and decay are tuned by feel while
 *   listening, so the control has to be sweepable in one gesture. They stay
 *   `role="slider"` underneath with real arrow-key handling, so the whole rack
 *   is operable without a pointer.
 *
 * It comes in two halves — `DeviceLanes` and `DeviceCards` — because it is a
 * panel in the artifact stack, and the stack owns the header the lane picker
 * sits in. See `DeviceLanes` for what that leaves it responsible for.
 */

import { useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  PowerIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { laneColor } from "@/lib/lanes";
import {
  DEVICES,
  DEVICE_ORDER,
  createDevice,
  formatParam,
} from "@/lib/devices";
import type { DeviceKind, DeviceSpec, ParamDescriptor, TrackDevices } from "@/lib/devices";
import type { StoryTrack } from "@/lib/api";

/* ---------------------------------------------------------------- the dial */

/** Degrees of travel, split either side of straight up. 270° is the hardware
 *  convention and leaves a visible gap at the bottom so "fully down" and
 *  "fully up" cannot be confused. */
const SWEEP = 270;
/** The dial's own coordinate space. Drawn at 40 and scaled by CSS, so the arc
 *  maths is in round numbers and the stroke is crisp at any size. */
const BOX = 40;
const RADIUS = 15;
/** Pixels of vertical drag for the full range. Long enough to be precise,
 *  short enough to cross in one comfortable gesture. */
const DRAG_RANGE = 160;
/** How far the pointer has to travel before a press counts as a turn — the
 *  same guard the timeline puts on a clip drag, for the same reason: the pixel
 *  of jitter in a normal click would otherwise move the dial, and a knob that
 *  changes when you click it is a knob you cannot trust. */
const TURN_THRESHOLD_PX = 3;

/** Position on the dial (0..1) from a value, honouring the descriptor's curve
 *  so a 10 ms attack is not indistinguishable from a 20 ms one. */
function toNorm(param: ParamDescriptor, value: number): number {
  const t = (value - param.min) / (param.max - param.min);
  return Math.min(1, Math.max(0, param.curve ? Math.pow(t, 1 / param.curve) : t));
}

/**
 * A point on the dial's track, in SVG coordinates.
 *
 * Angles are degrees clockwise from twelve o'clock, which is how the dial is
 * described everywhere else here — the pointer, the sweep, the value. Doing
 * the conversion once, in one place, is what keeps the arc and the pointer
 * agreeing: they used to be drawn by two different tricks (a rotated
 * dash-array and a CSS rotation) and disagreed by a few degrees at every
 * value but the middle.
 */
function point(angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: BOX / 2 + RADIUS * Math.cos(radians),
    y: BOX / 2 + RADIUS * Math.sin(radians),
  };
}

/** An SVG arc along the track, from one angle to another. */
function arc(from: number, to: number): string {
  const a = point(from);
  const b = point(to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function fromNorm(param: ParamDescriptor, norm: number): number {
  const t = param.curve ? Math.pow(norm, param.curve) : norm;
  const raw = param.min + t * (param.max - param.min);
  const stepped = Math.round(raw / param.step) * param.step;
  // Steps rarely divide the range exactly; clamping after rounding is what
  // keeps a dragged-to-the-end dial on its stated maximum.
  return Math.min(param.max, Math.max(param.min, Number(stepped.toFixed(6))));
}

function Dial({
  param,
  value,
  onChange,
  disabled,
  color,
}: {
  param: ParamDescriptor;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** The lane's colour. A rack is always looking at one track, and its
   *  controls say which one without a label. */
  color: string;
}) {
  const norm = toNorm(param, value);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startNorm: number;
    turning: boolean;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startNorm: norm,
      turning: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const travelled = state.startY - event.clientY;
    if (!state.turning) {
      if (Math.abs(travelled) < TURN_THRESHOLD_PX) return;
      state.turning = true;
    }
    // Up is more, which is the only direction anyone expects, and a fine
    // gesture with shift for the last few percent.
    const scale = event.shiftKey ? DRAG_RANGE * 4 : DRAG_RANGE;
    const next = state.startNorm + travelled / scale;
    onChange(fromNorm(param, Math.min(1, Math.max(0, next))));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const nudge = (steps: number): void =>
    onChange(
      Math.min(param.max, Math.max(param.min, Number((value + steps * param.step).toFixed(6)))),
    );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const big = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        event.preventDefault();
        nudge(big);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        event.preventDefault();
        nudge(-big);
        break;
      case "Home":
        event.preventDefault();
        onChange(param.min);
        break;
      case "End":
        event.preventDefault();
        onChange(param.max);
        break;
      default:
        break;
    }
  };

  // Both ends of the sweep, and where this value sits between them.
  const from = -SWEEP / 2;
  const to = SWEEP / 2;
  const angle = from + norm * SWEEP;
  const pointer = point(angle);
  const hub = { x: BOX / 2, y: BOX / 2 };

  return (
    <div className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={param.label}
        aria-valuemin={param.min}
        aria-valuemax={param.max}
        aria-valuenow={value}
        aria-valuetext={formatParam(param, value)}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onChange(fromNorm(param, 0.5))}
        className={cn(
          // 56px. A knob is aimed at by eye and swept by feel, and at 40 it
          // was neither: the arc read as a hairline and the pointer's angle
          // was a guess.
          "focus-visible:ring-ring/50 relative size-14 touch-none rounded-full outline-none focus-visible:ring-3",
          disabled ? "opacity-50" : "cursor-ns-resize",
        )}
      >
        <svg viewBox={`0 0 ${BOX} ${BOX}`} className="size-full overflow-visible">
          {/* The track it can travel along, and how far along it is. Two arcs
              on the same geometry, so the filled part is exactly the swept
              part — no dash offsets to drift out of step. */}
          <path
            d={arc(from, to)}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-muted"
          />
          {norm > 0.001 && (
            <path
              d={arc(from, angle)}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              stroke={color}
            />
          )}
          {/* The pointer, drawn from the hub out to the track: a line rather
              than a dot, because at this size a dot reads as a highlight and
              you lose which way the dial is facing. */}
          <line
            x1={hub.x + (pointer.x - hub.x) * 0.3}
            y1={hub.y + (pointer.y - hub.y) * 0.3}
            x2={hub.x + (pointer.x - hub.x) * 0.78}
            y2={hub.y + (pointer.y - hub.y) * 0.78}
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-foreground"
          />
        </svg>
      </div>
      <span className="text-muted-foreground w-full truncate text-center text-[11px] leading-none">
        {param.label}
      </span>
      <span className="w-full truncate text-center font-(family-name:--font-log) text-[11px] leading-none tabular-nums">
        {formatParam(param, value)}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- the card */

function DeviceCard({
  spec,
  disabled,
  color,
  onPatch,
  onToggle,
  onRemove,
  onMove,
  canMoveLeft,
  canMoveRight,
}: {
  spec: DeviceSpec;
  disabled: boolean;
  /** The lane's colour — see `DeviceCards`. */
  color: string;
  onPatch: (key: string, value: number) => void;
  onToggle: () => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) {
  const descriptor = DEVICES[spec.kind];
  const dials = descriptor.params.filter((p) => p.control === "dial");
  const sliders = descriptor.params.filter((p) => p.control === "slider");

  return (
    <div
      className={cn(
        "border-border bg-card flex shrink-0 flex-col rounded-xl border px-3 py-2",
        spec.bypassed && "opacity-45",
      )}
    >
      <div className="mb-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          style={spec.bypassed ? undefined : { color }}
          aria-label={spec.bypassed ? `Enable ${descriptor.name}` : `Bypass ${descriptor.name}`}
          aria-pressed={!spec.bypassed}
          disabled={disabled}
          onClick={onToggle}
        >
          <PowerIcon className="size-3.5" />
        </Button>
        <span className="mr-2 text-xs font-medium">{descriptor.name}</span>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label={`Move ${descriptor.name} earlier in the chain`}
            disabled={disabled || !canMoveLeft}
            onClick={() => onMove(-1)}
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label={`Move ${descriptor.name} later in the chain`}
            disabled={disabled || !canMoveRight}
            onClick={() => onMove(1)}
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:text-destructive size-6"
            aria-label={`Remove ${descriptor.name}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-1.5">
        {dials.map((param) => (
          <Dial
            key={param.key}
            param={param}
            value={spec.params[param.key]}
            disabled={disabled}
            color={color}
            onChange={(value) => onPatch(param.key, value)}
          />
        ))}
      </div>

      {sliders.map((param) => (
        <div key={param.key} className="mt-2 flex items-center gap-2">
          <span className="text-muted-foreground w-7 shrink-0 text-[10px]">{param.label}</span>
          <Slider
            // The filled part and the thumb follow the track's colour. The
            // primitive paints both with `bg-primary`, so the override reaches
            // in by data-slot rather than forking the component.
            style={{ "--lane-tint": color } as React.CSSProperties}
            className="[&_[data-slot=slider-range]]:bg-(--lane-tint) [&_[data-slot=slider-thumb]]:border-(--lane-tint) min-w-20 flex-1"
            min={param.min}
            max={param.max}
            step={param.step}
            disabled={disabled}
            aria-label={`${descriptor.name} ${param.label}`}
            value={[spec.params[param.key]]}
            onValueChange={([v]) => onPatch(param.key, v)}
          />
          <span className="w-8 shrink-0 text-right font-(family-name:--font-log) text-[10px] tabular-nums">
            {Math.round(spec.params[param.key] * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- the rack */

export interface DeviceRackProps {
  /** Lanes that exist on the timeline, in order. */
  lanes: number[];
  tracks: StoryTrack[];
  devices: TrackDevices;
  lane: number;
  onLane: (lane: number) => void;
  onChange: (lane: number, specs: DeviceSpec[]) => void;
  /** An agent holds the story: the rack still shows what is on each track. */
  readOnly?: boolean;
}

function trackName(tracks: StoryTrack[], lane: number): string {
  return tracks.find((t) => t.track_index === lane)?.name ?? `Track ${lane}`;
}

/**
 * The rack's header: which track you are looking at, and what is on it.
 *
 * Split from the cards because the rack is a panel in the studio's artifact
 * stack now, and the stack owns the header row — the chevron, the close
 * button, the frame. What is left is the part only the rack can supply: the
 * lane picker, in the lanes' own colours, and a summary that has to keep
 * working while the panel is shut. A collapsed rack that silently compresses
 * your narration is the failure mode worth designing out.
 */
export function DeviceLanes({
  lanes,
  tracks,
  devices,
  lane,
  onLane,
}: Pick<DeviceRackProps, "lanes" | "tracks" | "devices" | "lane" | "onLane">) {
  const chain = devices[lane] ?? [];

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-medium">Devices</span>

      {/* Lane numbers rather than names on the buttons: they line up with the
          timeline's own gutter, and the renamed track is spelled out beside
          them anyway. */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {lanes.map((l) => {
          const count = (devices[l] ?? []).filter((d) => !d.bypassed).length;
          return (
            <Button
              key={l}
              variant={l === lane ? "secondary" : "ghost"}
              size="sm"
              className="h-6 shrink-0 gap-1 px-2 font-mono text-[11px]"
              aria-pressed={l === lane}
              aria-label={`Devices on ${trackName(tracks, l)}`}
              onClick={() => onLane(l)}
            >
              {/* The lane's own colour, the same one the timeline draws its
                  clips in — picking a track here is the same act as picking
                  one up there. */}
              <span
                className="size-2 rounded-[2px]"
                style={{ background: laneColor(l, 0.9) }}
                aria-hidden="true"
              />
              {l}
              {count > 0 && (
                <span className="bg-foreground/50 size-1.5 rounded-full" aria-hidden="true" />
              )}
            </Button>
          );
        })}
      </div>

      <span className="text-muted-foreground min-w-0 truncate text-xs">
        {chain.length === 0
          ? trackName(tracks, lane)
          : chain
              .map((d) => (d.bypassed ? `(${DEVICES[d.kind].name})` : DEVICES[d.kind].name))
              .join(" · ")}
      </span>
    </div>
  );
}

/** The cards themselves: one track's chain, in order, plus the way to add to
 *  it. Scrolls sideways rather than wrapping — a chain is a sequence, and
 *  wrapping it onto a second row loses the one thing its layout says. */
/**
 * The colour every control on a card is drawn in: the lane's own.
 *
 * A rack is always looking at exactly one track, and which one is the thing
 * you most need to know before you touch a knob. Saying it in the controls
 * themselves means the answer is wherever your eyes already are, instead of
 * only in the lane buttons at the top.
 */
export function DeviceCards({
  tracks,
  devices,
  lane,
  onChange,
  readOnly = false,
}: Pick<DeviceRackProps, "tracks" | "devices" | "lane" | "onChange" | "readOnly">) {
  const tint = laneColor(lane, 0.95);
  const [adding, setAdding] = useState(false);
  const chain = devices[lane] ?? [];

  // Not memoised: it closes over the chain, which is a new array on every
  // render of the page above, so a `useCallback` here would only be a lie
  // about stability.
  const patch = (index: number, next: DeviceSpec): void =>
    onChange(
      lane,
      chain.map((d, i) => (i === index ? next : d)),
    );

  const move = (index: number, by: -1 | 1): void => {
    const to = index + by;
    if (to < 0 || to >= chain.length) return;
    const next = [...chain];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(lane, next);
  };

  return (
    <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-auto p-2">
      {chain.map((spec, i) => (
        <DeviceCard
          key={spec.id}
          spec={spec}
          disabled={readOnly}
          color={tint}
          canMoveLeft={i > 0}
          canMoveRight={i < chain.length - 1}
          onMove={(by) => move(i, by)}
          onToggle={() => patch(i, { ...spec, bypassed: !spec.bypassed })}
          onRemove={() => onChange(lane, chain.filter((_, j) => j !== i))}
          onPatch={(key, value) => patch(i, { ...spec, params: { ...spec.params, [key]: value } })}
        />
      ))}

      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="text-muted-foreground h-auto min-h-24 w-28 shrink-0 flex-col gap-1 border-dashed"
            disabled={readOnly}
            aria-label={`Add a device to ${trackName(tracks, lane)}`}
          >
            <PlusIcon />
            <span className="text-xs">Add device</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1">
          {DEVICE_ORDER.map((kind: DeviceKind) => (
            <button
              key={kind}
              type="button"
              className="hover:bg-accent focus-visible:bg-accent w-full rounded-md px-2 py-1.5 text-left outline-none"
              onClick={() => {
                onChange(lane, [...chain, createDevice(kind)]);
                setAdding(false);
              }}
            >
              <span className="text-sm font-medium">{DEVICES[kind].name}</span>
              <span className="text-muted-foreground block text-xs leading-snug">
                {DEVICES[kind].blurb}
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {chain.length === 0 && (
        <p className="text-muted-foreground/80 max-w-xs self-center px-3 text-xs leading-relaxed">
          Nothing on {trackName(tracks, lane)} yet. Devices are heard on the timeline while it
          plays; the export mixdown is still dry.
        </p>
      )}
    </div>
  );
}
