/**
 * `/blog` — every post, newest first.
 *
 * Laid out like most blogs a reader already knows: the newest post as a wide
 * featured card, then the rest as a grid of cards, each led by the post's
 * cover image (the 1200x630 `image` from its frontmatter, the same picture
 * the social card uses). Every card carries its date, an estimated reading
 * time and its tags, and says so when the post can be listened to.
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
import { ArrowUpRightIcon, HeadphonesIcon } from "lucide-react";

import { SeoHead } from "@/components/seo-head";
import { assetUrl } from "@/lib/asset-url";
import { cn } from "@/lib/utils";

import { BLOG_POSTS, BLOG_TAGS, type BlogPost } from "../blog/posts";

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

/** Minutes to read, from the rendered post at about 230 words a minute. */
function readingMinutes(html: string): number {
  const words = html
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** The cover, or a quiet tile with the title's initial if a post has none. */
function Cover({ post, className }: { post: BlogPost; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn("bg-muted relative overflow-hidden", className)}>
      {post.image && !failed ? (
        <img
          src={assetUrl(post.image)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex size-full items-center justify-center"
        >
          <span className="font-display text-muted-foreground text-6xl font-extrabold">
            {post.title.slice(0, 1)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Date, reading time and the listen marker, in the mono label voice. */
function Meta({ post }: { post: BlogPost }) {
  return (
    <p className="label-caps text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
      <time dateTime={post.date}>{formatDate(post.date)}</time>
      <span aria-hidden="true">·</span>
      <span>{readingMinutes(post.html)} min read</span>
      {post.audio ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-foreground inline-flex items-center gap-1">
            <HeadphonesIcon className="size-3" aria-hidden="true" />
            Listen
          </span>
        </>
      ) : null}
      {post.draft ? (
        <span className="bg-warn/15 text-warn rounded-sm px-1.5 font-semibold">
          Draft
        </span>
      ) : null}
    </p>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <p className="mt-4 flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="border-border text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[11px]"
        >
          {t}
        </span>
      ))}
    </p>
  );
}

/** The newest post, wide: cover on one side, the pitch on the other. */
function FeaturedCard({ post }: { post: BlogPost }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group border-border hover:border-border-strong bg-card focus-visible:ring-ring/50 grid overflow-hidden rounded-md border outline-none transition-colors focus-visible:ring-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
    >
      <Cover post={post} className="aspect-[1200/630] md:self-center" />
      <div className="flex flex-col p-6 sm:p-8">
        <p className="label-caps text-foreground">Latest</p>
        <h2 className="mt-4 text-4xl leading-[0.92] text-balance uppercase sm:text-5xl">
          {post.title}
        </h2>
        <p className="text-muted-foreground mt-4 leading-relaxed text-pretty">
          {post.description}
        </p>
        <div className="mt-auto pt-8">
          <Meta post={post} />
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 group-hover:underline">
            Read the post
            <ArrowUpRightIcon
              className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
    </Link>
  );
}

function PostCard({ post }: { post: BlogPost }) {
  return (
    <li className="min-w-0">
      <Link
        to={`/blog/${post.slug}`}
        className="group focus-visible:ring-ring/50 flex h-full flex-col rounded-md outline-none focus-visible:ring-3"
      >
        <Cover
          post={post}
          className="border-border group-hover:border-border-strong aspect-[1200/630] rounded-md border transition-colors"
        />
        <div className="flex flex-1 flex-col pt-4">
          <Meta post={post} />
          <h3 className="mt-2.5 text-lg leading-snug font-semibold tracking-tight text-balance underline-offset-4 group-hover:underline">
            {post.title}
          </h3>
          <p className="text-muted-foreground mt-2 line-clamp-3 text-sm leading-relaxed">
            {post.description}
          </p>
          <Tags tags={post.tags} />
        </div>
      </Link>
    </li>
  );
}

export function BlogIndexPage() {
  const [tag, setTag] = useState<string | null>(null);
  const posts = tag
    ? BLOG_POSTS.filter((p) => p.tags.includes(tag))
    : BLOG_POSTS;
  // The featured slot belongs to the newest post only when nothing is filtered;
  // a filtered view is a plain grid, so the cards keep their order.
  const lead = tag ? undefined : posts[0];
  const rest = lead ? posts.slice(1) : posts;

  return (
    <>
      <SeoHead
        title="Blog | Soundbox"
        description="How Soundbox is built, how the models behave, and how to get better sound out of them."
        path="/blog"
      />
      <div className="mx-auto w-full max-w-6xl px-4 pt-12 pb-24 sm:pt-16">
        <header className="border-border flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b pb-8">
          <div>
            <p className="label-caps text-muted-foreground">Blog</p>
            <h1 className="mt-3 text-[clamp(3rem,8vw,6rem)] leading-[0.88] uppercase">
              Notes from the studio
            </h1>
          </div>
          <p className="text-muted-foreground max-w-sm leading-relaxed text-pretty">
            Notes on the engine, the models and how to prompt them.
          </p>
        </header>

        {BLOG_TAGS.length > 0 && (
          <div
            className="mt-6 flex flex-wrap gap-2"
            role="group"
            aria-label="Filter by tag"
          >
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
          <p className="text-muted-foreground mt-10">Nothing here yet.</p>
        ) : (
          <>
            {lead ? (
              <div className="mt-8">
                <FeaturedCard post={lead} />
              </div>
            ) : null}
            {rest.length > 0 ? (
              <ul className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((post) => (
                  <PostCard key={post.slug} post={post} />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
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
        "focus-visible:ring-ring/50 rounded-sm border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3",
        active
          ? "bg-foreground text-background border-foreground"
          : "border-border text-muted-foreground hover:text-foreground hover:border-border-strong",
      )}
    >
      {children}
    </button>
  );
}
