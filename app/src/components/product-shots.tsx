/**
 * Real screenshots of the running app, switchable.
 *
 * Everything else on this site that looks like Konchi is a drawing of it —
 * `timeline-banner`, the `reveal-*` panels, `model-params-demo`. Those exist to
 * animate and to be interactive, which a screenshot cannot be, and they are
 * honest about being illustrations. But a visitor deciding whether to install
 * something eventually wants the unglamorous question answered: *what does it
 * actually look like*. Only a screenshot answers that.
 *
 * These were captured from the app running in its mock mode (`npm run dev:mock`
 * — no backend, seeded data), at 1600×1000, dark theme. Mock rather than a live
 * install because it is reproducible: anyone can re-shoot these and get the same
 * frames, which is what stops them rotting silently.
 *
 * Two things were fixed in `lib/mock.ts` while capturing, because a screenshot
 * is a claim and these two were false ones:
 *
 *   - The seeded sounds were credited to `Stable Audio Open Small`,
 *     `TangoFlux Base` and `AudioGen Medium` — Python-era models that are not in
 *     the audio.cpp catalog at all. A product shot naming models the /models page
 *     does not list is worse than no product shot.
 *   - The Agents page showed `uv run konchi-mcp` as the stdio bridge command.
 *     `uv` is Python tooling and had to go, but the fix is not `npx
 *     konchi-mcp` either — `konchi-mcp` is a private package, so npx
 *     cannot resolve it, and `npm install` only links the bin into the
 *     checkout's own `node_modules/.bin`, off any editor's spawn `PATH`. The
 *     real command is by absolute path — `node
 *     /path/to/soundbox/server/dist/mcp/stdio.js` — which is what
 *     `docs/MCP.md` documents and what the Agents page actually prints,
 *     resolved for the install it's running on.
 *
 * The images live in `site/public/product/`, the site build's `publicDir`, so
 * they are served from `/product/*.png` on the site and never ship in the app
 * bundle.
 */

import { useState } from "react";

import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/asset-url";

interface Shot {
  id: string;
  label: string;
  src: string;
  /** Alt text carries what the picture shows, for anyone who cannot see it —
   *  not "screenshot of the library", which tells a screen-reader user nothing
   *  they could not guess from the heading. */
  alt: string;
  caption: string;
}

const SHOTS: Shot[] = [
  {
    id: "library",
    label: "Library",
    src: "/product/library.png",
    alt: "The Konchi library: eight generated sounds in a list, each with a waveform, the prompt that made it, its model, seed, file size and age. Two rows carry a badge showing the agent that generated them.",
    caption:
      "Everything generated, with the prompt, model and seed kept beside it. The badge on a row is the agent that made it.",
  },
  {
    id: "agents",
    label: "Agents",
    src: "/product/agents.png",
    alt: "The Agents page: stat tiles for calls in the last 24 hours, sounds made over MCP, active agents and errors; a panel of connection commands; a list of connected agents showing claude-code and cursor with their call counts; and a log of recent tool calls with durations.",
    caption:
      "Every MCP client that has connected, what it called, whether it worked, and how long it took.",
  },
  {
    id: "music-studio",
    label: "Music studio",
    src: "/product/music-studio.png",
    alt: "The music studio: generated tracks with cover art and waveforms, arranged in a workspace.",
    caption: "Music sits in the same workspace as everything else you generate.",
  },
];

export function ProductShots() {
  const [activeId, setActiveId] = useState(SHOTS[0].id);
  const active = SHOTS.find((s) => s.id === activeId)!;

  return (
    <div>
      <div role="tablist" aria-label="Screens" className="flex flex-wrap gap-1.5">
        {SHOTS.map((shot) => (
          <button
            key={shot.id}
            type="button"
            role="tab"
            aria-selected={shot.id === activeId}
            aria-controls={`shot-${shot.id}`}
            onClick={() => setActiveId(shot.id)}
            className={cn(
              "focus-visible:ring-ring/50 cursor-pointer rounded-full border px-3 py-1 text-xs font-medium outline-none focus-visible:ring-2",
              "transition-colors duration-200 motion-reduce:transition-none",
              shot.id === activeId
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border/50 text-muted-foreground hover:text-foreground",
            )}
          >
            {shot.label}
          </button>
        ))}
      </div>

      <figure
        id={`shot-${active.id}`}
        role="tabpanel"
        className="border-border/60 bg-card/80 mt-4 overflow-hidden rounded-xl border shadow-sm"
      >
        {/* Every shot is the same 1600×1000 frame, so the aspect ratio is fixed
            here rather than left to the image: without it the panel resizes as
            each one decodes and the tab row jumps under the pointer. */}
        <img
          src={assetUrl(active.src)}
          alt={active.alt}
          width={1600}
          height={1000}
          // The first shot is the one on screen when the section is reached;
          // the others only matter once a tab is clicked.
          loading={active.id === SHOTS[0].id ? "eager" : "lazy"}
          decoding="async"
          className="aspect-[16/10] w-full object-cover object-top"
        />
        <figcaption className="border-border/60 text-muted-foreground border-t px-4 py-2.5 text-xs leading-relaxed">
          {active.caption}
        </figcaption>
      </figure>
    </div>
  );
}
