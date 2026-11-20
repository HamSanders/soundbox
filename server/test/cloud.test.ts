/**
 * Mirli Cloud, app side: sign-in by device code, the catalog in the pickers,
 * the caps, and a render, all against a fake gateway that speaks
 * `cloud/contract.ts`. No network.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WaveFile } from "wavefile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CloudClient } from "../src/cloud/client.js";
import type { CloudModel as CloudModelInfo } from "../src/cloud/contract.js";
import { CloudModel } from "../src/cloud/model.js";
import { CloudService } from "../src/cloud/service.js";
import { Config } from "../src/config.js";
import { ModelError } from "../src/errors.js";
import { ModelManager } from "../src/models/manager.js";

const BASE = "https://cloud.test";

const SFX: CloudModelInfo = {
  id: "cloud:test-sfx",
  name: "Test SFX",
  upstream_label: "Test SFX, hosted",
  description: "Sound effects.",
  task: "generate",
  category: "sfx",
  price: { unit: "render", credits_per_unit: 3, min_credits: 3 },
  supports: { lyrics: false, seed: false, negative_prompt: false, voice_reference: false },
  max_duration_s: 30,
  default_duration_s: 5,
  voice_ids: [],
  license_note: "Commercial use allowed.",
  watermark: false,
};

function wav(): Buffer {
  const w = new WaveFile();
  w.fromScratch(1, 22_050, "16", Array.from({ length: 2205 }, (_, i) => Math.round(Math.sin(i / 8) * 8000)));
  return Buffer.from(w.toBuffer());
}

/** Enough of the gateway to drive the client: state in closures, fetch out. */
function fakeGateway() {
  const g = {
    approved: false,
    denied: false,
    token: "mirli_dev_abc",
    balance: 100,
    spentToday: 0,
    quote: 3,
    polls: 0,
    jobPolls: 0,
    cancelled: false,
    created: [] as { body: Record<string, unknown>; key: string | null }[],
    revoked: false,
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const err = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const authed = auth === `Bearer ${g.token}` && !g.revoked;
    if (url.host === "cdn.test") {
      // Outputs are on a CDN: the app's token must not travel there.
      if (auth) return new Response("token leaked to CDN", { status: 400 });
      return new Response(wav(), { headers: { "content-type": "audio/wav" } });
    }
    switch (`${method} ${url.pathname}`) {
      case "GET /v1/models":
        return json({ price_version: 1, models: [SFX] });
      case "POST /v1/device/code":
        return json({
          device_code: "dc",
          user_code: "ABCD-EFGH",
          verification_uri: `${BASE}/activate`,
          verification_uri_complete: `${BASE}/activate?code=ABCD-EFGH`,
          interval: 5,
          expires_in: 900,
        });
      case "POST /v1/device/token":
        g.polls++;
        if (g.denied) return err(400, "access_denied", "Refused.");
        return g.approved ? json({ token: g.token }) : err(400, "authorization_pending", "Waiting.");
      case "DELETE /v1/device":
        g.revoked = true;
        return new Response(null, { status: 204 });
    }
    if (!authed) return err(401, "unauthorized", "Sign in.");
    if (method === "GET" && url.pathname === "/v1/account") {
      return json({ email: "me@example.com", balance: g.balance, held: 0, spent_today: g.spentToday, first_paid: true });
    }
    if (method === "POST" && url.pathname === "/v1/quote") return json({ credits: g.quote, units: 1, price_version: 1 });
    if (method === "POST" && url.pathname === "/v1/checkout") return json({ url: `${BASE}/checkout/${body.pack}` });
    const job = (state: string, extra: Record<string, unknown> = {}) => ({
      job_id: "00000000-0000-4000-8000-000000000001",
      state,
      progress: state === "succeeded" ? 1 : 0.5,
      message: null,
      quoted: g.quote,
      charged: state === "succeeded" ? g.quote : null,
      outputs: state === "succeeded" ? [{ url: "https://cdn.test/out.wav", mime: "audio/wav", stem: null }] : [],
      error: null,
      ...extra,
    });
    if (method === "POST" && url.pathname === "/v1/jobs") {
      g.created.push({ body, key: new Headers(init?.headers).get("idempotency-key") });
      return json(job("queued"), 202);
    }
    if (method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
      g.jobPolls++;
      if (g.cancelled) return json(job("cancelled"));
      return json(job(g.jobPolls >= 2 ? "succeeded" : "running"));
    }
    if (method === "POST" && url.pathname.endsWith("/cancel")) {
      g.cancelled = true;
      return json(job("cancelled"));
    }
    return err(404, "not_found", `${method} ${url.pathname}`);
  }) as typeof fetch;
  return { g, fetchImpl };
}

let dataDir: string;
let config: Config;
let models: ModelManager;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-cloud-test-"));
  config = new Config(dataDir);
  models = new ModelManager(join(dataDir, "models"));
  process.env.MIRLI_CLOUD_URL = BASE;
});

afterEach(async () => {
  delete process.env.MIRLI_CLOUD_URL;
  await rm(dataDir, { recursive: true, force: true });
});

async function signedIn() {
  const gw = fakeGateway();
  const cloud = new CloudService(config, models, gw.fetchImpl, true);
  await cloud.refresh();
  config.updateSettings({ cloud_token: gw.g.token });
  await models.setCloudModels([SFX], cloud);
  return { ...gw, cloud };
}

describe("Mirli Cloud sign-in", () => {
  it("does nothing at all when MIRLI_CLOUD is off", async () => {
    const gw = fakeGateway();
    const cloud = new CloudService(config, models, gw.fetchImpl, false);
    await cloud.refresh();
    expect((await models.listInfo()).some((m) => m.provider === "cloud")).toBe(false);
    await expect(cloud.startSignIn()).rejects.toThrow(ModelError);
    expect(gw.g.polls).toBe(0);
  });

  it("signs in by device code, stores the token privately, and signs out", async () => {
    const gw = fakeGateway();
    const cloud = new CloudService(config, models, gw.fetchImpl, true);
    await cloud.refresh();

    const started = await cloud.startSignIn();
    cloud.cancelSignIn(); // drive polls by hand instead of timers
    expect(started).toMatchObject({ state: "pending", user_code: "ABCD-EFGH" });

    const anon = new CloudClient(BASE, null, gw.fetchImpl);
    (cloud as unknown as { signIn: unknown }).signIn = started;
    await cloud.poll(anon, "dc", 5);
    expect(config.settings.cloud_token).toBeNull();
    gw.g.approved = true;
    await cloud.poll(anon, "dc", 5);
    expect(config.settings.cloud_token).toBe("mirli_dev_abc");

    // The token never leaves through the settings API.
    const pub = config.settings.public(config.paths);
    expect(JSON.stringify(pub)).not.toContain("mirli_dev_abc");
    expect(pub.cloud_signed_in).toBe(true);

    const status = await cloud.status();
    expect(status).toMatchObject({ signed_in: true, account: { email: "me@example.com", balance: 100 }, models: 1 });

    await cloud.signOut();
    expect(gw.g.revoked).toBe(true);
    expect(config.settings.cloud_token).toBeNull();
    expect((await cloud.status()).signed_in).toBe(false);
  });

  it("reports a refused sign-in", async () => {
    const gw = fakeGateway();
    const cloud = new CloudService(config, models, gw.fetchImpl, true);
    const started = await cloud.startSignIn();
    cloud.cancelSignIn();
    (cloud as unknown as { signIn: unknown }).signIn = started;
    gw.g.denied = true;
    await cloud.poll(new CloudClient(BASE, null, gw.fetchImpl), "dc", 5);
    expect((await cloud.status()).sign_in).toMatchObject({ state: "denied" });
  });
});

describe("Mirli Cloud models", () => {
  it("shows cloud models after local ones, with a price, and needs sign-in", async () => {
    const gw = fakeGateway();
    const cloud = new CloudService(config, models, gw.fetchImpl, true);
    await cloud.refresh();
    const info = (await models.listInfo()).find((m) => m.id === "cloud:test-sfx");
    expect(info).toMatchObject({ provider: "cloud", status: "error", price: { credits_per_unit: 3 }, vram_estimate_mb: 0 });
    expect(info!.error).toMatch(/Sign in/);
  });

  it("renders: quote, job with an idempotency key, progress, download, decode", async () => {
    const { g, cloud } = await signedIn();
    const model = new CloudModel(SFX, cloud, async () => {});
    const steps: string[] = [];
    const out = await model.generate("a door slam", 4, { progress: (_f, m) => steps.push(m) });
    expect(out.sampleRate).toBe(22_050);
    expect(out.audio[0]!.length).toBe(2205);
    expect(g.created).toHaveLength(1);
    expect(g.created[0]!.body).toMatchObject({ model: "cloud:test-sfx", task: "generate", max_credits: 50 });
    expect(g.created[0]!.body.params).toEqual({ prompt: "a door slam", duration_s: 4 });
    expect(g.created[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(steps.some((s) => s.includes("3 credits"))).toBe(true);
  });

  it("stops before sending when over the per-render or daily cap, or short of credits", async () => {
    const { g, cloud } = await signedIn();
    const model = new CloudModel(SFX, cloud, async () => {});
    config.updateSettings({ cloud_max_credits_per_call: 2 });
    await expect(model.generate("x", 4)).rejects.toThrow(/limit of 2 per render/);
    config.updateSettings({ cloud_max_credits_per_call: 50, cloud_max_credits_per_day: 10 });
    g.spentToday = 9;
    await expect(model.generate("x", 4)).rejects.toThrow(/daily limit/);
    config.updateSettings({ cloud_max_credits_per_day: 300 });
    g.balance = 1;
    await expect(model.generate("x", 4)).rejects.toThrow(/needs 3 and you have 1/);
    expect(g.created).toHaveLength(0);
  });

  it("cancels the cloud job when the Mirli job is cancelled", async () => {
    const { g, cloud } = await signedIn();
    const model = new CloudModel(SFX, cloud, async () => {});
    const progress = Object.assign(() => {}, { handle: { cancelled: true } }) as never;
    await expect(model.generate("x", 4, { progress })).rejects.toThrow(/Cancel/);
    expect(g.cancelled).toBe(true);
  });

  it("tells you to sign in again when the device was signed out elsewhere", async () => {
    const { g, cloud } = await signedIn();
    g.revoked = true;
    const model = new CloudModel(SFX, cloud, async () => {});
    await expect(model.generate("x", 4)).rejects.toThrow(/signed this device out/);
  });
});
