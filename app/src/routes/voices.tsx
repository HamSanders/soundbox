/**
 * Voices — the marketing page for the speech side of Soundbox, at `/voices`.
 *
 * The site covered sound effects, music and the studio and said nothing about
 * voices, even though most of the catalog is voice models and the app has a
 * whole workflow for them: a one-off read (`speak`), scripts that persist as
 * stories with per-speaker lines on a timeline, and a Voice Lab where a cast
 * is built. This page closes that gap.
 *
 * The same two rules as `studio.tsx` apply:
 *
 * 1. **No query hooks.** Prerendered by vite-react-ssg, no backend, no
 *    `QueryClientProvider` above it — a hook from `@/lib/queries` would throw
 *    at render.
 * 2. **No overselling.** Every claim here traces to a source: the voice
 *    routes in `server/src/routes/voices.ts` (builtin vs clone, WAV upload),
 *    the story routes in `server/src/routes/stories.ts` (per-line generate,
 *    reorder, export, the SSE live view), the page docstrings in
 *    `routes/voice.tsx` / `routes/voice-lab.tsx` / `routes/story.tsx`, the
 *    delivery table in `docs/MCP.md`, and the catalog in
 *    `content/models/models.ts`. The model numbers below are *derived* from
 *    that file rather than written down, for the same reason `MODEL_STATS`
 *    is: a hand-maintained count is a lie waiting to happen.
 *
 * The licence section deliberately does not reproduce the licence table —
 * `/models` owns that, entry by entry with sources, and two copies would
 * drift. This page states the shape of the problem and links there.
 */

import { Link } from "react-router-dom";
import { ExternalLinkIcon, MicIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WindowChrome } from "@/components/window-chrome";
import { ModelParamsDemo } from "@/components/model-params-demo";
import { SeoHead } from "@/components/seo-head";
import { ambientPeaks } from "@/lib/studio-scene";
import { GENERATOR_HREF, MODELS_HUB_HREF } from "@/lib/marketing-links";
import { SamplePlay } from "@/components/sample-play";
import { MODELS } from "@/content/models/models";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------- derived */

/**
 * Counted from the catalog, not asserted. `verified` means someone here ran
 * the model end-to-end through the adapter — see `ModelContent.verified` —
 * and for voice models that is currently almost none of them, which the copy
 * below says out loud instead of hiding.
 */
const VOICE_MODELS = MODELS.filter((m) => m.category === "voice");
const VOICE_STATS = {
  count: VOICE_MODELS.length,
  total: MODELS.length,
  optIn: VOICE_MODELS.filter((m) => m.tier === "extra").length,
  verified: VOICE_MODELS.filter((m) => m.verified).length,
  nonCommercial: VOICE_MODELS.filter((m) => m.license.commercial === "no").length,
  conditional: VOICE_MODELS.filter((m) => m.license.commercial === "conditional").length,
  unknown: VOICE_MODELS.filter((m) => m.license.commercial === "unknown").length,
};

/* ---------------------------------------------------------- primitives */

/** Same shape as the `Section` in `music/hub.tsx` — copied rather than
 *  extracted because two call sites do not justify a shared component, and
 *  the hubs are allowed to diverge in layout if they need to. */
function Section({
  id,
  title,
  lede,
  className,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-section={id} className={cn("scroll-mt-20 pt-14", className)}>
      <h2
        id={id}
        className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl"
      >
        {title}
      </h2>
      {lede && (
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{lede}</p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------- visual */

/**
 * One spoken line as the timeline draws it: a labelled clip with a waveform.
 *
 * The bars come from `ambientPeaks`, which is seeded and quantised — the
 * server-rendered markup and the hydrated client must agree bar for bar, so
 * nothing here may touch Math.random or the clock. Purely decorative; the
 * text beside it carries the information.
 */
function LineClip({
  speaker,
  text,
  seed,
  widthPct,
  offsetPct,
  tone,
}: {
  speaker: string;
  text: string;
  seed: string;
  widthPct: number;
  offsetPct: number;
  tone: string;
}) {
  const peaks = ambientPeaks(seed, 26);
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-[10px] tracking-tight">
        {speaker}
      </span>
      <div className="relative h-11 min-w-0 flex-1">
        <div
          className={cn("absolute inset-y-0 overflow-hidden rounded-md border", tone)}
          style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
        >
          <svg
            viewBox="0 0 104 24"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-x-1 top-1/2 h-6 w-[calc(100%-0.5rem)] -translate-y-1/2 opacity-70"
          >
            {peaks.map((p, i) => {
              const h = 3 + p * 18;
              return (
                <rect
                  key={i}
                  x={i * 4}
                  y={12 - h / 2}
                  width={2.4}
                  height={h}
                  rx={1}
                  className="fill-current"
                />
              );
            })}
          </svg>
          <span className="absolute bottom-0.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate text-[9px] leading-tight opacity-90">
            {text}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The script-to-lanes picture: three lines, two speakers, each line a clip on
 * its speaker's lane. This is the story page's actual arrangement — the
 * script on the left of that page and the timeline on the right are the same
 * lines seen two ways — compressed into one frame.
 */
function StoryFigure() {
  return (
    <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
      <WindowChrome label="Story: Night shift, scene 2" />
      <div className="space-y-2 p-4">
        <LineClip
          speaker="NARRATOR"
          text="The depot is empty by nine."
          seed="voices-narrator-1"
          widthPct={44}
          offsetPct={0}
          tone="border-primary/40 bg-primary/10 text-primary"
        />
        <LineClip
          speaker="MARA"
          text="Not tonight it isn't."
          seed="voices-mara-1"
          widthPct={26}
          offsetPct={40}
          tone="border-chart-2/40 bg-chart-2/10 text-chart-2"
        />
        <LineClip
          speaker="NARRATOR"
          text="She was right about that, too."
          seed="voices-narrator-2"
          widthPct={32}
          offsetPct={62}
          tone="border-primary/40 bg-primary/10 text-primary"
        />
      </div>
      <figcaption className="border-border/60 text-muted-foreground border-t px-4 py-2 text-[11px] leading-relaxed">
        Each line of the script is a clip on its speaker&apos;s lane. Drag one earlier and the
        script reorders to match: the timeline sets the reading order.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <section aria-labelledby="voices-hero-heading" className="relative overflow-hidden px-4">
      {/* Same decorative wash as the studio and landing heroes, same token —
          this is a fourth page of one site, not a microsite. */}
      <div
        aria-hidden="true"
        className="bg-primary/12 pointer-events-none absolute -top-48 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-3xl py-16 text-center sm:py-24">
        <span className="text-muted-foreground ring-border bg-card inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1">
          <MicIcon className="size-3.5" aria-hidden="true" />
          Text to speech · voice cloning · local
        </span>

        <h1
          id="voices-hero-heading"
          className="font-heading mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
        >
          Text to speech, voice cloning and scripts
        </h1>

        <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
          Type a line and get it read as a clip in your library. Clone a voice from a WAV you
          upload or a sound you already made, and use it anywhere a built-in speaker would go.
          Write a script with speakers, pauses and deliveries, and the studio reads it line by
          line onto a timeline you can rearrange. It runs on your own machine, with open-weight
          models you choose and download.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" variant="outline" asChild>
            <a href={GENERATOR_HREF} target="_blank" rel="noreferrer noopener">
              Install guide
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
          <Button size="lg" variant="ghost" asChild>
            <Link to={MODELS_HUB_HREF}>See the voice models</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- close */

function Close() {
  return (
    <section
      aria-labelledby="voices-close-heading"
      className="border-border/60 bg-muted/20 border-t px-4 py-16 sm:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="max-w-2xl">
          <p className="label-caps text-primary">
            Running it
          </p>
          <h2
            id="voices-close-heading"
            className="font-heading mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            Voices ship with the app
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            The Voice Studio, stories and the Voice Lab are part of Soundbox. They use the same
            local server on <code className="font-mono text-xs">127.0.0.1:17494</code> and the
            same library, with no account. Before your first read you need a text-to-speech
            model. Check its licence first: voice licences vary more than any other category in
            the catalog.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild>
            <a href={GENERATOR_HREF} target="_blank" rel="noreferrer noopener">
              Install guide
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link to={MODELS_HUB_HREF}>Browse the models</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/studio">The studio</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export function VoicesPage() {
  return (
    <div className="bg-background text-foreground min-h-svh overflow-x-clip">
      <SeoHead
        title="Text to speech, voice cloning and scripts | Soundbox"
        description={`Text-to-speech, voice cloning and multi-speaker scripts on your own machine. ${VOICE_STATS.count} open-weight voice models, each listed with its licence. Several are non-commercial.`}
        path="/voices"
      />
      <a
        href="#main"
        className="bg-card ring-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>
      <main id="main">
        <Hero />

        <div className="mx-auto w-full max-w-5xl px-4 pb-4">
          {/* The order is the order the workflow grows: one read, then a
              script that keeps its reads, then the cast behind them, then the
              agent surface, then the honest part about models and licences. */}

          <Section
            id="one-line"
            title="One line, one clip"
            lede="The simplest case is a single read."
          >
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              <div className="text-muted-foreground space-y-4 text-sm leading-relaxed">
                <p>
                  Type a line, pick a voice, press Speak. The result is an ordinary sound in your
                  library: you can tag it, search for it and export it as WAV, and it stays there
                  after you leave the page.
                </p>
                <p>
                  Delivery is set separately from the text. Writing{" "}
                  <code className="font-mono text-xs">(whispering)</code> into the text makes the
                  model say the word &ldquo;whispering&rdquo; out loud, so delivery has its own
                  controls. Soundbox reads each model family&apos;s parameter table, and the
                  controls you see are the ones that model accepts. A model with no delivery
                  controls shows none.
                </p>
              </div>
              <div className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
                <WindowChrome label="Voice Studio: Speak" />
                <div className="space-y-3 p-4 text-sm">
                  <p className="border-border/60 bg-background/60 rounded-md border px-3 py-2 leading-relaxed">
                    The depot is empty by nine. Most nights, anyway.
                  </p>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    <span className="border-border/60 rounded-full border px-2.5 py-1">
                      Voice: Narrator
                    </span>
                    <span className="border-border/60 rounded-full border px-2.5 py-1">
                      Pace: unhurried
                    </span>
                    <span className="bg-primary text-primary-foreground ml-auto rounded-full px-3 py-1 font-medium">
                      Speak
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section
            id="hear"
            title="Hear a voice"
            lede="The opening of a post from this site's blog, read by a voice on Chatterbox."
          >
            <div className="border-border max-w-xl rounded-md border p-4">
              <SamplePlay id="narration-intro" />
            </div>
          </Section>

          <Section
            id="stories"
            title="A script that stays"
            lede="A story is an ordered list of lines. Each line has a place in the script and a position on the timeline."
          >
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              <StoryFigure />
              <div className="text-muted-foreground space-y-4 text-sm leading-relaxed">
                <p>
                  Write lines, give each a speaker, and voice them one at a time. Generation is
                  per line, so when one read is wrong (a mispronounced word, a flat take) you
                  regenerate that line and leave the rest of the script alone.
                </p>
                <p>
                  The lines sit on a multi-track timeline. You can move clips, split them,
                  reorder them and mute a lane. When you are done, the story exports as one mixed
                  WAV. Deleting a story keeps its audio in the library unless you choose to remove
                  that as well.
                </p>
                <p>
                  A story can also start from existing audio: hand it a library sound and it opens
                  as a story, optionally split into stems with each stem on its own lane.
                </p>
              </div>
            </div>
          </Section>

          <Section
            id="cast"
            title="Building a cast"
            lede="Voices have a library of their own. Pick a built-in speaker or clone one from a clip."
          >
            <div className="text-muted-foreground grid gap-6 text-sm leading-relaxed sm:grid-cols-2">
              <div className="border-border/60 bg-card/80 rounded-xl border p-5">
                <h3 className="font-heading text-foreground text-sm font-semibold">
                  Built-in voices
                </h3>
                <p className="mt-2">
                  Many model families ship named speakers. Saving one as a voice gives it a name
                  and notes of your own, so you can cast &ldquo;the tired dispatcher&rdquo; in
                  every script and get the same speaker.
                </p>
              </div>
              <div className="border-border/60 bg-card/80 rounded-xl border p-5">
                <h3 className="font-heading text-foreground text-sm font-semibold">
                  Cloned voices
                </h3>
                <p className="mt-2">
                  Models that support cloning take a reference clip (a sound already in your
                  library, or a WAV you upload) and read new text in that voice. In the Voice Lab
                  you audition each voice with a test read before you use it in a script.
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-5 max-w-3xl text-sm leading-relaxed">
              Almost none of these models&apos; licences require a speaker&apos;s permission
              before you clone their voice. Getting that consent is your responsibility.
            </p>
          </Section>

          <Section
            id="tuning"
            title="Controls for each model"
            lede="The parameter panel is built from what each model accepts. Switching models rebuilds the controls."
          >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
              <div className="text-muted-foreground space-y-4 text-sm leading-relaxed">
                <p>
                  Soundbox ships parameter definitions for{" "}
                  <span className="text-foreground font-medium">29 model families</span>,{" "}
                  <span className="text-foreground font-medium">165 controls</span> in total,
                  across sliders, numbers, toggles, choices and text. They are vendored from
                  audio.cpp&apos;s own parameter file and checked against its per-family source.
                  Delivery settings (&ldquo;how should this line be said&rdquo;) and sampler
                  settings (&ldquo;how hard should the sampler work&rdquo;) are grouped
                  separately.
                </p>
                <p>
                  These are request options, and audio.cpp accepts unknown keys silently, so a
                  misspelled parameter produces no error. Because the panel is built from the real
                  definitions, it never shows a control that the model would ignore.
                </p>
                <p>
                  The demo shows two behaviours from the app. Some parameters do nothing until
                  another is on, so dependent controls grey out until their gate is set. Only
                  values you change are sent: if you change nothing, the request carries no
                  options and the model&apos;s own defaults apply.
                </p>
                <p className="text-muted-foreground/80">
                  The same panel drives sound effects and music. It is shown here because voice
                  models have the most to tune.
                </p>
              </div>

              <ModelParamsDemo />
            </div>
          </Section>

          <Section
            id="agents"
            title="Agents can write and voice scripts too"
            lede="The story tools are on the same MCP surface as everything else in Soundbox."
          >
            <div className="text-muted-foreground max-w-3xl space-y-4 text-sm leading-relaxed">
              <p>
                A connected agent can speak a one-off line, create a story, add lines with
                speakers and per-line delivery, revise them, and voice the result, through the
                same endpoints the app uses. Every generated file comes back with an absolute
                path, so the agent can pass narration to ffmpeg or drop it into a video project.
              </p>
              <p>
                The story page holds a live connection open, so lines an agent writes appear as
                they are written, without a refresh. The Agents page attributes every call to the
                client that made it.
              </p>
            </div>
          </Section>

          <Section
            id="models"
            title={`${VOICE_STATS.count} voice models, each with its licence and verified status`}
            lede={`Voice is the largest category in the catalog: ${VOICE_STATS.count} of ${VOICE_STATS.total} models are text-to-speech, voice conversion or cloning. Their licences also vary the most.`}
          >
            <div className="text-muted-foreground max-w-3xl space-y-4 text-sm leading-relaxed">
              <p>
                Every voice model in the catalog is opt-in: it appears in the app&apos;s picker
                only after you enable it on the Models page.{" "}
                {VOICE_STATS.verified === 1
                  ? "One of the " + VOICE_STATS.count + " has been verified end to end"
                  : VOICE_STATS.verified + " of the " + VOICE_STATS.count + " have been verified end to end"}
                ; the rest come from audio.cpp&apos;s shipped model list and are marked
                unverified. Each model page says which.
              </p>
              <p>
                The licences vary widely. Of the {VOICE_STATS.count}:{" "}
                {VOICE_STATS.nonCommercial} are non-commercial,{" "}
                {VOICE_STATS.conditional} permit commercial use only under conditions (revenue
                caps, attribution duties, per-speaker voice licences), and{" "}
                {VOICE_STATS.unknown} have no confirmed licence and are treated as
                non-commercial. For commercial work, read the entry for the specific model before
                you generate anything you plan to ship.
              </p>
            </div>
            <div className="mt-6">
              <Button variant="outline" asChild>
                <Link to={MODELS_HUB_HREF}>Read the licence write-ups on /models</Link>
              </Button>
            </div>
          </Section>
        </div>

        <div className="mt-14">
          <Close />
        </div>
      </main>
    </div>
  );
}
