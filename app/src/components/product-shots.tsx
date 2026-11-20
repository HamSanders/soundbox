/**
 * Real screenshots of the running app, switchable.
 *
 * Everything else on this site that looks like Mirli is a drawing of it —
 * `timeline-banner`, the `reveal-*` panels, `model-params-demo`. Those exist to
 * animate and to be interactive, which a screenshot cannot be, and they are
 * honest about being illustrations. But a visitor deciding whether to install
 * something eventually wants the unglamorous question answered: *what does it
 * actually look like*. Only a screenshot answers that.
 *
 * These were captured from the app running in its mock mode (`npm run dev:mock`
 * — no backend, seeded data), at 1440×900 (2x), dark theme. Mock rather than a live
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
 *   - The Agents page showed `uv run soundbox-mcp` as the stdio bridge command.
 *     `uv` is Python tooling and had to go, but the fix is not `npx
 *     soundbox-mcp` either — `soundbox-mcp` is a private package, so npx
 *     cannot resolve it, and `npm install` only links the bin into the
 *     checkout's own `node_modules/.bin`, off any editor's spawn `PATH`. The
 *     real command is by absolute path — `node
 *     /path/to/soundbox/server/dist/mcp/stdio.js` — which is what
 *     `docs/MCP.md` documents and what the Agents page actually prints,
 *     resolved for the install it's running on.
 *
 * The images live in `site/public/product/`, the site build's `publicDir`, so
 * they are served from `/product/*` on the site and never ship in the app
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
    src: "/product/app-library.webp",
    alt: "The Mirli library: kind tabs, a search box with tag, model, favourites and agent filters, eight generated sounds each with its tags, licence badge, model and length, and the bottom player playing Door slam 01.",
    caption:
      "Everything generated, in one list, with the prompt, model and seed kept beside it. A row marked with an agent's name was made over MCP.",
  },
  {
    id: "create",
    label: "Create",
    src: "/product/app-create-music.webp",
    alt: "The Create panel on its Music tab: a model picker, an instrumental switch, a styles prompt with suggestion chips, tempo and a Create button, beside the list of tracks.",
    caption: "Music, SFX and Speech in one panel, beside the takes it has already made.",
  },
  {
    id: "details",
    label: "Details",
    src: "/product/app-details.webp",
    alt: "The details panel docked beside the library: a waveform for Rain on tin roof with trim and effect tools, and its generation settings: model, prompt, seed, steps, CFG and duration.",
    caption: "Open any take for its waveform, quick edits and the exact settings that made it.",
  },
  {
    id: "voice-clone",
    label: "Clone a voice",
    src: "/product/app-voice-clone.webp",
    alt: "Clone a voice: an area to upload or record up to five clips of one speaker, a clip timer, and fields for the voice's name, model and notes.",
    caption: "A few seconds of one clear speaker is enough to start a cloned voice.",
  },
  {
    id: "voice-lab",
    label: "Voice Lab",
    src: "/product/app-voice-lab.webp",
    alt: "Voice Lab: your voices as cards, a table of every voice with its kind and model, and a panel to read one line through several voices side by side.",
    caption: "Every voice you have made or installed, and a way to hear them back to back.",
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
        {/* Every shot is the same 1440×900 frame, so the aspect ratio is fixed
            here rather than left to the image: without it the panel resizes as
            each one decodes and the tab row jumps under the pointer. */}
        <img
          src={assetUrl(active.src)}
          alt={active.alt}
          width={1440}
          height={900}
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
