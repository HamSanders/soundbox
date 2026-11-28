/**
 * Welcome — the public site's front door, prerendered at `/`.
 *
 * This used to be an app route living beside the shell. It is now part of
 * `site/` only (see `site/src/routes.tsx`), and the app has no marketing
 * routes at all. That move is what removed the live pieces: there is no
 * backend behind this page and no `QueryClientProvider` above it, so nothing
 * here may call a query hook. The hero plays pre-rendered files instead of
 * offering a prompt box with nothing behind it — see `Hero`.
 *
 * Two rules shaped everything else.
 *
 * 1. **Nothing here can fail.** Every sound is a pre-rendered file and every
 *    section is static. The one network call, the GitHub star count, is left
 *    out when it fails rather than shown as a dash.
 *
 * 2. **Show, then hand off.** The page says what Mirli makes and lets you hear
 *    it. The detail (models and their licences, the MCP tools, the studio,
 *    the generation pipeline) lives on /models, /mcp, /studio and the docs,
 *    each linked from the section that touches it. Caveats are stated once,
 *    where they are decided: licences on /models, signing at Download, the
 *    rest in the FAQ.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudioLinesIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  CloudIcon,
  ExternalLinkIcon,
  StarIcon,
  TerminalIcon,
} from "lucide-react";

import { SeoHead, faqJsonLd, softwareAppJsonLd } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { ProductShots } from "@/components/product-shots";
import { DownloadButton, PlatformPicker } from "@/components/download-cta";
import { COMPARISON, COMPARISON_HEAD } from "@/content/comparison";
import { COMMERCIAL, FREE, GPU, MAC, MODELS_FAQ, OFFLINE, RENAMED } from "@/content/faq";
import { HeroClips } from "@/components/hero-clips";
import { type ExampleId } from "@/content/examples";
import { cloudWaitlistHref, MODELS_HUB_HREF, REPO_URL, repoFile } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/asset-url";

/* ------------------------------------------------------------------- data */

/**
 * What the hero lets you hear: three sound effects, two pieces of music (one
 * sung) and a voice, so six cards cover everything the app makes. Each is a
 * real render from `content/examples.ts`. The order is the order of the slots
 * in `components/hero-clips.tsx`: the second and fifth are the large cards.
 */
const HERO_SAMPLES: ExampleId[] = [
  "chip-impact",
  "song-own-machine",
  "chip-ambience",
  "inst-lofi",
  "voice-intro",
  "door-heavy-vault",
];

/* ------------------------------------------------------------ primitives */

function Section({
  id,
  className,
  children,
  labelledBy,
}: {
  id?: string;
  className?: string;
  labelledBy: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("border-border/60 border-t px-4 py-16 sm:py-20", className)}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

function SectionHead({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="label-caps text-primary">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="font-heading mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
      >
        {title}
      </h2>
      {children && (
        <p className="text-muted-foreground mt-3 leading-relaxed">{children}</p>
      )}
    </div>
  );
}

/**
 * Fenced snippet.
 *
 * `min-w-0` and `overflow-x-auto` are both load-bearing at 375px, and they are
 * not the same fix. The scroller stops the <pre> from being drawn wider than
 * its box; `min-w-0` stops the box — a grid item, whose automatic minimum size
 * is otherwise min-content — from *demanding* the width of the longest curl
 * line and dragging the whole column past the viewport with it.
 */
function Code({ children, label }: { children: string; label: string }) {
  return (
    <div className="bg-muted/50 ring-border min-w-0 overflow-hidden rounded-xl ring-1 ring-inset">
      <div className="text-muted-foreground border-border/60 flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium">
        <TerminalIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-relaxed">
        <code className="font-mono">{children}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

/** GitHub's public repo endpoint, from the same `REPO_URL` every link uses. */
const REPO_API = REPO_URL.replace("https://github.com/", "https://api.github.com/repos/");

/** The star count for the secondary button. Fetched after load and left out
 *  if the request fails or is rate limited: the button never shows a dash. */
function useStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(REPO_API, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stargazers_count?: number } | null) => {
        if (typeof d?.stargazers_count === "number") setStars(d.stargazers_count);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return stars;
}

/**
 * The running app, large and centred under the buttons: the Music page with
 * its Create panel, the takes it made and the player. A capture of the 0.6 app
 * in mock mode (the same set as `ProductShots`), not a drawing.
 *
 * Hidden on phones, where a desktop window is too small to read; the Studio
 * section further down shows the same screens with tabs. The source sits
 * behind a min-width media query, so a phone fetches only the 1px placeholder.
 */
function HeroShot() {
  return (
    <figure className="relative mx-auto hidden w-full max-w-5xl sm:block">
      <div
        aria-hidden="true"
        className="bg-primary/10 pointer-events-none absolute inset-x-[8%] top-[10%] bottom-[-4%] blur-3xl"
      />
      <picture className="relative block">
        <source media="(min-width: 640px)" srcSet={assetUrl("/product/app-music.webp")} />
        <img
          src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
          alt="The Mirli app on its Music page: a Create panel with an ACE-Step model picker, an instrumental switch and a styles prompt, beside a list of seven generated tracks with licence badges, and a player at the bottom."
          width={1440}
          height={900}
          loading="lazy"
          decoding="async"
          className="ring-border/70 aspect-[16/10] w-full rounded-xl object-cover object-top shadow-2xl ring-1"
        />
      </picture>
    </figure>
  );
}

/**
 * Say what it is, then let it be heard.
 *
 * The audio sites that do this well (Stable Audio, Suno, ElevenLabs) put real
 * output with a play button in the first screen. Here the output is the
 * first screen: one headline, one sentence and two buttons in the middle,
 * and six renders around them as cards, each playable without installing
 * anything (`HeroClips`). The layout is the one on claude.com/programs/startups,
 * with sounds where that page has films: cards at three sizes scattered
 * either side of the copy, the corner ones cut off by the section's edge.
 *
 * The screenshot of the running app used to sit between the buttons and the
 * sounds. It now follows the hero as its own band, so it is the second thing
 * on the page instead of the thing the sounds had to wait behind.
 */
function Hero() {
  const stars = useStars();

  return (
    <>
      <section
        aria-labelledby="hero-heading"
        className="border-border/60 relative overflow-hidden border-b"
      >
        {/* Decorative only: a soft wash behind the headline, drawn from the
            accent token. Hidden from assistive tech. */}
        <div
          aria-hidden="true"
          className="bg-primary/12 pointer-events-none absolute -top-48 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-3xl"
        />

        {/* Capped at 1440px so the cards, which are sized as a share of this
            box, stop growing on a very wide window and stay clear of the copy. */}
        <div className="relative mx-auto w-full max-w-[90rem] xl:h-[780px]">
          <div className="relative z-10 mx-auto max-w-[41rem] px-4 pt-16 pb-10 text-center xl:px-0 xl:pt-44 xl:pb-0">
            <p className="label-caps text-muted-foreground inline-flex items-center gap-2">
              <span aria-hidden="true" className="bg-signal size-1.5 rounded-full" />
              Press play on any card
            </p>

            <h1
              id="hero-heading"
              className="font-heading mt-4 text-5xl leading-[0.98] font-semibold tracking-tight text-balance xl:text-7xl"
            >
              A free, open-source alternative to ElevenLabs and Suno
            </h1>

            <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
              Sound effects, music and voices.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start">
              <DownloadButton pickerHref="#install" />
              <Button size="lg" variant="outline" asChild>
                <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                  <StarIcon aria-hidden="true" />
                  Star on GitHub
                  {stars !== null ? (
                    <span className="text-muted-foreground tabular-nums">
                      {stars.toLocaleString("en")}
                    </span>
                  ) : null}
                </a>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              No graphics card?{" "}
              <a
                href={cloudWaitlistHref("home-hero")}
                className="text-foreground underline underline-offset-4"
              >
                Join the Mirli Cloud waitlist
              </a>
            </p>
          </div>

          <HeroClips ids={HERO_SAMPLES} />
        </div>
      </section>

      <div className="px-4 py-12 sm:py-16">
        <HeroShot />
        {/* Measured, not quoted: the same figure /press cites, from
            docs/new-models-2026-10.md (RTX 5080, CUDA, model already loaded). */}
        <p className="text-muted-foreground mx-auto max-w-5xl text-center text-xs leading-relaxed sm:mt-6">
          Every clip above was made on one desktop GPU. A five-second sound effect takes 1.3 s on
          an RTX 5080 once the model is loaded.{" "}
          <Link to="/sfx" className="text-foreground underline underline-offset-4">
            Hear hundreds more
          </Link>
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ what it makes */

/**
 * The three things the app makes, one sentence each, each handing off to the
 * page that covers it in full. The hero already plays one of each, so these
 * cards carry no players of their own; the headings are the plain phrases
 * people search for.
 */
const MAKES: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: "Sound effects",
    body: "Describe the material, the action and the space, and get a WAV with its prompt and seed kept beside it.",
    href: "/sfx",
    cta: "Browse sound effects",
  },
  {
    title: "Music, with or without lyrics",
    body: "A style prompt makes an instrumental. Add a lyric sheet and a model that sings does the rest.",
    href: "/music",
    cta: "Listen to the tracks",
  },
  {
    title: "Text to speech and voice cloning",
    body: "Read a script aloud, or clone a voice from a short clip and cast it across the lines of a script.",
    href: "/voices",
    cta: "How voices work",
  },
];

function WhatItMakes() {
  return (
    <Section id="what" labelledBy="what-heading">
      <SectionHead id="what-heading" eyebrow="What it makes" title="AI sound effects, music and voices" />
      <ul className="border-border mt-8 grid border-t border-l md:grid-cols-3">
        {MAKES.map((m) => (
          <li key={m.title} className="border-border flex flex-col gap-3 border-r border-b p-5">
            <h3 className="text-base font-semibold tracking-tight">{m.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{m.body}</p>
            <Link
              to={m.href}
              className="text-muted-foreground hover:text-foreground mt-auto pt-2 text-sm underline underline-offset-4"
            >
              {m.cta}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ studio */

/** The running app, captured rather than drawn. Everything else about the
 *  studio lives on /studio. */
function Studio() {
  return (
    <Section id="screens" labelledBy="screens-heading">
      <SectionHead id="screens-heading" eyebrow="Studio" title="Arrange it all on one timeline">
        Lay sound effects, music and spoken lines on a multi-track timeline, add
        effects and mix down to one file.
      </SectionHead>
      <div className="mt-8">
        <ProductShots />
      </div>
      <div className="mt-6">
        <Button variant="outline" asChild>
          <Link to="/studio">See the studio</Link>
        </Button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ agents */

const MCP_ADD = "claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp";

/**
 * One section for the agent story, where there used to be three (a card, the
 * Agents-page mock with OpenTelemetry and skills, and the API/curl block).
 * The detail is on /mcp and in the API reference.
 */
function ForAgents() {
  return (
    <Section id="agents" labelledBy="agents-heading" className="bg-muted/20">
      <SectionHead id="agents-heading" eyebrow="For agents" title="Let your coding agent make the sounds">
        Mirli runs an MCP server, so Claude Code, Cursor or any MCP client can
        generate audio and put the files straight into your project. Start the
        app, then run:
      </SectionHead>
      <div className="mt-6 max-w-3xl">
        <Code label="Claude Code">{MCP_ADD}</Code>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to="/mcp">Connect an agent</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/docs/reference">API and MCP reference</Link>
        </Button>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- compare */

/** Rows the home page leaves out: "Account" is in the hero and "Agents" has
 *  its own section. The landing pages keep the full table. */
const HOME_SKIP_ROWS = new Set(["Account", "Agents"]);

function Compare() {
  return (
    <Section id="compare" labelledBy="compare-heading">
      <SectionHead id="compare-heading" eyebrow="Compare" title="Mirli or a hosted service">
        Open models trade consistency for ownership.
      </SectionHead>
      <div className="border-border mt-8 overflow-x-auto rounded-md border">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="p-3" />
              <th scope="col" className="label-caps text-muted-foreground p-3 font-normal">
                {COMPARISON_HEAD[0]}
              </th>
              <th scope="col" className="label-caps p-3 font-normal">
                {COMPARISON_HEAD[1]}
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.filter(([row]) => !HOME_SKIP_ROWS.has(row)).map(([row, hosted, ours]) => (
              <tr key={row} className="border-border border-b last:border-b-0">
                <th scope="row" className="text-muted-foreground p-3 font-normal">
                  {row}
                </th>
                <td className="text-muted-foreground p-3">{hosted}</td>
                <td className="p-3">{ours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-3 max-w-2xl text-xs leading-relaxed">
        Hosted services differ and change their terms, so this compares them in
        general. If you want one tuned voice with no setup, a hosted service is
        the better fit.
      </p>
    </Section>
  );
}

/* --------------------------------------------------------------- questions */

const HOME_FAQ = [FREE, GPU, OFFLINE, COMMERCIAL, MAC, MODELS_FAQ, RENAMED];

function Questions() {
  return (
    <Section id="questions" labelledBy="questions-heading">
      <SectionHead id="questions-heading" eyebrow="FAQ" title="Questions" />
      <dl className="mt-8 grid max-w-5xl gap-x-12 gap-y-7 md:grid-cols-2">
        {HOME_FAQ.map((f) => (
          <div key={f.question}>
            <dt className="font-semibold tracking-tight">{f.question}</dt>
            <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.answer}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground mt-8 text-sm">
        More in the{" "}
        <Link to="/docs" className="text-foreground underline underline-offset-4">
          docs
        </Link>{" "}
        and on the{" "}
        <Link to={MODELS_HUB_HREF} className="text-foreground underline underline-offset-4">
          models page
        </Link>
        .
      </p>
    </Section>
  );
}

/* ---------------------------------------------------------------- download */

const AGENT_INSTALL = `Install Mirli on this machine and confirm it works, following
${repoFile("docs/INSTALL-AGENT.md")}`;

function Download() {
  return (
    <Section id="install" className="scroll-mt-16" labelledBy="install-heading">
      <SectionHead id="install-heading" eyebrow="Download" title="Download Mirli">
        One installer for Windows or macOS. Models download inside the app the
        first time you pick one. The builds are not signed yet, so the first
        launch asks you to confirm.
      </SectionHead>

      <PlatformPicker className="mt-8" />

      <div className="mt-8 max-w-3xl">
        <Code label="Or let your agent install it">{AGENT_INSTALL}</Code>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            <BookOpenIcon aria-hidden="true" />
            Read the README
          </a>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/docs/install">Install guide</Link>
        </Button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- cloud */

/**
 * For the visitor the rest of the page leaves out: no GPU, or not one big
 * enough. Mirli Cloud is the hosted version and is not open yet, so this hands
 * off to its waitlist. It sits after Download because the free app comes first.
 */
function Cloud() {
  return (
    <Section id="cloud" labelledBy="cloud-heading" className="bg-muted/20">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <SectionHead id="cloud-heading" eyebrow="Mirli Cloud · Coming soon" title="No graphics card? Use Mirli Cloud">
          The models, run for you. Make sound effects, music and voices
          from your browser or the Mirli app and pay only for what you make.
          Join the waitlist and we'll email you once, when it opens.
        </SectionHead>
        <Button size="lg" asChild className="shrink-0 self-start md:self-auto">
          <a href={cloudWaitlistHref("home")}>
            <CloudIcon aria-hidden="true" />
            Join the waitlist
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        </Button>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- footer */

function Footer() {
  return (
    <footer className="border-border/60 border-t px-4 py-12">
      <div className="mx-auto grid w-full max-w-5xl gap-8 sm:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
              <AudioLinesIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="font-heading font-semibold tracking-tight">Mirli</span>
          </div>
          <p className="text-muted-foreground mt-4 max-w-md text-sm leading-relaxed">
            <strong className="text-foreground font-medium">
              Mirli is MIT licensed. The model weights are not.
            </strong>{" "}
            Each model carries its own licence and several forbid commercial
            use. Mirli downloads weights from Hugging Face at your direction
            and does not redistribute them. What you may do with a generated
            sound is governed by the licence of the model that produced it.
          </p>
        </div>

        <nav aria-label="Footer">
          <h2 className="text-sm font-semibold tracking-tight">Elsewhere</h2>
          <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
            <li>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                GitHub
                <ExternalLinkIcon className="size-3" aria-hidden="true" />
              </a>
            </li>
            <li>
              <a
                href={cloudWaitlistHref("home-footer")}
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Mirli Cloud waitlist
              </a>
            </li>
            <li>
              <Link
                to={MODELS_HUB_HREF}
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Models &amp; licences
              </Link>
            </li>
            <li>
              <Link
                to="/docs/reference"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                API &amp; MCP
              </Link>
            </li>
            <li>
              <Link
                to="/press"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Press kit
              </Link>
            </li>
            <li>
              <Link
                to="/docs/install"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Install
              </Link>
            </li>
          </ul>
          <h2 className="mt-6 text-sm font-semibold tracking-tight">Guides</h2>
          <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
            <li>
              <Link
                to="/alternatives/elevenlabs"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                ElevenLabs alternative
              </Link>
            </li>
            <li>
              <Link
                to="/alternatives/suno"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Suno alternative
              </Link>
            </li>
            <li>
              <Link
                to="/make/sound-effects"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Sound effects generator
              </Link>
            </li>
            <li>
              <Link
                to="/make/game-audio"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Game audio
              </Link>
            </li>
            <li>
              <Link
                to="/make/voiceovers"
                className="hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Text to speech and cloning
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ page */

export function WelcomePage() {
  return (
    <div className="text-foreground overflow-x-clip">
      {/* A new name says nothing on its own, so the title carries what it
          is as well as what it is called. */}
      <SeoHead
        title="Mirli: free local ElevenLabs and Suno alternative for AI sound effects, music and voices"
        description="Free, open-source alternative to ElevenLabs and Suno that runs on your own GPU: AI sound effects, music with lyrics, text-to-speech and voice cloning. No account, no credits, works offline, with an MCP server for Claude Code and Cursor."
        path="/"
        jsonLd={[
          softwareAppJsonLd(),
          faqJsonLd(HOME_FAQ.map((f) => ({ question: f.question, answer: f.answer }))),
        ]}
      />
      <a
        href="#main"
        className="bg-card ring-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>
      <main id="main">
        <Hero />

        <WhatItMakes />
        <Studio />
        <ForAgents />
        <Compare />
        <Questions />
        <Download />
        <Cloud />
      </main>
      <Footer />
    </div>
  );
}
