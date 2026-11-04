/**
 * `/download` — the installers, the launch film and the repo's numbers, on the site.
 *
 * The installer filenames carry the version (`Konchi_0.4.1_x64-setup.exe`),
 * so a link to one file would go stale on every release. The page therefore
 * renders with links to `releases/latest` (which GitHub redirects to the newest
 * release) and, once mounted, asks the GitHub API for that release and for the
 * repository, then swaps in the direct asset links, version and sizes and fills
 * in the star, fork and download counts. If either request fails or is rate
 * limited, the fallback links still work and the readouts stay dark.
 *
 * It is dressed in the console's hardware kit (`components/console`): panels
 * with screws, LEDs, seven-segment readouts, a VU meter. The app's own
 * instrument is the most recognisable thing Konchi has, so the page that
 * hands it over looks like it. The visitor's OS is guessed after mount, so the
 * prerendered HTML is the same for everyone.
 */

import { ArrowDownIcon, ExternalLinkIcon, StarIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Led, Meter, Panel, Seg } from "@/components/console/hardware";
import "@/components/console/console.css";
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
  channel: string;
  label: string;
  short: string;
  detail: string;
  match: (name: string) => boolean;
}

const PLATFORMS: Platform[] = [
  {
    id: "windows",
    channel: "OUT 1",
    label: "Windows",
    short: "Windows",
    detail: "10 / 11 · x64 · .exe",
    match: (n) => /x64-setup\.exe$/i.test(n),
  },
  {
    id: "mac-arm",
    channel: "OUT 2",
    label: "Mac · Apple silicon",
    short: "Mac",
    detail: "M1 and later · .dmg",
    match: (n) => /aarch64\.dmg$/i.test(n),
  },
  {
    id: "mac-intel",
    channel: "OUT 3",
    label: "Mac · Intel",
    short: "Intel Mac",
    detail: "x64 · .dmg",
    match: (n) => /x64\.dmg$/i.test(n),
  },
];

/** The ticker: prompts in the material / action / space shape that works. */
const PROMPTS = [
  "heavy wooden door slamming in a stone corridor",
  "rain on a tin roof, distant thunder",
  "lo-fi hip hop, dusty vinyl, 82 bpm",
  "boots on wet gravel at night",
  "old freight lift motor starting under load",
  "synthwave chorus, female vocal, big drums",
  "glass bottle shattering on tile",
  "a narrator, warm and close: “it began with a sound”",
];

/** Bar heights for the hero waveform: fixed, so the prerender matches. */
const BARS = Array.from({ length: 120 }, (_, i) => {
  const env = Math.sin((i / 119) * Math.PI);
  const wobble = Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.43) * 0.4);
  return 0.08 + env * (0.25 + wobble * 0.67);
});

const KEYFRAMES = `
@keyframes dl-eq { 0%,100% { transform: scaleY(.45) } 50% { transform: scaleY(1) } }
@keyframes dl-ticker { to { transform: translateX(-50%) } }
`;

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** Readout text: the number, or dashes until it arrives. */
function readout(n: number | undefined, digits: number): string {
  return n === undefined ? "-".repeat(digits) : String(n);
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

/** A needle that drifts like it is riding a signal. Parked for reduced motion. */
function useSignal(): number {
  const [level, setLevel] = useState(0.55);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setLevel(0.45 + Math.random() * 0.4), 220);
    return () => window.clearInterval(id);
  }, []);
  return level;
}

function Waveform() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex h-40 items-center gap-[3px] [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)] sm:h-56"
    >
      {BARS.map((h, i) => (
        <span
          key={i}
          className="bg-primary min-w-0 flex-1 rounded-full opacity-80 motion-safe:animate-[dl-eq_1.4s_ease-in-out_infinite]"
          style={{
            height: `${h * 100}%`,
            animationDelay: `${(i % 17) * -0.09}s`,
            boxShadow: "0 0 12px var(--cx-lamp-glow)",
          }}
        />
      ))}
    </div>
  );
}

function Ticker() {
  const row = [...PROMPTS, ...PROMPTS];
  return (
    <div
      aria-hidden="true"
      className="border-y border-[var(--cx-line)] bg-[var(--cx-seg-bg)] py-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
    >
      <div className="flex w-max motion-safe:animate-[dl-ticker_60s_linear_infinite]">
        {row.map((p, i) => (
          <span
            key={i}
            className="flex items-center gap-3 px-6 font-mono text-sm whitespace-nowrap text-[var(--cx-lamp)] [text-shadow:0_0_8px_var(--cx-lamp-glow)]"
          >
            <span className="text-[var(--cx-engrave-dim)]">▸</span>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DownloadPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [mine, setMine] = useState<PlatformId | null>(null);
  const signal = useSignal();

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

  return (
    <div className="console bg-background text-foreground min-h-svh overflow-x-clip">
      <SeoHead
        title="Download Konchi for Windows and macOS | Konchi"
        description="Download the Konchi desktop app for Windows 10/11 or macOS. Free, open source, no account. Models download from inside the app."
        path="/download"
      />
      <style>{KEYFRAMES}</style>

      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="download-heading" className="relative pt-14 sm:pt-20">
        <div
          aria-hidden="true"
          className="bg-primary/20 pointer-events-none absolute top-40 left-1/2 h-72 w-[70rem] -translate-x-1/2 rounded-full blur-[120px]"
        />
        <div className="relative mx-auto w-full max-w-6xl px-4">
          <a
            href={release?.html_url ?? LATEST_URL}
            className="inline-flex items-center gap-3 rounded-md border border-[var(--cx-line)] bg-[var(--cx-seg-bg)] px-3 py-1.5 transition-colors hover:border-[var(--cx-lamp)]"
          >
            <Led on blink color="red" label="New" />
            <span className="cx-label">{release ? release.tag_name : "latest"}</span>
            <span className="cx-label text-[var(--cx-lamp)]!">Release notes →</span>
          </a>

          <h1
            id="download-heading"
            className="font-heading text-foreground mt-6 text-[clamp(3.6rem,13vw,11rem)] leading-[0.85] font-black tracking-[-0.055em]"
          >
            Make
            <br />
            <span className="text-primary [text-shadow:0_0_40px_var(--cx-lamp-glow)]">noise.</span>
          </h1>

          <div className="mt-8 grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <p className="text-muted-foreground max-w-md text-lg leading-relaxed text-pretty">
              Sound effects, music and voices from open models, made on your own GPU. No account,
              no credits, no cloud.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <a
                href={primaryAsset?.browser_download_url ?? "#installers"}
                className="cx-transport flex items-center gap-4 px-6 py-4 font-semibold"
              >
                <ArrowDownIcon className="size-6" aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="text-lg">
                    {primary ? `Download for ${primary.short}` : "Choose your download"}
                  </span>
                  <span className="font-mono text-xs font-normal opacity-75">
                    {primaryAsset
                      ? `${release?.tag_name} · ${megabytes(primaryAsset.size)} MB`
                      : "Windows · macOS"}
                  </span>
                </span>
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="cx-push w-auto! items-center! gap-3! px-4!"
              >
                <StarIcon className="size-4 text-amber-400" aria-hidden="true" />
                <span className="cx-label">Star</span>
                <Seg value={readout(repo?.stargazers_count, 3)} digits={3} />
              </a>
            </div>
          </div>
        </div>

        <div className="relative mt-10">
          <Waveform />
        </div>
      </section>

      <Ticker />

      {/* --------------------------------------------------- monitor + meters */}
      <section aria-label="Launch film and project numbers" className="px-4 pt-16">
        <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_17rem]">
          <Panel
            title="Monitor · soundbox-vibe.mp4"
            aside={<Led on blink color="red" label="Rec" />}
            bodyClassName="pb-5"
          >
            <SiteVideo
              src="/media/soundbox-vibe.mp4"
              poster="/media/posters/vibe.jpg"
              label="Konchi in thirty seconds: type a prompt, hear sound effects, music and voices, switch models"
            />
          </Panel>

          <Panel title="Counters" aside={<Led on={Boolean(repo)} color="green" label="Live" />}>
            <div className="flex flex-col items-center gap-5 pt-1">
              <Meter value={signal} label="Signal" />
              <dl className="grid w-full gap-4">
                {[
                  { label: "GitHub stars", value: repo?.stargazers_count },
                  { label: release ? `Downloads ${release.tag_name}` : "Downloads", value: downloads },
                  { label: "Forks", value: repo?.forks_count },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-1.5">
                    <dt className="cx-label">{label}</dt>
                    <dd>
                      <Seg
                        value={readout(value, 5)}
                        digits={5}
                        className="w-full text-4xl"
                        dim={value === undefined}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Panel>
        </div>
      </section>

      {/* ------------------------------------------------------- installers */}
      <section id="installers" aria-labelledby="installers-heading" className="scroll-mt-20 px-4 pt-20">
        <div className="mx-auto w-full max-w-6xl">
          <h2
            id="installers-heading"
            className="font-heading text-foreground text-4xl font-black tracking-[-0.04em] sm:text-6xl"
          >
            Pick your <span className="text-primary">output.</span>
          </h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {PLATFORMS.map((platform) => {
              const asset = assetFor(platform);
              const isMine = platform.id === mine;
              return (
                <li key={platform.id}>
                  <Panel
                    title={platform.channel}
                    aside={<Led on={isMine} label={isMine ? "Your system" : "Ready"} />}
                    className={cn(isMine && "ring-primary/70 shadow-primary/20 shadow-2xl ring-2")}
                  >
                    <p className="font-heading text-2xl font-bold tracking-tight text-[var(--cx-nameplate)]">
                      {platform.label}
                    </p>
                    <p className="cx-label mt-1 text-[var(--cx-engrave-dim)]!">{platform.detail}</p>
                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div className="flex flex-col gap-1.5">
                        <span className="cx-label">Size · MB</span>
                        <Seg
                          value={asset ? String(megabytes(asset.size)) : "--"}
                          digits={3}
                          size="lg"
                          dim={!asset}
                        />
                      </div>
                      <a
                        href={asset?.browser_download_url ?? LATEST_URL}
                        className={cn(
                          "flex items-center gap-2 px-5 py-3 text-sm font-semibold",
                          isMine ? "cx-transport" : "cx-push w-auto!",
                        )}
                      >
                        <ArrowDownIcon className="size-4" aria-hidden="true" />
                        Download
                      </a>
                    </div>
                    <p className="mt-4 truncate font-mono text-[11px] text-[var(--cx-engrave-dim)]">
                      {asset?.name ?? "fetching the latest build…"}
                    </p>
                  </Panel>
                </li>
              );
            })}
          </ul>
          <p className="text-muted-foreground mt-6 text-sm">
            Linux: no installer yet, so{" "}
            <a className="text-foreground underline underline-offset-4" href={`${REPO_URL}#run-from-source`}>
              run it from source
            </a>
            . Older builds are on the{" "}
            <a className="text-foreground underline underline-offset-4" href={`${REPO_URL}/releases`}>
              releases page
            </a>
            .
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------------- github */}
      <section aria-labelledby="github-heading" className="px-4 py-24">
        <Panel className="mx-auto w-full max-w-6xl" bodyClassName="px-6 py-12 sm:px-12">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <p className="cx-title">Open source</p>
              <h2
                id="github-heading"
                className="font-heading mt-3 text-4xl font-black tracking-[-0.04em] text-[var(--cx-nameplate)] sm:text-6xl"
              >
                Patch in.
              </h2>
              <p className="text-muted-foreground mt-3 max-w-md leading-relaxed">
                Read the code, file an issue, send a pull request. A star helps the next person
                find it.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="cx-transport flex items-center justify-between gap-6 px-5 py-3 font-semibold"
              >
                <span className="flex items-center gap-2">
                  <StarIcon className="size-4" aria-hidden="true" />
                  Star on GitHub
                </span>
                <span className="font-mono tabular-nums">
                  {readout(repo?.stargazers_count, 2)}
                </span>
              </a>
              <a
                href={`${REPO_URL}/issues`}
                target="_blank"
                rel="noreferrer noopener"
                className="cx-push justify-between! px-5!"
              >
                <span className="cx-label">Issues</span>
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
