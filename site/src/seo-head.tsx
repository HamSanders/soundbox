/**
 * Site-target override of `@/components/seo-head`.
 *
 * The app build's `SeoHead` writes tags via a `useEffect`, which is fine for
 * the in-app SPA but produces nothing during SSR — an effect never runs on
 * the server, so a static build using that component would ship `<head>`
 * with no title, no description, no JSON-LD, defeating the entire point of
 * this target. `site/vite.config.ts` aliases `@/components/seo-head` to this
 * file instead, so pages here get real tags in the pre-rendered HTML via
 * vite-react-ssg's `<Head>` (a react-helmet wrapper that *does* run on the
 * server). `faqJsonLd`/`breadcrumbJsonLd` are pure functions with no
 * head-writing in them, so they're re-exported from the app's file unchanged.
 */

import { Head } from "vite-react-ssg";

import { pageUrl, siteUrl } from "@/lib/asset-url";

export { faqJsonLd, breadcrumbJsonLd, softwareAppJsonLd } from "@sfx-app/components/seo-head";

/**
 * The card every page shares unless it names its own: the studio screenshot
 * with the name and one line on it, 1200x630. Without an image the
 * `summary_large_image` card renders as bare text, or not at all.
 */
export const DEFAULT_OG_IMAGE = "/og/default.jpg";
const DEFAULT_OG_IMAGE_ALT =
  "Konchi: the free local alternative to ElevenLabs and Suno, for sound effects, music and voices";

export interface SeoHeadProps {
  title: string;
  description: string;
  /** Absolute path, e.g. "/sfx/8bit". Combined with VITE_SITE_ORIGIN. */
  path: string;
  jsonLd?: object[];
  /**
   * Root-relative, e.g. "/blog/why-audio-cpp.jpg". 1200x630.
   *
   * Emitted only when VITE_SITE_ORIGIN is set. Every scraper ignores a
   * relative og:image, so a half-configured build should ship no tag at all
   * rather than one that resolves to nothing — the same reason the canonical
   * link below is conditional. Defaults to `DEFAULT_OG_IMAGE`.
   */
  image?: string;
  /** Alt text for the share card. Defaults to the site line when `image` is the default. */
  imageAlt?: string;
  /** "website" unless this page is one article, which is to say a post. */
  type?: "website" | "article";
  /** Set on a blog post. Dates are YYYY-MM-DD. */
  article?: {
    publishedTime: string;
    modifiedTime?: string;
    author?: string;
    tags?: string[];
  };
}

export function SeoHead({
  title,
  description,
  path,
  jsonLd,
  image = DEFAULT_OG_IMAGE,
  imageAlt,
  type = "website",
  article,
}: SeoHeadProps) {
  // Origin + deploy base + path, with the trailing slash the host serves the
  // page at (a slashless canonical points at a 301); empty without
  // VITE_SITE_ORIGIN.
  const url = pageUrl(path);
  const alt = imageAlt ?? (image === DEFAULT_OG_IMAGE ? DEFAULT_OG_IMAGE_ALT : undefined);
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content="Konchi" />
      <meta name="twitter:card" content="summary_large_image" />
      {url && <meta property="og:url" content={url} />}
      {url && <link rel="canonical" href={url} />}
      {url && image && <meta property="og:image" content={siteUrl(image)} />}
      {url && image && <meta name="twitter:image" content={siteUrl(image)} />}
      {url && image && alt && <meta property="og:image:alt" content={alt} />}
      {url && image && alt && <meta name="twitter:image:alt" content={alt} />}
      {article && <meta property="article:published_time" content={article.publishedTime} />}
      {article?.modifiedTime && (
        <meta property="article:modified_time" content={article.modifiedTime} />
      )}
      {article?.author && <meta property="article:author" content={article.author} />}
      {(article?.tags ?? []).map((tag) => (
        <meta key={tag} property="article:tag" content={tag} />
      ))}
      {/*
        * JSON-LD as script *children*, not `dangerouslySetInnerHTML`.
        *
        * `Head` here is react-helmet-async, which builds its tags from a
        * declared props/children shape rather than by rendering the
        * elements you hand it. It has no support for
        * `dangerouslySetInnerHTML` on a script, so the previous form
        * emitted an empty tag — in practice no tag at all, because the
        * script had no content. Every jsonLd on the site was being
        * dropped silently: the `faqJsonLd`/`breadcrumbJsonLd` helpers ran,
        * the objects were built, and nothing reached the HTML.
        *
        * `<` is escaped because these strings are prose (FAQ answers), and
        * a literal `</script>` inside one would otherwise close the tag
        * early. JSON.stringify does not escape it for us.
        */}
      {(jsonLd ?? []).map((obj, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(obj).replace(/</g, "\\u003c")}
        </script>
      ))}
    </Head>
  );
}
