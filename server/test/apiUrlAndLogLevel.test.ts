import { describe, expect, it, vi } from "vitest";

import { apiUrl } from "../src/apiUrl.js";
import { ModelError } from "../src/errors.js";
import { generateImage } from "../src/image/client.js";
import { chatCompletion } from "../src/llm/client.js";
import { resolveLogLevel } from "../src/logging.js";

describe("apiUrl", () => {
  const CHAT = "/v1/chat/completions";

  it("adds the path to a bare root", () => {
    expect(apiUrl("http://ai.lan:8080", CHAT)).toBe("http://ai.lan:8080/v1/chat/completions");
    expect(apiUrl("http://ai.lan:8080/", CHAT)).toBe("http://ai.lan:8080/v1/chat/completions");
  });

  it("doesn't double /v1 when the base already has it (issue #22)", () => {
    expect(apiUrl("http://ai.lan:8080/v1", CHAT)).toBe("http://ai.lan:8080/v1/chat/completions");
    expect(apiUrl("http://ai.lan:8080/v1/", CHAT)).toBe("http://ai.lan:8080/v1/chat/completions");
    expect(apiUrl("https://ai.lan/V1", CHAT)).toBe("https://ai.lan/V1/chat/completions");
  });

  it("keeps a base that is the whole endpoint", () => {
    expect(apiUrl("http://ai.lan/v1/chat/completions", CHAT)).toBe("http://ai.lan/v1/chat/completions");
    expect(apiUrl("http://ai.lan/v1/chat", CHAT)).toBe("http://ai.lan/v1/chat/completions");
  });

  it("keeps a path prefix the server lives under", () => {
    expect(apiUrl("https://gw.lan/localai", CHAT)).toBe("https://gw.lan/localai/v1/chat/completions");
    expect(apiUrl("https://gw.lan/localai/v1", CHAT)).toBe("https://gw.lan/localai/v1/chat/completions");
  });

  it("handles Automatic1111's /sdapi/v1 the same way", () => {
    const TXT2IMG = "/sdapi/v1/txt2img";
    expect(apiUrl("http://sd:7860", TXT2IMG)).toBe("http://sd:7860/sdapi/v1/txt2img");
    expect(apiUrl("http://sd:7860/sdapi/v1", TXT2IMG)).toBe("http://sd:7860/sdapi/v1/txt2img");
    expect(apiUrl("http://sd:7860/sdapi", TXT2IMG)).toBe("http://sd:7860/sdapi/v1/txt2img");
  });

  it("only matches whole segments", () => {
    // `/apiv1` is not `/v1`, so nothing is stripped.
    expect(apiUrl("http://ai.lan/apiv1", CHAT)).toBe("http://ai.lan/apiv1/v1/chat/completions");
  });
});

const notFound = () => new Response("404 page not found", { status: 404 });

describe("the clients use apiUrl and name the URL they tried", () => {
  it("prompt assistant: /v1 base, no doubling, full URL plus a hint on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(notFound());
    const err = await chatCompletion(
      { baseUrl: "http://ai.lan:8080/v1", model: "m", messages: [{ role: "user", content: "hi" }] },
      fetchMock as never,
    ).catch((e: unknown) => e);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://ai.lan:8080/v1/chat/completions");
    expect(err).toBeInstanceOf(ModelError);
    expect((err as Error).message).toContain("http://ai.lan:8080/v1/chat/completions returned HTTP 404");
    expect((err as Error).message).toMatch(/base URL/);
  });

  it("prompt assistant: an unreachable host names the full URL", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      chatCompletion(
        { baseUrl: "http://nowhere.lan", model: "m", messages: [{ role: "user", content: "hi" }] },
        fetchMock as never,
      ),
    ).rejects.toThrow("http://nowhere.lan/v1/chat/completions");
  });

  it("artwork: /v1 base, no doubling, full URL plus a hint on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(notFound());
    const err = await generateImage(
      {
        baseUrl: "http://ai.lan:8080/v1",
        kind: "openai",
        prompt: "cover",
        width: 512,
        height: 512,
        steps: 4,
        cfg: 1,
      },
      fetchMock as never,
    ).catch((e: unknown) => e);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://ai.lan:8080/v1/images/generations");
    expect((err as Error).message).toContain("http://ai.lan:8080/v1/images/generations returned HTTP 404");
    expect((err as Error).message).toMatch(/base URL/);
  });

  it("artwork: no hint on errors other than 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const err = await generateImage(
      { baseUrl: "http://sd:7860", kind: "a1111", prompt: "x", width: 64, height: 64, steps: 1, cfg: 1 },
      fetchMock as never,
    ).catch((e: unknown) => e);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://sd:7860/sdapi/v1/txt2img");
    expect((err as Error).message).toContain("HTTP 500: boom");
    expect((err as Error).message).not.toMatch(/base URL/);
  });
});

describe("debug lines for outbound requests", () => {
  it("name the URL and status, never the key or the prompt", async () => {
    const { configureLogging } = await import("../src/logging.js");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    // Read what lands in the log file: that's what a user attaches to an issue.
    const logFile = join(mkdtempSync(join(tmpdir(), "sbx-log-")), "t.log");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    const quietErr = vi.spyOn(console, "error").mockImplementation(() => {});
    configureLogging("debug", logFile);
    try {
      const fetchMock = vi.fn().mockResolvedValue(notFound());
      await chatCompletion(
        {
          baseUrl: "http://ai.lan/v1",
          apiKey: "sk-secret-key",
          model: "qwen",
          messages: [{ role: "user", content: "a very private prompt" }],
        },
        fetchMock as never,
      ).catch(() => {});
    } finally {
      configureLogging("info", join(mkdtempSync(join(tmpdir(), "sbx-log-")), "t.log"));
      quiet.mockRestore();
      quietErr.mockRestore();
    }
    const text = readFileSync(logFile, "utf8");
    expect(text).toContain("POST http://ai.lan/v1/chat/completions model=qwen");
    expect(text).toContain("-> HTTP 404");
    expect(text).not.toContain("sk-secret-key");
    expect(text).not.toContain("a very private prompt");
  });
});

describe("resolveLogLevel", () => {
  it("defaults to info", () => {
    expect(resolveLogLevel(undefined, undefined)).toEqual({ level: "info", source: "default", invalid: null });
    expect(resolveLogLevel(undefined, "  ")).toEqual({ level: "info", source: "default", invalid: null });
  });

  it("reads KONCHI_LOG_LEVEL when no flag is given", () => {
    expect(resolveLogLevel(undefined, "debug")).toEqual({ level: "debug", source: "env", invalid: null });
    expect(resolveLogLevel(undefined, " DEBUG ")).toMatchObject({ level: "debug" });
  });

  it("lets the flag win over the environment", () => {
    expect(resolveLogLevel("error", "debug")).toEqual({ level: "error", source: "flag", invalid: null });
  });

  it("accepts warn for warning", () => {
    expect(resolveLogLevel(undefined, "warn")).toMatchObject({ level: "warning" });
  });

  it("reports an unknown value instead of hiding it", () => {
    expect(resolveLogLevel(undefined, "verbose")).toEqual({ level: "info", source: "env", invalid: "verbose" });
    expect(resolveLogLevel("loud", "debug")).toEqual({ level: "info", source: "flag", invalid: "loud" });
  });
});
