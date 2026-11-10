/**
 * `/download` — the installers, the Soundbox film and the repo's numbers, on the site.
 *
 * Set as a spec sheet in the noir system: the display face for the big lines,
 * mono caps for labels, hairline rules, square-cut corners and white ink as
 * the only signal. The one-line M draws itself in the hero.
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
 * for everyone. Every moving part (the pen drawing the M, the counters, the
 * prompt ticker) is decoration and stops under reduced motion.
 */

import { ArrowDownIcon, ArrowUpRightIcon, StarIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { SiteVideo } from "@/components/site-video";
import { SeoHead } from "@/components/seo-head";
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

const INSIDE = [
  ["The desktop app", "and its local server, on your machine."],
  ["audio.cpp", "the native engine. No Python to install."],
  ["An MCP server", "so Claude Code and Cursor can make sound too."],
] as const;

const STYLES = `
@keyframes dl-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes dl-ticker { to { transform: translateX(-50%) } }
@media (prefers-reduced-motion: no-preference) {
  .dl-pen { animation: dl-draw 2.8s cubic-bezier(.65,0,.35,1) .25s both }
  .dl-ticker { animation: dl-ticker 60s linear infinite }
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

/** A meter readout: a mono caps label over a big display-face number. */
function Stat({ value, label }: { value: number | undefined; label: string }) {
  const shown = useCountUp(value);
  return (
    <div className="flex min-w-0 flex-col gap-3 px-4 py-6 sm:px-6">
      <span className="label-caps text-muted-foreground">{label}</span>
      <span className="font-display text-6xl leading-none font-extrabold tabular-nums sm:text-7xl">
        {shown === undefined ? "–" : shown.toLocaleString("en")}
      </span>
    </div>
  );
}

/** The one-line M, drawn by the pen on load (and simply shown under reduced motion). */
function PenMark({ className }: { className?: string }) {
  const pad = MARK_WEIGHT.large;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${M_WIDTH + pad * 2} ${M_HEIGHT + pad * 2}`}
      className={className}
      aria-hidden="true"
    >
      <path
        className="dl-pen"
        d={M_PATH}
        pathLength={1}
        strokeDasharray="1"
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_WEIGHT.large * 0.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
        "focus-visible:ring-ring/50 inline-flex h-11 items-center justify-center gap-2 rounded-sm px-5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3",
        solid
          ? "bg-foreground text-background hover:bg-foreground/85"
          : "border-border-strong hover:bg-foreground/[0.06] border",
        className,
      )}
    >
      {children}
    </a>
  );
}

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
  // Your system first, so the top row is the one you want.
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
      <section aria-labelledby="download-heading" className="px-4">
        <div className="mx-auto grid w-full max-w-5xl gap-10 pt-14 pb-16 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)] lg:items-center lg:gap-12">
          <div className="min-w-0">
            <p className="label-caps text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Download</span>
              <span aria-hidden="true">/</span>
              <a
                href={release?.html_url ?? LATEST_URL}
                className="hover:text-foreground"
              >
                {release?.tag_name ?? "Latest release"}
              </a>
              <span aria-hidden="true">/</span>
              <span>Free and open source</span>
            </p>
            <h1
              id="download-heading"
              className="mt-6 text-[clamp(3.25rem,9vw,6.75rem)] leading-[0.88] text-balance uppercase"
            >
              Every sound you need, on your own machine.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-lg text-lg leading-relaxed text-pretty">
              Sound effects, music and voices from open models, generated on
              your GPU. No account, no credits, no cloud.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink
                href={primaryAsset?.browser_download_url ?? "#installers"}
                solid
                className="h-12 px-7 text-[15px]"
              >
                <ArrowDownIcon className="size-4" aria-hidden="true" />
                {primary
                  ? `Download for ${primary.short}`
                  : "Download Soundbox"}
              </ButtonLink>
              <ButtonLink
                href={REPO_URL}
                external
                className="h-12 px-6 text-[15px]"
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
            <p className="readout text-muted-foreground mt-4">
              {primaryAsset
                ? `${release?.tag_name} · ${megabytes(primaryAsset.size)} MB · ${primaryAsset.name} · `
                : "Windows and macOS · "}
              <a
                href="#installers"
                className="hover:text-foreground underline underline-offset-4"
              >
                every platform
              </a>
            </p>
          </div>

          <PenMark className="text-foreground mx-auto w-full max-w-sm lg:max-w-none" />
        </div>
      </section>

      {/* ----------------------------------------------------------- ticker */}
      <div
        aria-hidden="true"
        className="border-border overflow-hidden border-y py-3"
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
        className="scroll-mt-20 px-4 pt-20 sm:pt-24"
      >
        <div className="mx-auto w-full max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <h2
              id="installers-heading"
              className="text-5xl leading-none uppercase sm:text-6xl"
            >
              Pick your platform
            </h2>
            <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
              One installer with everything inside. Models download from the app
              the first time you use them.
            </p>
          </div>

          <div className="border-border-strong mt-10 border-t">
            <div className="label-caps text-muted-foreground border-border hidden grid-cols-[1.1fr_1.2fr_1.7fr_0.5fr_8rem] gap-6 border-b py-3 md:grid">
              <span>Platform</span>
              <span>Runs on</span>
              <span>File</span>
              <span className="text-right">Size</span>
              <span />
            </div>
            <ul>
              {ordered.map((platform) => {
                const asset = assetFor(platform);
                const isMine = platform.id === mine;
                return (
                  <li
                    key={platform.id}
                    className={cn(
                      "border-border relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 border-b py-5 md:grid-cols-[1.1fr_1.2fr_1.7fr_0.5fr_8rem] md:py-6",
                      isMine &&
                        "before:bg-foreground before:absolute before:inset-y-0 before:-left-4 before:w-0.5",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <h3 className="font-display text-3xl leading-none font-extrabold sm:text-4xl">
                        {platform.label}
                      </h3>
                      {isMine ? (
                        <span className="label-caps bg-foreground text-background rounded-sm px-1.5">
                          Yours
                        </span>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground col-start-1 text-sm md:col-start-auto">
                      {platform.detail}
                    </span>
                    <span className="readout text-muted-foreground col-start-1 min-w-0 truncate md:col-start-auto">
                      {asset ? asset.name : "From the latest release"}
                    </span>
                    <span className="readout text-muted-foreground col-start-1 md:col-start-auto md:text-right">
                      {asset ? `${megabytes(asset.size)} MB` : "–"}
                    </span>
                    <ButtonLink
                      href={asset?.browser_download_url ?? LATEST_URL}
                      solid={isMine}
                      className="col-start-2 row-span-4 row-start-1 w-32 md:col-start-auto md:row-span-1 md:row-start-auto"
                    >
                      <ArrowDownIcon className="size-4" aria-hidden="true" />
                      Download
                    </ButtonLink>
                  </li>
                );
              })}
            </ul>
          </div>

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

      {/* ----------------------------------------------------------- inside */}
      <section aria-labelledby="inside-heading" className="px-4 pt-20 sm:pt-24">
        <div className="mx-auto w-full max-w-5xl">
          <h2
            id="inside-heading"
            className="text-4xl leading-none uppercase sm:text-5xl"
          >
            In the box
          </h2>
          <ol className="border-border mt-8 grid border-t md:grid-cols-3">
            {INSIDE.map(([title, rest], i) => (
              <li
                key={title}
                className="border-border flex gap-4 border-b py-6 md:border-r md:border-b-0 md:px-6 md:first:pl-0 md:last:border-r-0"
              >
                <span className="readout text-muted-foreground pt-1">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="leading-relaxed">
                  <span className="font-semibold">{title}</span>{" "}
                  <span className="text-muted-foreground">{rest}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------- film */}
      {/* The film predates the noir look; in greyscale it sits in the page
          until it is re-cut. */}
      <section aria-label="The film" className="px-4 pt-20 sm:pt-24">
        <div className="border-border mx-auto w-full max-w-5xl border p-2 grayscale">
          <SiteVideo
            src="/media/soundbox-vibe.mp4"
            poster="/media/posters/vibe.jpg"
            label="Soundbox in thirty seconds: type a prompt, hear sound effects, music and voices, switch models"
            className="[&>div]:rounded-none [&>div]:border-0"
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ stats */}
      <section aria-label="Project numbers" className="px-4 pt-20 sm:pt-24">
        <div className="border-border-strong divide-border mx-auto grid w-full max-w-5xl grid-cols-1 divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat value={repo?.stargazers_count} label="GitHub stars" />
          <Stat
            value={downloads}
            label={release ? `Downloads of ${release.tag_name}` : "Downloads"}
          />
          <Stat value={repo?.forks_count} label="Forks" />
        </div>
      </section>

      {/* ------------------------------------------------------------ outro */}
      <section
        aria-labelledby="github-heading"
        className="px-4 pt-24 pb-28 sm:pt-32"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h2
              id="github-heading"
              className="text-[clamp(3rem,8vw,6rem)] leading-[0.9] uppercase"
            >
              Built in the open.
            </h2>
            <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
              Read the code, file an issue, send a pull request. A star helps
              the next person find it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink
              href={REPO_URL}
              external
              solid
              className="h-12 px-7 text-[15px]"
            >
              <StarIcon className="size-4" aria-hidden="true" />
              Star on GitHub
            </ButtonLink>
            <ButtonLink
              href={`${REPO_URL}/issues`}
              external
              className="h-12 px-6 text-[15px]"
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
