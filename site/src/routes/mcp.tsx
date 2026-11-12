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
 * tool list from `@/content/mcp/tools.ts`, the model licences from
 * `@/content/models/models.ts`. Nothing on this page should be a claim you
 * cannot follow back to one of those.
 *
 * Site-only, so no `AppTopNav` — the site's own `SiteHeader` wraps it.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { SeoHead, faqJsonLd } from "@/components/seo-head";
import { C, CopyBlock, Disclosure, Note } from "@/components/docs-primitives";
import { MCP_TOOLS, MCP_TOOL_GROUPS } from "@/content/mcp/tools";
import { MODELS } from "@/content/models/models";
import type { CommercialUse } from "@/content/models/types";

const MCP_URL = "http://127.0.0.1:17494/mcp";

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "Any MCP client"];

const CLIENT_JSON = `{"mcpServers":{"konchi":{"type":"http","url":"${MCP_URL}"}}}`;

/* Keyed by `CommercialUse`, which carries a fourth value the app's own
   `LicenseInfo` does not: "unknown" means nobody here has read a licence for
   these weights, and it must not render as a permissive default. See
   app/src/content/models/types.ts. */
const LICENSE_BADGE: Record<CommercialUse, string> = {
  yes: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  conditional: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
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
      "The Model Context Protocol is an open standard for giving an AI agent tools it can call. Konchi runs an MCP server inside its own process, so an agent connected to it can generate sound effects, music and speech, and arrange them, without you leaving the conversation you are already in.",
  },
  {
    question: "Which clients work with it?",
    answer:
      "Anything that speaks MCP. Claude Code takes the HTTP URL as a single command; Claude Desktop, Cursor and the rest take a JSON config block with the same URL. Clients that only speak stdio can use the bundled stdio bridge, which proxies onto the running server and loads no models itself.",
  },
  {
    question: "Do I need an API key?",
    answer:
      "No. There is no key and no account, because there is no auth and no cloud: the server listens on 127.0.0.1 and the agent runs on the same machine. Over HTTP there is nothing to install on the agent's side.",
  },
  {
    question: "What does it cost per generation?",
    answer:
      "Nothing. Generation runs on your own GPU from open-weight models you have downloaded, so there is no per-second billing and no subscription for model access. Konchi itself is MIT-licensed.",
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
      "Yes. The MCP server runs inside the main Konchi process, so there is no separate daemon to start. If the app is running, the tools are available. If it is not, the tools return an actionable error; they do not start a second copy that would compete for the GPU.",
  },
];

/* ------------------------------------------------------------------ parts */

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
      {children}
    </span>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="min-w-0">
      <div className="flex items-baseline gap-2.5">
        <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
          {n}
        </span>
        <h3 className="font-heading text-base font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="mt-2.5 min-w-0 space-y-2.5 sm:pl-[2.125rem]">{children}</div>
    </li>
  );
}

/**
 * The worked example.
 *
 * The calls, arguments and result shape are the ones the tools actually use.
 */
function ExampleTranscript() {
  const calls: { tool: string; args?: string; result: string }[] = [
    {
      tool: "konchi.generate",
      args: 'prompt: "heavy wooden door slamming in a stone corridor", duration_s: 3',
      result: "C:\\Users\\you\\.konchi\\sounds\\9f1c2ae4….wav",
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
                cp C:\Users\you\.konchi\sounds\9f1c2ae4….wav assets/audio/vault-door.wav
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed">
            Done: <C>assets/audio/vault-door.wav</C>, 3 seconds, referenced from the door's
            interact handler.
          </p>
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
  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title="MCP server for local sound generation | Konchi"
        description="Connect Claude Code, Claude Desktop, Cursor or any MCP client to Konchi in one line. Sound effects, music and speech are generated on your own GPU and returned as absolute file paths. No API key, no account, no per-generation billing."
        path="/mcp"
        image="/og/mcp.jpg"
        imageAlt="The one command that connects Claude Code to Konchi's MCP server"
        jsonLd={[faqJsonLd(FAQS)]}
      />

      <div className="mx-auto w-full max-w-3xl px-4">
        {/* ------------------------------------------------------------ hero */}
        <header className="py-12">
          <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
            MCP Server
          </p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            A local sound studio your agent can call
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
            Konchi runs an MCP server inside its own process, so the agent writing your code can
            also generate the sound effects, music and speech that go with it. Generation runs on
            your GPU from open-weight models, and the tools return absolute paths to WAVs on your
            disk. No cloud service is involved, so there is no key, no account and no
            per-generation bill.
          </p>

          <div className="mt-6 flex flex-wrap gap-1.5">
            {CLIENTS.map((client) => (
              <Pill key={client}>{client}</Pill>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <a href="#connect">Connect it in one line</a>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/docs/mcp">Read the tool reference</Link>
            </Button>
          </div>
        </header>

        {/* --------------------------------------------------------- connect */}
        <section id="connect" className="scroll-mt-20 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Connect it in one line
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            The MCP server runs inside the main Konchi process. There is no separate daemon to
            start: if the app is running, the server is up.
          </p>

          <ol className="mt-8 space-y-8">
            <Step
              n={1}
              title="Start Konchi"
            >
              <p className="text-muted-foreground text-sm leading-relaxed">
                Install and run it. The full walkthrough, including downloading model weights, is
                in <Link to="/docs/install" className="text-primary underline underline-offset-4">the install guide</Link>.
                The server listens on <C>127.0.0.1:17494</C>.
              </p>
            </Step>

            <Step n={2} title="Point your client at it">
              <p className="text-muted-foreground text-sm leading-relaxed">
                In Claude Code, that is one command:
              </p>
              <CopyBlock
                code={`claude mcp add --transport http konchi ${MCP_URL}`}
                label="Copy the claude mcp add command"
              />
              <p className="text-muted-foreground text-sm leading-relaxed">
                Clients that take a JSON config file, such as Claude Desktop and Cursor, use the
                same URL:
              </p>
              <CopyBlock
                code={CLIENT_JSON}
                language="json"
                label="Copy the MCP client config"
              />
              <Note>
                The URL has no trailing slash. Konchi rewrites <C>/mcp</C> onto the mounted path
                internally and does not answer a POST with a redirect, so the URL works as pasted.
              </Note>
            </Step>

            <Step n={3} title="Ask for a sound">
              <p className="text-muted-foreground text-sm leading-relaxed">
                There is nothing else to configure. Ask in your current conversation:
              </p>
              <CopyBlock
                code="Generate a heavy wooden door slamming in a stone corridor, about 3 seconds, and put it in assets/audio/."
                language="text"
                label="Copy the example prompt"
              />
            </Step>
          </ol>

          <div className="mt-8">
            <Note>
              There is no key and no account, because there is no auth and no cloud. The agent and
              the server run on the same machine and talk over a loopback socket.
            </Note>
          </div>
        </section>

        {/* ------------------------------------------------------------ path */}
        <section className="mt-16 border-t pt-12">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            What comes back is a path
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            Every result from <C>konchi.generate</C> carries an absolute filesystem path to a WAV
            on your disk. The agent has no base64 to decode, no signed URL that expires, and no id
            to exchange for bytes in a second call. Its next step is ordinary shell work:
          </p>
          <div className="mt-4">
            <CopyBlock
              code={`ffmpeg -i /home/you/.konchi/sounds/9f1c2ae4….wav assets/audio/vault-door.ogg`}
              label="Copy the ffmpeg example"
            />
          </div>
          <p className="text-muted-foreground mt-4 leading-relaxed">
            This works because the agent and Konchi run on the same machine and share a
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
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
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
                            <span className="bg-amber-500/10 text-amber-600 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium dark:text-amber-400">
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
            Konchi runs open-weight models locally and does not train its own. Each model's
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
              <a href="#connect">Connect it</a>
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
