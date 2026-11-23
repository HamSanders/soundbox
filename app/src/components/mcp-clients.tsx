/**
 * Per-client MCP setup, driven by `@/content/mcp/clients`.
 *
 * Two views of the same data:
 *
 *  - `McpQuickConnect`: a compact card for the top of the `/mcp` page. The
 *    server URL, a row of clients, and for the chosen one a single thing to
 *    copy (plus a one-click install link where the client has one).
 *  - `McpClientGuides`: the full write-up for the chosen client: steps, every
 *    snippet, where the config lives, how to check it worked, caveats, and the
 *    vendor page it was checked against.
 *
 * Both take `value`/`onChange` so a page can keep them on the same client.
 * The picker is a row of plain buttons rather than Radix tabs: Radix unmounts
 * inactive panels, and there are fourteen clients, which no tab strip fits at
 * 375px anyway. The row wraps instead.
 */

import { Fragment, useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpRightIcon, DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { C, CopyBlock, CopyButton, Note } from "@/components/docs-primitives";
import { cn } from "@/lib/utils";
import type { McpClient } from "@/content/mcp/clients";

/** Renders `backtick` spans in a content string as inline code. */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <C key={i}>{part}</C> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

export function McpClientPicker({
  clients,
  value,
  onChange,
  size = "sm",
  className,
}: {
  clients: McpClient[];
  value: string;
  onChange: (id: string) => void;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <div role="group" aria-label="MCP client" className={cn("flex flex-wrap gap-1.5", className)}>
      {clients.map((client) => {
        const active = client.id === value;
        return (
          <button
            key={client.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(client.id)}
            title={client.formerly ? `${client.name} (formerly ${client.formerly})` : client.name}
            className={cn(
              "focus-visible:ring-ring/50 rounded-full border font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3",
              size === "xs" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
          >
            {client.name}
          </button>
        );
      })}
    </div>
  );
}

function InstallButton({ client }: { client: McpClient }) {
  if (!client.install) return null;
  return (
    <Button asChild size="sm">
      <a href={client.install.href}>
        <DownloadIcon />
        {client.install.label}
      </a>
    </Button>
  );
}

function useClient(clients: McpClient[], value: string | undefined) {
  const [own, setOwn] = useState(clients[0]?.id ?? "");
  const id = value ?? own;
  const client = clients.find((c) => c.id === id) ?? clients[0];
  return { client, setOwn };
}

/* --------------------------------------------------------- quick connect */

export function McpQuickConnect({
  clients,
  url,
  value,
  onChange,
  guideHref,
  className,
}: {
  clients: McpClient[];
  url: string;
  value?: string;
  onChange?: (id: string) => void;
  /** In-page link to the full guide, e.g. `#setup`. */
  guideHref?: string;
  className?: string;
}) {
  const { client, setOwn } = useClient(clients, value);
  const change = onChange ?? setOwn;
  if (!client) return null;

  return (
    <div
      className={cn(
        "border-border/70 bg-card/60 min-w-0 rounded-2xl border p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="label-caps text-muted-foreground shrink-0">Server URL</span>
        <code className="bg-muted/70 min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-xs">
          {url}
        </code>
        <CopyButton value={url} label="Copy the MCP server URL" />
      </div>

      <McpClientPicker
        clients={clients}
        value={client.id}
        onChange={change}
        size="xs"
        className="mt-4"
      />

      <div className="mt-4 min-w-0 space-y-3">
        <CopyBlock
          code={client.quick.code}
          language={client.quick.language}
          label={client.quick.label}
          className="[&_pre]:max-h-40 [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <InstallButton client={client} />
          {guideHref && (
            <Button asChild size="sm" variant="ghost">
              <a href={guideHref}>
                <ArrowDownIcon />
                Full {client.name} setup
              </a>
            </Button>
          )}
          {client.transport === "bridge" && (
            <span className="text-muted-foreground text-xs">Needs Node.js for the stdio bridge</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- guides */

function SnippetHeading({ children }: { children: ReactNode }) {
  return <p className="label-caps text-muted-foreground mb-1.5">{children}</p>;
}

export function McpClientGuide({ client }: { client: McpClient }) {
  return (
    <article className="min-w-0 space-y-5" aria-labelledby={`client-${client.id}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`client-${client.id}`} className="font-heading text-lg font-semibold tracking-tight">
          {client.name}
        </h3>
        <span className="text-muted-foreground text-xs">
          {client.vendor}
          {client.formerly && <> · formerly {client.formerly}</>}
          {" · "}
          {client.transport === "http" ? "connects over HTTP directly" : "connects through a stdio bridge"}
        </span>
      </header>

      <ol className="marker:text-muted-foreground ml-4 list-decimal space-y-2 text-sm leading-relaxed">
        {client.steps.map((step) => (
          <li key={step} className="pl-1">
            <InlineCode text={step} />
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        <div className="min-w-0">
          <CopyBlock
            code={client.quick.code}
            language={client.quick.language}
            label={client.quick.label}
          />
          {client.install && (
            <div className="mt-2">
              <InstallButton client={client} />
            </div>
          )}
        </div>
        {client.extra?.map((snippet) => (
          <div key={snippet.label} className="min-w-0">
            <SnippetHeading>{snippet.label.replace(/^Copy the /, "Or: the ")}</SnippetHeading>
            <CopyBlock code={snippet.code} language={snippet.language} label={snippet.label} />
          </div>
        ))}
      </div>

      {client.configPaths && client.configPaths.length > 0 && (
        <div>
          <SnippetHeading>Where the config lives</SnippetHeading>
          <dl className="divide-border/70 divide-y rounded-lg border text-sm">
            {client.configPaths.map((row) => (
              <div
                key={row.label}
                className="flex min-w-0 flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-4"
              >
                <dt className="text-muted-foreground shrink-0 sm:w-56">{row.label}</dt>
                <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere] sm:pt-0.5">
                  {row.path}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div>
        <SnippetHeading>Check it worked</SnippetHeading>
        <p className="text-sm leading-relaxed">
          <InlineCode text={client.verify} />
        </p>
      </div>

      {client.caveats?.map((caveat) => (
        <Note key={caveat}>
          <InlineCode text={caveat} />
        </Note>
      ))}

      <a
        href={client.docs}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
      >
        {client.vendor === "MCP" ? "The MCP client list" : `${client.name}'s MCP docs`}
        <ArrowUpRightIcon className="size-3" />
      </a>
    </article>
  );
}

export function McpClientGuides({
  clients,
  value,
  onChange,
  className,
}: {
  clients: McpClient[];
  value?: string;
  onChange?: (id: string) => void;
  className?: string;
}) {
  const { client, setOwn } = useClient(clients, value);
  const change = onChange ?? setOwn;
  if (!client) return null;

  return (
    <div className={cn("min-w-0 space-y-6", className)}>
      <McpClientPicker clients={clients} value={client.id} onChange={change} />
      <div className="border-border/70 rounded-2xl border p-4 sm:p-6">
        <McpClientGuide client={client} />
      </div>
    </div>
  );
}
