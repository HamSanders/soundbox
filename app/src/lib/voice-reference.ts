import type { Model, Voice } from "./api";

/** Validate the selected voice against the model actually reading it. */
export function voiceReferenceError(
  voice: Voice | null | undefined,
  model: Pick<Model, "family"> | null | undefined,
): string | null {
  if (model?.family !== "fish_audio" || voice?.kind !== "clone") return null;
  const samples = voice.samples ?? [];
  const missing = samples.flatMap((s, i) => s.reference_text?.trim() ? [] : [i + 1]);
  if (samples.length && !missing.length) return null;
  return `Fish Audio: “${voice.name}” needs a Reference Transcript` +
    (missing.length ? ` for clip(s) ${missing.join(", ")}` : "") +
    ". Open Voice Lab → Edit voice and enter the exact words spoken in each reference clip.";
}
