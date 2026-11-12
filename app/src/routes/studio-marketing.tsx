/**
 * Studio — the page that sells the timeline, prerendered at `/studio`.
 *
 * These four sections all used to sit on the landing page, one after another.
 * That was four consecutive sticky scroll-stages between the hero and the
 * first word about models, which made the front door a studio tour with a
 * generator bolted to the top of it. The generator is what someone arrives
 * for; the studio is what they stay for, and those are two different pitches
 * that were fighting for the same screens.
 *
 * So the studio pitch moved here whole. Nothing was rewritten in the move —
 * `RevealEditRoutes`, `RevealStudio`, `RevealAgenticChat` and
 * `RevealWorkspace` are the same components rendered from a different
 * parent, deliberately, so the two pages cannot drift apart. What is new is
 * only the frame around them: a close that says where to go next. There is no
 * hero — the page opens on the workspace, because the banner a hero would have
 * carried is the same timeline the first section is built from.
 *
 * The same two rules as `welcome.tsx` apply and are worth restating because
 * this file is easy to reach for when adding "just one live bit":
 *
 * 1. **Nothing here may call a query hook.** This page is prerendered by
 *    vite-react-ssg with no backend behind it and no `QueryClientProvider`
 *    above it. `useModels()` here would throw at render, not degrade.
 * 2. **It must not oversell.** Every claim below is checkable against the
 *    component that follows it or against the server source those components
 *    were transcribed from — the intent split in `server/src/llm/studio.ts`,
 *    the panel shortcuts in `routes/story.tsx`, the audio-to-audio routes in
 *    `docs/AUDIOCPP.md`. If a sentence here cannot be traced to one of those,
 *    it does not belong.
 */

import { Link } from "react-router-dom";
import { ExternalLinkIcon } from "lucide-react";

import { SeoHead, softwareAppJsonLd } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { RevealEditRoutes } from "@/components/reveal-edit-routes";
import { RevealStudio } from "@/components/reveal-studio";
import { RevealAgenticChat } from "@/components/reveal-agentic-chat";
import { RevealWorkspace } from "@/components/reveal-workspace";
import { GENERATOR_HREF, MODELS_HUB_HREF } from "@/lib/marketing-links";

/* ----------------------------------------------------------------- close */

/**
 * The end of the page, and the only place on it that asks for anything.
 *
 * A CTA rather than a copy of the landing page's footer: the site-wide footer
 * links live in the layout's header and on `/`, and duplicating the licence
 * paragraph here would mean two copies to keep true.
 */
function Close() {
  return (
    <section
      aria-labelledby="studio-close-heading"
      className="border-border/60 bg-muted/20 border-t px-4 py-16 sm:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="max-w-2xl">
          <p className="label-caps text-primary">
            Running it
          </p>
          <h2
            id="studio-close-heading"
            className="font-heading mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            The studio ships with Soundbox
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            There is no account and nothing extra to buy. The timeline runs
            against the same local server on{" "}
            <code className="font-mono text-xs">127.0.0.1:17494</code> as the
            rest of the app, and generates with the models you downloaded. Read
            each model's licence first: it decides what you may do with the
            output.
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
            <Link to="/docs">Read the docs</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export function StudioMarketingPage() {
  return (
    <div className="bg-background text-foreground min-h-svh overflow-x-clip">
      <SeoHead
        title="Multi-track studio for generated audio | Soundbox"
        description="Cast a script across speakers, lay music and sound effects on a timeline, add per-track effects and mix down to one file. Everything is generated and arranged on your own machine."
        path="/studio"
        image="/product/studio.png"
        imageAlt="The Soundbox studio: a script cast across three speakers above a multi-track timeline of spoken lines, music and sound effects"
        jsonLd={[softwareAppJsonLd()]}
      />
      <a
        href="#main"
        className="bg-card ring-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>
      <main id="main">
        {/* The page opens straight into the workspace — the hero that used to
            sit here restated the timeline banner the section below is already
            made of, so it was two of the same picture stacked.

            The heading stays, screen-reader-only: a document still needs one
            h1, and the sections beneath it are all h2s. Dropping it entirely
            would leave the page with no top-level heading at all, which is a
            worse trade than an invisible one. */}
        <h1 id="studio-hero-heading" className="sr-only">
          The Soundbox studio
        </h1>

        {/* The workspace goes first because it is the only section a reader
            can put their hands on: the dividers drag and the clips open their
            real menu. Establishing "this is a room you rearrange" before any
            of the capability sections means the rest land as things you do
            *in* that room rather than as a feature list — and a page whose
            first move is interactive sets a different expectation for the
            four that follow than another block of prose would. */}
        <RevealWorkspace />

        {/* Then the capabilities, in the order the studio is actually met: do
            something to one clip, build an arrangement out of several, then
            hand the arrangement to the chat box. Editing first because it is
            the smallest unit — a reader who has not yet accepted that a clip
            can be extended has no reason to care that four of them can be
            stacked. */}
        <RevealEditRoutes />
        <RevealStudio />
        <RevealAgenticChat />

        <Close />
      </main>
    </div>
  );
}
