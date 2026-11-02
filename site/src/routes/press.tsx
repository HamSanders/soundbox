/**
 * `/press` — the press kit.
 *
 * One link to hand a YouTuber, a journalist or a newsletter writer: what
 * Soundbox is in words they can quote, the facts they would otherwise have to
 * dig out of the README, and every video, screenshot and mark with a direct
 * download. It argues for nothing; the other pages do that.
 *
 * Every number here is sourced, because a number in someone else's article is
 * one we cannot correct:
 *
 *   - model counts: `server/src/models/audiocpp_models_catalog.json`
 *     (`models` is the verified, on-by-default list; `catalog_extra` the
 *     opt-in rest);
 *   - the MCP tool count: `@/content/mcp/tools.ts`, the list `/mcp` renders;
 *   - timings: `docs/new-models-2026-10.md`, measured on an RTX 5080 with
 *     audio.cpp 0.9.2;
 *   - colours and type: `app/src/index.css` (the `.dark` palette is the one the
 *     films are cut on).
 *
 * The videos are the "-x" copies of the launch renders (under 10 MB each, so
 * they fit an X upload and a GitHub Pages deploy), in `site/public/media/`.
 * Posters, the mark and the GIFs are in `site/public/press/`.
 *
 * Site-only, so no `AppTopNav` — the site's own `SiteHeader` wraps it.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeoHead } from "@/components/seo-head";
import { C, CopyButton, Note } from "@/components/docs-primitives";
import { assetUrl } from "@/lib/asset-url";
import { REPO_URL } from "@/lib/marketing-links";
import { MCP_TOOLS } from "@/content/mcp/tools";

/**
 * The address press enquiries go to. Not chosen yet: while it is still the
 * placeholder, the contact section points at GitHub instead of printing a
 * `mailto:` to nowhere. Set it here and nowhere else.
 */
const CONTACT_EMAIL = "{CONTACT_EMAIL}";
const HAS_CONTACT_EMAIL = !CONTACT_EMAIL.startsWith("{");

/* Counted from audiocpp_models_catalog.json: 4 under `models`, 61 under
   `catalog_extra`. Not imported, because the file is 119 KB and would ship in
   this page's bundle to print two integers. ONE_PARAGRAPH spells the 4 out as
   "Four", since it opens a sentence; change both together. */
const VERIFIED_MODELS = 4;
const OPT_IN_MODELS = 61;

const RELEASES_URL = `${REPO_URL}/releases/latest`;

/* ------------------------------------------------------------------ words */

const ONE_LINE =
  "Soundbox is a free, open-source app that generates sound effects, music and speech on your own computer from open-weight AI models, with no account and nothing uploaded.";

const ONE_PARAGRAPH = `Soundbox is a free, MIT-licensed app for Windows and macOS that generates sound effects, music, songs with lyrics and speech on your own computer. It runs open-weight models through audio.cpp, a C++ runtime, so there is no Python to install. Nothing is uploaded and there is no account. Four models are verified end to end and on by default; another ${OPT_IN_MODELS}, most of them text-to-speech, can be switched on, and each shows its licence before it downloads. On an RTX 5080 a five-second sound effect takes 1.3 seconds once the model is loaded. Clips can be arranged on a multi-track timeline, and a built-in MCP server lets coding agents such as Claude Code and Cursor make sounds and save them into a project.`;

const FACTS: { term: string; detail: ReactNode }[] = [
  { term: "Price", detail: "Free, with no subscription, credits or account." },
  {
    term: "Licence",
    detail: (
      <>
        Soundbox itself is MIT. Each model's weights carry their own licence, shown before
        download, and that licence decides what you may do with the output.
      </>
    ),
  },
  {
    term: "Runs on",
    detail:
      "Your own computer. NVIDIA GPUs use CUDA and Apple silicon uses Metal, though none of the verified models has been confirmed on a Mac yet. Without a supported GPU it runs on the CPU, where a clip takes minutes rather than seconds. It works offline once the weights are downloaded.",
  },
  {
    term: "Runtime",
    detail: (
      <>
        Every model runs through <a href="https://github.com/0xShug0/audio.cpp" target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-4">audio.cpp</a>,
        a native C++ runtime, so neither Python nor the CUDA toolkit is needed.
      </>
    ),
  },
  {
    term: "Models",
    detail: `${VERIFIED_MODELS} verified end to end and on by default: Stable Audio 3.0 SFX, Stable Audio 3.0 Small Music, ACE-Step 1.5 Turbo and MiniMax Music 3. Another ${OPT_IN_MODELS} can be switched on, 45 of them text-to-speech.`,
  },
  {
    term: "Makes",
    detail:
      "Sound effects and ambience, instrumentals, songs from a lyric sheet, speech, cloned voices, voice conversion and stem separation.",
  },
  {
    term: "Install",
    detail:
      "Installers for Windows 10 and 11 (x64) and macOS (Apple silicon and Intel). Docker for a headless server, and Linux from source.",
  },
  {
    term: "For agents",
    detail: `An MCP server with ${MCP_TOOLS.length} tools for Claude Code, Cursor and any other MCP client, plus a local HTTP API.`,
  },
  {
    term: "Data",
    detail: "Audio is saved as WAV files under ~/.soundbox, and the library is one SQLite file beside them. Nothing is sent anywhere.",
  },
];

/* Measured, not quoted: docs/new-models-2026-10.md, RTX 5080 16 GB, CUDA,
   audio.cpp 0.9.2. "Warm" is with the model already in VRAM. */
const TIMINGS: { what: string; model: string; time: string }[] = [
  { what: "5 s sound effect", model: "Stable Audio 3.0 SFX", time: "1.3 s warm, 11.8 s cold" },
  { what: "10 s instrumental", model: "Stable Audio 3.0 Small Music", time: "8.0 s" },
  { what: "15 s song with lyrics", model: "ACE-Step 1.5 Turbo", time: "15 s warm, 151 s first load" },
  { what: "15 s orchestral piece", model: "MiniMax Music 3", time: "42 s" },
];

/* ----------------------------------------------------------------- videos */

interface Video {
  title: string;
  src: string;
  poster: string;
  /** Seconds, from ffprobe. */
  seconds: number;
  bytes: number;
  vertical?: boolean;
  goodFor: string;
}

const VIDEOS: Video[] = [
  {
    title: "The 30-second tour",
    src: "/media/soundbox-vibe.mp4",
    poster: "/press/poster-vibe.jpg",
    seconds: 29.6,
    bytes: 4_131_653,
    goodFor: "What Soundbox makes and who it is for, cut to a song that was generated in it.",
  },
  {
    title: "Under the hood",
    src: "/media/soundbox-tech.mp4",
    poster: "/press/poster-tech.jpg",
    seconds: 43.0,
    bytes: 8_293_156,
    goodFor: "audio.cpp in place of a Python setup, swapping models, and measured render times. Suits a technical audience.",
  },
  {
    title: "Agents and MCP",
    src: "/media/soundbox-agents.mp4",
    poster: "/press/poster-agents.jpg",
    seconds: 20.8,
    bytes: 5_124_673,
    goodFor: "An agent asks for a door slam over MCP and gets back the path to a WAV. Suits coverage of AI coding tools.",
  },
  {
    title: "Bring your games to life",
    src: "/media/soundbox-games.mp4",
    poster: "/press/poster-games.jpg",
    seconds: 33.1,
    bytes: 9_168_595,
    goodFor: "Claude Code makes six sounds and wires them into a small Godot game.",
  },
  {
    title: "Bring your 3D models to life",
    src: "/media/soundbox-3d-models.mp4",
    poster: "/press/poster-3d-models.jpg",
    seconds: 28.6,
    bytes: 8_675_009,
    goodFor: "A silent Blender creature wakes up, chatters and roars.",
  },
  {
    title: "Bring your playlist to life",
    src: "/media/soundbox-playlist.mp4",
    poster: "/press/poster-playlist.jpg",
    seconds: 32.2,
    bytes: 6_318_268,
    goodFor: "Six tracks from three models fill an empty playlist. Two of them are songs with lyrics.",
  },
  {
    title: "Bring your haunted house to life",
    src: "/media/soundbox-haunted-house.mp4",
    poster: "/press/poster-haunted-house.jpg",
    seconds: 30.5,
    bytes: 8_994_534,
    goodFor: "A silent haunted house gets seven sound effects and a music bed, for Halloween.",
  },
  {
    title: "Bring your games to life (vertical)",
    src: "/media/soundbox-games-vertical.mp4",
    poster: "/press/poster-games-vertical.jpg",
    seconds: 33.1,
    bytes: 9_076_270,
    vertical: true,
    goodFor: "The same film, cut for Shorts, Reels and TikTok.",
  },
  {
    title: "Bring your playlist to life (vertical)",
    src: "/media/soundbox-playlist-vertical.mp4",
    poster: "/press/poster-playlist-vertical.jpg",
    seconds: 32.2,
    bytes: 6_456_301,
    vertical: true,
    goodFor: "The same film, cut for Shorts, Reels and TikTok.",
  },
];

/* ------------------------------------------------------------------ stills */

interface Still {
  src: string;
  alt: string;
  caption: string;
  /** Pixel size, printed beside the download. */
  size: string;
}

const SCREENSHOTS: Still[] = [
  {
    src: "/product/studio.png",
    alt: "The Soundbox studio: a script cast across three speakers above a multi-track timeline holding spoken lines, a music bed and sound effects",
    caption: "The studio, with a script cast across three voices above the timeline.",
    size: "1600 × 1000",
  },
  {
    src: "/product/sfx.png",
    alt: "The SFX library with waveforms, models and seeds, and the prompt composer",
    caption: "The sound effects library. Each take keeps its prompt, model and seed.",
    size: "1600 × 1000",
  },
  {
    src: "/product/music-studio.png",
    alt: "The Music page: a request form with model, licence, styles, tempo, key and length beside a shelf of generated takes",
    caption: "The music page takes a style prompt or a lyric sheet.",
    size: "1600 × 1000",
  },
  {
    src: "/product/models.png",
    alt: "The Models page: each model with its licence badge, size and install state",
    caption: "The models page shows each licence and VRAM figure before download.",
    size: "1600 × 1000",
  },
  {
    src: "/product/agents.png",
    alt: "The Agents page: connected MCP clients, copy-paste connection commands, and a log of recent calls",
    caption: "The agents page lists each MCP client that has connected and what it called.",
    size: "1600 × 1000",
  },
  {
    src: "/product/library.png",
    alt: "The Soundbox library: generated sounds with waveforms, prompts, models and seeds",
    caption: "Sound effects, music and speech in one library.",
    size: "1600 × 1000",
  },
  {
    src: "/product/voice-lab.png",
    alt: "The Voice Lab: saved voices as cards, cloned from a clip or built into a model",
    caption: "Saved and cloned voices in the Voice Lab.",
    size: "1600 × 470",
  },
];

const GIFS: Still[] = [
  {
    src: "/product/same-prompt-three-models.gif",
    alt: "The same prompt and seed rendered by Stable Audio 3.0 Small Music, MiniMax Music 3 and ACE-Step 1.5 Turbo, with measured render times on an RTX 5080",
    caption: "The same prompt on three music models, with render times.",
    size: "640 × 360",
  },
  {
    src: "/press/tech-timings.gif",
    alt: "Render times for Soundbox's verified models, measured on an RTX 5080",
    caption: "Render times measured on an RTX 5080.",
    size: "640 × 360",
  },
  {
    src: "/press/tech-swap-models.gif",
    alt: "Switching the model behind a prompt in Soundbox",
    caption: "Swapping the model behind a prompt.",
    size: "640 × 360",
  },
  {
    src: "/press/tech-no-python.gif",
    alt: "The usual Python setup for one model struck out, replaced by one native audio.cpp binary",
    caption: "One native binary in place of a Python setup.",
    size: "640 × 360",
  },
];

const MARKS: { label: string; svg: string; png: string; tile: string }[] = [
  {
    label: "Teal tile",
    svg: "/press/soundbox-mark.svg",
    png: "/press/soundbox-mark.png",
    tile: "bg-[#0a0c0d]",
  },
  {
    label: "Dark tile",
    svg: "/press/soundbox-mark-dark.svg",
    png: "/press/soundbox-mark-dark.png",
    tile: "bg-[#e6ecec]",
  },
];

const COLOURS: { name: string; hex: string; use: string; light?: boolean }[] = [
  { name: "Teal", hex: "#2DD4BF", use: "The mark, waveforms and links." },
  { name: "Ground", hex: "#0A0C0D", use: "The background of the app and every film." },
  { name: "Ink", hex: "#E6ECEC", use: "Text on the ground.", light: true },
  { name: "Muted", hex: "#8E999D", use: "Labels and secondary text." },
  { name: "Deep teal", hex: "#0D6B64", use: "Teal on a light background." },
];

const LINKS: { label: string; href: string; internal?: boolean }[] = [
  { label: "Source code on GitHub", href: REPO_URL },
  { label: "Download the latest release", href: RELEASES_URL },
  { label: "Documentation", href: "/docs", internal: true },
  { label: "Sound effect samples", href: "/sfx", internal: true },
  { label: "Music samples", href: "/music", internal: true },
  { label: "Models and licences", href: "/models", internal: true },
  { label: "The MCP server", href: "/mcp", internal: true },
];

/* ------------------------------------------------------------------ parts */

function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  return `0:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function fileName(src: string): string {
  return src.slice(src.lastIndexOf("/") + 1);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-16 scroll-mt-20 border-t pt-12">
      <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Quotable({ label, text }: { label: string; text: string }) {
  return (
    <figure className="border-border/70 bg-card/40 rounded-xl border p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          {label}
        </figcaption>
        <CopyButton value={text} label={`Copy the ${label.toLowerCase()}`}>
          Copy
        </CopyButton>
      </div>
      <blockquote className="mt-3 leading-relaxed text-pretty">{text}</blockquote>
    </figure>
  );
}

function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={assetUrl(href)}
      download={fileName(href)}
      className="text-primary focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3"
    >
      <DownloadIcon className="size-3.5" aria-hidden="true" />
      {children}
    </a>
  );
}

function VideoCard({ video }: { video: Video }) {
  return (
    <li className="border-border/60 flex min-w-0 flex-col overflow-hidden rounded-xl border">
      {/* Click to play, never autoplay: every one of these is about what it
          sounds like, and a muted loop shows the wrong half. `preload="none"`
          keeps the page at the weight of its posters. */}
      <video
        controls
        preload="none"
        playsInline
        poster={assetUrl(video.poster)}
        className={
          video.vertical
            ? "aspect-[9/16] w-full bg-black object-contain"
            : "aspect-video w-full bg-black object-contain"
        }
        aria-label={video.title}
      >
        <source src={assetUrl(video.src)} type="video/mp4" />
      </video>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-heading text-sm font-semibold tracking-tight">{video.title}</h3>
        <p className="text-muted-foreground mt-1 font-mono text-xs">
          {formatLength(video.seconds)} · {video.vertical ? "9:16" : "16:9"} ·{" "}
          {video.vertical ? "1080 × 1920" : "1920 × 1080"} · {formatSize(video.bytes)}
        </p>
        <p className="text-muted-foreground mt-2 flex-1 text-sm leading-relaxed">
          {video.goodFor}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <DownloadLink href={video.src}>MP4</DownloadLink>
          <DownloadLink href={video.poster}>Poster</DownloadLink>
        </div>
      </div>
    </li>
  );
}

function StillCard({ still }: { still: Still }) {
  return (
    <li className="border-border/60 min-w-0 overflow-hidden rounded-xl border">
      <a href={assetUrl(still.src)} target="_blank" rel="noreferrer noopener" className="block">
        <img
          src={assetUrl(still.src)}
          alt={still.alt}
          loading="lazy"
          className="bg-muted/40 aspect-video w-full object-cover object-top"
        />
      </a>
      <div className="p-3">
        <p className="text-sm leading-relaxed">{still.caption}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground font-mono text-xs">{still.size}</span>
          <DownloadLink href={still.src}>{fileName(still.src).endsWith(".gif") ? "GIF" : "PNG"}</DownloadLink>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------- page */

export function PressPage() {
  const landscape = VIDEOS.filter((v) => !v.vertical);
  const vertical = VIDEOS.filter((v) => v.vertical);
  return (
    <div className="bg-background text-foreground min-h-svh overflow-x-clip">
      <SeoHead
        title="Press kit | Soundbox"
        description="Descriptions to quote, a fact sheet and downloadable films, screenshots and logos for anyone covering Soundbox, the free app that generates sound effects, music and speech on your own computer."
        path="/press"
        imageAlt="Soundbox press kit"
      />

      <div className="mx-auto w-full max-w-4xl px-4">
        {/* ------------------------------------------------------------ hero */}
        <header className="py-12">
          <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
            Press kit
          </p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Soundbox, for anyone writing or filming about it
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
            Everything on this page is free to use in coverage of Soundbox, and a credit is
            appreciated. The numbers come from the README, the model catalog and runs measured on
            one machine, and each file below downloads directly.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <a href="#videos">Videos</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="#contact">Contact</a>
            </Button>
          </div>
        </header>

        {/* ----------------------------------------------------------- words */}
        <section id="describe" className="scroll-mt-20 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">In a sentence</h2>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Quote either of these as written. Soundbox is one word, with a capital S.
          </p>
          <div className="mt-6 space-y-4">
            <Quotable label="One sentence" text={ONE_LINE} />
            <Quotable label="One paragraph" text={ONE_PARAGRAPH} />
          </div>
        </section>

        {/* ----------------------------------------------------------- facts */}
        <Section id="facts" title="Fact sheet">
          <dl className="mt-6 divide-y rounded-xl border">
            {FACTS.map((fact) => (
              <div key={fact.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="text-sm font-semibold">{fact.term}</dt>
                <dd className="text-muted-foreground text-sm leading-relaxed">{fact.detail}</dd>
              </div>
            ))}
          </dl>

          <h3 className="font-heading mt-10 text-lg font-semibold tracking-tight">
            How long a generation takes
          </h3>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
            Measured on an RTX 5080 (16 GB) with audio.cpp 0.9.2. Warm means the model was already
            loaded. A smaller GPU is slower, and on the CPU alone the same clip takes minutes.
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Request</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {TIMINGS.map((row) => (
                  <tr key={row.what}>
                    <td className="px-4 py-2">{row.what}</td>
                    <td className="text-muted-foreground px-4 py-2">{row.model}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------------------------------------------------- videos */}
        <Section id="videos" title="Videos">
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Use them whole or cut down in coverage of Soundbox, and a credit is appreciated. Each
            is an H.264 MP4 under 10 MB, which X accepts as it is. In the "Bring your ___ to life"
            films, every sound was generated in Soundbox from the prompt shown on screen.
          </p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2">
            {landscape.map((video) => (
              <VideoCard key={video.src} video={video} />
            ))}
          </ul>

          <h3 className="font-heading mt-10 text-lg font-semibold tracking-tight">Vertical</h3>
          <ul className="mt-4 grid max-w-xl grid-cols-2 gap-5">
            {vertical.map((video) => (
              <VideoCard key={video.src} video={video} />
            ))}
          </ul>

          <div className="mt-8">
            <Note>
              The tour, under-the-hood and agents films end on the project's previous address,{" "}
              <C>github.com/Gadurp1/soundbox</C>, which redirects to{" "}
              <C>github.com/HamSanders/soundbox</C>. The under-the-hood film was cut at v0.2.0, so
              its version label is older than the current release.
            </Note>
          </div>
        </Section>

        {/* ---------------------------------------------------------- stills */}
        <Section id="screenshots" title="Screenshots and GIFs">
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Taken from the running app in its dark theme. Click one for the full-size file.
          </p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SCREENSHOTS.map((still) => (
              <StillCard key={still.src} still={still} />
            ))}
          </ul>
          <h3 className="font-heading mt-10 text-lg font-semibold tracking-tight">GIFs</h3>
          <ul className="mt-4 grid gap-5 sm:grid-cols-2">
            {GIFS.map((still) => (
              <StillCard key={still.src} still={still} />
            ))}
          </ul>
        </Section>

        {/* ----------------------------------------------------------- brand */}
        <Section id="brand" title="Mark, colours and type">
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            The mark is a waveform on a rounded tile. Use whichever tile suits your background,
            and please don't recolour or redraw it.
          </p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2">
            {MARKS.map((mark) => (
              <li key={mark.svg} className="border-border/60 overflow-hidden rounded-xl border">
                <div className={`flex items-center justify-center py-8 ${mark.tile}`}>
                  <img
                    src={assetUrl(mark.svg)}
                    alt={`The Soundbox mark, ${mark.label.toLowerCase()}`}
                    width={96}
                    height={96}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
                  <span className="text-sm">{mark.label}</span>
                  <DownloadLink href={mark.svg}>SVG</DownloadLink>
                  <DownloadLink href={mark.png}>PNG, 1024 px</DownloadLink>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="font-heading mt-10 text-lg font-semibold tracking-tight">Colours</h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COLOURS.map((colour) => (
              <li key={colour.hex} className="flex items-center gap-3">
                <span
                  className="border-border size-10 shrink-0 rounded-lg border"
                  style={{ background: colour.hex }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {colour.name} <span className="text-muted-foreground font-mono text-xs">{colour.hex}</span>
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{colour.use}</p>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="font-heading mt-10 text-lg font-semibold tracking-tight">Type</h3>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
            <span className="text-foreground font-medium">Inter</span> for headings and the
            interface (the films set titles in its 800 and 900 weights), and{" "}
            <span className="text-foreground font-mono">JetBrains Mono</span> for prompts, labels
            and code. Both are free under the SIL Open Font License.
          </p>
        </Section>

        {/* ----------------------------------------------------------- links */}
        <Section id="links" title="Links">
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                {link.internal ? (
                  <Link
                    to={link.href}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </Link>
                ) : (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
                  >
                    {link.label}
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>

        {/* --------------------------------------------------------- contact */}
        <Section id="contact" title="Contact">
          <div className="pb-20">
            <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
              {HAS_CONTACT_EMAIL ? (
                <>
                  For interviews, review questions or a file in another format, email{" "}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="text-primary underline underline-offset-4"
                  >
                    {CONTACT_EMAIL}
                  </a>
                  .
                </>
              ) : (
                <>
                  For interviews, review questions or a file in another format,{" "}
                  <a
                    href={`${REPO_URL}/issues`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline underline-offset-4"
                  >
                    open an issue on GitHub
                  </a>
                  .
                </>
              )}
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
