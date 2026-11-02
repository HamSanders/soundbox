import type { RouteRecord } from "vite-react-ssg";

import { Layout } from "./layout";
import { DocsPage } from "./routes/docs";
import { DocsIndexPage } from "./routes/docs-index";
import { DocPageRoute } from "./routes/doc";
import { BlogIndexPage } from "./routes/blog-index";
import { BlogPostPage } from "./routes/blog-post";
import { McpPage } from "./routes/mcp";
import { PressPage } from "./routes/press";
import { DownloadPage } from "./routes/download";
import { DOC_PAGES } from "./docs/pages";
import { BLOG_POSTS } from "./blog/posts";
import { SfxHubPage } from "@/routes/sfx/hub";
import { WelcomePage } from "@/routes/welcome";
import { MusicHubPage } from "@/routes/music/hub";
import { MusicTrackPage } from "@/routes/music/track";
import { SfxCategoryPage } from "@/routes/sfx/category";
import { SfxSamplePage } from "@/routes/sfx/sample";
import { StudioMarketingPage } from "@/routes/studio-marketing";
import { VoicesPage } from "@/routes/voices";
import { ModelsHubPage } from "@/routes/models-hub";
import { ModelsDetailPage } from "@/routes/models-detail";
import { SFX_CATEGORIES } from "@/content/sfx/categories";
import { isPublished } from "@/content/sfx/types";
import { MODELS } from "@/content/models/models";
import { MUSIC_TRACKS } from "@/content/music/tracks";

const publishedCategories = SFX_CATEGORIES.filter(isPublished);
const publishedSlugs = publishedCategories.map((c) => c.slug);
const sampleStaticPaths = publishedCategories.flatMap((c) =>
  c.content.samples.map((s) => `sfx/${c.slug}/${s.slug}`),
);
const modelSlugs = MODELS.map((e) => e.slug);

export const routes: RouteRecord[] = [
  {
    path: "/",
    Component: Layout,
    entry: "src/layout.tsx",
    children: [
      {
        // The front door. This used to redirect to /sfx because the landing
        // page only existed inside the app; it now lives here instead, and the
        // app has no marketing routes at all (see app/src/App.tsx).
        index: true,
        Component: WelcomePage,
        entry: "../app/src/routes/welcome.tsx",
      },
      {
        path: "sfx",
        Component: SfxHubPage,
        entry: "../app/src/routes/sfx/hub.tsx",
      },
      {
        path: "sfx/:slug",
        Component: SfxCategoryPage,
        entry: "../app/src/routes/sfx/category.tsx",
        // Only prerender categories that actually have content — an
        // unpublished slug still resolves client-side (SfxCategoryPage
        // redirects to /sfx), it just isn't a page the crawler is handed.
        getStaticPaths: () => publishedSlugs.map((slug) => `sfx/${slug}`),
      },
      {
        path: "sfx/:slug/:sample",
        Component: SfxSamplePage,
        entry: "../app/src/routes/sfx/sample.tsx",
        getStaticPaths: () => sampleStaticPaths,
      },
      {
        // The music landing page: one route, twelve tracks, no dynamic
        // children — everything it shows is on the page itself.
        path: "music",
        Component: MusicHubPage,
        entry: "../app/src/routes/music/hub.tsx",
      },
      {
        path: "music/:slug",
        Component: MusicTrackPage,
        entry: "../app/src/routes/music/track.tsx",
        // Every track is written up, so all of them are prerendered. An
        // unknown slug gets no file, which is a real 404 from the host.
        getStaticPaths: () => MUSIC_TRACKS.map((t) => `music/${t.slug}`),
      },
      {
        // The studio pitch, which used to be four sections of the landing
        // page. No children and no `getStaticPaths` — it is one page, and
        // everything it shows is rendered from the components themselves.
        //
        // Lives in `studio-marketing.tsx`, not `studio.tsx` — that filename
        // now belongs to the app's real in-app builder route (StudioPage,
        // mounted at /studio in App.tsx), which was built independently and
        // landed on `main` while this page was in flight on a branch. Same
        // name, two different components for two different build targets;
        // the marketing page took the rename since the app route is the one
        // other app code imports by that name.
        path: "studio",
        Component: StudioMarketingPage,
        entry: "../app/src/routes/studio-marketing.tsx",
      },
      {
        // The voice pitch: one-off reads, stories with per-speaker lines, the
        // Voice Lab, and the honest state of the voice catalog. Like /studio,
        // one page with nothing dynamic under it.
        path: "voices",
        Component: VoicesPage,
        entry: "../app/src/routes/voices.tsx",
      },
      {
        // Marketing content about the five models Soundbox runs locally.
        // Not to be confused with the app's own /models route (the
        // download/load-into-VRAM management screen) — see models-hub.tsx.
        path: "models",
        Component: ModelsHubPage,
        entry: "../app/src/routes/models-hub.tsx",
      },
      {
        path: "models/:slug",
        Component: ModelsDetailPage,
        entry: "../app/src/routes/models-detail.tsx",
        // All five models are fully written up, unlike the sfx taxonomy's
        // stub/backlog split — there's no reason to half-ship this.
        getStaticPaths: () => modelSlugs.map((slug) => `models/${slug}`),
      },
      {
        // The marketing entry point for the MCP server. The reference lives at
        // /docs/mcp; this is the page that argues for connecting at all.
        // Static — nothing about it varies, so no getStaticPaths.
        path: "mcp",
        Component: McpPage,
        entry: "src/routes/mcp.tsx",
      },
      {
        // The press kit: quotable copy, a fact sheet and direct downloads for
        // the films, screenshots and mark. Static, one page.
        path: "press",
        Component: PressPage,
        entry: "src/routes/press.tsx",
      },
      {
        path: "download",
        Component: DownloadPage,
        entry: "src/routes/download.tsx",
      },
      {
        path: "blog/:slug",
        Component: BlogPostPage,
        entry: "src/routes/blog-post.tsx",
        // Mandatory: `includeAllRoutes` is false, so a dynamic path with no
        // `getStaticPaths` emits no file — and a page that was never written
        // is a page Pagefind cannot index.
        getStaticPaths: () => BLOG_POSTS.map((post) => `blog/${post.slug}`),
      },
      {
        path: "blog",
        Component: BlogIndexPage,
        entry: "src/routes/blog-index.tsx",
      },
      {
        // One page per file in `docs/`. Prerendered like everything else, so
        // each is a real HTML document a crawler and Pagefind can both read.
        path: "docs/:slug",
        Component: DocPageRoute,
        entry: "src/routes/doc.tsx",
        getStaticPaths: () => DOC_PAGES.map((page) => `docs/${page.slug}`),
      },
      {
        // The way in: every page, grouped. The generated reference moved to
        // /docs/reference so this URL can be the front door.
        path: "docs",
        Component: DocsIndexPage,
        entry: "src/routes/docs-index.tsx",
      },
      {
        path: "docs/reference",
        Component: DocsPage,
        entry: "src/routes/docs.tsx",
      },
    ],
  },
];
