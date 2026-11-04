/**
 * `/download` — the installers, the Soundbox film and the repo's numbers, on the site.
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
 * for everyone. Every moving part (the aurora, the film's tilt, the counters,
 * the prompt marquee) is decoration and stops under reduced motion.
 */

import { ArrowDownIcon, ArrowUpRightIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { SiteVideo } from "@/components/site-video";
import { SeoHead } from "@/components/seo-head";
import { REPO_URL } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

const LATEST_URL = `${REPO_URL}/releases/latest`;
const API_BASE = REPO_URL.replace("https://github.com/", "https://api.github.com/repos/");

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

/** The marquee: prompts in the material / action / space shape that works. */
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

const STYLES = `
@keyframes dl-drift-a { 0%,100% { transform: translate(-10%, 0) scale(1) } 50% { transform: translate(8%, 6%) scale(1.15) } }
@keyframes dl-drift-b { 0%,100% { transform: translate(10%, 4%) scale(1.1) } 50% { transform: translate(-6%, -4%) scale(.95) } }
@keyframes dl-marquee { to { transform: translateX(-50%) } }
@keyframes dl-flatten { from { transform: perspective(1400px) rotateX(18deg) scale(.92); opacity: .6 } to { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: no-preference) {
  .dl-a { animation: dl-drift-a 18s ease-in-out infinite }
  .dl-b { animation: dl-drift-b 22s ease-in-out infinite }
  .dl-marquee { animation: dl-marquee 50s linear infinite }
  @supports (animation-timeline: view()) {
    .dl-tilt { animation: dl-flatten linear both; animation-timeline: view(); animation-range: entry 0% cover 40% }
  }
}
.dl-grain { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E") }
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
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "mac-arm";
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

function Stat({ value, label }: { value: number | undefined; label: string }) {
  const shown = useCountUp(value);
  return (
    <div className="flex flex-col items-center gap-1 px-3 text-center sm:px-10">
      <span className="font-heading text-3xl font-semibold tracking-tight tabular-nums sm:text-5xl">
        {shown === undefined ? "–" : shown.toLocaleString("en")}
      </span>
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}

/** A card whose border and wash follow the pointer. */
function SpotlightCard({
  className,
  children,
  highlight,
}: {
  className?: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  };
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={cn(
        "group relative overflow-hidden rounded-3xl border p-6 transition-colors sm:p-8",
        highlight
          ? "border-primary/40 bg-primary/[0.06]"
          : "border-foreground/10 bg-foreground/[0.02] hover:border-foreground/20",
        className,
      )}
      style={{ "--x": "50%", "--y": "0px" } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(400px circle at var(--x) var(--y), color-mix(in oklch, var(--primary) 14%, transparent), transparent 60%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export function DownloadPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [mine, setMine] = useState<PlatformId | null>(null);

  useEffect(() => {
    setMine(detectPlatform());
    const controller = new AbortController();
    void github<Release>("/releases/latest", controller.signal).then((d) => d && setRelease(d));
    void github<Repo>("", controller.signal).then((d) => d && setRepo(d));
    return () => controller.abort();
  }, []);

  const assetFor = (p: Platform) => release?.assets.find((a) => p.match(a.name));
  const primary = PLATFORMS.find((p) => p.id === mine);
  const primaryAsset = primary && assetFor(primary);
  const downloads = release?.assets.reduce((sum, a) => sum + a.download_count, 0);
  // Your system first, so the big card is the one you want.
  const ordered = [...PLATFORMS].sort((a, b) => Number(b.id === mine) - Number(a.id === mine));

  return (
    <div className="bg-background text-foreground relative min-h-svh overflow-x-clip">
      <SeoHead
        title="Download Soundbox for Windows and macOS | Soundbox"
        description="Download the Soundbox desktop app for Windows 10/11 or macOS. Free, open source, no account. Models download from inside the app."
        path="/download"
      />
      <style>{STYLES}</style>

      {/* Decorative: two slow colour fields, a masked grid and film grain. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[60rem]">
        <div className="dl-a absolute top-[-12rem] left-[10%] size-[38rem] rounded-full bg-[oklch(0.7_0.15_190/0.28)] blur-[120px]" />
        <div className="dl-b absolute top-[-6rem] right-[5%] size-[32rem] rounded-full bg-[oklch(0.6_0.2_290/0.25)] blur-[120px]" />
        <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] bg-[linear-gradient(to_right,color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="dl-grain absolute inset-0 opacity-[0.07] mix-blend-overlay" />
      </div>

      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="download-heading" className="relative px-4 pt-20 sm:pt-28">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
          <a
            href={release?.html_url ?? LATEST_URL}
            className="border-foreground/10 bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:border-foreground/20 inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm backdrop-blur transition-colors"
          >
            <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
              {release?.tag_name ?? "New"}
            </span>
            Free and open source
            <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
          </a>

          <h1
            id="download-heading"
            className="font-heading mt-8 bg-gradient-to-b from-[var(--foreground)] to-[color-mix(in_oklch,var(--foreground)_55%,transparent)] bg-clip-text text-[clamp(3rem,9vw,6.5rem)] leading-[0.95] font-semibold tracking-[-0.045em] text-balance text-transparent"
          >
            Every sound you need, on your own machine.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-pretty">
            Sound effects, music and voices from open models, generated on your GPU. No account,
            no credits, no cloud.
          </p>

          <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <a
              href={primaryAsset?.browser_download_url ?? "#installers"}
              className="bg-foreground text-background group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-7 text-[15px] font-medium shadow-[0_0_0_1px_color-mix(in_oklch,var(--foreground)_20%,transparent),0_8px_40px_-8px_var(--primary)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
            >
              <ArrowDownIcon
                className="size-4 transition-transform group-hover:translate-y-0.5"
                aria-hidden="true"
              />
              {primary ? `Download for ${primary.short}` : "Download Soundbox"}
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="border-foreground/15 bg-foreground/[0.03] hover:bg-foreground/[0.07] inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border px-6 text-[15px] font-medium backdrop-blur transition-colors sm:w-auto"
            >
              <StarIcon className="size-4" aria-hidden="true" />
              Star on GitHub
              {repo ? (
                <span className="text-muted-foreground tabular-nums">
                  {repo.stargazers_count.toLocaleString("en")}
                </span>
              ) : null}
            </a>
          </div>
          <p className="text-muted-foreground mt-4 text-xs">
            {primaryAsset
              ? `${release?.tag_name} · ${megabytes(primaryAsset.size)} MB · `
              : "Windows and macOS · "}
            <a href="#installers" className="hover:text-foreground underline-offset-4 hover:underline">
              other platforms
            </a>
          </p>
        </div>

        {/* The film, tilted back and flattening as it scrolls into view. */}
        <div className="relative mx-auto mt-16 w-full max-w-5xl sm:mt-20">
          <div
            aria-hidden="true"
            className="bg-primary/30 absolute inset-x-[10%] top-[20%] bottom-0 rounded-full blur-[100px]"
          />
          <div className="dl-tilt border-foreground/10 bg-foreground/[0.03] relative origin-top rounded-[1.75rem] border p-2 shadow-2xl backdrop-blur">
            <SiteVideo
              src="/media/soundbox-vibe.mp4"
              poster="/media/posters/vibe.jpg"
              label="Soundbox in thirty seconds: type a prompt, hear sound effects, music and voices, switch models"
              className="[&>div]:rounded-[1.25rem] [&>div]:border-0"
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- marquee */}
      <div
        aria-hidden="true"
        className="mt-16 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
      >
        <div className="dl-marquee flex w-max gap-3">
          {[...PROMPTS, ...PROMPTS].map((p, i) => (
            <span
              key={i}
              className="border-foreground/10 text-muted-foreground rounded-full border px-4 py-2 text-sm whitespace-nowrap"
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ stats */}
      <section aria-label="Project numbers" className="px-4 pt-20">
        <div className="divide-foreground/10 mx-auto grid w-fit grid-cols-3 divide-x">
          <Stat value={repo?.stargazers_count} label="GitHub stars" />
          <Stat value={downloads} label={release ? `Downloads of ${release.tag_name}` : "Downloads"} />
          <Stat value={repo?.forks_count} label="Forks" />
        </div>
      </section>

      {/* ------------------------------------------------------- installers */}
      <section id="installers" aria-labelledby="installers-heading" className="scroll-mt-20 px-4 pt-28">
        <div className="mx-auto w-full max-w-5xl">
          <h2
            id="installers-heading"
            className="font-heading text-center text-4xl font-semibold tracking-[-0.035em] sm:text-5xl"
          >
            Pick your platform
          </h2>
          <p className="text-muted-foreground mx-auto mt-4 max-w-md text-center">
            One installer with everything inside. Models download from the app the first time you
            use them.
          </p>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {ordered.map((platform, i) => {
              const asset = assetFor(platform);
              const isMine = platform.id === mine;
              const big = i === 0;
              return (
                <SpotlightCard
                  key={platform.id}
                  highlight={isMine}
                  className={cn(big && "md:row-span-2 md:flex md:flex-col")}
                >
                  <div className={cn("flex h-full flex-col", big && "md:min-h-72")}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground text-sm">{platform.detail}</span>
                      {isMine ? (
                        <span className="text-primary text-xs font-medium">Detected</span>
                      ) : null}
                    </div>
                    <h3
                      className={cn(
                        "font-heading mt-3 font-semibold tracking-[-0.03em]",
                        big ? "text-4xl sm:text-5xl" : "text-2xl",
                      )}
                    >
                      {platform.label}
                    </h3>
                    {big ? (
                      <ul className="text-muted-foreground mt-6 grid gap-2 text-sm">
                        {[
                          "The desktop app and its local server",
                          "audio.cpp, the native engine. No Python",
                          "An MCP server for Claude Code and Cursor",
                        ].map((line) => (
                          <li key={line} className="flex items-center gap-2.5">
                            <span className="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-auto flex items-end justify-between gap-4 pt-8">
                      <span className="text-muted-foreground font-mono text-xs">
                        {asset ? `${megabytes(asset.size)} MB` : " "}
                      </span>
                      <a
                        href={asset?.browser_download_url ?? LATEST_URL}
                        className={cn(
                          "inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors",
                          isMine || big
                            ? "bg-foreground text-background hover:opacity-90"
                            : "border-foreground/15 hover:bg-foreground/[0.06] border",
                        )}
                      >
                        <ArrowDownIcon className="size-4" aria-hidden="true" />
                        Download
                      </a>
                    </div>
                  </div>
                </SpotlightCard>
              );
            })}
          </div>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            On Linux?{" "}
            <a className="text-foreground underline underline-offset-4" href={`${REPO_URL}#run-from-source`}>
              Run it from source
            </a>
            . Older builds are on the{" "}
            <a className="text-foreground underline underline-offset-4" href={`${REPO_URL}/releases`}>
              releases page
            </a>
            .
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ outro */}
      <section aria-labelledby="github-heading" className="relative px-4 pt-32 pb-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(ellipse_at_bottom,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_65%)]"
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
          <h2
            id="github-heading"
            className="font-heading text-[clamp(2.5rem,7vw,5rem)] leading-[0.95] font-semibold tracking-[-0.045em] text-balance"
          >
            Built in the open.
          </h2>
          <p className="text-muted-foreground mt-5 max-w-md text-lg leading-relaxed">
            Read the code, file an issue, send a pull request. A star helps the next person find it.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="bg-foreground text-background inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-medium transition-transform hover:scale-[1.02]"
            >
              <StarIcon className="size-4" aria-hidden="true" />
              Star on GitHub
            </a>
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer noopener"
              className="border-foreground/15 hover:bg-foreground/[0.06] inline-flex h-12 items-center gap-2 rounded-full border px-6 text-[15px] font-medium transition-colors"
            >
              Issues
              <ArrowUpRightIcon className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
