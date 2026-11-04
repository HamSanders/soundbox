/**
 * `/blog` — every post, newest first.
 *
 * Tags filter in the browser rather than at `/blog/tag/<tag>`. With a handful
 * of posts each archive page would be one or two cards, which is the thin page
 * `isPublished` exists to keep off `/sfx`; and because `includeAllRoutes` is
 * false, a renamed tag would turn every link to its archive into a hard 404.
 * When there are enough posts to justify it the upgrade is a `getStaticPaths`
 * over `BLOG_TAGS`. Search already covers discovery — Pagefind indexes the
 * whole site.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon } from "lucide-react";

import { SeoHead } from "@/components/seo-head";
import { cn } from "@/lib/utils";

import { BLOG_POSTS, BLOG_TAGS } from "../blog/posts";
import { BlogShell } from "../blog/shell";

function formatDate(date: string): string {
  // Parsed as UTC on purpose: `new Date("2026-08-25")` is midnight UTC, and
  // rendering it in a western timezone would print the 24th.
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function BlogIndexPage() {
  const [tag, setTag] = useState<string | null>(null);
  const posts = tag ? BLOG_POSTS.filter((p) => p.tags.includes(tag)) : BLOG_POSTS;

  return (
    <>
      <SeoHead
        title="Blog | Konchi"
        description="How Konchi is built, how the models behave, and how to get better sound out of them."
        path="/blog"
      />
      <BlogShell>
        <header className="mb-10">
          <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">Blog</p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Konchi blog
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
            Notes on the engine, the models and how to prompt them.
          </p>
        </header>

        {BLOG_TAGS.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <TagChip active={tag === null} onClick={() => setTag(null)}>
              All
            </TagChip>
            {BLOG_TAGS.map((t) => (
              <TagChip key={t} active={tag === t} onClick={() => setTag(t)}>
                {t}
              </TagChip>
            ))}
          </div>
        )}

        {posts.length === 0 ? (
          <p className="text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="space-y-4">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  to={`/blog/${post.slug}`}
                  className="border-border/70 hover:border-primary/50 hover:bg-card group block rounded-2xl border p-4 transition-colors"
                >
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    <time dateTime={post.date}>{formatDate(post.date)}</time>
                    {post.draft && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                        Draft
                      </span>
                    )}
                  </span>
                  <span className="font-heading mt-1.5 flex items-center gap-1.5 font-semibold tracking-tight">
                    {post.title}
                    <ArrowRightIcon className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="text-muted-foreground mt-1.5 block text-sm leading-relaxed">
                    {post.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </BlogShell>
    </>
  );
}

function TagChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-primary/60 bg-primary/10 text-foreground font-medium"
          : "border-border/70 text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      {children}
    </button>
  );
}
