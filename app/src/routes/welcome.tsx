/**
 * Welcome — the public site's front door, prerendered at `/`.
 *
 * This used to be an app route living beside the shell. It is now part of
 * `site/` only (see `site/src/routes.tsx`), and the app has no marketing
 * routes at all. That move is what removed the live pieces: there is no
 * backend behind this page and no `QueryClientProvider` above it, so nothing
 * here may call a query hook, and the hero prompt no longer hands anything to
 * the composer — see `HeroPrompt`.
 *
 * Two rules shaped everything else, and both survive the move.
 *
 * 1. **Nothing here can fail.** The model section is a static table
 *    transcribed from the README. It was already the source of truth when a
 *    live `/api/models` response could overlay it; now there is no overlay at
 *    all. No loading state, no empty state, nothing to go wrong.
 *
 * 2. **It must not oversell.** The README's model table has a Status column
 *    that admits which models have been verified on real hardware and which
 *    are opt-in until someone confirms them.
 *    That column is reproduced here rather than quietly dropped, because a
 *    landing page that contradicts the README is worse than no landing page.
 *    Where the reference design puts pricing tiers and testimonials, this puts
 *    licensing and an honest install story — the true version of the same
 *    "should I trust this?" question.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ActivityIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FolderIcon,
  RadarIcon,
  ScaleIcon,
  SparklesIcon,
  TerminalIcon,
  WifiOffIcon,
} from "lucide-react";

import { SeoHead, softwareAppJsonLd } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TimelineBanner } from "@/components/timeline-banner";
import { RevealPromptToSample } from "@/components/reveal-prompt-to-sample";
import { RevealPillars } from "@/components/reveal-pillars";
import { ProductShots } from "@/components/product-shots";
import { LicenseChip } from "@/components/license-badge";
import type { LicenseInfo } from "@/lib/api";
import { GENERATOR_HREF, MODELS_HUB_HREF, REPO_URL, repoFile } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";


/* ------------------------------------------------------------------- data */

/**
 * Prompt starters, in the material / action / space shape the README's
 * "Writing prompts that work" section argues for. These do double duty: they
 * fill the box, and they are the only teaching material anyone reads.
 */
const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: "Impact",
    prompt: "heavy wooden crate dropping onto a concrete floor, close mic, dry room",
  },
  {
    label: "Footsteps",
    prompt: "boots on wet gravel, slow steady pace, outdoors at night",
  },
  {
    label: "Machinery",
    prompt: "old freight lift motor starting under load, metal cable strain, echoing shaft",
  },
  {
    label: "Ambience",
    prompt: "rain on a tin roof, distant thunder, steady wind through trees",
  },
  {
    label: "UI",
    prompt: "small plastic button click, tight and dry, no reverb",
  },
  {
    label: "Whoosh",
    prompt: "heavy steel blade swinging fast past the microphone, turbulent air",
  },
];

interface ModelCard {
  id: string;
  name: string;
  vendor: string;
  /** Quality / rate, straight from the README table. */
  spec: string;
  maxDuration: string;
  download: string;
  license: LicenseInfo;
  /** The README's Status column, unedited in meaning. */
  status: string;
  verified: boolean;
  gated?: boolean;
}

const STABILITY_LICENSE: LicenseInfo = {
  name: "Stability AI Community License",
  commercial: "conditional",
  url: "https://stability.ai/license",
};

/**
 * Transcribed from the README's model table. This is the source of truth for
 * this page — a live `/api/models` response is only ever an overlay on top of
 * it, never a replacement, so the section is identical with the server down.
 *
 * Every model here runs through audio.cpp (docs/AUDIOCPP.md) — a native
 * binary, not a per-model Python stack.
 */
const MODELS: ModelCard[] = [
  {
    id: "audiocpp-stable-audio-3-sfx",
    name: "Stable Audio 3.0 SFX",
    vendor: "Stability AI",
    spec: "audio.cpp (GGUF)",
    maxDuration: "—",
    download: "—",
    license: STABILITY_LICENSE,
    status: "Verified",
    verified: true,
  },
  {
    id: "audiocpp-stable-audio-3-small-music",
    name: "Stable Audio 3.0 Small Music",
    vendor: "Stability AI",
    spec: "audio.cpp (GGUF)",
    maxDuration: "—",
    download: "—",
    license: STABILITY_LICENSE,
    status: "Verified",
    verified: true,
  },
  {
    id: "audiocpp-ace-step",
    name: "ACE-Step 1.5 Turbo",
    vendor: "ACE-Step",
    spec: "audio.cpp (GGUF)",
    maxDuration: "—",
    download: "—",
    // The catalog long said "Apache-2.0 (unverified)"; the /models rebuild
    // checked the upstream LICENSE file in ace-step/ACE-Step-1.5 and it is
    // MIT — see content/models/models.ts, which this card follows.
    license: {
      name: "MIT License",
      commercial: "yes",
      url: "https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE",
    },
    status: "Verified",
    verified: true,
  },
  {
    id: "audiocpp-minimax-music3",
    name: "MiniMax Music 3",
    vendor: "MiniMax",
    spec: "audio.cpp (GGUF)",
    maxDuration: "—",
    download: "—",
    license: {
      name: "MiniMax-Music3 Community License",
      commercial: "conditional",
      url: "https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE",
    },
    status: "Verified. Needs about 10 GB of VRAM",
    verified: true,
  },
];

const MCP_CONFIG = `{
  "mcpServers": {
    "soundbox": { "type": "http", "url": "http://127.0.0.1:17494/mcp" }
  }
}`;

const CURL = `curl -X POST http://127.0.0.1:17494/api/generate \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"audiocpp-stable-audio-3-sfx","prompt":"heavy wooden door slamming in a stone corridor","duration_s":3}'`;

const INSTALL = `git clone ${REPO_URL}
cd soundbox
npm install
npm run dev`;

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
      <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
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

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card ring-border/70 rounded-2xl p-5 ring-1">
      <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
        <Icon className="size-4.5" aria-hidden="true" />
      </div>
      <h3 className="mt-3.5 text-sm font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

function HeroPrompt({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // This used to hand the typed prompt to the composer through the session
  // store and navigate to `/app`. That only ever worked because this page was
  // built into the app; on the public site there is no composer to open and no
  // store to write to, so the submit goes where someone who wants to run this
  // prompt actually has to go — the install guide.
  const go = () => {
    if (!value.trim()) return;
    window.open(GENERATOR_HREF, "_blank", "noreferrer,noopener");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="mx-auto mt-8 w-full max-w-2xl"
    >
      {/* Deliberately the same shell as the real composer — card, soft ring,
          ring lights up on focus-within — so arriving at Generate feels like
          the same box got bigger rather than like a different app. */}
      <div className="bg-card ring-foreground/10 focus-within:ring-ring/40 rounded-2xl p-2 text-left shadow-lg ring-1 transition-shadow">
        <label htmlFor="hero-prompt" className="sr-only">
          Describe a sound
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id="hero-prompt"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                go();
              }
            }}
            rows={2}
            placeholder="heavy wooden door slam, dry room, close mic"
            aria-describedby="hero-prompt-hint"
            className="max-h-40 min-h-[3.25rem] resize-none overflow-y-auto border-transparent bg-transparent px-2.5 py-2 text-base leading-relaxed shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!value.trim()}
            aria-label="Download Soundbox to run this prompt"
            className="mb-1 shrink-0 rounded-full shadow-sm transition-transform hover:scale-105 active:scale-95"
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
      <p id="hero-prompt-hint" className="text-muted-foreground mt-2 text-xs">
        Soundbox runs on your own machine, so this opens the download page.
        Prompts work best when they name the material, the action and the
        space.
      </p>
    </form>
  );
}

function Hero() {
  const [prompt, setPrompt] = useState("");

  const applyExample = (example: string) => {
    setPrompt(example);
    document.getElementById("hero-prompt")?.focus();
  };

  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden px-4">
      {/* Decorative only: a soft teal wash behind the headline, drawn from the
          accent token. No imagery, no asset, nothing to load — and hidden from
          assistive tech. */}
      <div
        aria-hidden="true"
        className="bg-primary/12 pointer-events-none absolute -top-48 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-3xl py-16 text-center sm:py-24">
        <span className="text-muted-foreground ring-border bg-card inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1">
          <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
          Open source · MIT · runs on your own GPU
        </span>

        <h1
          id="hero-heading"
          className="font-heading mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
        >
          The local alternative to ElevenLabs and Suno
        </h1>

        <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
          Describe a sound and get a WAV. Write lyrics and get a song. Clone a
          voice from a short clip. Arrange it all on a timeline, or let your
          coding agent do it over MCP. Open-weight models, no account, works
          offline.
        </p>

        {/* The product, under the pitch rather than above it. The banner led
            the page for a while; with the badge and headline stacked beneath
            it the top of the hero read as three things shouting at once, and
            the headline is the one that has to win. The banner still sits
            above the fold — it just answers the headline now instead of
            preempting it. Decorative and silent — see components/timeline-banner. */}
        <TimelineBanner className="mt-10 text-left" />

        <HeroPrompt value={prompt} onChange={setPrompt} />

        <div
          className="mt-6 flex flex-wrap justify-center gap-2"
          role="group"
          aria-label="Example prompts"
        >
          {EXAMPLES.map((ex) => (
            <Button
              key={ex.label}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              title={ex.prompt}
              onClick={() => applyExample(ex.prompt)}
            >
              {ex.label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md text-xs leading-relaxed">
          Each example names a material, an action and a space.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {/* A real link rather than an onClick navigate: this page is
              prerendered, and a crawler following the site needs an href. */}
          <Button size="lg" asChild>
            <Link to={MODELS_HUB_HREF}>Browse the models</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href={GENERATOR_HREF} target="_blank" rel="noreferrer noopener">
              Download
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- models */

function ModelRow({ model }: { model: ModelCard }) {
  return (
    <li className="bg-card ring-border/70 rounded-2xl p-5 ring-1">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold tracking-tight">
            {model.name}
          </h3>
          <p className="text-muted-foreground text-xs">{model.vendor}</p>
        </div>
      </div>

      <dl className="text-muted-foreground mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="min-w-0">
          <dt>Output</dt>
          <dd className="text-foreground mt-0.5 font-medium break-words">
            {model.spec}
          </dd>
        </div>
        <div className="min-w-0">
          <dt>Max clip</dt>
          <dd className="text-foreground mt-0.5 font-medium tabular-nums">
            {model.maxDuration}
          </dd>
        </div>
        <div className="min-w-0">
          <dt>Download</dt>
          <dd className="text-foreground mt-0.5 font-medium tabular-nums">
            {model.download}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <LicenseChip license={model.license} />
        <span className="text-muted-foreground text-xs">{model.license.name}</span>
        {model.gated && (
          <span className="text-muted-foreground text-xs">Gated on Hugging Face</span>
        )}
      </div>

      <p
        className={cn(
          "mt-3 flex items-start gap-1.5 text-xs leading-relaxed",
          model.verified
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground",
        )}
      >
        {model.verified ? (
          <CheckIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <CircleDashedIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{model.status}</span>
      </p>
    </li>
  );
}

function Models() {
  // No live `/api/models` overlay any more. This page is part of the public
  // static site, which has no backend to ask and — see `site/src/main.tsx` —
  // no QueryClientProvider to ask through, so calling `useModels()` here would
  // throw at render rather than degrade. The static table below was always the
  // source of truth; the live response only ever added an install-status pill,
  // which is meaningless to a visitor who has not installed anything yet.
  return (
    <Section labelledBy="models-heading" id="models">
      <SectionHead
        id="models-heading"
        eyebrow="Models"
        title="One runtime for every model, with the licence shown first"
      >
        Every model runs through{" "}
        <a
          href="https://github.com/0xShug0/audio.cpp"
          target="_blank"
          rel="noreferrer noopener"
          className="text-foreground underline underline-offset-4"
        >
          audio.cpp
        </a>

        , a native runtime, so there is no Python to set up. audio.cpp
        implements a fixed set of model architectures, and a model must be one
        of them, quantised to GGUF, to run. You can point it at your own weights
        for an architecture it already supports (see{" "}
        <a
          href={`${repoFile("docs/AUDIOCPP.md")}#bring-your-own-model`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-foreground underline underline-offset-4"
        >
          bring your own model
        </a>
        ). A new architecture needs a new loader in audio.cpp. Each model shows
        what you may do with its output before you download it, and
        non-commercial models ask you to confirm the restriction.
      </SectionHead>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODELS.map((e) => (
          <ModelRow key={e.id} model={e} />
        ))}
      </ul>

      <div className="border-border/60 mt-6 rounded-2xl border border-dashed p-5">
        <h3 className="text-sm font-semibold tracking-tight">
          What &ldquo;verified&rdquo; means
        </h3>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          The four models above have been run end to end on real hardware and
          are on by default. Start with Stable Audio 3.0 SFX to check your
          setup. 42 more models (text-to-speech, music, stem separation and
          voice conversion) are in the catalog and can be switched on from the
          Models page. Of those, VibeVoice 1.5B has also been run end to end;
          the rest are marked unverified until someone reports a result.
          Reports either way help.
        </p>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          The licence chips are a summary and are not legal advice. Read each
          licence before you ship what a model made.
        </p>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- local */

function Local() {
  return (
    <Section labelledBy="local-heading">
      <SectionHead
        id="local-heading"
        eyebrow="Local and offline"
        title="Nothing is uploaded"
      >
        Soundbox is a server on your loopback interface and a folder on your
        disk. Weights download from Hugging Face when you ask for them. After
        that it works offline.
      </SectionHead>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Feature icon={WifiOffIcon} title="No account or credits">
            There is no sign-up and no usage meter. Audio models download
            without an account.
          </Feature>
          <Feature icon={FolderIcon} title="Your library is files on disk">
            One SQLite file and one folder of WAVs under <code>~/.soundbox</code>.
            Back it up, sync it or delete it like any other folder.
          </Feature>
          <Feature icon={ScaleIcon} title="Licences before downloads">
            Every model card states its terms and colour-codes commercial use.
            Non-commercial weights need an explicit confirmation that names the
            restriction.
          </Feature>
          <Feature icon={AudioLinesIcon} title="Prompt, seed and settings kept">
            Everything you generate is saved with what produced it, so you can
            search it, tag it, favourite it and regenerate from it.
          </Feature>
        </div>

        <div className="bg-muted/50 ring-border min-w-0 rounded-2xl p-5 ring-1 ring-inset">
          <h3 className="text-sm font-semibold tracking-tight">Where things live</h3>
          <pre className="text-muted-foreground mt-3 overflow-x-auto text-xs leading-relaxed">
            <code className="font-mono">{`~/.soundbox/
├── soundbox.db      SQLite: prompts, seeds, tags
├── sounds/          the WAVs, one per generation
└── models/          weights you chose to download`}</code>
          </pre>
          <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
            The backend binds <code className="font-mono">127.0.0.1:17494</code>.
            The UI talks to that and to nothing else.
          </p>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- prompting */

function Prompting() {
  return (
    <Section labelledBy="prompting-heading">
      <SectionHead
        id="prompting-heading"
        eyebrow="Writing prompts that work"
        title="Name the material, the action and the space"
      >
        These models were trained on captions of recordings, so they respond to
        descriptions of what is making the sound and where. Mood words produce
        noise.
      </SectionHead>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="ring-border/70 bg-card rounded-2xl p-5 ring-1">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            Too vague
          </p>
          <p className="mt-3 font-mono text-sm">scary sound</p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            It names no material and no action, so the model returns noise.
          </p>
        </div>
        <div className="ring-primary/30 bg-card rounded-2xl p-5 ring-1">
          <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
            Usable
          </p>
          <p className="mt-3 font-mono text-sm">
            low metallic groan of a ship&rsquo;s hull under pressure, distant,
            reverberant
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Material (metal hull), action (groaning under pressure), space
            (distant, reverberant).
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-relaxed">
        Keep clips short and layer them in your editor. A three-second clip is
        easier to place than a twenty-second one.
      </p>
    </Section>
  );
}

/* ---------------------------------------------------------------- studio */

/**
 * The studio, in one screen instead of four.
 *
 * This is a signpost, not a demonstration. The reveals it replaces are worth
 * the scrolling they cost, but only to someone who has already decided the
 * generator is interesting — so the argument moved to /studio and what stays
 * here is the shortest honest description of it plus a link. Deliberately a
 * `<Link>`: this page is prerendered, and /studio only gets crawled if there
 * is an href pointing at it.
 */
/* ---------------------------------------------------------------- agents */

/**
 * The companion-app pitch. Soundbox is built to be driven by AI agents, not
 * just clicked through — this section leads with that rather than burying it
 * under "Developers", and shows the part a screenshot actually sells: the
 * in-app Agents page, which is where "an agent can call this" turns into
 * "you can see it happen."
 */
function Agents() {
  return (
    <Section labelledBy="agents-heading" className="bg-muted/20">
      <SectionHead
        id="agents-heading"
        eyebrow="Built for agents"
        title="An MCP server, and a log of every call"
      >
        Connect Claude Code, Cursor or any MCP client and it can generate,
        speak, arrange and export audio as part of a larger task. The Agents
        page in the app logs every call: which client made it, what it asked
        for, and whether it worked.
      </SectionHead>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="ring-border/70 bg-card min-w-0 overflow-hidden rounded-2xl ring-1">
          <div className="text-muted-foreground border-border/60 flex items-center gap-2 border-b px-4 py-2.5 text-xs font-medium">
            <RadarIcon className="size-3.5 shrink-0" aria-hidden="true" />
            Agents
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                ["Calls (24h)", "37"],
                ["Sounds via MCP", "12"],
                ["Active agents", "1"],
                ["Errors", "0"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border px-2.5 py-2">
                  <p className="text-muted-foreground text-[0.65rem]">{label}</p>
                  <p className="font-heading mt-0.5 text-lg font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <BotIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium">
                  claude-code
                  <span className="text-muted-foreground ml-1 font-mono text-xs">2.1.0</span>
                </span>
                <span className="text-muted-foreground ml-auto text-xs">active</span>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                14 calls · 9 sounds · 1 session
              </p>
            </div>
            <ul className="divide-border/60 divide-y text-xs">
              {[
                ["generate", "gravel footstep, outdoor, close mic"],
                ["list_models", ""],
                ["generate", "wooden crate dropped on concrete floor"],
              ].map(([tool, prompt], i) => (
                <li key={i} className="flex items-center gap-2 py-2">
                  <CheckIcon className="size-3 shrink-0 text-emerald-500" aria-hidden="true" />
                  <span className="text-muted-foreground shrink-0 font-mono">{tool}</span>
                  <span className="min-w-0 flex-1 truncate">{prompt}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid min-w-0 gap-4">
          <Feature icon={BotIcon} title="Every agent, identified">
            Each call is attributed to the client that made it, by name and
            version, from the MCP handshake. There are no headers to add.
          </Feature>
          <Feature icon={ActivityIcon} title="Optional OpenTelemetry">
            Set <code className="font-mono text-xs">otel_endpoint</code> to
            your own collector and each tool call is exported as a trace and a
            metric over standard OTLP/HTTP.
          </Feature>
          <Feature icon={SparklesIcon} title="Bundled agent skills">
            Three skills ship with Soundbox: prompting for sound effects, a
            sound pass that finds and generates every sound a project needs,
            and writing and voicing dialogue. Install them from the Agents page
            or with{" "}
            <code className="font-mono text-xs">soundbox skills install</code>.
          </Feature>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ developers */

function Developers() {
  return (
    <Section labelledBy="dev-heading">
      <SectionHead
        id="dev-heading"
        eyebrow="API &amp; MCP"
        title="An HTTP API and an MCP endpoint on port 17494"
      >
        The server behind the UI also serves an HTTP API and an MCP endpoint,
        so an agent can build a level and make its door sound in the same task.
        Results include the WAV&rsquo;s absolute path, which you can pass to
        ffmpeg or copy into a project.
      </SectionHead>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Code label="MCP client config">{MCP_CONFIG}</Code>
        <Code label="HTTP API">{CURL}</Code>
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground flex items-start gap-2 text-sm leading-relaxed">
          <BotIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            24 tools, including{" "}
            <code className="font-mono text-xs">generate</code>,{" "}
            <code className="font-mono text-xs">speak</code>,{" "}
            <code className="font-mono text-xs">separate</code>,{" "}
            <code className="font-mono text-xs">list_sounds</code> and{" "}
            <code className="font-mono text-xs">export_story</code>.
          </span>
        </p>
        <div className="flex shrink-0 gap-2 self-start sm:self-auto">
          <Button variant="outline" asChild>
            <Link to="/docs/reference">Open API &amp; MCP docs</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/mcp">See the MCP page</Link>
          </Button>
        </div>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- started */

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Install the app",
    body: (
      <>
        Download the installer for Windows 10 or 11, or macOS on Apple silicon
        or Intel. It carries its own runtime, so nothing else needs installing.
        The builds are not signed yet, so the first launch asks you to confirm.
      </>
    ),
  },
  {
    title: "Download a model",
    body: (
      <>
        The first run walks you through picking models for your GPU, and each
        model downloads from inside the app the first time you use it. Start
        with Stable Audio 3.0 SFX to check your setup, then pick the model
        whose licence suits what you are making.
      </>
    ),
  },
  {
    title: "Or run from source",
    body: (
      <>
        Requires Node 22.12 or later, with no Python and no CUDA toolkit.{" "}
        <code className="font-mono text-xs">npm run dev</code> starts the server
        on port 17494 and the UI on 5174. Inference runs in{" "}
        <code className="font-mono text-xs">audiocpp_cli</code>, a native binary
        that picks CUDA, HIP, Metal, Vulkan or CPU automatically and is cached
        under <code className="font-mono text-xs">~/.soundbox/bin/</code>.
      </>
    ),
  },
];

function GetStarted() {
  return (
    <Section labelledBy="start-heading">
      <SectionHead
        id="start-heading"
        eyebrow="Getting started"
        title="Install, pick a model, generate"
      >
        A GPU is not required, but CPU generation is slow. A few GB of VRAM
        covers the verified models, and each model card shows its footprint. To
        try the UI with no GPU or server,{" "}
        <code className="font-mono text-xs">npm run dev:mock</code> runs it
        against an in-browser fake.
      </SectionHead>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <ol className="space-y-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span
                className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">{step.title}</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="min-w-0 space-y-4">
          <Code label="Quick start">{INSTALL}</Code>
          <div className="flex flex-wrap gap-2">
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
        </div>
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
            <span className="font-heading font-semibold tracking-tight">Soundbox</span>
          </div>
          <p className="text-muted-foreground mt-4 max-w-md text-sm leading-relaxed">
            <strong className="text-foreground font-medium">
              Soundbox is MIT licensed. The model weights are not.
            </strong>{" "}
            Each model carries its own licence and several forbid commercial
            use. Soundbox downloads weights from Hugging Face at your direction
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
        </nav>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ page */

export function WelcomePage() {
  return (
    <div className="bg-background text-foreground min-h-svh overflow-x-clip">
      {/* "Soundbox" alone is a name several unrelated products share, so the
          title carries what it is as well as what it is called. */}
      <SeoHead
        title="Soundbox: free local ElevenLabs and Suno alternative for AI sound effects, music and voices"
        description="Free, open-source alternative to ElevenLabs and Suno that runs on your own GPU: AI sound effects, music with lyrics, text-to-speech and voice cloning. No account, no credits, works offline, with an MCP server for Claude Code and Cursor."
        path="/"
        jsonLd={[softwareAppJsonLd()]}
      />
      <a
        href="#main"
        className="bg-card ring-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>
      <main id="main">
        <Hero />

        {/* One scroll-reveal, not four. This is the stretch of page where
            someone is deciding whether to keep reading, and a claim they can
            watch happen holds better than one they have to take — but the
            three studio reveals that used to follow this one turned the front
            door into a studio tour before the page had said what a generation
            costs or what licence it carries. They now live on /studio, which
            the flow below hands off to. */}
        <RevealPromptToSample />

        {/* Then the shape of the whole product, as one flow rather than four
            adjacent features: the same box that made that sound effect makes
            music and speech, and all three land in one studio. Each beat links
            to its own page, so this doubles as the route into them.

            It replaces a separate `StudioTeaser` that sat here. Two teasers
            pointing at overlapping places is one more than the page needs, and
            the studio reads better as the destination of the flow than as a
            card beside it. */}
        <RevealPillars />

        {/* And then the unglamorous version of the same thing. Everything above
            this point is a drawing of Soundbox — animated and interactive,
            which is what makes those sections worth their space, but also what
            makes them illustrations. Someone deciding whether to install this
            eventually wants to see the actual application, so here it is,
            captured from the app rather than composed. */}
        <Section id="screens" labelledBy="screens-heading">
          <SectionHead
            id="screens-heading"
            eyebrow="Screenshots"
            title="The running app"
          >
            Captured from the app: the library with its prompts and seeds, the
            Agents page with its call history, and the music studio.
          </SectionHead>
          <div className="mt-8">
            <ProductShots />
          </div>
        </Section>

        <Agents />
        <Models />
        <Local />
        <Prompting />
        <Developers />
        <GetStarted />
      </main>
      <Footer />
    </div>
  );
}
