/**
 * `/docs` — the API & MCP reference, reachable from the public site.
 *
 * The reference itself is `ApiMcpReference` in
 * `app/src/components/api-mcp-reference.tsx`. It used to be a route in the app
 * as well (`/developers`), rendered here through a split-out body; the app
 * route is gone and this page is now the only place it is published, so there
 * is one canonical reference rather than two that drift apart.
 *
 * It still takes `health` as an optional prop rather than calling `useHealth()`
 * itself, which matters here specifically: the site has no
 * `QueryClientProvider` (see `site/src/main.tsx`) and no backend to poll, so
 * this page renders it with no `health` prop — every value that would come from
 * a live `/api/health` call already has a static fallback (`apiOrigin()` falls
 * back to the documented default origin, and the example model name falls back
 * to a documented default).
 */

import { ApiMcpReference } from "@/components/api-mcp-reference";
import { SeoHead } from "@/components/seo-head";

export function DocsPage() {
  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title="API & MCP Reference | Konchi"
        description="The full HTTP API and MCP tool reference for Konchi, generated from the server's own OpenAPI schema."
        path="/docs"
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <ApiMcpReference />
      </div>
    </div>
  );
}
