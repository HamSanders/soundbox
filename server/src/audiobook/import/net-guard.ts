/**
 * Server-side request forgery guard for URL import.
 *
 * Mirli can run exposed to a network (Docker, `MIRLI_ALLOWED_HOSTS`, an access
 * token), and URL import makes the server fetch an address a client chose. So
 * by default an import may only reach public addresses: loopback, private,
 * carrier-grade NAT, link-local (including the 169.254.169.254 cloud
 * metadata service), unique-local IPv6 (fc00::/7, so fd00:ec2::254 too),
 * multicast, documentation and reserved ranges are refused.
 *
 * The check runs where it can't be raced: in the DNS `lookup` hook of the
 * socket, on the address actually connected to, for every request and every
 * redirect hop (the caller follows redirects itself). An IP literal never
 * reaches `lookup`, so `assertHostAllowed` checks those up front.
 *
 * Opt-out: `MIRLI_IMPORT_PRIVATE_HOSTS` lists host names (or IPs) that may be
 * private, comma-separated, or `*` for any. Read at call time, like the other
 * `MIRLI_*` switches (see `env.ts`).
 */

import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions, type LookupOptions } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { envVar } from "../../env.js";

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(
      `${host} is a private or local address, which URL import doesn't fetch. ` +
        "Set MIRLI_IMPORT_PRIVATE_HOSTS to allow it.",
    );
    this.name = "BlockedAddressError";
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128],
  ["fc00::", 7], // unique local (fd00::/8 inside it)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // old site-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
  ["100::", 64], // discard-only
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** The IPv4 address embedded in an IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible
 *  or NAT64 (64:ff9b::/96) IPv6 address, if any. */
function embeddedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const a = parseInt(hex[1]!, 16);
    const b = parseInt(hex[2]!, 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

/** True for any address an import must not reach by default. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedIpv4(ip);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true; // not an address at all: refuse rather than guess
}

/** Host names (or IPs) the opt-out lists. */
function allowList(env: NodeJS.ProcessEnv = process.env): string[] {
  return (envVar("MIRLI_IMPORT_PRIVATE_HOSTS", env) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\[|\]$/g, ""))
    .filter(Boolean);
}

export function privateAllowed(host: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = allowList(env);
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return list.includes("*") || list.includes(h);
}

/** Refuse IP literals and well-known local names before any connection. */
export function assertHostAllowed(hostname: string, env: NodeJS.ProcessEnv = process.env): void {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (privateAllowed(host, env)) return;
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new BlockedAddressError(hostname);
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new BlockedAddressError(hostname);
  }
}

type Resolver = (
  hostname: string,
  options: LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A socket `lookup` that resolves every address for the host and fails if
 * any of them is blocked (so a name can't hide a private address behind a
 * public one), then connects to the first. `resolver` is injectable for tests.
 */
export function guardedLookup(
  resolver: Resolver = dnsLookup as unknown as Resolver,
  env: NodeJS.ProcessEnv = process.env,
): LookupFunction {
  return ((hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    resolver(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses ?? [];
      if (!privateAllowed(hostname, env)) {
        const bad = list.find((a) => isBlockedAddress(a.address));
        if (bad) return callback(new BlockedAddressError(`${hostname} (${bad.address})`));
      }
      if (!list.length) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }));
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  }) as LookupFunction;
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * A `fetch` over node:http/https whose sockets resolve through
 * `guardedLookup`. It never follows redirects (the caller checks each hop)
 * and asks for an uncompressed body, so the size cap counts real bytes.
 */
export function guardedFetch(lookup: LookupFunction = guardedLookup()): typeof fetch {
  return ((input: string | URL, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input));
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const headers: Record<string, string> = { "Accept-Encoding": "identity" };
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      const req = send(url, { method: "GET", headers, lookup, signal: init.signal ?? undefined }, (res: IncomingMessage) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          for (const one of Array.isArray(v) ? v : [v]) out.append(k, one);
        }
        const status = res.statusCode ?? 502;
        const body = NULL_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        if (!body) res.resume();
        resolve(new Response(body, { status, statusText: res.statusMessage, headers: out }));
      });
      req.on("error", reject);
      req.end();
    })) as typeof fetch;
}
