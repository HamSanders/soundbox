/**
 * `/docs` — the way in.
 *
 * Every documentation page in one place, grouped the way the sidebar groups
 * them, because a docs site whose front door is one arbitrary page is a docs
 * site nobody reads twice. The generated API and MCP reference is a card here
 * like everything else; it lives at `/docs/reference`.
 */

import { Link } from "react-router-dom";
import { ArrowRightIcon, TerminalIcon } from "lucide-react";

import { SeoHead } from "@/components/seo-head";
import { DocsShell } from "../docs/shell";
import { DOC_SECTIONS } from "../docs/pages";

export function DocsIndexPage() {
  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title="Documentation: install, studio, HTTP API and MCP | Soundbox"
        description="How Soundbox works: installing it, generating sound, arranging in the studio, the local HTTP API, and the MCP tools an agent gets."
        path="/docs"
      />
      <DocsShell current="index">
        <header className="mb-12">
          <p className="label-caps text-primary">
            Documentation
          </p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Soundbox documentation
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
            Soundbox generates audio with open-weight models on your own machine,
            arranges it on a timeline, and serves it over an HTTP API and to agents
            over MCP.
          </p>
        </header>

        <div className="space-y-12">
          {DOC_SECTIONS.map((section) => (
            <section key={section.name}>
              <h2 className="label-caps text-muted-foreground">
                {section.name}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {section.pages.map((page) => (
                  <li key={page.slug}>
                    <Link
                      to={`/docs/${page.slug}`}
                      className="border-border/70 hover:border-primary/50 hover:bg-card group block h-full rounded-2xl border p-4 transition-colors"
                    >
                      <span className="font-heading flex items-center gap-1.5 font-semibold tracking-tight">
                        {page.title}
                        <ArrowRightIcon className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                      <span className="text-muted-foreground mt-1.5 block text-sm leading-relaxed">
                        {page.blurb}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h2 className="label-caps text-muted-foreground">
              Generated
            </h2>
            <Link
              to="/docs/reference"
              className="border-border/70 hover:border-primary/50 hover:bg-card group mt-4 flex items-start gap-3 rounded-2xl border p-4 transition-colors"
            >
              <TerminalIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-heading flex items-center gap-1.5 font-semibold tracking-tight">
                  API &amp; MCP reference
                  <ArrowRightIcon className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-muted-foreground mt-1.5 block text-sm leading-relaxed">
                  Every endpoint and every agent tool, generated from the server's own
                  schema.
                </span>
              </span>
            </Link>
          </section>
        </div>
      </DocsShell>
    </div>
  );
}
