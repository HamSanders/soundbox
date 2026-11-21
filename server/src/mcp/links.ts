/**
 * Links an MCP client on another machine can actually use.
 *
 * A local agent reads a sound straight off disk, so every result carries an
 * absolute `path`. When Mirli runs on a server behind a proxy (one that signs
 * people in and forwards MCP with this server's `MIRLI_API_TOKEN`), that path
 * names a file the agent cannot reach, and the server's own `/files/` URL needs
 * a credential the agent does not hold. The proxy can then tell this server,
 * per MCP session, two things:
 *
 *   - `x-mirli-public-url`: the address people open this Mirli at, so
 *     `open_in_studio` links point there instead of at 127.0.0.1.
 *   - `x-mirli-link-base`: a URL prefix the proxy serves downloads under.
 *     Each result then carries a link `<base>/<filename>?exp=<unix s>&sig=<…>`,
 *     signed with the API token, which the proxy checks before fetching the
 *     file from here. Links expire; nobody can widen one to another file.
 *
 * Both headers are honoured only when an API token is set: the access guard
 * has then already proven the request came from whoever holds it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export const PUBLIC_URL_HEADER = "x-mirli-public-url";
export const LINK_BASE_HEADER = "x-mirli-link-base";
/** How long a download link works. Long enough for an agent's whole task. */
export const LINK_TTL_S = 24 * 60 * 60;

export interface RemoteView {
  /** Where people open this Mirli, no trailing slash; null keeps 127.0.0.1 links. */
  publicUrl: string | null;
  /** Signed download prefix, no trailing slash; null keeps `path` and `/files/` URLs. */
  linkBase: string | null;
  /** The signing key (the API token). */
  key: string;
  /** Seconds a link works; LINK_TTL_S unless a test says otherwise. */
  ttlS: number;
}

/** The string both sides sign. Versioned so the scheme can change without ambiguity. */
function payload(filename: string, exp: number): string {
  return `mirli-link:v1\n${filename}\n${exp}`;
}

export function linkSignature(key: string, filename: string, exp: number): string {
  return createHmac("sha256", key).update(payload(filename, exp)).digest("base64url");
}

/** True when `sig` is this key's signature for the file and `exp` has not passed. */
export function verifyLink(
  key: string,
  filename: string,
  exp: number,
  sig: string,
  nowS: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isInteger(exp) || exp < nowS) return false;
  const want = Buffer.from(linkSignature(key, filename, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A signed download link for a sound's `/files/<name>` URL. */
export function signedLink(view: RemoteView, fileUrl: string, nowS: number = Math.floor(Date.now() / 1000)): string {
  const filename = fileUrl.replace(/^\/files\//, "");
  const exp = nowS + view.ttlS;
  const sig = linkSignature(view.key, filename, exp);
  return `${view.linkBase}/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
}

function headerUrl(headers: IncomingHttpHeaders, name: string): string | null {
  const raw = headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.search || u.hash || u.username || u.password) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** The remote view a proxy asked for, or null when there is none to honour. */
export function remoteViewOf(headers: IncomingHttpHeaders, apiToken: string | null): RemoteView | null {
  if (!apiToken) return null;
  const publicUrl = headerUrl(headers, PUBLIC_URL_HEADER);
  const linkBase = headerUrl(headers, LINK_BASE_HEADER);
  if (!publicUrl && !linkBase) return null;
  return { publicUrl, linkBase, key: apiToken, ttlS: LINK_TTL_S };
}

/** Appended to the server instructions when results carry links instead of paths. */
export const REMOTE_INSTRUCTIONS = `
This Mirli runs on a server, not on your machine. Results carry no file path:
each sound's \`url\` is an HTTPS download link that works for 24 hours without
signing in. Download it when you need the file itself (for example with curl -o),
and call soundbox.get_sound for a fresh link after that. \`open_in_studio\` links
open the person's studio in their browser.
`;
