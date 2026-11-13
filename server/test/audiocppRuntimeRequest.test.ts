import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCppRuntime } from "../src/models/audiocppRuntime.js";

let server: Server | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
  server = undefined;
});

async function endpoint() {
  const bodies: Record<string, unknown>[] = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    bodies.push(body);
    expect(req.url).toBe("/v1/tasks/run");
    res.setHeader("content-type", "application/json");
    if (body.family === "fish_audio" && !body.options?.reference_text) {
      res.writeHead(500).end(JSON.stringify({ error: "requires reference_text option" }));
    } else res.end(JSON.stringify({ audio: "wav", sample_rate: 44100, channels: 1 }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const runtime = new AudioCppRuntime();
  vi.spyOn(runtime, "ensureRunning").mockResolvedValue(`http://127.0.0.1:${address.port}`);
  return { runtime, bodies };
}

describe("audio.cpp task HTTP serialization", () => {
  it("translates request_options to the runtime's options map, preserving voice_ref", async () => {
    const { runtime, bodies } = await endpoint();
    const body = { model: "fish", family: "fish_audio", task: "tts", text: "New speech.",
      voice_ref: "C:/voices/reference.wav", request_options: { reference_text: "Exact words." } };
    await expect(runtime.runTask(body, "/models", "cpu")).resolves.toHaveProperty("audio");
    expect(bodies[0]).toEqual({ model: "fish", family: "fish_audio", task: "tts", text: "New speech.",
      voice_ref: "C:/voices/reference.wav", options: { reference_text: "Exact words." } });
    expect(body).toHaveProperty("request_options"); // caller's object is untouched
  });

  it("preserves other families' parameters and requests without options", async () => {
    const { runtime, bodies } = await endpoint();
    await runtime.runTask({ model: "chatterbox", voice_id: "alice", seed: 42,
      request_options: { exaggeration: "0.7" } }, "/models", "cpu");
    expect(bodies[0]).toEqual({ model: "chatterbox", voice_id: "alice", seed: 42,
      options: { exaggeration: "0.7" } });
    const separation = { model: "demucs", task: "sep", audio: "C:/source.wav" };
    await runtime.runTask(separation, "/models", "cpu");
    expect(bodies[1]).toEqual(separation);
  });
});
