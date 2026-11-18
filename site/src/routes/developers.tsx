/**
 * `/developers/`: one page with everything an AI agent (or the developer
 * driving one) needs to understand, install and drive Mirli.
 *
 * Why one page and not a section of many: an agent that is handed a URL
 * fetches that URL, and anything behind a second click is a second fetch it
 * may not make. So the install paths, the MCP configs for each client, every
 * tool, the HTTP API, the environment variables and the limits all live here,
 * and the full docs are linked for depth. The same content is published as
 * Markdown at `/developers/index.md` and leads `llms-full.txt`; see
 * docs/agents-discovery.md for the standards behind those files.
 *
 * The words live in `src/developers/content.ts`, which the Markdown is also
 * rendered from. The tool list and the environment variables are not written
 * anywhere: they come from `virtual:developer-facts`, which reads
 * `server/src/mcp/server.ts` and `docs/INSTALL.md` at build time.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import facts from "virtual:developer-facts";
import { Button } from "@/components/ui/button";
import { SeoHead } from "@/components/seo-head";
import { C, CopyBlock, Note } from "@/components/docs-primitives";
import {
  AGENT_FILES,
  AGENT_RULES,
  API_RULES,
  CLIENTS,
  CURL,
  DOCS,
  FACTS,
  IMAGE,
  INSTALL,
  LIMITS,
  MCP_NOTES,
  MCP_URL,
  PAGE,
  REPO,
  argSignature,
  stripLinks,
} from "../developers/content";

const SECTIONS = [
  { id: "install", title: "Install" },
  { id: "connect", title: "Connect the MCP server" },
  { id: "tools", title: `MCP tools (${facts.tools.length})` },
  { id: "api", title: "HTTP API" },
  { id: "env", title: "Environment variables" },
  { id: "limits", title: "Hardware and limits" },
  { id: "docs", title: "Full documentation" },
];

const LINK = "text-primary underline underline-offset-4";

/** Prose with `backtick` spans as inline code and bare https URLs as links. */
function Prose({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|https:\/\/[^\s)]+[^\s).,;:])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
          return <C key={i}>{part.slice(1, -1)}</C>;
        if (part.startsWith("https://"))
          return (
            <a key={i} href={part} className={LINK}>
              {part.replace(/^https:\/\//, "")}
            </a>
          );
        return part;
      })}
    </>
  );
}

function DocLink({ path, children }: { path: string; children: ReactNode }) {
  return path.startsWith("http") || path.includes(".") ? (
    <a href={path} className={LINK}>
      {children}
    </a>
  ) : (
    <Link to={path} className={LINK}>
      {children}
    </Link>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-16 scroll-mt-20 border-t pt-12">
      <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
      {intro && (
        <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">{intro}</p>
      )}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="font-heading scroll-mt-20 text-base font-semibold tracking-tight">
      {children}
    </h3>
  );
}

function jsonLd(): object[] {
  const origin = (import.meta.env.VITE_SITE_ORIGIN ?? "").replace(/\/+$/, "");
  const url = origin ? `${origin}/developers/` : undefined;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Mirli",
      alternateName: "Soundbox",
      description: PAGE.summary,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Windows 10, Windows 11, macOS, Linux",
      softwareVersion: facts.version,
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      downloadUrl: `${REPO}/releases/latest`,
      ...(origin ? { url: `${origin}/`, softwareHelp: { "@type": "WebPage", url } } : {}),
      sameAs: [REPO],
      subjectOf: {
        "@type": "SoftwareSourceCode",
        name: "Mirli source code",
        codeRepository: REPO,
        programmingLanguage: ["TypeScript", "Rust"],
        license: "https://opensource.org/licenses/MIT",
      },
    },
  ];
}

export function DevelopersPage() {
  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title={PAGE.title}
        description={PAGE.description}
        path={PAGE.path}
        jsonLd={jsonLd()}
      />

      <div className="mx-auto w-full max-w-3xl px-4">
        {/* ------------------------------------------------------------ hero */}
        <header className="py-12">
          <p className="label-caps text-primary">Developers · for AI agents</p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Everything an agent needs to run Mirli
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
            {PAGE.summary}
          </p>
          <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed">
            Some identifiers kept the old name and are what you type: the MCP tools are{" "}
            <C>soundbox.*</C>, the environment variables <C>SOUNDBOX_*</C>, the CLI{" "}
            <C>soundbox</C> and the image <C>{IMAGE}</C>. Version {facts.version}.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <a href="#connect">Connect the MCP server</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/developers/index.md">This page as Markdown</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/llms-full.txt">llms-full.txt</a>
            </Button>
          </div>

          <dl className="mt-8 divide-y rounded-2xl border">
            {FACTS.map((f) => (
              <div key={f.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="label-caps text-muted-foreground pt-0.5">{f.label}</dt>
                <dd className="min-w-0 text-sm leading-relaxed break-words">
                  {f.code ? <C>{f.value}</C> : <Prose text={f.value} />}
                </dd>
              </div>
            ))}
          </dl>

          <nav aria-label="On this page" className="mt-8">
            <p className="label-caps text-muted-foreground">On this page</p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {/* --------------------------------------------------------- install */}
        <Section
          id="install"
          title="Install"
          intro="Three ways in. All three end with the same server on 127.0.0.1:17494, which is also the MCP server."
        >
          <div className="space-y-12">
            {INSTALL.map((p) => (
              <div key={p.id} id={`install-${p.id}`} className="scroll-mt-20">
                <H3>{p.title}</H3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  <Prose text={p.when} />
                </p>
                <div className="mt-4 space-y-3">
                  {p.steps.map((s, i) => (
                    <div key={i} className="space-y-2">
                      <p className="text-sm leading-relaxed">
                        <Prose text={s.text} />
                      </p>
                      {s.code && (
                        <CopyBlock code={s.code} language={s.lang} label={`Copy: ${p.title}`} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div>
              <H3 id="agent-rules">Rules for an agent installing Mirli</H3>
              <ul className="text-muted-foreground mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                {AGENT_RULES.map((r) => (
                  <li key={r}>
                    <Prose text={r} />
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-3 text-sm">
                The full walkthrough:{" "}
                <a href={`${REPO}/blob/main/docs/INSTALL-AGENT.md`} className={LINK}>
                  docs/INSTALL-AGENT.md
                </a>
                .
              </p>
            </div>
          </div>
        </Section>

        {/* --------------------------------------------------------- connect */}
        <Section
          id="connect"
          title="Connect the MCP server"
          intro={
            <>
              One endpoint, <C>{MCP_URL}</C>, over Streamable HTTP, with no key by default. The
              app or <C>soundbox</C> server must be running.
            </>
          }
        >
          <div className="space-y-10">
            {CLIENTS.map((c) => (
              <div key={c.id} id={`client-${c.id}`} className="min-w-0 scroll-mt-20">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <H3>{c.client}</H3>
                  {c.install && (
                    <a href={c.install.href} className="label-caps text-primary hover:underline">
                      {c.install.label} ↗
                    </a>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  <Prose text={c.where} />
                </p>
                <CopyBlock
                  className="mt-3"
                  code={c.code}
                  language={c.lang}
                  label={`Copy the ${c.client} config`}
                />
                {c.file && (
                  <>
                    <p className="text-muted-foreground mt-3 text-sm">
                      Or in <Prose text={c.file.where} />:
                    </p>
                    <CopyBlock
                      className="mt-2"
                      code={c.file.code}
                      language={c.file.lang}
                      label={`Copy the ${c.client} config file`}
                    />
                  </>
                )}
                {c.note && (
                  <div className="mt-3">
                    <Note>
                      <Prose text={c.note} />
                    </Note>
                  </div>
                )}
                <p className="text-muted-foreground mt-2 text-xs">
                  Syntax from{" "}
                  <a href={c.source} className="hover:text-foreground underline underline-offset-4">
                    {c.client}'s docs
                  </a>
                  .
                </p>
              </div>
            ))}
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
              {MCP_NOTES.map((n) => (
                <li key={n}>
                  <Prose text={n} />
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* ----------------------------------------------------------- tools */}
        <Section
          id="tools"
          title={`MCP tools (${facts.tools.length})`}
          intro={
            <>
              Read from the server's source at build time, so this list is what the server
              registers. Descriptions are the ones the server sends the model. <C>?</C> marks an
              optional argument. The grouped walkthrough is the{" "}
              <Link to="/docs/mcp" className={LINK}>
                MCP reference
              </Link>
              .
            </>
          }
        >
          <ul className="space-y-4">
            {facts.tools.map((t) => (
              <li
                key={t.name}
                id={`tool-${t.name.replace(/\./g, "-")}`}
                className="border-border/60 min-w-0 scroll-mt-20 rounded-xl border p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <code className="font-mono text-sm font-medium break-all">{t.name}</code>
                  <span className="text-muted-foreground text-xs">{t.title}</span>
                </div>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  <Prose text={t.description} />
                </p>
                {t.args.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {t.args.map((a) => (
                      <li key={a.name} className="text-xs leading-relaxed">
                        <code className="font-mono break-all">{argSignature(a)}</code>
                        {a.description && (
                          <span className="text-muted-foreground">
                            {" "}
                            · <Prose text={a.description.replace(/\n+/g, " ")} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground mt-3 text-xs">No arguments.</p>
                )}
              </li>
            ))}
          </ul>
        </Section>

        {/* ------------------------------------------------------------- api */}
        <Section
          id="api"
          title="HTTP API"
          intro="The same server, without MCP. Useful from scripts, game engines and anything that is not an MCP client."
        >
          <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            {API_RULES.map((r) => (
              <li key={r}>
                <Prose text={r} />
              </li>
            ))}
          </ul>
          <div className="mt-10 space-y-8">
            {CURL.map((c) => (
              <div key={c.title} className="min-w-0">
                <H3>{c.title}</H3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  <Prose text={c.text} />
                </p>
                <CopyBlock className="mt-3" code={c.code} label={`Copy: ${c.title}`} />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-8 text-sm">
            Every route, with bodies and responses:{" "}
            <Link to="/docs/api" className={LINK}>
              the HTTP API reference
            </Link>
            .
          </p>
        </Section>

        {/* ------------------------------------------------------------- env */}
        <Section
          id="env"
          title="Environment variables"
          intro={
            <>
              Read from the table in{" "}
              <Link to="/docs/install" className={LINK}>
                the install guide
              </Link>{" "}
              at build time.
            </>
          }
        >
          <dl className="divide-y rounded-2xl border">
            {facts.envVars.map((e) => (
              <div key={e.names.join()} className="px-4 py-3">
                <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {e.names.map((n) => (
                    <code key={n} className="font-mono text-sm font-medium break-all">
                      {n}
                    </code>
                  ))}
                  <span className="text-muted-foreground text-xs">
                    <Prose text={e.readBy} />
                  </span>
                </dt>
                <dd className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  <Prose text={stripLinks(e.description).replace(/\*\*/g, "")} />
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* ---------------------------------------------------------- limits */}
        <Section id="limits" title="Hardware and limits">
          <dl className="divide-y rounded-2xl border">
            {LIMITS.map((l) => (
              <div key={l.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="label-caps text-muted-foreground pt-0.5">{l.label}</dt>
                <dd className="text-sm leading-relaxed">
                  <Prose text={l.value} />
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* ------------------------------------------------------------ docs */}
        <Section id="docs" title="Full documentation">
          <ul className="grid gap-4 sm:grid-cols-2">
            {DOCS.map((d) => (
              <li key={d.path} className="border-border/60 rounded-xl border p-4">
                <DocLink path={d.path}>
                  <span className="font-heading text-sm font-semibold">{d.label}</span>
                </DocLink>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{d.blurb}</p>
              </li>
            ))}
          </ul>

          <H3 id="files">
            <span className="mt-12 block">Machine-readable files</span>
          </H3>
          <ul className="mt-4 space-y-2 pb-20 text-sm">
            {AGENT_FILES.map((f) => (
              <li key={f.path}>
                <DocLink path={f.path}>
                  <code className="font-mono">{f.label}</code>
                </DocLink>
                <span className="text-muted-foreground">: {f.blurb}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
