/**
 * `/blog/<slug>` — one post.
 *
 * Drafts never reach here in a production build: `BLOG_POSTS` has already
 * dropped them, so `getStaticPaths` emits no file and the host returns a real
 * 404 rather than a page apologising for itself.
 */

import { Link, Navigate, useParams } from "react-router-dom";

import { SeoHead } from "@/components/seo-head";

import { BLOG_POSTS, postBySlug } from "../blog/posts";
import { BlogShell } from "../blog/shell";
import { REPO_URL } from "@/lib/marketing-links";
import { assetUrl } from "@/lib/asset-url";

/**
 * Live components a post can have, by slug.
 *
 * The same trick `routes/doc.tsx` plays for the docs, and for the same
 * reason: markdown cannot hold a React component, and the alternative is a
 * screenshot that goes stale and cannot re-theme itself. `after` says where
 * it lands — "lede" is directly under the header, before the prose.
 */
const ISLANDS: Record<string, { after: "lede"; node: React.ReactNode }> = {};

const REPO_BLOB = `${REPO_URL}/blob/main/site/content/blog`;

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function BlogPostPage() {
  const { slug } = useParams();
  const post = postBySlug(slug);
  if (!post) return <Navigate to="/blog" replace />;

  const island = ISLANDS[post.slug];
  const index = BLOG_POSTS.findIndex((p) => p.slug === post.slug);
  const newer = index > 0 ? BLOG_POSTS[index - 1] : null;
  const older = index < BLOG_POSTS.length - 1 ? BLOG_POSTS[index + 1] : null;

  return (
    <>
      <SeoHead
        title={`${post.title} | Konchi`}
        description={post.description}
        path={`/blog/${post.slug}`}
        type="article"
        image={post.image}
        article={{
          publishedTime: post.date,
          modifiedTime: post.updated,
          author: post.author,
          tags: post.tags,
        }}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            ...(post.updated ? { dateModified: post.updated } : {}),
            author: { "@type": "Person", name: post.author },
          },
        ]}
      />
      <BlogShell headings={post.headings}>
        <article>
          <header className="mb-10">
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span aria-hidden>·</span>
              <span>{post.author}</span>
              {post.draft && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                  Draft
                </span>
              )}
            </p>
            <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {post.title}
            </h1>
            <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed text-pretty sm:text-lg">
              {post.description}
            </p>
            {post.updated && (
              <p className="text-muted-foreground mt-2 text-xs">
                Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time>
              </p>
            )}
          </header>

          {post.audio && (
            <figure className="border-border/70 bg-card/40 mb-8 rounded-2xl border p-4">
              {/* A plain <audio> element on purpose. The app's waveform player
                  is a real editing surface with a backend behind it; a reader
                  who wants to listen to a post wants a play button that works
                  before any JavaScript has run. */}
              <audio controls preload="none" src={assetUrl(post.audio)} className="w-full">
                Your browser cannot play audio inline.{" "}
                <a href={assetUrl(post.audio)}>Download the recording</a> instead.
              </audio>
              <figcaption className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
                Read aloud by Konchi with a synthetic voice, on the machine that
                wrote it.
              </figcaption>
            </figure>
          )}

          {island?.after === "lede" && island.node}

          {post.image && (
            // Decorative: the plate says nothing the headline has not, so alt is
            // empty rather than a description a screen reader has to sit through.
            <img
              src={assetUrl(post.image)}
              alt=""
              className="border-border/70 mb-10 w-full rounded-2xl border object-cover"
              loading="eager"
            />
          )}

          <div className="konchi-doc" dangerouslySetInnerHTML={{ __html: post.html }} />

          <footer className="border-border/70 mt-16 border-t pt-6">
            <div className="flex flex-wrap justify-between gap-4 text-sm">
              {newer ? (
                <Link to={`/blog/${newer.slug}`} className="text-muted-foreground hover:text-foreground">
                  ← {newer.title}
                </Link>
              ) : (
                <span />
              )}
              {older && (
                <Link to={`/blog/${older.slug}`} className="text-muted-foreground hover:text-foreground">
                  {older.title} →
                </Link>
              )}
            </div>
            <p className="text-muted-foreground mt-6 text-xs">
              <a
                href={`${REPO_BLOB}/${post.slug}.md`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground"
              >
                Edit this post on GitHub
              </a>
            </p>
          </footer>
        </article>
      </BlogShell>
    </>
  );
}
