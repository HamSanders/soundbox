/** Installed text-to-speech models and the voices they can read with. */

import { useMemo } from "react";

import { isReady } from "@/components/voice-shared";
import { ttsVoices } from "@/hooks/use-generate-session";
import type { Model, Voice } from "@/lib/api";
import { useModels, useVoices } from "@/lib/queries";

export function useTts(): { models: Model[]; allModels: Model[]; voices: Voice[]; allVoices: Voice[] } {
  const models = useModels();
  const voices = useVoices();
  const tts = useMemo(
    () => (models.data ?? []).filter((m) => m.task === "tts" && isReady(m)),
    [models.data],
  );
  const usable = useMemo(() => ttsVoices(voices.data ?? [], tts), [voices.data, tts]);
  return { models: tts, allModels: models.data ?? [], voices: usable, allVoices: voices.data ?? [] };
}

/** The model a paragraph is generated on, matching the server's
 *  `chooseVoice`: the paragraph's own override, then the voice's own model
 *  (a voice is made on a model, and read on another it stops sounding like
 *  itself), then the older character and book settings for a voice with no
 *  installed model, then the first installed one that isn't metered. */
export function resolveModel(opts: {
  paragraphModel: string | null;
  characterModel: string | null;
  multiCast: boolean;
  bookModel: string | null;
  voiceId: string | null | undefined;
  voices: Voice[];
  models: Model[];
}): string | null {
  const voiceModel = opts.voiceId
    ? (opts.voices.find((v) => v.id === opts.voiceId)?.model_id ?? null)
    : null;
  const installed = voiceModel && opts.models.some((m) => m.id === voiceModel) ? voiceModel : null;
  return (
    opts.paragraphModel ??
    installed ??
    (opts.multiCast ? opts.characterModel : null) ??
    opts.bookModel ??
    // Never default onto a model that may charge per render.
    opts.models.find((m) => !m.metered)?.id ??
    null
  );
}

/** "Chatterbox" for a voice made on Chatterbox; the raw id when that model
 *  isn't installed; null for a voice with no model recorded. */
export function voiceModelName(voice: Pick<Voice, "model_id"> | null | undefined, models: Model[]): string | null {
  if (!voice?.model_id) return null;
  return models.find((m) => m.id === voice.model_id)?.name ?? voice.model_id;
}
