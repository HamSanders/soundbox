/**
 * `/download` — the installers, the Soundbox film and the repo's numbers, on the site.
 *
 * The page is built around the mark's own idea: a line of sound that turns
 * into the M. In the hero a calm wave runs in from the left edge of the
 * screen, becomes the pen line of the M, and leaves the other side as a live
 * waveform that swells under the pointer. Everything else stays out of its
 * way: one colour of ink, the display face for the big lines, mono caps for
 * labels, hairline grids and square-cut corners.
 *
 * The installer filenames carry the version (`Soundbox_0.4.1_x64-setup.exe`),
 * so a link to one file would go stale on every release. The page therefore
 * renders with links to `releases/latest` (which GitHub redirects to the newest
 * release) and, once mounted, asks the GitHub API for that release and for the
 * repository, then swaps in the direct asset links, version and sizes and fills
 * in the star, fork and download counts. If either request fails or is rate
 * limited, the fallback links still work and the numbers show a dash.
 *
 * The visitor's OS is guessed after mount, so the prerendered HTML is the same
 * for everyone. Every moving part (the wave, the pen, the headline's entrance,
 * the tilt, the counters, the ticker) is decoration and stops under reduced
 * motion, where the wave is drawn once and holds still.
 */

import { ArrowDownIcon, ArrowUpRightIcon, StarIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";

import { SiteVideo } from "@/components/site-video";
import { SeoHead } from "@/components/seo-head";
import { TimelineBanner } from "@/components/timeline-banner";
import { MARK_WEIGHT, M_HEIGHT, M_PATH, M_WIDTH } from "@/lib/brand-geometry";
import { REPO_URL } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

const LATEST_URL = `${REPO_URL}/releases/latest`;
const API_BASE = REPO_URL.replace(
  "https://github.com/",
  "https://api.github.com/repos/",
);

interface Asset {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: Asset[];
}

interface Repo {
  stargazers_count: number;
  forks_count: number;
}

type PlatformId = "windows" | "mac-arm" | "mac-intel";

interface Platform {
  id: PlatformId;
  label: string;
  short: string;
  detail: string;
  match: (name: string) => boolean;
}

const PLATFORMS: Platform[] = [
  {
    id: "windows",
    label: "Windows",
    short: "Windows",
    detail: "Windows 10 and 11, x64",
    match: (n) => /x64-setup\.exe$/i.test(n),
  },
  {
    id: "mac-arm",
    label: "macOS",
    short: "Mac",
    detail: "Apple silicon, M1 and later",
    match: (n) => /aarch64\.dmg$/i.test(n),
  },
  {
    id: "mac-intel",
    label: "macOS Intel",
    short: "Intel Mac",
    detail: "Older Macs, x64",
    match: (n) => /x64\.dmg$/i.test(n),
  },
];

/** The ticker: prompts in the material / action / space shape that works. */
const PROMPTS = [
  "heavy wooden door slamming in a stone corridor",
  "lo-fi hip hop, dusty vinyl, 82 bpm",
  "rain on a tin roof, distant thunder",
  "a warm narrator, close to the mic",
  "synthwave chorus, big gated drums",
  "boots on wet gravel at night",
  "glass bottle shattering on tile",
  "old freight lift starting under load",
];

const HEADLINE = [
  ["Every", "sound", "you", "need,"],
  ["on", "your", "own", "machine."],
];

const INSIDE = [
  ["The desktop app", "and its local server. Nothing leaves your machine."],
  ["audio.cpp", "the native engine. No Python to install."],
  ["An MCP server", "so Claude Code and Cursor can make sound too."],
] as const;

const STYLES = `
@keyframes dl-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes dl-ticker { to { transform: translateX(-50%) } }
@keyframes dl-rise { from { opacity: 0; transform: translateY(.35em); filter: blur(10px) } to { opacity: 1; transform: none; filter: blur(0) } }
@keyframes dl-flatten { from { transform: perspective(1600px) rotateX(18deg) scale(.93) } to { transform: none } }
@keyframes dl-shine { from { opacity: 1; transform: translateX(-160%) skewX(-20deg) } to { opacity: 1; transform: translateX(520%) skewX(-20deg) } }
.dl-shine { opacity: 0 }
@media (prefers-reduced-motion: no-preference) {
  .dl-pen { animation: dl-draw 1.9s cubic-bezier(.65,0,.35,1) .5s both }
  .dl-ticker { animation: dl-ticker 60s linear infinite }
  .dl-rise { animation: dl-rise .9s cubic-bezier(.16,1,.3,1) var(--d, 0s) both }
  .dl-cta:hover .dl-shine { animation: dl-shine .8s ease-out }
  @supports (animation-timeline: view()) {
    .dl-tilt { animation: dl-flatten linear both; animation-timeline: view(); animation-range: entry 0% cover 38% }
  }
}
`;

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** `GET` a GitHub API path and hand back the JSON, or null on any failure. */
async function github<T>(path: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * A best guess at the visitor's installer. Browsers on Apple silicon still
 * report "Intel" in the user agent, so a Mac defaults to the Apple silicon
 * build, which is what every Mac sold since 2020 needs.
 */
function detectPlatform(): PlatformId | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua))
    return "mac-arm";
  return null;
}

/** Counts up to `target` once it arrives. Jumps straight there under reduced motion. */
function useCountUp(target: number | undefined): number | undefined {
  const [shown, setShown] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (target === undefined) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1200);
      setShown(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

/* ------------------------------------------------------------------ wave */

/**
 * The hero's drawing space. It is far wider than any screen and the SVG is set
 * to `slice`, so the M keeps its size against the band's height and the wave
 * simply runs off both edges however wide the window is.
 */
const VB_W = 4800;
const VB_H = 320;
const M_SCALE = 1.75;
const M_X = (VB_W - M_WIDTH * M_SCALE) / 2;
const M_Y = (VB_H - M_HEIGHT * M_SCALE) / 2;
const LINE = MARK_WEIGHT.large * 0.8 * M_SCALE;
/** Where the M's pen line starts (`M_PATH` opens at 0, 107.5): the wave in ends here. */
const TAIL = { x: M_X, y: M_Y + 107.5 * M_SCALE };
/** Where the sound comes back out, level with the middle of the M. */
const OUT = { x: M_X + (M_WIDTH + 10) * M_SCALE, y: M_Y + 62 * M_SCALE };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);

/**
 * Sound in, mark, sound out. The two waves are redrawn every frame from the
 * clock; the M between them is the brand path, drawn on by CSS.
 */
function HeroWave({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const inRef = useRef<SVGPathElement>(null);
  const outRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const lineIn = inRef.current;
    const lineOut = outRef.current;
    if (!svg || !lineIn || !lineOut) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let pointerX = VB_W / 2;
    let near = 0;
    let wanted = 0;
    let frame = 0;

    const draw = (now: number) => {
      const rect = svg.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
        const t = still ? 0 : (now - start) / 1000;
        const half = (rect.width / 2) * (VB_H / rect.height) + 24;
        const left = VB_W / 2 - half;
        const right = VB_W / 2 + half;
        near += (wanted - near) * 0.07;
        // The line swells where the pointer is.
        const lift = (x: number) =>
          1 + 1.5 * near * Math.exp(-Math.pow((x - pointerX) / 240, 2));

        // In: a slow, calm wave that settles onto the M's opening stroke.
        const inEnd = left + (TAIL.x - left) * (still ? 1 : easeOut(t / 0.7));
        let d = "";
        for (let x = left; ; x += 8) {
          const px = Math.min(x, inEnd);
          const gap = TAIL.x - px;
          const env = Math.pow(Math.min(1, gap / 320), 1.6);
          const y =
            TAIL.y +
            0.3 * gap * Math.exp(-gap / 70) +
            17 * env * lift(px) * Math.sin(px * 0.021 - t * 2.2);
          d += `${d ? "L" : "M"}${px.toFixed(1)} ${y.toFixed(1)}`;
          if (px >= inEnd) break;
        }
        lineIn.setAttribute("d", d);

        // Out: the same line as a busy, speaking waveform.
        const grown = still ? 1 : easeOut((t - 2.3) / 0.9);
        d = "";
        if (grown > 0) {
          const outEnd = OUT.x + (right - OUT.x) * grown;
          for (let x = OUT.x; ; x += 5) {
            const px = Math.min(x, outEnd);
            const gap = px - OUT.x;
            const env = Math.min(1, gap / 130);
            const burst = 0.62 + 0.38 * Math.sin(px * 0.0045 - t * 1.1);
            const s =
              Math.sin(px * 0.05 - t * 5) * 0.6 +
              Math.sin(px * 0.093 - t * 7.3) * 0.3 +
              Math.sin(px * 0.021 - t * 2.4) * 0.35;
            const y =
              OUT.y + 46 * env * env * (3 - 2 * env) * burst * lift(px) * s;
            d += `${d ? "L" : "M"}${px.toFixed(1)} ${y.toFixed(1)}`;
            if (px >= outEnd) break;
          }
        }
        lineOut.setAttribute("d", d);
      }
      if (!still) frame = requestAnimationFrame(draw);
    };

    const onMove = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      if (rect.height === 0) return;
      pointerX =
        VB_W / 2 +
        (e.clientX - (rect.left + rect.width / 2)) * (VB_H / rect.height);
      // Only while the pointer is somewhere around the band.
      wanted =
        e.clientY > rect.top - 160 && e.clientY < rect.bottom + 160 ? 1 : 0;
    };
    const onResize = () => still && draw(performance.now());

    draw(start);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={LINE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient
          id="dl-out"
          gradientUnits="userSpaceOnUse"
          x1={OUT.x}
          x2={OUT.x + 110}
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path ref={inRef} />
      <g transform={`translate(${M_X} ${M_Y}) scale(${M_SCALE})`}>
        <path
          className="dl-pen"
          d={M_PATH}
          pathLength={1}
          strokeDasharray="1"
          strokeWidth={LINE / M_SCALE}
        />
      </g>
      <path ref={outRef} stroke="url(#dl-out)" />
    </svg>
  );
}

/* ----------------------------------------------------------------- pieces */

/** A panel that carries a soft light under the pointer. */
function Lit({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "li";
}) {
  const onMove = (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  };
  return (
    <Tag
      onMouseMove={onMove}
      className={cn("group/lit relative overflow-hidden", className)}
      style={{ "--x": "50%", "--y": "0px" } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/lit:opacity-100"
        style={{
          background:
            "radial-gradient(380px circle at var(--x) var(--y), color-mix(in oklch, currentColor 11%, transparent), transparent 65%)",
        }}
      />
      <div className="relative flex h-full flex-col">{children}</div>
    </Tag>
  );
}

/** A meter readout: a mono caps label over a big display-face number. */
function Stat({ value, label }: { value: number | undefined; label: string }) {
  const shown = useCountUp(value);
  return (
    <Lit className="bg-background flex-1 p-6">
      <span className="label-caps text-muted-foreground">{label}</span>
      <span className="font-display mt-auto pt-4 text-6xl leading-[0.85] font-extrabold tabular-nums lg:text-7xl">
        {shown === undefined ? "–" : shown.toLocaleString("en")}
      </span>
    </Lit>
  );
}

/** A square-cut link button. `solid` is the one signal on a row. */
function ButtonLink({
  href,
  solid,
  external,
  className,
  children,
}: {
  href: string;
  solid?: boolean;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className={cn(
        "dl-cta focus-visible:ring-ring/50 relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-sm px-5 text-sm font-medium whitespace-nowrap outline-none transition-[background-color,box-shadow,transform] focus-visible:ring-3 active:scale-[0.98]",
        solid
          ? "bg-foreground text-background"
          : "border-border-strong hover:bg-foreground/[0.07] border",
        className,
      )}
    >
      {solid ? (
        <span
          aria-hidden="true"
          className="dl-shine bg-background/45 pointer-events-none absolute inset-y-0 left-0 w-1/4 blur-md"
        />
      ) : null}
      <span className="relative inline-flex items-center gap-2">
        {children}
      </span>
    </a>
  );
}

/** A section's opening: a numbered mono label, the title, and a line beside it. */
function SectionHead({
  index,
  label,
  id,
  title,
  children,
}: {
  index: string;
  label: string;
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
      <div>
        <p className="label-caps text-muted-foreground">
          {index} <span aria-hidden="true">/</span> {label}
        </p>
        <h2
          id={id}
          className="mt-3 text-5xl leading-[0.9] uppercase sm:text-7xl"
        >
          {title}
        </h2>
      </div>
      {children ? (
        <p className="text-muted-foreground max-w-sm leading-relaxed">
          {children}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export function DownloadPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [mine, setMine] = useState<PlatformId | null>(null);

  useEffect(() => {
    setMine(detectPlatform());
    const controller = new AbortController();
    void github<Release>("/releases/latest", controller.signal).then(
      (d) => d && setRelease(d),
    );
    void github<Repo>("", controller.signal).then((d) => d && setRepo(d));
    return () => controller.abort();
  }, []);

  const assetFor = (p: Platform) =>
    release?.assets.find((a) => p.match(a.name));
  const primary = PLATFORMS.find((p) => p.id === mine);
  const primaryAsset = primary && assetFor(primary);
  const downloads = release?.assets.reduce(
    (sum, a) => sum + a.download_count,
    0,
  );
  // Your system first, so on a phone the top card is the one you want.
  const ordered = [...PLATFORMS].sort(
    (a, b) => Number(b.id === mine) - Number(a.id === mine),
  );

  return (
    <div className="bg-background text-foreground relative min-h-svh overflow-x-clip">
      <SeoHead
        title="Download Soundbox for Windows and macOS | Soundbox"
        description="Download the Soundbox desktop app for Windows 10/11 or macOS. Free, open source, no account. Models download from inside the app."
        path="/download"
      />
      <style>{STYLES}</style>

      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="download-heading" className="relative">
        {/* One light from above, and a ruled floor fading into the dark. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[56rem]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(70rem_34rem_at_50%_-6rem,color-mix(in_oklch,var(--foreground)_13%,transparent),transparent_70%)]" />
          <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_30%,black,transparent)] bg-[linear-gradient(to_right,color-mix(in_oklch,var(--foreground)_5%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--foreground)_5%,transparent)_1px,transparent_1px)] bg-[size:72px_72px]" />
        </div>

        <div className="relative flex flex-col items-center pt-12 text-center sm:pt-16">
          <a
            href={release?.html_url ?? LATEST_URL}
            className="label-caps text-muted-foreground hover:text-foreground dl-rise mx-4 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 transition-colors"
          >
            <span className="bg-foreground text-background rounded-sm px-1.5">
              {release?.tag_name ?? "Latest"}
            </span>
            Free and open source
            <span aria-hidden="true">/</span>
            Windows and macOS
            <ArrowUpRightIcon className="size-3" aria-hidden="true" />
          </a>

          <HeroWave className="mt-6 h-[clamp(9.5rem,22vw,17.5rem)] w-full [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]" />

          <h1
            id="download-heading"
            className="mt-4 px-4 text-[clamp(3.1rem,11.4vw,9.25rem)] leading-[0.84] text-balance uppercase"
          >
            {HEADLINE.map((line, l) => (
              <span key={l} className="block">
                {line.map((word, w) => (
                  <span key={word}>
                    <span
                      className="dl-rise inline-block"
                      style={
                        {
                          "--d": `${0.15 + (l * 4 + w) * 0.07}s`,
                        } as CSSProperties
                      }
                    >
                      {word}
                    </span>
                    {w < line.length - 1 ? " " : null}
                  </span>
                ))}
              </span>
            ))}
          </h1>
          <p
            className="text-muted-foreground dl-rise mt-7 max-w-xl px-4 text-lg leading-relaxed text-pretty sm:text-xl"
            style={{ "--d": "0.8s" } as CSSProperties}
          >
            Sound effects, music and voices from open models, generated on your
            GPU. No account, no credits, no cloud.
          </p>

          <div
            className="dl-rise mt-9 flex w-full flex-col items-center justify-center gap-3 px-4 sm:w-auto sm:flex-row"
            style={{ "--d": "0.95s" } as CSSProperties}
          >
            <ButtonLink
              href={primaryAsset?.browser_download_url ?? "#installers"}
              solid
              className="h-14 w-full px-9 text-base shadow-[0_0_70px_-14px_var(--foreground)] hover:shadow-[0_0_90px_-10px_var(--foreground)] sm:w-auto"
            >
              <ArrowDownIcon className="size-4.5" aria-hidden="true" />
              {primary ? `Download for ${primary.short}` : "Download Soundbox"}
            </ButtonLink>
            <ButtonLink
              href={REPO_URL}
              external
              className="h-14 w-full px-7 text-base sm:w-auto"
            >
              <StarIcon className="size-4" aria-hidden="true" />
              Star on GitHub
              {repo ? (
                <span className="text-muted-foreground tabular-nums">
                  {repo.stargazers_count.toLocaleString("en")}
                </span>
              ) : null}
            </ButtonLink>
          </div>
          <p
            className="readout text-muted-foreground dl-rise mt-5 px-4"
            style={{ "--d": "1.05s" } as CSSProperties}
          >
            {primaryAsset
              ? `${megabytes(primaryAsset.size)} MB · ${primaryAsset.name} · `
              : "One installer, everything inside · "}
            <a
              href="#installers"
              className="hover:text-foreground underline underline-offset-4"
            >
              every platform
            </a>
          </p>
        </div>

        {/* The studio, tilted back and flattening as it scrolls into view. */}
        <div className="relative mx-auto mt-16 w-full max-w-5xl px-4 sm:mt-24">
          <div
            aria-hidden="true"
            className="bg-foreground/15 absolute inset-x-[12%] top-[12%] bottom-[-6%] blur-[110px]"
          />
          <div className="dl-tilt border-border-strong/60 bg-background relative origin-top border p-1.5 shadow-2xl sm:p-2">
            <TimelineBanner className="text-left" />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- ticker */}
      <div
        aria-hidden="true"
        className="border-border mt-20 overflow-hidden border-y py-3.5 sm:mt-28"
      >
        <div className="dl-ticker label-caps text-muted-foreground flex w-max">
          {[...PROMPTS, ...PROMPTS].map((p, i) => (
            <span key={i} className="flex items-center whitespace-nowrap">
              <span className="px-6">{p}</span>
              <span className="text-border-strong">/</span>
            </span>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------- installers */}
      <section
        id="installers"
        aria-labelledby="installers-heading"
        className="scroll-mt-20 px-4 pt-24 sm:pt-32"
      >
        <div className="mx-auto w-full max-w-5xl">
          <SectionHead
            index="01"
            label="Install"
            id="installers-heading"
            title="Pick your platform"
          >
            One installer with everything inside. Models download from the app
            the first time you use them.
          </SectionHead>

          <ul className="bg-border border-border mt-10 grid gap-px border md:grid-cols-3">
            {ordered.map((platform) => {
              const asset = assetFor(platform);
              const isMine = platform.id === mine;
              return (
                <Lit
                  as="li"
                  key={platform.id}
                  className={cn(
                    "min-h-72 p-6 sm:p-7",
                    isMine ? "bg-foreground text-background" : "bg-background",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={cn(
                        "label-caps",
                        !isMine && "text-muted-foreground",
                      )}
                    >
                      {platform.detail}
                    </span>
                    {isMine ? (
                      <span className="label-caps bg-background text-foreground rounded-sm px-1.5">
                        Yours
                      </span>
                    ) : null}
                  </div>
                  <h3 className="font-display mt-5 text-6xl leading-[0.85] font-extrabold">
                    {platform.label}
                  </h3>
                  <div className="mt-auto pt-10">
                    <p
                      className={cn(
                        "readout truncate",
                        !isMine && "text-muted-foreground",
                      )}
                    >
                      {asset
                        ? `${megabytes(asset.size)} MB · ${asset.name}`
                        : "Latest release"}
                    </p>
                    <a
                      href={asset?.browser_download_url ?? LATEST_URL}
                      className={cn(
                        "focus-visible:ring-ring/50 mt-3 inline-flex h-12 w-full items-center justify-between rounded-sm px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3",
                        isMine
                          ? "bg-background text-foreground hover:bg-background/85"
                          : "border-border-strong hover:bg-foreground hover:text-background border",
                      )}
                    >
                      Download
                      <ArrowDownIcon className="size-4" aria-hidden="true" />
                    </a>
                  </div>
                </Lit>
              );
            })}
          </ul>

          <p className="text-muted-foreground mt-6 text-sm">
            On Linux?{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href={`${REPO_URL}#run-from-source`}
            >
              Run it from source
            </a>
            . Older builds are on the{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href={`${REPO_URL}/releases`}
            >
              releases page
            </a>
            .
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- film and numbers */}
      <section aria-labelledby="proof-heading" className="px-4 pt-24 sm:pt-32">
        <div className="mx-auto w-full max-w-5xl">
          <SectionHead
            index="02"
            label="In the box"
            id="proof-heading"
            title="See it. Count it."
          >
            Thirty seconds of the app at work, and what the repository says
            today.
          </SectionHead>

          <div className="bg-border border-border mt-10 grid gap-px border lg:grid-cols-3">
            {/* The film predates the noir look; in greyscale it sits in the
                page until it is re-cut. */}
            <div className="bg-background p-2 grayscale lg:col-span-2">
              <SiteVideo
                src="/media/soundbox-vibe.mp4"
                poster="/media/posters/vibe.jpg"
                label="Soundbox in thirty seconds: type a prompt, hear sound effects, music and voices, switch models"
                className="[&>div]:rounded-none [&>div]:border-0"
              />
            </div>
            <div className="bg-border flex flex-col gap-px sm:flex-row lg:flex-col">
              <Stat value={repo?.stargazers_count} label="GitHub stars" />
              <Stat
                value={downloads}
                label={
                  release ? `Downloads of ${release.tag_name}` : "Downloads"
                }
              />
              <Stat value={repo?.forks_count} label="Forks" />
            </div>
            {INSIDE.map(([title, rest], i) => (
              <Lit key={title} className="bg-background p-6 sm:p-7">
                <span className="readout text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-8 text-lg leading-snug">
                  <span className="font-semibold">{title}</span>{" "}
                  <span className="text-muted-foreground">{rest}</span>
                </p>
              </Lit>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ outro */}
      <section
        aria-labelledby="github-heading"
        className="relative px-4 pt-28 pb-28 sm:pt-40 sm:pb-36"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[32rem] bg-[radial-gradient(60rem_26rem_at_50%_110%,color-mix(in_oklch,var(--foreground)_14%,transparent),transparent_70%)]"
        />
        <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
          <h2
            id="github-heading"
            className="text-[clamp(3.5rem,13vw,10.5rem)] leading-[0.84] text-balance uppercase"
          >
            Built in the open.
          </h2>
          <p className="text-muted-foreground mt-7 max-w-md text-lg leading-relaxed">
            Read the code, file an issue, send a pull request. A star helps the
            next person find it.
          </p>
          <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
            <ButtonLink
              href={REPO_URL}
              external
              solid
              className="h-14 px-9 text-base"
            >
              <StarIcon className="size-4" aria-hidden="true" />
              Star on GitHub
            </ButtonLink>
            <ButtonLink
              href={`${REPO_URL}/issues`}
              external
              className="h-14 px-7 text-base"
            >
              Issues
              <ArrowUpRightIcon className="size-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
