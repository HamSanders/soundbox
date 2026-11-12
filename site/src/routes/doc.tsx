/**
 * `/docs/:slug` — one documentation page, rendered from the markdown in
 * `docs/`.
 *
 * The HTML arrives as a string that the build already produced (see
 * `plugins/markdown.ts`), so this component's whole job is the furniture
 * around it: the title, the shell, and the way out at the bottom. Nothing here
 * runs on the client except the contents column's scroll spy — the page itself
 * is in the static file, which is what a crawler and a reader with a slow
 * connection both want.
 *
 * Islands — a real timeline, a real device — are placed by slug rather than
 * written into the markdown, so the docs stay readable as plain files on
 * GitHub. See `ISLANDS` below.
 */

import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRightIcon, PencilIcon } from "lucide-react";

import { SeoHead } from "@/components/seo-head";
import { DocsShell } from "../docs/shell";
import { DOC_PAGES, docBySlug, type DocPage } from "../docs/pages";
import { SignalChain } from "../docs/islands/signal-chain";

const GITHUB_EDIT = "https://github.com/HamSanders/soundbox/blob/main/docs";

/** Which live component sits under which page, and the file it is spliced
 *  into. Keyed by slug so the markdown never has to know it is on a website. */
const ISLANDS: Record<string, { after: string; node: React.ReactNode }> = {
  audiocpp: { after: "top", node: <SignalChain /> },
};

function DocBody({ page }: { page: DocPage }) {
  const index = DOC_PAGES.findIndex((p) => p.slug === page.slug);
  const previous = DOC_PAGES[index - 1];
  const next = DOC_PAGES[index + 1];
  const island = ISLANDS[page.slug];

  return (
    <>
      <SeoHead
        title={`${page.metaTitle ?? page.title} | Soundbox docs`}
        description={page.description ?? page.blurb}
        path={`/docs/${page.slug}`}
      />

      <article>
        {/* The same three-part header the marketing pages open with — teal
            eyebrow, display title, one line of lede — so crossing from
            /welcome into /docs does not feel like leaving the site. */}
        <header className="mb-10">
          <p className="label-caps text-primary">
            {page.section}
          </p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {page.title}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
            {page.blurb}
          </p>
        </header>

        {island?.after === "top" && <div className="mb-10">{island.node}</div>}

        {/* The document itself. `soundbox-doc` carries the prose styling —
            see index.css — because the HTML comes from markdown and cannot
            carry classes of its own. */}
        <div className="soundbox-doc" dangerouslySetInnerHTML={{ __html: page.html }} />
      </article>

      <footer className="border-border/60 mt-12 border-t pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {previous ? (
            <Link
              to={`/docs/${previous.slug}`}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              ← {previous.label}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              to={`/docs/${next.slug}`}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              {next.label} <ArrowRightIcon className="size-3.5" />
            </Link>
          )}
        </div>
        <a
          href={`${GITHUB_EDIT}/${page.slug.toUpperCase()}.md`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5 text-xs"
        >
          <PencilIcon className="size-3" />
          Edit {page.slug.toUpperCase()}.md on GitHub
        </a>
      </footer>
    </>
  );
}

export function DocPageRoute() {
  const { slug } = useParams();
  const page = docBySlug(slug ?? "");
  if (!page) return <Navigate to="/docs" replace />;
  return (
    <div className="bg-background text-foreground min-h-svh">
      <DocsShell current={page.slug} page={page}>
        <DocBody page={page} />
      </DocsShell>
    </div>
  );
}
