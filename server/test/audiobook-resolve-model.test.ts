/**
 * The editor picks the model a paragraph is voiced on in the browser
 * (`resolveModel`); it must agree with the server: a voice reads on the
 * model it was made on unless that one paragraph overrides it.
 */

import { describe, expect, it } from "vitest";

import { resolveModel, voiceModelName } from "@/components/audiobook/editor/use-tts";
import type { Model, Voice } from "@/lib/api";

const models = [
  { id: "kokoro", name: "Kokoro" },
  { id: "chatterbox", name: "Chatterbox" },
] as unknown as Model[];
const voices = [
  { id: "brit", name: "Brit", model_id: "chatterbox" },
  { id: "old", name: "Old", model_id: "gone-model" },
  { id: "plain", name: "Plain", model_id: null },
] as unknown as Voice[];
const base = { paragraphModel: null, characterModel: null, multiCast: true, bookModel: "kokoro", voices, models };

describe("resolveModel", () => {
  it("uses the voice's own model over the book's and the character's", () => {
    expect(resolveModel({ ...base, voiceId: "brit" })).toBe("chatterbox");
    expect(resolveModel({ ...base, voiceId: "brit", characterModel: "kokoro" })).toBe("chatterbox");
  });
  it("lets a paragraph override win", () => {
    expect(resolveModel({ ...base, voiceId: "brit", paragraphModel: "kokoro" })).toBe("kokoro");
  });
  it("falls back to the character, then the book, when the voice's model is missing", () => {
    expect(resolveModel({ ...base, voiceId: "old", characterModel: "chatterbox" })).toBe("chatterbox");
    expect(resolveModel({ ...base, voiceId: "plain" })).toBe("kokoro");
    expect(resolveModel({ ...base, voiceId: null, bookModel: null })).toBe("kokoro");
  });
  it("names a voice's model for the pickers", () => {
    expect(voiceModelName(voices[0], models)).toBe("Chatterbox");
    expect(voiceModelName(voices[1], models)).toBe("gone-model");
    expect(voiceModelName(voices[2], models)).toBeNull();
  });
});
