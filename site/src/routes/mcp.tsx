/**
 * `/mcp` — the marketing entry point for the MCP server.
 *
 * This is not `/docs/mcp`. That page is the reference: every tool, every
 * argument, the stdio bridge, the telemetry export — written for somebody who
 * has already decided to connect and needs to know what the server accepts.
 * This page is for somebody who hasn't decided yet, and whose whole question is
 * "what is this and why would I point my agent at it". So it makes the argument
 * once (the audio, the model and the agent are all on your machine, so the
 * integration is a path instead of a payload), shows the one line of config,
 * lists the tools at a glance, and hands off to the reference for the detail.
 *
 * Everything factual here is sourced: the port from `server/src/config.ts`, the
 * tool list from `@/content/mcp/tools.ts`, the per-client setup from
 * `@/content/mcp/clients.ts`, the model licences from
 * `@/content/models/models.ts`. Nothing on this page should be a claim you
 * cannot follow back to one of those.
 *
 * Site-only, so no `AppTopNav` — the site's own `SiteHeader` wraps it.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeoHead, faqJsonLd } from "@/components/seo-head";
import { C, CopyBlock, Disclosure, Note } from "@/components/docs-primitives";
import { SamplePlay } from "@/components/sample-play";
import { McpClientGuides, McpQuickConnect } from "@/components/mcp-clients";
import { mcpClients } from "@/content/mcp/clients";
import { MCP_TOOLS, MCP_TOOL_GROUPS } from "@/content/mcp/tools";
import { MODELS } from "@/content/models/models";
import type { CommercialUse } from "@/content/models/types";

const MCP_URL = "http://127.0.0.1:17494/mcp";

const HERO_FACTS = ["No API key or account", "Free per generation", "Runs on your GPU", "Returns file paths"];

/* Keyed by `CommercialUse`, which carries a fourth value the app's own
   `LicenseInfo` does not: "unknown" means nobody here has read a licence for
   these weights, and it must not render as a permissive default. See
   app/src/content/models/types.ts. */
const LICENSE_BADGE: Record<CommercialUse, string> = {
  yes: "bg-ok/10 text-ok",
  conditional: "bg-warn/10 text-warn",
  no: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

const LICENSE_LABEL: Record<CommercialUse, string> = {
  yes: "Commercial OK",
  conditional: "Commercial (conditional)",
  no: "Non-commercial",
  unknown: "Licence unconfirmed",
};

/* The catalog is 46 models deep, 42 of them opt-in extras. This is a marketing
   section, not the catalog: it shows the tier the app lists by default and
   sends the reader to /models for the rest. */
const LISTED_MODELS = MODELS.filter((model) => model.tier === "listed");

const FAQS: { question: string; answer: string }[] = [
  {
    question: "What is MCP?",
    answer:
      "The Model Context Protocol is an open standard for giving an AI agent tools it can call. Mirli runs an MCP server inside its own process, so an agent connected to it can generate sound effects, music and speech, and arrange them, without you leaving the conversation you are already in.",
  },
  {
    question: "Which clients work with it?",
    answer:
      "Anything that speaks MCP. Claude Code, Codex, Devin and opencode take the URL in a single command; Cursor, VS Code, Zed, Cline, Goose, LM Studio, Continue and Antigravity take it in a config file, and Cursor, VS Code, Goose and LM Studio also have one-click install links. Claude Desktop only runs stdio servers from its config, so it connects through the mcp-remote bridge. The setup section on this page has the exact steps for each.",
  },
  {
    question: "Do I need an API key?",
    answer:
      "No. There is no key and no account, because there is no auth and no cloud: the server listens on 127.0.0.1 and the agent runs on the same machine. Over HTTP there is nothing to install on the agent's side.",
  },
  {
    question: "What does it cost per generation?",
    answer:
      "Nothing. Generation runs on your own GPU from open-weight models you have downloaded, so there is no per-second billing and no subscription for model access. Mirli itself is MIT-licensed.",
  },
  {
    question: "How long does a generation take?",
    answer:
      "Seconds to a minute, depending on the model and the length of the clip. The tool call blocks until the audio is written to disk, so the agent receives a finished file and has no job id to poll.",
  },
  {
    question: "Can I use the output commercially?",
    answer:
      "It depends on the model. Each model's licence is stated on its page, and the list_models tool reports commercial_use as yes, no or conditional, so an agent working on something commercial can check before it generates.",
  },
  {
    question: "Does anything leave my machine?",
    answer:
      "No. The weights are on your disk, the inference runs on your machine, and the WAV is written to your filesystem.",
  },
  {
    question: "Can I use it with my own agent?",
    answer:
      "Yes. Any MCP client can connect over HTTP with the same URL; nothing in the server is Claude-specific. To skip MCP, call the HTTP API that the same local server exposes.",
  },
  {
    question: "Do I need to keep the app open?",
    answer:
      "Yes. The MCP server runs inside the main Mirli process, so there is no separate daemon to start. If the app is running, the tools are available. If it is not, the tools return an actionable error; they do not start a second copy that would compete for the GPU.",
  },
];

/* ------------------------------------------------------------------ parts */

/**
 * The worked example.
 *
 * The calls, arguments and result shape are the ones the tools actually use.
 */
function ExampleTranscript() {
  const calls: { tool: string; args?: string; result: string }[] = [
    {
      tool: "soundbox.generate",
      args: 'prompt: "heavy wooden door slamming in a stone corridor", duration_s: 3',
      result: "C:\\Users\\you\\.soundbox\\sounds\\9f1c2ae4….wav",
    },
  ];
  return (
    <figure className="border-border/70 bg-card/40 space-y-5 rounded-2xl border p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
          You
        </div>
        <p className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">
          The vault door in level 2 has no sound. Make one and wire it up.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <div className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
          AI
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="pt-0.5 text-sm leading-relaxed">
            I'll generate it locally and drop it into your assets folder.
          </p>
          <div className="space-y-2">
            {calls.map((call) => (
              <div
                key={call.tool}
                className="border-border/70 bg-muted/40 rounded-xl border px-3 py-2"
              >
                <p className="font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
                  <span className="text-primary">{call.tool}</span>
                  {call.args && <span className="text-muted-foreground"> {call.args}</span>}
                </p>
                <p className="text-muted-foreground mt-1 font-mono text-xs [overflow-wrap:anywhere]">
                  <span aria-hidden>→ </span>
                  {call.result}
                </p>
              </div>
            ))}
            <div className="border-border/70 bg-muted/40 rounded-xl border px-3 py-2">
              <p className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]">
                cp C:\Users\you\.soundbox\sounds\9f1c2ae4….wav assets/audio/vault-door.wav
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed">
            Done: <C>assets/audio/vault-door.wav</C>, 3 seconds, referenced from the door's
            interact handler.
          </p>
          <div className="border-border rounded-md border p-3">
            <p className="label-caps text-muted-foreground mb-2">
              Hear a door like it
            </p>
            <SamplePlay id="door-heavy-vault" />
          </div>
        </div>
      </div>

      <figcaption className="text-muted-foreground border-border/70 border-t pt-3 text-xs leading-relaxed">
        The second step is an ordinary shell copy, because the first step returned a path on the
        same disk. The chat wording is written for this illustration; the call and its result
        shape are real.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------- page */

export function McpPage() {
  const clients = useMemo(() => mcpClients(MCP_URL), []);
  const [client, setClient] = useState(clients[0].id);

  /* `/mcp#setup-cursor` opens on Cursor, so a support answer can link
     straight to one client. Read after mount: the static HTML is Claude Code. */
  useEffect(() => {
    const pick = () => {
      const id = window.location.hash.match(/^#setup-(.+)$/)?.[1];
      if (id && clients.some((c) => c.id === id)) {
        setClient(id);
        document.getElementById("setup")?.scrollIntoView();
      }
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, [clients]);

  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title="MCP server for local sound generation | Mirli"
        description="Connect Claude Code, Claude Desktop, Cursor or any MCP client to Mirli in one line. Sound effects, music and speech are generated on your own GPU and returned as absolute file paths. No API key, no account, no per-generation billing."
        path="/mcp"
        image="/og/mcp.jpg"
        imageAlt="The one command that connects Claude Code to Mirli's MCP server"
        jsonLd={[faqJsonLd(FAQS)]}
      />

      {/* -------------------------------------------------------------- hero
          One screen tall, never more: the pitch on the left and the thing to
          copy on the right, so a visitor can connect without scrolling. */}
      <section className="mx-auto flex w-full max-w-6xl items-center px-4 py-10 lg:min-h-[calc(100svh-3.5rem)] lg:py-8">
        <div className="grid w-full min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
          <div className="min-w-0">
            <p className="label-caps text-primary">MCP server</p>
            <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Give your agent a sound studio
            </h1>
            <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-relaxed text-pretty">
              Sound effects, music and speech, generated on your own machine and handed back as
              file paths your agent can use. One line connects Claude, Cursor, VS Code, Codex or
              any MCP client.
            </p>
            <ul className="mt-6 grid max-w-md grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {HERO_FACTS.map((fact) => (
                <li key={fact} className="flex items-center gap-2">
                  <CheckIcon className="text-primary size-4 shrink-0" />
                  {fact}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-2">
              <Button asChild size="lg">
                <Link to="/download">Download Mirli</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/docs/mcp">Tool reference</Link>
              </Button>
            </div>
          </div>

          <div className="min-w-0">
            <McpQuickConnect
              clients={clients}
              url={MCP_URL}
              value={client}
              onChange={setClient}
              guideHref="#setup"
            />
            <p className="text-muted-foreground mt-3 px-1 text-xs leading-relaxed">
              Mirli has to be running: the server lives inside the app, on{" "}
              <C>127.0.0.1:17494</C>. Nothing leaves your machine.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-3xl px-4">
        {/* ----------------------------------------------------------- setup */}
        <section id="setup" className="scroll-mt-20 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Set up your client
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Install and start Mirli first (
            <Link to="/docs/install" className="text-primary underline underline-offset-4">
              the install guide
            </Link>{" "}
            covers downloading model weights). There is no separate daemon: if the app is
            running, the server is up. Then pick your client. Every entry was checked against
            that vendor's own MCP docs, linked at the bottom of each.
          </p>
          <div className="mt-8">
            <McpClientGuides clients={clients} value={client} onChange={setClient} />
          </div>
          <div className="mt-8">
            <Note>
              Then ask for a sound in plain language, for example: “Generate a heavy wooden door
              slamming in a stone corridor, about 3 seconds, and put it in assets/audio/.”
            </Note>
          </div>
        </section>

        {/* ------------------------------------------------------------ path */}
        <section className="mt-16 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            What comes back is a path
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            Every result from <C>soundbox.generate</C> carries an absolute filesystem path to a WAV
            on your disk. The agent has no base64 to decode, no signed URL that expires, and no id
            to exchange for bytes in a second call. Its next step is ordinary shell work:
          </p>
          <div className="mt-4">
            <CopyBlock
              code={`ffmpeg -i /home/you/.soundbox/sounds/9f1c2ae4….wav assets/audio/vault-door.ogg`}
              label="Copy the ffmpeg example"
            />
          </div>
          <p className="text-muted-foreground mt-4 leading-relaxed">
            This works because the agent and Mirli run on the same machine and share a
            filesystem.
          </p>
        </section>

        {/* --------------------------------------------------------- example */}
        <section className="mt-16 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">A worked example</h2>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            One turn with one tool call, producing one file, as it appears in your agent's chat.
          </p>
          <div className="mt-6">
            <ExampleTranscript />
          </div>
        </section>

        {/* ----------------------------------------------------------- tools */}
        <section className="mt-16 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            The tools your agent gets
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            {MCP_TOOLS.length} of them, in {MCP_TOOL_GROUPS.length} groups. Arguments, defaults and
            return shapes are in{" "}
            <Link to="/docs/mcp" className="text-primary underline underline-offset-4">
              the tool reference
            </Link>
            .
          </p>

          <div className="mt-8 space-y-10">
            {MCP_TOOL_GROUPS.map((group) => {
              const tools = MCP_TOOLS.filter((t) => t.group === group.id);
              if (tools.length === 0) return null;
              return (
                <div key={group.id}>
                  <h3 className="label-caps text-muted-foreground">
                    {group.title}
                  </h3>
                  <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
                    {group.intro}
                  </p>
                  <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                    {tools.map((tool) => (
                      <li
                        key={tool.name}
                        className="border-border/60 min-w-0 rounded-xl border p-4"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <code className="font-mono text-xs font-medium break-all">
                            {tool.name}
                          </code>
                          {tool.slow && (
                            <span className="bg-warn/10 text-warn shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                              slow
                            </span>
                          )}
                          {tool.destructive && (
                            <span className="bg-destructive/10 text-destructive shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                              destructive
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                          {tool.blurb}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------------------------------------------------------- models */}
        <section className="mt-16 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            The models it reaches
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Mirli runs open-weight models locally and does not train its own. Each model's
            licence is shown before you download it. The output is yours, and the model's terms
            govern what you may do with it. <C>list_models</C> reports the same thing as{" "}
            <C>commercial_use</C>, so an agent can check before it generates.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {LISTED_MODELS.map((model) => (
              <li key={model.slug}>
                <Link
                  to={`/models/${model.slug}`}
                  className="border-border/60 hover:border-primary/50 hover:bg-card block h-full rounded-xl border p-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-heading text-sm font-semibold tracking-tight">
                      {model.name}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${LICENSE_BADGE[model.license.commercial]}`}
                    >
                      {LICENSE_LABEL[model.license.commercial]}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {model.vendor} · {model.license.name}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                    {model.tagline}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------------- faq */}
        <section className="mt-16 border-t pt-12 pb-20">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-6 divide-y rounded-2xl border">
            {FAQS.map((faq) => (
              <Disclosure
                key={faq.question}
                className="px-1 py-1"
                summary={
                  <span className="font-heading text-sm font-semibold tracking-tight">
                    {faq.question}
                  </span>
                }
              >
                <p className="text-muted-foreground text-sm leading-relaxed">{faq.answer}</p>
              </Disclosure>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            <Button asChild>
              <a href="#setup">Set up your client</a>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/docs/mcp">Read the tool reference</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
