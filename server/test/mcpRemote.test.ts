/**
 * MCP behind a signing-in proxy (links.ts), driven by a real MCP client over
 * HTTP:
 *
 *   - a session id the server no longer holds gets 404, the spec's signal to
 *     start a new session, not a 400 the client reads as a broken request;
 *   - a server bound to a wildcard address takes whatever Host its network
 *     forwards, as the rest of the app already does;
 *   - with an API token set, the proxy's headers turn paths into signed,
 *     expiring links and point `open_in_studio` at the public address;
 *   - without a token, the same headers change nothing.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import * as dsp from "../src/audio/dsp.js";
import { LINK_BASE_HEADER, PUBLIC_URL_HEADER, linkSignature, verifyLink } from "../src/mcp/links.js";

const TOKEN = "t".repeat(40);
const PUBLIC = "https://studio.example.test";
const LINKS = "https://mcp.example.test/dl/acct-1";

let dataDir: string;
let app: FastifyInstance;
let base: string;
let soundFile: string;

async function connect(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "remote-test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text).join("");
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-mcp-remote-"));
  app = buildApp(new Config(dataDir), { serveUi: false, apiToken: TOKEN, allowedHosts: "any" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  const wav = join(dataDir, "in.wav");
  dsp.writeWav(wav, [Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 10) * 0.2)], 24000);
  const up = await app.inject({
    method: "POST",
    url: "/api/sounds/upload?name=Clip",
    headers: { "content-type": "audio/wav", authorization: `Bearer ${TOKEN}` },
    payload: await readFile(wav),
  });
  expect(up.statusCode).toBe(201);
  soundFile = up.json().file;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("sessions", () => {
  it("answers an unknown session id with 404", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "gone",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
  });

  it("still answers 400 to a request with no session that isn't initialize", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });

  it("takes a forwarded Host when bound to a wildcard address", async () => {
    // fetch won't set Host, so speak HTTP directly, as a proxy forwarding to
    // a private name (e.g. <machine>.vm.<app>.internal) would.
    const status = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } },
      });
      const req = request(
        `${base}/mcp`,
        {
          method: "POST",
          headers: {
            host: "ws-1.vm.studios.internal:17494",
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    expect(status).toBe(200);
  });
});

describe("behind a proxy", () => {
  it("returns signed links and the public studio address", async () => {
    const client = await connect({
      authorization: `Bearer ${TOKEN}`,
      [PUBLIC_URL_HEADER]: PUBLIC,
      [LINK_BASE_HEADER]: LINKS,
    });
    expect(client.getInstructions()).toMatch(/runs on a server/);

    const [sound] = await call(client, "soundbox.list_sounds", {});
    expect(sound.path).toBe("");
    const url = new URL(sound.url);
    const filename = soundFile.replace(/^\/files\//, "");
    expect(`${url.origin}${url.pathname}`).toBe(`${LINKS}/${encodeURIComponent(filename)}`);
    const exp = Number(url.searchParams.get("exp"));
    expect(exp).toBeGreaterThan(Date.now() / 1000 + 23 * 3600);
    expect(verifyLink(TOKEN, filename, exp, url.searchParams.get("sig")!)).toBe(true);
    // Another file, another key, or a past expiry: refused.
    expect(verifyLink(TOKEN, "other.wav", exp, url.searchParams.get("sig")!)).toBe(false);
    expect(verifyLink("k".repeat(40), filename, exp, url.searchParams.get("sig")!)).toBe(false);
    expect(verifyLink(TOKEN, filename, 10, linkSignature(TOKEN, filename, 10))).toBe(false);

    const story = await call(client, "soundbox.create_story", { title: "Remote" });
    expect(story.open_in_studio).toMatch(new RegExp(`^${PUBLIC}/#/studio/`));
    await client.close();
  });

  it("keeps paths for a client without the proxy headers", async () => {
    const client = await connect({ authorization: `Bearer ${TOKEN}` });
    expect(client.getInstructions()).not.toMatch(/runs on a server/);
    const [sound] = await call(client, "soundbox.list_sounds", {});
    expect(sound.path).toMatch(/\.wav$/);
    expect(sound.url).toBe(soundFile);
    await client.close();
  });
});

describe("without an API token", () => {
  it("ignores the proxy headers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mirli-mcp-open-"));
    const open = buildApp(new Config(dir), { serveUi: false });
    await open.listen({ port: 0, host: "127.0.0.1" });
    const url = `http://127.0.0.1:${(open.server.address() as AddressInfo).port}/mcp`;
    const client = new Client({ name: "x", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { [PUBLIC_URL_HEADER]: PUBLIC, [LINK_BASE_HEADER]: LINKS } },
      }),
    );
    expect(client.getInstructions()).not.toMatch(/runs on a server/);
    const story = await call(client, "soundbox.create_story", { title: "Local" });
    expect(story.open_in_studio).toMatch(/^http:\/\/127\.0\.0\.1:/);
    await client.close();
    await open.close();
    await rm(dir, { recursive: true, force: true });
  });
});
