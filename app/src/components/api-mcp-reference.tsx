/**
 * API & MCP — the whole HTTP and MCP surface, as one reference.
 *
 * This is a component, not a route, because there is exactly one place it is
 * rendered: the public site's `/docs/reference` page (`site/src/routes/docs.tsx`).
 * It used to be a route too — `/developers` inside the app — and that is
 * precisely the problem it was causing. Two copies of the same reference meant
 * two things to keep current, and they drifted: the in-app copy still claimed
 * MCP exposed five tools long after the server grew to twenty. Consolidating on
 * the public docs leaves one canonical reference for a developer to read, and
 * one place to fix when the server changes. The app keeps `/agents`, which is a
 * different thing — a live dashboard of this instance's MCP connection, not
 * documentation.
 *
 * Where the content comes from:
 *
 *  - The HTTP API's full endpoint index is `docs/API.md`, rendered by the site
 *    at /docs/api. This page carries the quickstart and links there rather
 *    than keeping a second copy of ninety-odd routes to drift. (It used to:
 *    a reference generated from the Python server's OpenAPI document, which
 *    outlived that server by months.)
 *  - The MCP reference is hand-written in `components/mcp-reference.tsx` from
 *    `content/mcp/tools.ts`, transcribed from `server/src/mcp/server.ts`.
 *
 * Every example is built from `apiOrigin()` so a copied command hits the server
 * the reader is actually running.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  McpConnect,
  McpDebugging,
  McpTools,
  McpWorkedExample,
} from "@/components/mcp-reference";
import { C, CopyBlock, DocSection, Note, SCROLL_MT } from "@/components/docs-primitives";
import type { HealthStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/asset-url";

/**
 * The origin a copy-pasted command should hit.
 *
 * `window.location.origin` is correct when the app is served *by* the
 * Konchi server itself (a production build, or a future Tauri build) — the
 * browser's address bar origin is exactly where /api and /mcp live. It is
 * wrong in local dev: Vite serves the app on :5174 and proxies /api and /mcp
 * to :17494 for the *browser's own* requests, but a `curl` or MCP client
 * config the user copies out of this page runs from a terminal, not through
 * that proxy, so it needs the real backend port. Ports in the 517x/5173-5179
 * range are Vite's, not Konchi's — assume dev in that case and show the
 * documented default instead.
 */
function apiOrigin(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:17494";
  const { protocol, hostname, port } = window.location;
  const isViteDevPort = port !== "" && Number(port) >= 5170 && Number(port) <= 5179;
  if (isViteDevPort) return "http://127.0.0.1:17494";
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

/* ------------------------------------------------------------- in-page nav */

interface NavGroup {
  label: string;
  items: { id: string; label: string }[];
}

const NAV: NavGroup[] = [
  { label: "Start", items: [{ id: "quickstart", label: "Quickstart" }] },
  {
    label: "MCP",
    items: [
      { id: "mcp-connect", label: "Connect a client" },
      // Deliberately not "The five tools": the count changes as the server
      // grows, and a nav label is the last place anyone remembers to update.
      { id: "mcp-tools", label: "The tools" },
      { id: "mcp-example", label: "Worked example" },
      { id: "mcp-debug", label: "Debugging" },
    ],
  },
  {
    label: "HTTP API",
    items: [{ id: "http-api", label: "Every endpoint" }],
  },
];

const ALL_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));

/**
 * Which section the reader is currently in.
 *
 * The bottom margin is large on purpose: without it every section between the
 * top of the viewport and the bottom counts as visible, and the highlight sits
 * on whatever is last rather than on what is being read. Restricting the
 * observation band to the top slice of the viewport makes "active" mean "at the
 * top of the screen", which is what a reader expects.
 */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Document order, so the topmost visible section wins. If nothing is in
        // the band (a section taller than it), keep the previous answer.
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-72px 0px -70% 0px", threshold: 0 },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

function OnThisPage({ activeId, onJump }: { activeId: string; onJump: (id: string) => void }) {
  return (
    <nav
      aria-label="On this page"
      className={cn(
        "min-w-0 rounded-lg border p-3",
        // Sticky rail only where there is room for one beside the content;
        // above the content, as a plain card, everywhere else.
        "xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto xl:border-0 xl:p-0",
      )}
    >
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        On this page
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-1 xl:gap-y-4">
        {NAV.map((group) => (
          <div key={group.label} className="min-w-0">
            <p className="text-muted-foreground/70 mb-1 text-[0.7rem] font-medium">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onJump(item.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "focus-visible:ring-ring/50 hover:text-foreground w-full truncate rounded",
                        "px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-3",
                        isActive
                          ? "text-foreground bg-muted font-medium"
                          : "text-muted-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------- the reference */

/**
 * The reference body, independent of a live query client.
 *
 * `health` is a prop rather than a `useHealth()` call because the only build
 * that renders this — the public site — has no `QueryClientProvider` (see
 * site/src/main.tsx) and no backend to poll. It is simply omitted there, and
 * every value that would come from it already has a static fallback (see
 * `apiOrigin`, and `model` below). Keep it that way: reaching for a query hook
 * in here would break the site build at render time, not at compile time.
 */
export function ApiMcpReference({ health }: { health?: HealthStatus }) {
  const origin = apiOrigin();
  const model = health?.loaded_model ?? "audiocpp-stable-audio-3-sfx";
  const ids = useMemo(() => ALL_IDS, []);
  const activeId = useActiveSection(ids);

  /**
   * The app runs under HashRouter, so an `<a href="#mcp-tools">` would replace
   * the *route* hash and bounce the reader to Generate. In-page navigation is
   * therefore scripted; moving focus to the heading keeps it usable from the
   * keyboard, where a scroll alone would leave the caret at the top of the page.
   */
  const jump = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const heading = el.querySelector<HTMLElement>("h2, h3");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, []);

  return (
    <div className="min-w-0">
      <header className="min-w-0">
        <h1 className={cn("font-heading text-2xl font-semibold tracking-tight", SCROLL_MT)}>
          API &amp; MCP
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
          Konchi is a local server with a browser front end. Everything the app does goes through
          the HTTP API documented below, and an agent can drive the same pipeline over MCP. Every example here points at this instance, so a copied
          command works as-is.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {health?.version && (
            <Badge variant="outline" className="font-mono">
              v{health.version}
            </Badge>
          )}
          <Badge variant="outline" className="font-mono">
            {origin}
          </Badge>
        </div>
      </header>

      <div className="mt-6 min-w-0 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:items-start xl:gap-10">
        <OnThisPage activeId={activeId} onJump={jump} />

        <div className="mt-6 min-w-0 space-y-10 xl:mt-0">
          <DocSection
            id="quickstart"
            title="Quickstart"
            intro="Generate a sound over HTTP in three calls. The pattern is submit, poll, fetch."
          >
            <div className="space-y-1.5">
              <p className="text-sm font-medium">1 · Check the server and see what is loaded</p>
              <CopyBlock code={`curl ${origin}/api/health`} label="Copy the health check" />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">2 · Submit a generation</p>
              <CopyBlock
                label="Copy the generate request"
                code={`curl -X POST ${origin}/api/generate \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"${model}","prompt":"heavy wooden door slam, dry room","duration_s":3}'`}
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                Returns <C>{"{ \"job_id\": \"…\" }"}</C> immediately with <C>202</C>. The audio does
                not exist yet. If the model isn't loaded, the job loads it first. That is the{" "}
                <C>loading</C> phase, and it can take a while the first time.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">3 · Follow the job, then fetch the sound</p>
              <CopyBlock
                label="Copy the job polling example"
                code={`# poll — done, error or cancelled ends it
curl "${origin}/api/jobs/$JOB_ID"

# …or stream every change as server-sent events
curl -N -H 'Accept: text/event-stream' "${origin}/api/jobs/$JOB_ID/events"

# on "status":"done", result.sounds holds the new ids
curl "${origin}/api/sounds/$SOUND_ID"`}
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                The <C>Sound</C> you get back has a <C>file</C> field like{" "}
                <C>/files/&lt;id&gt;.wav</C>. Fetch that from this same origin to get the audio, or
                add <C>?format=mp3</C> to have it transcoded.
              </p>
            </div>

            <Note>
              Describe the physical sound. “Scary sound” produces noise; “low metallic groan of a
              ship's hull under pressure, distant, reverberant” produces something usable. Short
              clips layered in an editor work better than one long generation.
            </Note>
          </DocSection>

          <McpConnect origin={origin} />
          <McpTools />
          <McpWorkedExample />
          <McpDebugging origin={origin} />

          <DocSection
            id="http-api"
            title="Every endpoint"
            intro="The quickstart above is the core loop. The API reference indexes the rest of the HTTP surface route by route: sounds, voices, stories, sessions, models, settings and the MCP log."
          >
            <p className="text-sm leading-relaxed">
              <a className="underline underline-offset-2" href={assetUrl("/docs/api/")}>
                Read the full API reference
              </a>{" "}
              for every route with its method, purpose and key fields. It is kept in the repository as{" "}
              <C>docs/API.md</C> beside the code it describes. Mutating requests need a JSON body
              or an <C>X-Konchi</C> header; see the reference for why.
            </p>
          </DocSection>
        </div>
      </div>
    </div>
  );
}
