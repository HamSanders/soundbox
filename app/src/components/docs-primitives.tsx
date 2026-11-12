/**
 * Small building blocks shared by the API and MCP reference sections.
 *
 * These exist because the Developers page is long-form documentation rendered
 * as components rather than markdown: no markdown runtime, no syntax
 * highlighter, no extra dependency for something that is ultimately a `<pre>`
 * with a copy button and a handful of typographic rules applied consistently.
 *
 * Two constraints shape most of what is here:
 *
 *  - **Nothing may widen the page.** Code, endpoint paths and JSON examples are
 *    all arbitrarily long strings inside a flex/grid layout, where the default
 *    `min-width: auto` makes a child refuse to shrink and pushes the whole
 *    document sideways. Every scrollable box below therefore sits on `min-w-0`
 *    and scrolls inside itself.
 *  - **The app uses HashRouter.** A plain `<a href="#endpoints">` would replace
 *    the route hash and bounce the user to Generate. In-page navigation is
 *    buttons calling `scrollIntoView`, which is also why headings carry
 *    `scroll-mt` for the sticky app header.
 */

import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Sticky-header clearance for anything scrolled to by the in-page index. */
export const SCROLL_MT = "scroll-mt-20";

/* ------------------------------------------------------------------ copy */

export function CopyButton({
  value,
  label,
  className,
  children,
}: {
  value: string;
  /** Accessible name — say *what* is copied, since a page this long has many. */
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={children ? "xs" : "icon-sm"}
      className={className}
      aria-label={children ? undefined : label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {
            /* clipboard denied — the text is selectable in the block itself */
          },
        );
      }}
    >
      {copied ? (
        <CheckIcon className="text-green-600 dark:text-green-500" />
      ) : (
        <CopyIcon />
      )}
      {children}
      <span className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}

/**
 * A code block that scrolls horizontally inside its own border.
 *
 * `min-w-0` on the wrapper is load-bearing: without it a long curl line stops
 * the grid column from shrinking and the whole page gains a horizontal
 * scrollbar at 375px.
 */
export function CopyBlock({
  code,
  language = "bash",
  label,
  className,
}: {
  code: string;
  language?: string;
  /** What the copy button says it copies. Defaults to the language. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("group relative min-w-0", className)}>
      <pre
        className="bg-muted/60 min-w-0 overflow-x-auto rounded-lg border p-3 pr-11 font-mono text-xs leading-relaxed"
        data-language={language}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
      <CopyButton
        value={code}
        label={label ?? `Copy ${language} snippet`}
        className="absolute top-1.5 right-1.5"
      />
    </div>
  );
}

/** Inline code, sized to sit on a prose line without shifting the baseline. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="bg-muted/70 text-foreground/85 rounded px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  );
}

/* -------------------------------------------------------------- sections */

/**
 * A top-level documentation section. The heading is the scroll target and the
 * label the in-page index shows, so `id` and `title` are the single source for
 * both — the index is built from the same list that renders these.
 */
export function DocSection({
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
    <section id={id} aria-labelledby={`${id}-heading`} className="min-w-0">
      <h2
        id={`${id}-heading`}
        className={cn("font-heading text-lg font-semibold tracking-tight", SCROLL_MT)}
      >
        {title}
      </h2>
      {intro ? <div className="text-muted-foreground mt-1 text-sm">{intro}</div> : null}
      <div className="mt-4 min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/** A subsection heading — h3, so the outline stays h1 → h2 → h3. */
export function DocSubsection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="min-w-0">
      <h3
        id={`${id}-heading`}
        className={cn(
"label-caps text-muted-foreground",
          SCROLL_MT,
        )}
      >
        {title}
      </h3>
      <div className="mt-3 min-w-0 space-y-3">{children}</div>
    </section>
  );
}

/** A short aside — the thing that bites people, called out but not shouted. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="border-primary/40 text-muted-foreground border-l-2 py-0.5 pl-3 text-xs leading-relaxed">
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------- fields */

export interface FieldRow {
  name: string;
  type: string;
  required?: boolean;
  default?: string | null;
  constraints?: string | null;
  note?: ReactNode;
}

/**
 * Parameter / field list.
 *
 * Deliberately not a `<table>`: a real table with four columns cannot survive
 * 375px without either truncating type names or scrolling the page. Each field
 * is a wrapping row instead, which reads the same at every width. It is still
 * a description list semantically, so a screen reader gets name→details pairs.
 */
export function FieldList({ fields }: { fields: FieldRow[] }) {
  if (fields.length === 0) return null;
  return (
    <dl className="min-w-0 divide-y rounded-lg border">
      {fields.map((f) => (
        <div key={f.name} className="min-w-0 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt className="font-mono text-xs font-medium break-all">{f.name}</dt>
            <dd className="text-muted-foreground font-mono text-xs break-all">{f.type}</dd>
            {f.required ? (
              <dd className="label-caps text-primary">
                required
              </dd>
            ) : null}
            {f.default != null && f.default !== "null" ? (
              <dd className="text-muted-foreground text-[0.7rem]">
                default <span className="font-mono">{f.default}</span>
              </dd>
            ) : null}
            {f.constraints ? (
              <dd className="text-muted-foreground text-[0.7rem]">{f.constraints}</dd>
            ) : null}
          </div>
          {f.note ? (
            <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">{f.note}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/* --------------------------------------------------------------- details */

/**
 * Disclosure built on native `<details>`.
 *
 * Radix has no accordion in this project and adding one would buy nothing here:
 * `<details>` is keyboard-operable, announced as an expandable group, works
 * before hydration and costs no bytes. The only work is hiding the platform
 * marker and drawing our own focus ring, since `<summary>` has no default one
 * in every browser.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={cn("group min-w-0", className)} open={defaultOpen}>
      <summary
        className={cn(
          "focus-visible:ring-ring/50 focus-visible:border-ring hover:bg-muted/50 flex cursor-pointer",
          "list-none rounded-lg border border-transparent px-3 py-2 outline-none",
          "focus-visible:ring-3 [&::-webkit-details-marker]:hidden",
        )}
      >
        {summary}
      </summary>
      <div className="mt-2 min-w-0 space-y-3 px-3 pb-3">{children}</div>
    </details>
  );
}
