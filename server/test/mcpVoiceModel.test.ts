/**
 * A voice is read on the model it was made on.
 *
 * The bug this pins: a story cast entirely to a VibeVoice clone, voiced with
 * no `model`, came back read on Vevo2 — whichever TTS model happened to be
 * ready — so the clone did not sound like the voice. Driven through a real MCP
 * client like mcpDelivery.test.ts; the models themselves are stubbed, since
 * what matters is which one each line is handed to, not the audio.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Config } from "../src/config.js";
import { buildMcp } from "../src/mcp/server.js";
import type { ModelInfo } from "../src/models/types.js";
import type { Voice } from "../src/schemas.js";
import { KonchiService } from "../src/service.js";

const VEVO2 = "audiocpp-vevo2";
const VIBEVOICE = "audiocpp-vibevoice";
const CHATTERBOX = "audiocpp-chatterbox";
/** Enabled in the catalog but its weights are not on this machine. */
const FISH = "audiocpp-fish-audio";

let client: Client;
let svc: KonchiService;
let dataDir: string;
/** Model id → the texts it was asked to speak, in order. */
const spoken = new Map<string, string[]>();

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text).join("");
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

function voice(id: string, name: string, modelId: string | null): void {
  const v: Voice = {
    id,
    name,
    kind: "builtin",
    created_at: new Date().toISOString(),
    voice_id: name.toLowerCase(),
    model_id: modelId,
  };
  (svc as unknown as { db: { createVoice(v: Voice, f: null): Voice } }).db.createVoice(v, null);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-mcp-voice-model-"));
  svc = new KonchiService(new Config(dataDir));
  await svc.models.setAudiocppEnabled([VEVO2, VIBEVOICE, CHATTERBOX, FISH]);

  // Vevo2 is the loaded one — the model the old resolution reached for.
  const real = svc.listModels.bind(svc);
  vi.spyOn(svc, "listModels").mockImplementation(async () =>
    (await real()).map(
      (m): ModelInfo => ({
        ...m,
        status: m.id === VEVO2 ? "loaded" : m.id === FISH ? "not_downloaded" : "installed",
      }),
    ),
  );
  vi.spyOn(svc.models, "load").mockResolvedValue({} as ModelInfo);
  for (const id of [VEVO2, VIBEVOICE, CHATTERBOX, FISH]) {
    vi.spyOn(svc.models.get(id), "speak").mockImplementation(async (text: string) => {
      spoken.set(id, [...(spoken.get(id) ?? []), text]);
      return { audio: [new Float32Array(2400).fill(0.1)], sampleRate: 24000 };
    });
  }

  voice("v-announcer", "Announcer", VIBEVOICE);
  voice("v-guy", "Guy", CHATTERBOX);
  voice("v-old", "Old", null);
  voice("v-fish", "Fishy", FISH);

  const server = buildMcp(() => svc);
  client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

beforeEach(() => spoken.clear());

afterAll(async () => {
  await client.close();
  await svc.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function storyWith(lines: { text: string; voice_id: string | null }[]): Promise<string> {
  const story = await call("konchi.create_story", {});
  await call("konchi.add_lines", { story_id: story.story_id, lines });
  return story.story_id;
}

function soundModels(storyId: string): string[] {
  return svc.listSegments(storyId).map((l) => svc.getSound(l.sound_id!)!.model);
}

describe("speak_story", () => {
  it("reads a voice on its own model when no model is passed", async () => {
    const id = await storyWith([
      { text: "And they're off!", voice_id: "v-announcer" },
      { text: "Down the stretch.", voice_id: "v-announcer" },
    ]);
    const res = await call("konchi.speak_story", { story_id: id });

    expect(spoken.get(VIBEVOICE)).toEqual(["And they're off!", "Down the stretch."]);
    expect(spoken.has(VEVO2)).toBe(false);
    expect(soundModels(id)).toEqual([VIBEVOICE, VIBEVOICE]);
    expect(res.models).toEqual({ [VIBEVOICE]: 2 });
    expect(res.notes).toBeUndefined();
  });

  it("lets an explicit model override every voice", async () => {
    const id = await storyWith([
      { text: "One.", voice_id: "v-announcer" },
      { text: "Two.", voice_id: "v-guy" },
    ]);
    const res = await call("konchi.speak_story", { story_id: id, model: VEVO2 });

    expect(spoken.get(VEVO2)).toEqual(["One.", "Two."]);
    expect(soundModels(id)).toEqual([VEVO2, VEVO2]);
    expect(res.models).toEqual({ [VEVO2]: 2 });
  });

  it("reads each line of a mixed cast on its own voice's model", async () => {
    const id = await storyWith([
      { text: "Who's there?", voice_id: "v-guy" },
      { text: "The announcer.", voice_id: "v-announcer" },
      { text: "Oh.", voice_id: "v-guy" },
      { text: "Narration.", voice_id: null },
      { text: "Before models.", voice_id: "v-old" },
    ]);
    const res = await call("konchi.speak_story", { story_id: id });

    expect(spoken.get(CHATTERBOX)).toEqual(["Who's there?", "Oh."]);
    expect(spoken.get(VIBEVOICE)).toEqual(["The announcer."]);
    // No voice, or a voice with no model: the ready default, as before.
    expect(spoken.get(VEVO2)).toEqual(["Narration.", "Before models."]);
    expect(soundModels(id)).toEqual([CHATTERBOX, VIBEVOICE, CHATTERBOX, VEVO2, VEVO2]);
    expect(res.models).toEqual({ [CHATTERBOX]: 2, [VIBEVOICE]: 1, [VEVO2]: 2 });
  });

  it("falls back when the voice's model is not installed, and says so", async () => {
    const id = await storyWith([{ text: "Glub.", voice_id: "v-fish" }]);
    const res = await call("konchi.speak_story", { story_id: id });

    expect(spoken.has(FISH)).toBe(false);
    expect(spoken.get(VEVO2)).toEqual(["Glub."]);
    expect(res.models).toEqual({ [VEVO2]: 1 });
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0]).toContain("Fishy");
    expect(res.notes[0]).toContain(FISH);
    expect(res.notes[0]).toContain(VEVO2);
  });
});

describe("speak", () => {
  it("reads a voice on its own model when no model is passed", async () => {
    const [sound] = await call("konchi.speak", {
      lines: [{ text: "Hello.", voice_id: "v-guy" }],
    });
    expect(spoken.get(CHATTERBOX)).toEqual(["Hello."]);
    expect(sound.model).toBe(CHATTERBOX);
    expect(sound.models).toBeUndefined();
  });

  it("lets an explicit model override the voice", async () => {
    const [sound] = await call("konchi.speak", {
      lines: [{ text: "Hello.", voice_id: "v-guy" }],
      model: VIBEVOICE,
    });
    expect(spoken.get(VIBEVOICE)).toEqual(["Hello."]);
    expect(sound.model).toBe(VIBEVOICE);
  });

  it("reads a dialogue across families, one model per voice", async () => {
    const [sound] = await call("konchi.speak", {
      lines: [
        { text: "Hi.", voice_id: "v-guy" },
        { text: "Hey.", voice_id: "v-announcer" },
      ],
    });
    expect(spoken.get(CHATTERBOX)).toEqual(["Hi."]);
    expect(spoken.get(VIBEVOICE)).toEqual(["Hey."]);
    expect(sound.models).toEqual({ [CHATTERBOX]: 1, [VIBEVOICE]: 1 });
  });

  it("falls back when the voice's model is not installed, and says so", async () => {
    const [sound] = await call("konchi.speak", {
      lines: [{ text: "Glub.", voice_id: "v-fish" }],
    });
    expect(spoken.get(VEVO2)).toEqual(["Glub."]);
    expect(sound.model).toBe(VEVO2);
    expect(sound.notes?.[0]).toContain("not installed");
  });
});
