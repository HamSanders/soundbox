/**
 * Per-route document head: title, description, canonical, Open Graph, JSON-LD.
 *
 * This writes directly to `document` rather than pulling in a helmet library —
 * there is exactly one consumer (the `/sfx` pages), the API surface needed is
 * four tags, and a dependency for that would be hard to justify.
 *
 * It is a *client-side* head, which on its own is worth very little for SEO.
 * It becomes worth something under the site's prerender step: the crawler loads each route in a real browser, lets
 * this effect run, and serialises the resulting DOM to a static .html file. So
 * the tags below are what ends up in the shipped markup — but only because
 * something snapshots them, never because a crawler waited for React.
 *
 * Tags are keyed with `data-seo-head` so that navigating between routes
 * replaces them instead of stacking duplicates.
 */

import { useEffect } from "react";

import { pageUrl, siteUrl } from "@/lib/asset-url";

const MARK = "data-seo-head";

/*
 * Absolute URLs for canonical and og:url come from `siteUrl` (origin from
 * VITE_SITE_ORIGIN, plus the deploy's base path). Deliberately not hardcoded:
 * the app is served from 127.0.0.1 by the local backend, so inventing a domain
 * would put a wrong canonical into the markup. With the variable unset the
 * canonical and og:url tags are simply omitted.
 */

export interface SeoHeadProps {
  title: string;
  description: string;
  /** Absolute path, e.g. "/sfx/8bit". Combined with VITE_SITE_ORIGIN. */
  path: string;
  /** schema.org objects, serialised into one or more JSON-LD script tags. */
  jsonLd?: object[];
  /**
   * Share-card image and its alt text. Only the site's override
   * (site/src/seo-head.tsx) emits these; the app has no pages worth sharing,
   * so here they are accepted and ignored.
   */
  image?: string;
  imageAlt?: string;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute(MARK, "");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function SeoHead({ title, description, path, jsonLd }: SeoHeadProps) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("name", "twitter:card", "summary_large_image");

    const url = pageUrl(path);
    let canonical: HTMLLinkElement | null = null;
    if (url) {
      upsertMeta("property", "og:url", url);
      canonical =
        document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? null;
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        canonical.setAttribute(MARK, "");
        document.head.appendChild(canonical);
      }
      canonical.href = url;
    }

    const scripts = (jsonLd ?? []).map((obj) => {
      const el = document.createElement("script");
      el.type = "application/ld+json";
      el.setAttribute(MARK, "");
      el.textContent = JSON.stringify(obj);
      document.head.appendChild(el);
      return el;
    });

    return () => {
      document.title = previousTitle;
      for (const s of scripts) s.remove();
    };
  }, [title, description, path, jsonLd]);

  return null;
}

/** `FAQPage` for the question list a category page renders. */
export function faqJsonLd(faqs: { question: string; answer: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

/** `BreadcrumbList` for Sound effects → <category>. */
export function breadcrumbJsonLd(
  trail: { name: string; path: string }[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      ...(pageUrl(t.path) ? { item: pageUrl(t.path) } : {}),
    })),
  };
}

/**
 * `SoftwareApplication` for Konchi itself, on the home page and /studio.
 *
 * No `aggregateRating`: there are no ratings to cite, and inventing one is the
 * fastest way to get a rich result revoked. Without it Google will not show a
 * software rich result, but the entity still ties the download, licence and
 * repository together. `codeRepository` belongs to `SoftwareSourceCode`;
 * unknown properties are ignored rather than rejected, so it is harmless here.
 */
export function softwareAppJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Konchi",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Windows 10, Windows 11, macOS",
    softwareVersion: "0.1.0",
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    downloadUrl: "https://github.com/HamSanders/soundbox/releases/latest",
    codeRepository: "https://github.com/HamSanders/soundbox",
    description:
      "Generates sound effects, music and speech on your own machine from open-weight models, with an HTTP API and an MCP server for coding agents.",
    ...(siteUrl("/product/studio.png") ? { screenshot: siteUrl("/product/studio.png") } : {}),
    ...(pageUrl("/") ? { url: pageUrl("/") } : {}),
  };
}
