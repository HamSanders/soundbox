/** Installed text-to-speech models and the voices they can read with. */

import { useMemo } from "react";

import { isReady } from "@/components/voice-shared";
import { ttsVoices } from "@/hooks/use-generate-session";
import type { Model, Voice } from "@/lib/api";
import { useModels, useVoices } from "@/lib/queries";

export function useTts(): { models: Model[]; voices: Voice[]; allVoices: Voice[] } {
  const models = useModels();
  const voices = useVoices();
  const tts = useMemo(
    () => (models.data ?? []).filter((m) => m.task === "tts" && isReady(m)),
    [models.data],
  );
  const usable = useMemo(() => ttsVoices(voices.data ?? [], tts), [voices.data, tts]);
  return { models: tts, voices: usable, allVoices: voices.data ?? [] };
}

/** The model a paragraph is generated on, matching the server's
 *  `modelFor`: paragraph override, character (multi cast), book, then the
 *  voice's own model, then the first installed one. */
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
  return (
    opts.paragraphModel ??
    (opts.multiCast ? opts.characterModel : null) ??
    opts.bookModel ??
    voiceModel ??
    opts.models[0]?.id ??
    null
  );
}
