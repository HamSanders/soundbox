/**
 * The update endpoint: GET /api/update?v=<version>&p=<platform>
 *
 * Soundbox asks this once a day (see server/src/updateCheck.ts). It answers
 * with the newest published release and adds one to a counter.
 *
 * What it keeps: a count per day, per version, per platform
 * (`installs:2026-11-17` → `0.5.1|win32-x64` = 412). Nothing else is written.
 * The request has no install id, no cookie and no body, and the version and
 * platform are checked against a strict pattern before they are used as a key,
 * so the counter cannot be filled with junk. The caller's address is visible to
 * Vercel, as for any request, and this code never reads or stores it.
 *
 * Counting is best effort. With no store configured, or when the store is
 * down, the caller still gets its answer: an update check must never fail
 * because the counter did.
 *
 * Store: any Upstash-compatible Redis REST endpoint (Vercel Marketplace →
 * Upstash). Read it back with `HGETALL installs:<date>`; see docs/RELEASING.md.
 *
 * The response is never cached (`no-store`): a cached answer would hide the
 * request from the counter.
 */

const REPO = "HamSanders/soundbox";
const PLATFORMS = new Set(["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"]);
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const KEEP_SECONDS = 60 * 60 * 24 * 400;
const LATEST_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 4000;

export interface Deps {
  fetch: typeof fetch;
  now: () => number;
  env: Record<string, string | undefined>;
}

let latestCache: { at: number; version: string } | null = null;

/** The tag of the newest published release, from the redirect GitHub gives
 *  `/releases/latest`. Not the API: its unauthenticated limit is per address,
 *  and a serverless host shares addresses. */
async function latestVersion(deps: Deps): Promise<string | null> {
  if (latestCache && deps.now() - latestCache.at < LATEST_TTL_MS) return latestCache.version;
  try {
    const res = await deps.fetch(`https://github.com/${REPO}/releases/latest`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const m = /\/releases\/tag\/v?(\d+\.\d+\.\d+)$/.exec(res.headers.get("location") ?? "");
    if (!m) return null;
    latestCache = { at: deps.now(), version: m[1]! };
    return m[1]!;
  } catch {
    return latestCache?.version ?? null;
  }
}

async function count(deps: Deps, version: string, platform: string): Promise<void> {
  const url = deps.env.UPSTASH_REDIS_REST_URL ?? deps.env.KV_REST_API_URL;
  const token = deps.env.UPSTASH_REDIS_REST_TOKEN ?? deps.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  const key = `installs:${new Date(deps.now()).toISOString().slice(0, 10)}`;
  try {
    await deps.fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["HINCRBY", key, `${version}|${platform}`, 1],
        ["EXPIRE", key, KEEP_SECONDS],
      ]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Best effort, by design.
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const v = q.get("v") ?? "";
  const p = q.get("p") ?? "";
  if (!VERSION_RE.test(v) || !PLATFORMS.has(p)) {
    return json({ error: "expected ?v=<major.minor.patch>&p=<os-arch>" }, 400);
  }
  const [latest] = await Promise.all([latestVersion(deps), count(deps, v, p)]);
  return json({
    latest,
    url: latest ? `https://github.com/${REPO}/releases/tag/v${latest}` : null,
  });
}

/** Test hook: forget the cached release between cases. */
export function resetCache(): void {
  latestCache = null;
}

export function GET(request: Request): Promise<Response> {
  return handle(request, { fetch, now: Date.now, env: process.env });
}
