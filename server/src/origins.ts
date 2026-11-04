import { envVar } from "./env.js";
/**
 * Which browser origins the server trusts.
 *
 * Two places ask: CORS (whether a cross-origin page may read our responses)
 * and the MCP endpoint (which refuses an untrusted Origin outright). Both use
 * this one rule so they can't drift apart.
 *
 * It used to be "any http://localhost:* or 127.0.0.1:* page", on the theory
 * that only local things can reach a local server. But plenty of local things
 * are not Konchi — another app's dev server, a local web tool, anything a
 * browser extension opens on localhost — and that rule let every one of them
 * read the library and drive generation. The trusted set is now just:
 *
 *   - the server's own origin, i.e. an Origin naming the same host:port as
 *     the request's Host header. That is the built UI the server serves,
 *     including inside the desktop shell, whose webview is pointed straight
 *     at `http://127.0.0.1:<port>` (the Tauri splash page never calls the
 *     API). The Host header is itself checked in app.ts (loopback, the bound
 *     host, KONCHI_ALLOWED_HOSTS), so a rebinding page can't satisfy this
 *     by naming its own domain.
 *   - the Vite dev server: `npm run dev` serves the UI on 5174 (or `PORT`)
 *     and proxies `/api`, `/mcp` and `/files` here with `changeOrigin`, so
 *     those requests arrive with Host rewritten to ours but Origin still
 *     naming the dev server.
 *   - origins whose host is listed in KONCHI_ALLOWED_HOSTS — the existing
 *     opt-in for serving beyond loopback, which is also where a UI hosted on
 *     that name would load from.
 */

/** The ports the Vite dev server serves the UI on: its configured default
 *  (app/vite.config.ts) and whatever `PORT` overrides it with — `npm run dev`
 *  hands both processes the same environment. */
function devPorts(): string[] {
  const ports = new Set(["5174"]);
  const override = (process.env.PORT ?? "").trim();
  if (/^\d{1,5}$/.test(override)) ports.add(override);
  return [...ports];
}

function devOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const port of devPorts()) {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      origins.add(`http://${host}:${port}`);
    }
  }
  return origins;
}

/** Strips the port from a Host header value, keeping IPv6 brackets. */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(":");
  // More than one colon without brackets is a bare IPv6 literal.
  if (colon !== -1 && h.indexOf(":", colon + 1) === -1) return h.slice(0, colon);
  return h;
}

/** KONCHI_ALLOWED_HOSTS, comma-separated `host` or `host:port` values,
 *  lower-cased. */
export function allowedHostEntries(): string[] {
  return (envVar("KONCHI_ALLOWED_HOSTS") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether a `host[:port]` value (a Host header, or an Origin's host) is listed
 * in KONCHI_ALLOWED_HOSTS. A bare `host` entry matches that name on any
 * port; a `host:port` entry matches only that port. The Host-header check in
 * app.ts, the MCP endpoint's Host check and the origin rule below all use it.
 */
export function isListedHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  const name = hostnameOf(h);
  return allowedHostEntries().some((entry) => entry === h || entry === name);
}

/**
 * Whether a browser at `origin` may call this server. `hostHeader` is the
 * request's Host, which is what makes "our own origin" recognisable without
 * knowing in advance which port we were told to listen on.
 */
export function isTrustedOrigin(origin: string, hostHeader?: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // `URL.origin` normalises case and drops a default port, and a real Origin
  // header never carries a path — anything that does isn't one.
  if (url.origin !== origin.trim().toLowerCase().replace(/\/$/, "")) return false;

  const host = url.host; // hostname[:port], lower-cased, IPv6 bracketed
  if (hostHeader && host === hostHeader.trim().toLowerCase()) return true;
  if (url.protocol === "http:" && devOrigins().has(url.origin)) return true;
  return isListedHost(host);
}
