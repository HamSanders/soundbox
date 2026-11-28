/**
 * The studio as a workspace you rearrange — panels opening and closing, columns
 * dragged wider, the right-click menu on the gesture that is already about the
 * clip.
 *
 * This replaces a static section that listed the panel names and drew the
 * context menu as a picture. Both were true and neither was worth the space:
 * "the studio is a set of panels you open and close" is a claim a reader has no
 * reason to believe from a bulleted list, and a menu that cannot be opened is a
 * screenshot of a menu.
 *
 * So the two things this section asserts are the two things it lets you do:
 *
 *   - **The columns really resize.** The handles below are pointer-driven and
 *     clamped 12–45% per side, the same bounds `routes/story.tsx` enforces, for
 *     the same reason — a pane dragged away entirely is a pane you cannot drag
 *     back. Dragging overrides the step's preset until the next step, because a
 *     layout that snapped back the instant you let go would be a demo arguing
 *     with you.
 *   - **The right-click menu really opens**, on the clips, positioned at the
 *     pointer, with the items `story-timeline.tsx` actually shows.
 *
 * Each step is a real working setup rather than a decorative permutation:
 * writing, arranging, mixing, asking, and the narrow-screen case where the
 * columns stack instead of shrinking. The widths in `SETUPS` are the ones the
 * app itself defaults to (20/20) or that the work in question wants.
 */

import { useEffect, useRef, useState } from "react";
import {
  CopyIcon,
  ExpandIcon,
  LayersIcon,
  MicIcon,
  RepeatIcon,
  ScissorsIcon,
  Trash2Icon,
  VolumeXIcon,
  type LucideIcon,
} from "@/lib/icons";

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { laneColor } from "@/lib/lanes";
import { LOOP_S, STUDIO_CLIPS, STUDIO_LANES, studioPeaksFor } from "@/lib/studio-scene";
import { cn } from "@/lib/utils";

/** The panels a column can hold. Ids and labels are the real ones from
 *  `routes/story.tsx`; `Prompt` is `insert` in the code and Prompt on screen. */
type PanelId = "script" | "chat" | "devices" | "library" | "sample";

const PANEL_LABEL: Record<PanelId, string> = {
  script: "Script",
  chat: "Chat",
  devices: "Devices",
  library: "Library",
  sample: "Sample",
};

interface Setup extends StageStep {
  left: PanelId | null;
  right: PanelId | null;
  leftPct: number;
  rightPct: number;
  /** The narrow case: columns stack under the timeline instead of flanking it,
   *  which is what the real layout's `@3xl` container query does. */
  stacked?: boolean;
}

const SETUPS: Setup[] = [
  {
    title: "The default",
    detail:
      "Script on the left, timeline in the middle, chat on the right, each column at 20%. Drag either divider. The handles below work and are clamped between 12% and 45% a side, the same as in the app.",
    left: "script",
    right: "chat",
    leftPct: 20,
    rightPct: 20,
  },
  {
    title: "Writing",
    detail:
      "Give the script room and close everything else. The lines hold their place on the timeline while you write them, before any of them is voiced.",
    left: "script",
    right: null,
    leftPct: 42,
    rightPct: 20,
  },
  {
    title: "Arranging",
    detail:
      "Both columns closed and the timeline across the full width. The timeline is a panel like the others and can be closed too, for example while you write.",
    left: null,
    right: null,
    leftPct: 20,
    rightPct: 20,
  },
  {
    title: "Mixing",
    detail:
      "The device rack on the right, per track. There are eight kinds (compressor, eq, reverb, delay, distortion, gate, limiter and autotune), so the narration lane can be compressed while the music under it is ducked.",
    left: null,
    right: "devices",
    leftPct: 20,
    rightPct: 34,
  },
  {
    title: "On a narrow screen",
    detail:
      "Below the layout's breakpoint the columns stop flanking the timeline and stack under it. The same panels stay open, in one column instead of three.",
    left: "library",
    right: "sample",
    leftPct: 20,
    rightPct: 20,
    stacked: true,
  },
];

/** The clip menu, transcribed from `components/story-timeline.tsx` — same
 *  items, same order, same rules about which are grouped and which is
 *  destructive. */
const MENU: { icon: LucideIcon; label: string; rule?: boolean; destructive?: boolean }[] = [
  { icon: MicIcon, label: "Regenerate" },
  { icon: ScissorsIcon, label: "Split at playhead" },
  { icon: LayersIcon, label: "Split into stems…" },
  { icon: CopyIcon, label: "Duplicate" },
  { icon: ExpandIcon, label: "Extend this track", rule: true },
  { icon: RepeatIcon, label: "Cover in a new style" },
  { icon: VolumeXIcon, label: "Mute" },
  { icon: Trash2Icon, label: "Delete", rule: true, destructive: true },
];

/** A panel's chrome: a titled box with a close affordance, so "you open and
 *  close these" is legible without a caption saying so. */
function Pane({
  id,
  className,
  style,
}: {
  id: PanelId;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        "border-border/60 bg-background/40 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="border-border/50 text-muted-foreground flex items-center justify-between border-b px-2 py-1 text-[10px] font-medium">
        {PANEL_LABEL[id]}
        <span aria-hidden="true" className="opacity-50">
          ×
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 p-1.5">
        {/* Deliberately abstract. A legible fake Script panel invites reading
            it, and the reader's attention belongs on the layout moving. */}
        {[0.9, 0.7, 0.8, 0.5].map((w, i) => (
          <div key={i} className="bg-muted-foreground/15 h-1.5 rounded" style={{ width: `${w * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Compact timeline: the same arrangement `lib/studio-scene` draws everywhere
 *  else on the site, at the size a column leaves it. */
function MiniTimeline({ onClipContextMenu }: { onClipContextMenu: (e: React.MouseEvent) => void }) {
  return (
    <div className="border-border/60 bg-background/40 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="border-border/50 text-muted-foreground flex items-center justify-between border-b px-2 py-1 text-[10px] font-medium">
        Timeline
        <span aria-hidden="true" className="opacity-50">
          ×
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {STUDIO_LANES.map((name, lane) => (
          <div key={name} className="border-border/40 relative h-8 border-b last:border-b-0">
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundColor: laneColor(lane, 0.04) }}
              aria-hidden="true"
            />
            {STUDIO_CLIPS.filter((c) => c.lane === lane).map((clip) => {
              const peaks = studioPeaksFor(clip);
              return (
                <button
                  key={clip.id}
                  type="button"
                  onContextMenu={onClipContextMenu}
                  onClick={onClipContextMenu}
                  title="Right-click"
                  className="focus-visible:ring-ring/50 absolute inset-y-1 cursor-context-menu overflow-hidden rounded border outline-none focus-visible:ring-2"
                  style={{
                    left: `${(clip.startS / LOOP_S) * 100}%`,
                    width: `${(clip.durationS / LOOP_S) * 100}%`,
                    borderColor: laneColor(clip.lane, 0.5),
                    backgroundColor: laneColor(clip.lane, 0.16),
                  }}
                >
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${peaks.length} 100`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {peaks.map((peak, i) => (
                      <rect
                        key={i}
                        x={i + 0.15}
                        y={50 - peak * 44}
                        width={0.7}
                        height={peak * 88}
                        fill={laneColor(clip.lane, 0.85)}
                      />
                    ))}
                  </svg>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RevealWorkspace() {
  return (
    <ScrollStage
      id="workspace"
      eyebrow="Panels and gestures"
      title="A workspace you rearrange"
      intro="Every part of the studio is a panel you open, close or drag wider. The dividers below work, and right-clicking a clip opens its menu."
      steps={SETUPS}
      layout="centered"
      lane={4}
      backdrop="rings"
    >
      {(_progress, step) => <Workspace setup={SETUPS[step]} step={step} />}
    </ScrollStage>
  );
}

function Workspace({ setup, step }: { setup: Setup; step: number }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; side: "left" | "right" } | null>(null);
  const [left, setLeft] = useState(setup.leftPct);
  const [right, setRight] = useState(setup.rightPct);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // A new step brings its own preset. Dragging wins until then — see the
  // component docstring for why the drag is not snapped back sooner.
  useEffect(() => {
    setLeft(setup.leftPct);
    setRight(setup.rightPct);
    setMenu(null);
  }, [step, setup.leftPct, setup.rightPct]);

  const onDown = (event: React.PointerEvent<HTMLDivElement>, side: "left" | "right") => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, side };
  };
  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    // Measured from the row's own edge on each side, so the right handle grows
    // its panel as it travels left — the direction it looks like it should go.
    const pct =
      state.side === "left"
        ? ((event.clientX - rect.left) / rect.width) * 100
        : ((rect.right - event.clientX) / rect.width) * 100;
    const clamped = Math.min(45, Math.max(12, pct));
    if (state.side === "left") setLeft(clamped);
    else setRight(clamped);
  };
  const onUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    const host = rowRef.current?.getBoundingClientRect();
    if (!host) return;
    setMenu({ x: event.clientX - host.left, y: event.clientY - host.top });
  };

  const Handle = ({ side }: { side: "left" | "right" }) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${side} panel`}
      onPointerDown={(e) => onDown(e, side)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="hover:bg-primary/40 active:bg-primary/60 bg-border/60 w-1 shrink-0 cursor-col-resize touch-none rounded-full transition-colors"
    />
  );

  return (
    <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
      <WindowChrome label="Studio: panels open, close and resize" />

      <div
        ref={rowRef}
        className="relative flex h-[19rem] gap-2 p-3"
        // A click anywhere dismisses the menu, which is what a real menu does.
        onClick={() => menu && setMenu(null)}
      >
        {setup.stacked ? (
          // The narrow case, drawn as the container query renders it: one
          // column, timeline first, panels beneath — not a shrunken three-up.
          <div className="flex min-h-0 w-full flex-col gap-2">
            <MiniTimeline onClipContextMenu={openMenu} />
            <div className="flex min-h-0 shrink-0 gap-2">
              {setup.left && <Pane id={setup.left} className="h-20 flex-1" />}
              {setup.right && <Pane id={setup.right} className="h-20 flex-1" />}
            </div>
          </div>
        ) : (
          <>
            {setup.left && (
              <>
                <Pane
                  id={setup.left}
                  className="transition-[flex-basis] duration-500 motion-reduce:transition-none"
                  // `flex-basis` rather than width: the timeline is the flexible
                  // element, so the columns declare a basis and it takes the rest.
                  style={{ flexBasis: `${left}%` }}
                />
                <Handle side="left" />
              </>
            )}

            <MiniTimeline onClipContextMenu={openMenu} />

            {setup.right && (
              <>
                <Handle side="right" />
                <Pane
                  id={setup.right}
                  className="transition-[flex-basis] duration-500 motion-reduce:transition-none"
                  style={{ flexBasis: `${right}%` }}
                />
              </>
            )}
          </>
        )}

        {menu && (
          <div
            role="menu"
            aria-label="Clip actions"
            className="border-border bg-popover absolute z-20 w-48 rounded-lg border p-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
          >
            {MENU.map((entry) => {
              const Icon = entry.icon;
              return (
                <div key={entry.label}>
                  {entry.rule && <div className="bg-border my-1 h-px" />}
                  <div
                    role="menuitem"
                    tabIndex={-1}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1 text-xs",
                      entry.destructive ? "text-destructive" : "text-foreground",
                    )}
                  >
                    <Icon className="size-3 shrink-0" aria-hidden="true" />
                    {entry.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="border-border/60 text-muted-foreground border-t px-3 py-2 text-[11px]">
        Drag a divider. Right-click a clip.{" "}
        <span className="opacity-70">
          Extend and Cover appear only when the clip&rsquo;s model supports them.
        </span>
      </p>
    </figure>
  );
}
