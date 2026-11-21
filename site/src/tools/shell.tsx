/**
 * The free tools, laid out like the app.
 *
 * Same idea as `/music` (app/src/routes/music/hub.tsx): a rail on the left,
 * a hero, then the tool itself drawn as a Mirli window: a create panel on the
 * left with the tabs and the big round button at the bottom, the library
 * panel on the right with the breadcrumb, a display-caps title, a Courier log
 * line and track rows. Results play in the app's dock (SiteDock). Someone who
 * downloads Mirli after using a tool should recognise the window.
 */

import {
  BellRingIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeIcon,
  MicVocalIcon,
  PanelLeftIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  WavesIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { laneColor } from "@/lib/lanes";
import { cn } from "@/lib/utils";

export const TOOLS: { to: string; label: string; tab: string; icon: LucideIcon }[] = [
  { to: "/tools/vocal-remover", label: "Vocal remover", tab: "Vocal remover", icon: MicVocalIcon },
  { to: "/tools/bpm-key-finder", label: "BPM and key finder", tab: "BPM & key", icon: GaugeIcon },
];

/** Shown greyed out in the rail, so the column reads as a toolbox that grows. */
const NEXT: { label: string; icon: LucideIcon }[] = [
  { label: "Sound effects", icon: SparklesIcon },
  { label: "Ringtone maker", icon: BellRingIcon },
  { label: "Voice cleanup", icon: WavesIcon },
];

export interface RailLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const railItem =
  "relative flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

/** The page: rail on the left (wide screens), tool tabs on top (narrow ones). */
export function ToolShell({ onThisPage, children }: { onThisPage: RailLink[]; children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-svh">
      <style>{STYLES}</style>
      <div className="mx-auto w-full max-w-[96rem] lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          aria-label="Free tools"
          className="border-border sticky top-14 hidden h-[calc(100svh-3.5rem)] flex-col gap-7 overflow-y-auto border-r px-3 py-6 lg:flex"
        >
          <div>
            <p className="label-caps text-muted-foreground px-3">Free tools</p>
            <ul className="mt-2">
              {TOOLS.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        railItem,
                        isActive
                          ? "bg-card text-foreground before:bg-signal before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full"
                          : "text-muted-foreground hover:text-foreground hover:bg-card",
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-caps text-muted-foreground px-3">On this page</p>
            <ul className="mt-2">
              {onThisPage.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <a href={href} className={cn(railItem, "text-muted-foreground hover:text-foreground hover:bg-card")}>
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-caps text-muted-foreground px-3">Coming next</p>
            <ul className="mt-2">
              {NEXT.map(({ label, icon: Icon }) => (
                <li key={label} className={cn(railItem, "text-muted-foreground/50 cursor-default")}>
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-card mt-auto rounded-md p-4">
            <p className="text-sm font-semibold">No limits at home</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Mirli runs every tool here on your own computer, offline, as often as you like.
            </p>
            <Button size="sm" className="mt-3 w-full" asChild>
              <Link to="/download">Download Mirli</Link>
            </Button>
          </div>
        </nav>

        <main id="main" className="min-w-0 px-4 pt-4 pb-28 lg:px-8 lg:pt-6">
          <ul className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 lg:hidden" aria-label="Free tools">
            {TOOLS.map(({ to, tab, icon: Icon }) => (
              <li key={to} className="shrink-0">
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "border-border inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm font-medium",
                      isActive ? "bg-foreground text-background border-transparent" : "text-muted-foreground",
                    )
                  }
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {tab}
                </NavLink>
              </li>
            ))}
          </ul>
          {children}
        </main>
      </div>
    </div>
  );
}

/** The hero: dusk ground lit by two lane colours, the art on the right, the title over it. */
export function ToolHero({
  kicker,
  title,
  lede,
  facts,
  art,
  lanes,
}: {
  kicker: string;
  title: string;
  lede: string;
  facts: string[];
  art: ReactNode;
  lanes: [number, number];
}) {
  return (
    <section
      className="relative isolate overflow-hidden rounded-md"
      style={{
        background: `radial-gradient(110% 130% at 88% 0%, ${laneColor(lanes[0], 0.42)}, transparent 58%), radial-gradient(80% 120% at 0% 100%, ${laneColor(lanes[1], 0.3)}, transparent 60%), var(--color-dusk)`,
      }}
    >
      <div className="absolute inset-0 -z-10 md:left-[38%]" aria-hidden="true">
        {art}
      </div>
      <div className="from-dusk via-dusk/80 absolute inset-0 -z-10 bg-gradient-to-r to-transparent md:via-dusk/40" aria-hidden="true" />
      <div className="max-w-3xl px-5 pt-24 pb-7 sm:px-8 sm:pt-32 sm:pb-9">
        <p className="label-caps text-white/75">{kicker}</p>
        <h1 className="mt-3 text-[clamp(2.6rem,6.4vw,5.5rem)] leading-[0.88] text-balance text-white uppercase">{title}</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-pretty text-white/75 sm:text-base">{lede}</p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {facts.map((f) => (
            <li key={f} className="readout rounded-sm bg-white/10 px-2 py-1 text-white/85 backdrop-blur-sm">
              {f}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The tool as a Mirli window: title bar, then the create panel and the
 * library panel side by side (stacked on narrow screens), on the app's ground.
 */
export function Workspace({
  crumb,
  active,
  side,
  children,
}: {
  crumb: string;
  /** Which tab is lit in the create panel. */
  active: string;
  side: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id="tool"
      aria-label={crumb}
      className="border-border bg-background mt-6 scroll-mt-20 overflow-hidden rounded-lg border shadow-2xl shadow-black/25"
    >
      <div className="border-border/60 flex items-center gap-2 border-b px-3 py-1.5">
        <div className="flex gap-1" aria-hidden="true">
          <span className="bg-muted-foreground/25 size-2 rounded-full" />
          <span className="bg-muted-foreground/25 size-2 rounded-full" />
          <span className="bg-muted-foreground/25 size-2 rounded-full" />
        </div>
        <span className="text-muted-foreground text-[11px] font-medium tracking-tight">Mirli</span>
      </div>
      <div className="grid gap-2 p-2 lg:grid-cols-[4rem_21rem_minmax(0,1fr)]">
        {/* The app's icon rail, here only as the frame's left edge. */}
        <div className="hidden flex-col items-center gap-5 py-2 lg:flex" aria-hidden="true">
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-md">
            <BrandMark className="size-6" />
          </span>
          {TOOLS.map(({ to, icon: Icon }) => (
            <span key={to} className="relative flex w-full justify-center">
              {to.endsWith(active) ? <span className="bg-foreground absolute top-1 bottom-1 left-0 w-0.5 rounded-full" /> : null}
              <Icon className={cn("size-5", to.endsWith(active) ? "text-foreground" : "text-muted-foreground/60")} />
            </span>
          ))}
        </div>

        <div className="border-border bg-card flex min-w-0 flex-col rounded-md border">
          <nav aria-label="Tool" className="flex gap-5 px-4 pt-3">
            {TOOLS.map(({ to, tab }) => (
              <Link
                key={to}
                to={to}
                aria-current={to.endsWith(active) ? "page" : undefined}
                className={cn(
                  "border-b-2 pb-2 text-base font-medium transition-colors",
                  to.endsWith(active) ? "border-foreground text-foreground" : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {tab}
              </Link>
            ))}
          </nav>
          <div className="flex flex-1 flex-col gap-3 p-3">{side}</div>
        </div>

        <div className="border-border bg-card min-w-0 rounded-md border">
          <div className="text-muted-foreground flex h-11 items-center gap-3 px-4 text-sm" aria-hidden="true">
            <PanelLeftIcon className="size-4" />
            <ChevronLeftIcon className="size-4" />
            <ChevronRightIcon className="size-4" />
            <span className="truncate">
              Mirli / Free tools / <span className="text-foreground font-medium">{crumb}</span>
            </span>
          </div>
          <div className="px-4 pt-3 pb-5 sm:px-6">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** A field box in the create panel, like the app's Model picker. */
export function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border bg-field flex min-h-10 items-center gap-3 rounded-md border px-3 py-2">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium">{children}</span>
    </div>
  );
}

/** The create panel's big round button, pinned to the bottom of the panel. */
export function PanelAction({
  children,
  onClick,
  disabled,
  icon: Icon,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <div className="mt-auto pt-2">
      <Button size="lg" className="h-11 w-full rounded-full text-base" onClick={onClick} disabled={disabled}>
        {Icon ? <Icon aria-hidden="true" /> : null}
        {children}
      </Button>
    </div>
  );
}

/** The library panel's head: kicker, display title, a log line. */
export function PanelHead({ kicker, title, log }: { kicker: string; title: string; log: ReactNode }) {
  return (
    <header className="pb-4">
      <p className="label-caps text-muted-foreground">{kicker}</p>
      <h2 className="font-display mt-1 truncate text-3xl leading-none font-extrabold tracking-[0.01em] uppercase sm:text-4xl">{title}</h2>
      <p className="readout text-muted-foreground mt-1.5 truncate">{log}</p>
    </header>
  );
}

const ROW_GRID =
  "grid grid-cols-[1.75rem_2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 @2xl:grid-cols-[2.5rem_2.5rem_minmax(0,1fr)_11rem_4rem_6rem]";

/** Column heads, on the rows' grid. */
export function RowList({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className={cn(ROW_GRID, "label-caps text-muted-foreground border-border hidden border-b px-2 pb-2 @2xl:grid")}>
        <span className="text-right">No.</span>
        <span />
        <span>Title</span>
        <span>Model</span>
        <span className="text-right">Length</span>
        <span />
      </div>
      <ol className="mt-1">{children}</ol>
    </div>
  );
}

/**
 * A track row on the app's grid: number, a tile that turns into play on
 * hover, the title in display caps over a Courier log line, model, length,
 * actions. `pending` draws the row before its audio exists, breathing.
 */
export function TrackRow({
  no,
  tile,
  title,
  log,
  model,
  length,
  isCurrent,
  playing,
  onPlay,
  actions,
  pending,
}: {
  no: string;
  tile: ReactNode;
  title: string;
  log: string;
  model: string;
  length: string;
  isCurrent?: boolean;
  playing?: boolean;
  onPlay?: () => void;
  actions?: ReactNode;
  pending?: "waiting" | "working";
}) {
  const active = !!isCurrent && !!playing;
  return (
    <li
      className={cn(
        ROW_GRID,
        "relative rounded-md px-2 py-1.5 transition-colors",
        !pending && "hover:bg-muted/60",
        isCurrent && "bg-muted/60",
        active && "before:bg-signal before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
        pending === "waiting" && "opacity-45",
      )}
    >
      <span className="readout text-muted-foreground text-right tabular-nums">{no}</span>
      {pending ? (
        <span className="ring-border bg-muted relative flex size-10 items-center justify-center overflow-hidden rounded-sm ring-1 ring-inset" aria-hidden="true">
          {pending === "working" ? <WorkingBars /> : <span className="border-muted-foreground/40 size-5 rounded-full border border-dashed" />}
        </span>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          aria-label={`${active ? "Pause" : "Play"} ${title}`}
          className="group/tile focus-visible:ring-ring/50 ring-border bg-muted relative flex size-10 items-center justify-center overflow-hidden rounded-sm ring-1 ring-inset outline-none focus-visible:ring-3"
        >
          {tile}
          <span
            aria-hidden="true"
            className={cn(
              "bg-background/70 text-foreground absolute inset-0 flex items-center justify-center transition-opacity group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100",
              isCurrent ? "opacity-100" : "opacity-0",
            )}
          >
            {active ? <PauseIcon className="size-4 fill-current" /> : <PlayIcon className="size-4 fill-current" />}
          </span>
        </button>
      )}
      <div className="min-w-0">
        <p className="font-display truncate text-base leading-tight font-bold tracking-[0.01em] uppercase">{title}</p>
        <p className={cn("readout text-muted-foreground truncate", pending === "working" && "tools-shimmer")} title={log}>
          {log}
        </p>
      </div>
      <span className="readout text-muted-foreground hidden truncate @2xl:block">{model}</span>
      <span className="readout text-muted-foreground hidden text-right tabular-nums @2xl:block">{length}</span>
      <div className="flex items-center justify-end gap-1">{actions}</div>
    </li>
  );
}

/** Five bars breathing: "a model is on this right now". */
function WorkingBars() {
  return (
    <span className="flex h-5 items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="tools-bar bg-signal block h-full w-0.5 rounded-full" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

/** A page section under the window, in the hub's style. */
export function Section({ id, title, lede, children }: { id: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} className="scroll-mt-20 pt-16">
      <h2 id={`${id}-h`} className="font-display text-3xl leading-none font-extrabold text-balance uppercase sm:text-4xl">
        {title}
      </h2>
      {lede ? <p className="text-muted-foreground mt-2.5 max-w-2xl text-sm leading-relaxed">{lede}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Numbered steps as cards, each with its lane's colour along the top. */
export function Steps({ steps }: { steps: { icon: LucideIcon; title: string; body: string }[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map(({ icon: Icon, title, body }, i) => (
        <li key={title} className="border-border bg-card relative overflow-hidden rounded-md border p-4">
          <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: laneColor(i * 2) }} aria-hidden="true" />
          <div className="flex items-center justify-between">
            <span className="readout text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <Icon className="text-muted-foreground size-4" aria-hidden="true" />
          </div>
          <p className="mt-3 font-semibold tracking-tight">{title}</p>
          <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Faq({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <dl className="border-border divide-border grid divide-y border-y">
      {items.map((f) => (
        <div key={f.question} className="grid gap-1.5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6">
          <dt className="font-semibold tracking-tight">{f.question}</dt>
          <dd className="text-muted-foreground text-sm leading-relaxed">{f.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Loudest sample per bucket, normalised, for PeakGlyph and the scrubber. */
export function peaksOf(buffer: AudioBuffer, buckets = 96): number[] {
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const n = chans[0]?.length ?? 0;
  const out: number[] = [];
  const step = Math.max(1, Math.floor(n / buckets));
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const end = Math.min(n, (b + 1) * step);
    // Every 16th sample is plenty for a 40px picture.
    for (let i = b * step; i < end; i += 16) for (const c of chans) m = Math.max(m, Math.abs(c[i]!));
    out.push(m);
    max = Math.max(max, m);
  }
  return out.map((v) => (max > 0 ? v / max : 0));
}

const STYLES = `
@keyframes tools-bar { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
.tools-bar { animation: tools-bar 0.9s ease-in-out infinite; transform-origin: center; }
@keyframes tools-shimmer { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.tools-shimmer { animation: tools-shimmer 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .tools-bar, .tools-shimmer, .tools-anim { animation: none !important; }
}
`;
