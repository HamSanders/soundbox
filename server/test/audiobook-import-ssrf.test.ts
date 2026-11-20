/**
 * URL import's address guard. The only server these tests reach is a
 * loopback fixture server they start themselves; host names resolve through
 * an injected resolver, never real DNS.
 */

import type { LookupAddress } from "node:dns";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertHostAllowed,
  guardedFetch,
  guardedLookup,
  isBlockedAddress,
} from "../src/audiobook/import/net-guard.js";
import { fetchDocument, MAX_REDIRECTS } from "../src/audiobook/import/url.js";

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><p>Local fixture page with enough words to read.</p></body></html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** A resolver that answers from a table instead of DNS. */
const resolver =
  (table: Record<string, string[]>) =>
  (host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) => {
    const ips = table[host];
    if (!ips) return cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []);
    cb(null, ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  };

describe("address classification", () => {
  it("blocks loopback, private, link-local, metadata and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1", "127.8.9.10", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
      "::1", "::", "fd00:ec2::254", "fc00::1", "fe80::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a00:1",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });

  it("refuses local literals and names before connecting, unless opted out", () => {
    for (const h of ["127.0.0.1", "[::1]", "169.254.169.254", "localhost", "printer.local", "metadata.google.internal"]) {
      expect(() => assertHostAllowed(h, {}), h).toThrow(/MIRLI_IMPORT_PRIVATE_HOSTS/);
    }
    expect(() => assertHostAllowed("books.example", {})).not.toThrow();
    expect(() => assertHostAllowed("127.0.0.1", { MIRLI_IMPORT_PRIVATE_HOSTS: "nas.lan, 127.0.0.1" })).not.toThrow();
    expect(() => assertHostAllowed("localhost", { MIRLI_IMPORT_PRIVATE_HOSTS: "*" })).not.toThrow();
    // The pre-rename spelling works too, like every MIRLI_* variable.
    expect(() => assertHostAllowed("[::1]", { SOUNDBOX_IMPORT_PRIVATE_HOSTS: "::1" })).not.toThrow();
  });
});

describe("DNS check at connect time", () => {
  it("fails a name that resolves to a private address, even among public ones", async () => {
    const lookup = guardedLookup(resolver({ "evil.example": ["93.184.216.34", "10.0.0.5"], "ok.example": ["93.184.216.34"] }), {});
    const run = (host: string) =>
      new Promise<unknown>((resolve, reject) =>
        (lookup as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void)(host, {}, (e, a) =>
          e ? reject(e) : resolve(a),
        ),
      );
    await expect(run("evil.example")).rejects.toThrow(/10\.0\.0\.5/);
    await expect(run("ok.example")).resolves.toBe("93.184.216.34");
  });

  it("guardedFetch uses the hook: a name pointing at loopback is refused, and allowed when opted out", async () => {
    const table = { "fixture.test": ["127.0.0.1"] };
    const blockedFetch = guardedFetch(guardedLookup(resolver(table), {}));
    await expect(blockedFetch(`http://fixture.test:${port}/`)).rejects.toThrow(/private or local/);

    const env = { MIRLI_IMPORT_PRIVATE_HOSTS: "fixture.test" };
    const doc = await fetchDocument(`http://fixture.test:${port}/page.html`, {
      fetch: guardedFetch(guardedLookup(resolver(table), env)),
      env,
    });
    expect(new TextDecoder().decode(doc.bytes)).toContain("Local fixture page");
  });

  it("the default fetcher refuses a loopback literal with 403", async () => {
    await expect(fetchDocument(`http://127.0.0.1:${port}/`, { env: {} })).rejects.toMatchObject({ status: 403 });
    const ok = await fetchDocument(`http://127.0.0.1:${port}/`, { env: { MIRLI_IMPORT_PRIVATE_HOSTS: "127.0.0.1" } });
    expect(ok.contentType).toContain("text/html");
  });
});

describe("redirects", () => {
  const redirecting = (targets: string[]) => {
    const seen: string[] = [];
    const fn = (async (u: string | URL) => {
      seen.push(String(u));
      const next = targets[seen.length - 1];
      return next
        ? new Response(null, { status: 302, headers: { location: next } })
        : new Response("<p>Arrived at the final page of the redirect chain.</p>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    return { fn, seen };
  };

  it("checks every hop and refuses a redirect into a private address", async () => {
    const { fn, seen } = redirecting(["/next", "http://169.254.169.254/latest/meta-data/"]);
    await expect(fetchDocument("https://books.example/start", { fetch: fn, env: {} })).rejects.toMatchObject({ status: 403 });
    expect(seen).toEqual(["https://books.example/start", "https://books.example/next"]);
  });

  it("refuses a redirect to another scheme", async () => {
    const { fn } = redirecting(["file:///etc/passwd"]);
    await expect(fetchDocument("https://books.example/a", { fetch: fn, env: {} })).rejects.toMatchObject({ status: 422 });
  });

  it("follows up to the cap, then stops", async () => {
    const ok = redirecting(Array.from({ length: MAX_REDIRECTS }, (_, i) => `/r${i}`));
    const doc = await fetchDocument("https://books.example/a", { fetch: ok.fn, env: {} });
    expect(doc.url).toBe(`https://books.example/r${MAX_REDIRECTS - 1}`);
    const loop = redirecting(Array.from({ length: MAX_REDIRECTS + 1 }, (_, i) => `/r${i}`));
    await expect(fetchDocument("https://books.example/a", { fetch: loop.fn, env: {} })).rejects.toMatchObject({ status: 502 });
  });
});
