import { describe, expect, it, vi } from "vitest";

import { generateImage } from "../src/image/client.js";
import { coverArtPrompt, voiceAvatarPrompt, NEGATIVE_PROMPT } from "../src/image/prompts.js";
import { probeEndpoint, IMAGE_PROBE_CANDIDATES } from "../src/image/probe.js";
import { assetScore, companionAsset, verifyDigest } from "../src/models/sdServerBinary.js";
import { ModelError } from "../src/errors.js";

/** One PNG's worth of bytes; only its round trip through base64 matters. */
const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PIXEL_B64 = PIXEL.toString("base64");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseRequest = {
  baseUrl: "http://127.0.0.1:7860",
  prompt: "album cover",
  negativePrompt: NEGATIVE_PROMPT,
  width: 512,
  height: 512,
  steps: 4,
  cfg: 1.0,
} as const;

describe("generateImage — a1111 shape", () => {
  it("posts to /sdapi/v1/txt2img with the steps and cfg it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ images: [PIXEL_B64] }));
    const bytes = await generateImage({ ...baseRequest, kind: "a1111" }, fetchMock as never);

    expect(bytes.equals(PIXEL)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:7860/sdapi/v1/txt2img");
    const body = JSON.parse((init as { body: string }).body);
    // Turbo checkpoints are unusable at a normal 20/7.5 — these must arrive
    // exactly as the catalog specified them.
    expect(body.steps).toBe(4);
    expect(body.cfg_scale).toBe(1.0);
    expect(body.negative_prompt).toContain("text");
  });

  it("sends -1 rather than null when no seed is pinned", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ images: [PIXEL_B64] }));
    await generateImage({ ...baseRequest, kind: "a1111", seed: null }, fetchMock as never);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.seed).toBe(-1);
  });

  it("strips a data: URL prefix", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ images: [`data:image/png;base64,${PIXEL_B64}`] }));
    const bytes = await generateImage({ ...baseRequest, kind: "a1111" }, fetchMock as never);
    expect(bytes.equals(PIXEL)).toBe(true);
  });
});

describe("generateImage — openai shape", () => {
  it("posts to /v1/images/generations asking for inline base64", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: PIXEL_B64 }] }));
    await generateImage(
      { ...baseRequest, kind: "openai", model: "dall-e-3", apiKey: "sk-x" },
      fetchMock as never,
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:7860/v1/images/generations");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.response_format).toBe("b64_json");
    expect(body.size).toBe("512x512");
    expect(body.model).toBe("dall-e-3");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer sk-x");
  });

  it("omits the model entirely when none is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: PIXEL_B64 }] }));
    await generateImage({ ...baseRequest, kind: "openai", model: null }, fetchMock as never);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect("model" in body).toBe(false);
  });

  it("refuses a URL response instead of fetching it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ url: "https://elsewhere.example/x.png" }] }));
    await expect(
      generateImage({ ...baseRequest, kind: "openai" }, fetchMock as never),
    ).rejects.toThrow(/returned a URL/);
    // The point of the check: exactly one request, to the endpoint we were
    // configured for, and none to whatever host it named.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("generateImage — failures", () => {
  it("surfaces the endpoint's own error body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("model not loaded", { status: 500 }));
    await expect(
      generateImage({ ...baseRequest, kind: "a1111" }, fetchMock as never),
    ).rejects.toThrow(/HTTP 500.*model not loaded/s);
  });

  it("names the wrong-API case when the shape doesn't match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ nothing: true }));
    await expect(
      generateImage({ ...baseRequest, kind: "a1111" }, fetchMock as never),
    ).rejects.toThrow(/really speaks the "a1111" API/);
  });

  it("rejects an empty image rather than writing a zero-byte file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ images: [""] }));
    await expect(
      generateImage({ ...baseRequest, kind: "a1111" }, fetchMock as never),
    ).rejects.toThrow(ModelError);
  });
});

describe("prompts", () => {
  it("draws a voice from its notes, not its name, when both exist", () => {
    const prompt = voiceAvatarPrompt({ name: "Voice 3", notes: "gravelly old sea captain" });
    expect(prompt).toContain("gravelly old sea captain");
    expect(prompt).not.toContain("Voice 3");
  });

  it("falls back to the name for an unannotated voice", () => {
    expect(voiceAvatarPrompt({ name: "Narrator", notes: null })).toContain("Narrator");
  });

  it("keeps lyrics out of a cover prompt", () => {
    const prompt = coverArtPrompt({
      prompt: "slow desert blues with lap steel",
      track_name: "Cold Corner",
      name: "Cold Corner",
      tags: ["blues", "guitar"],
    });
    expect(prompt).toContain("slow desert blues with lap steel");
    expect(prompt).toContain("blues, guitar");
    expect(prompt).toContain("no text");
  });

  it("clamps an overlong prompt rather than sending a wall the encoder truncates", () => {
    const long = "a ".repeat(400); // 800 chars in
    const prompt = coverArtPrompt({ prompt: long, track_name: null, name: "x", tags: [] });
    expect(prompt).not.toContain(long.trim());
    // The 200-char subject cap plus the fixed house-style suffix, and nothing
    // like the 800 characters it was handed.
    expect(prompt.length).toBeLessThan(400);
  });

  it("negatives text first, since that is the failure that ruins a cover", () => {
    expect(NEGATIVE_PROMPT.startsWith("text")).toBe(true);
  });
});

describe("probe", () => {
  it("reads A1111's checkpoint listing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ title: "sd_xl.safetensors [abc]", model_name: "sd_xl" }]));
    const found = await probeEndpoint(IMAGE_PROBE_CANDIDATES[0]!, fetchMock as never);
    expect(found?.kind).toBe("a1111");
    expect(found?.models).toEqual(["sd_xl"]);
  });

  it("reads an OpenAI-shaped listing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "sd-1.5" }] }));
    const localai = IMAGE_PROBE_CANDIDATES.find((c) => c.kind === "openai")!;
    const found = await probeEndpoint(localai, fetchMock as never);
    expect(found?.models).toEqual(["sd-1.5"]);
  });

  it("still reports an endpoint whose listing it cannot parse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("surprise"));
    const found = await probeEndpoint(IMAGE_PROBE_CANDIDATES[0]!, fetchMock as never);
    expect(found).not.toBeNull();
    expect(found?.models).toEqual([]);
  });

  it("treats nothing-listening as not there", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await probeEndpoint(IMAGE_PROBE_CANDIDATES[0]!, fetchMock as never)).toBeNull();
  });
});

/**
 * Asset names taken verbatim from a real stable-diffusion.cpp release listing
 * — the point of these is that the naming is nothing like llama.cpp's, so a
 * matcher that assumed short platform tags would pick nothing at all.
 */
describe("sd-server asset matching", () => {
  const RELEASE = [
    "cudart-sd-bin-win-cu12-x64.zip",
    "sd-master-97d2990-bin-Darwin-macOS-26.5.2-arm64.zip",
    "sd-master-97d2990-bin-Linux-Ubuntu-24.04-x86_64-rocm-7.14.0.zip",
    "sd-master-97d2990-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip",
    "sd-master-97d2990-bin-Linux-Ubuntu-24.04-x86_64.zip",
    "sd-master-97d2990-bin-win-cpu-x64.zip",
    "sd-master-97d2990-bin-win-cuda12-x64.zip",
    "sd-master-97d2990-bin-win-rocm-7.14.0-x64.zip",
    "sd-master-97d2990-bin-win-vulkan-x64.zip",
  ];

  function best(platforms: string[], backend: string, arches: string[]): string {
    const scored = RELEASE.map((n) => ({ n, s: assetScore(n, platforms, backend, arches) })).filter(
      (p) => p.s > 0,
    );
    scored.sort((a, b) => b.s - a.s);
    return scored[0]?.n ?? "";
  }

  it("picks the Windows CUDA build on a CUDA Windows machine", () => {
    expect(best(["win"], "cuda", ["x64", "x86_64"])).toBe("sd-master-97d2990-bin-win-cuda12-x64.zip");
  });

  it("picks the macOS arm64 build on Apple silicon", () => {
    expect(best(["darwin", "macos"], "metal", ["arm64"])).toBe(
      "sd-master-97d2990-bin-Darwin-macOS-26.5.2-arm64.zip",
    );
  });

  it("picks the untagged Linux build for CPU, since there is no 'cpu' asset there", () => {
    expect(best(["linux", "ubuntu"], "cpu", ["x64", "x86_64"])).toBe(
      "sd-master-97d2990-bin-Linux-Ubuntu-24.04-x86_64.zip",
    );
  });

  it("picks the explicit cpu build on Windows", () => {
    expect(best(["win"], "cpu", ["x64", "x86_64"])).toBe("sd-master-97d2990-bin-win-cpu-x64.zip");
  });

  it("never picks a GPU build for the wrong vendor", () => {
    expect(assetScore("sd-master-97d2990-bin-win-rocm-7.14.0-x64.zip", ["win"], "cuda", ["x64"])).toBe(0);
    expect(
      assetScore("sd-master-97d2990-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip", ["linux"], "cpu", ["x86_64"]),
    ).toBe(0);
  });

  it("never picks the cudart package as a primary asset", () => {
    expect(assetScore("cudart-sd-bin-win-cu12-x64.zip", ["win"], "cuda", ["x64"])).toBe(0);
  });

  it("rejects every asset from another platform", () => {
    for (const name of RELEASE) {
      if (name.toLowerCase().includes("win")) continue;
      expect(assetScore(name, ["win"], "cuda", ["x64"])).toBe(0);
    }
  });

  it("finds the cudart companion for a CUDA build, and only for one", () => {
    const release = {
      assets: RELEASE.map((name) => ({ name, browser_download_url: `https://x/${name}` })),
    };
    const cuda = release.assets.find((a) => a.name.includes("win-cuda12"))!;
    const cpu = release.assets.find((a) => a.name.includes("win-cpu"))!;
    expect(companionAsset(release, cuda)?.name).toBe("cudart-sd-bin-win-cu12-x64.zip");
    expect(companionAsset(release, cpu)).toBeNull();
  });
});

describe("verifyDigest", () => {
  const bytes = Buffer.from("hello");
  // sha256("hello")
  const digest = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

  it("accepts a matching digest in GitHub's algo-prefixed form", () => {
    expect(() => verifyDigest("x.zip", bytes, `sha256:${digest}`)).not.toThrow();
  });

  it("accepts a bare hex digest", () => {
    expect(() => verifyDigest("x.zip", bytes, digest)).not.toThrow();
  });

  it("throws on a mismatch", () => {
    expect(() => verifyDigest("x.zip", bytes, `sha256:${"0".repeat(64)}`)).toThrow(/mismatch/i);
  });

  it("refuses to install when no digest is published", () => {
    expect(() => verifyDigest("x.zip", bytes, null)).toThrow(/KONCHI_ALLOW_UNVERIFIED_BINARIES/);
  });

  it("installs unverified, with a warning, only when explicitly opted in", () => {
    process.env.KONCHI_ALLOW_UNVERIFIED_BINARIES = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => verifyDigest("x.zip", bytes, null)).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      delete process.env.KONCHI_ALLOW_UNVERIFIED_BINARIES;
    }
  });
});
