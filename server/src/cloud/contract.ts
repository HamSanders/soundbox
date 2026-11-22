/**
 * The wire contract between Mirli and the Mirli Cloud gateway.
 *
 * The gateway keeps an identical copy; change both together and bump
 * `CONTRACT_VERSION` for anything that is not purely additive.
 */

import { z } from "zod";

/**
 * 2 added the "convert" task, reference uploads, consent and the voice error
 * codes. The app sends its version as `x-mirli-contract`; older apps are not
 * shown models whose task they can't parse.
 */
export const CONTRACT_VERSION = 2;

export const priceUnit = z.enum(["render", "minute", "1k_chars", "10s"]);
export type PriceUnit = z.infer<typeof priceUnit>;

export const task = z.enum(["generate", "speak", "separate", "convert"]);
export type Task = z.infer<typeof task>;

/** One model as the app sees it. Mirrors the parts of the app's ModelInfo it needs. */
export const cloudModel = z.object({
  id: z.string().regex(/^cloud:[a-z0-9][a-z0-9.-]*$/),
  name: z.string(),
  upstream_label: z.string(),
  description: z.string(),
  task: task,
  category: z.enum(["sfx", "music", "voice", "stems"]),
  price: z.object({ unit: priceUnit, credits_per_unit: z.number().int().positive(), min_credits: z.number().int().positive() }),
  supports: z.object({
    lyrics: z.boolean(),
    seed: z.boolean(),
    negative_prompt: z.boolean(),
    voice_reference: z.boolean(),
  }),
  max_duration_s: z.number().positive(),
  default_duration_s: z.number().positive(),
  voice_ids: z.array(z.string()),
  license_note: z.string(),
  watermark: z.boolean(),
  /**
   * What a voice reference clip must be, for models that take one. The app
   * trims a longer clip to `max_s` before uploading. `required`: the model has
   * no built-in voice and only speaks in a cloned one.
   */
  reference: z.object({ min_s: z.number().nonnegative(), max_s: z.number().positive(), required: z.boolean() }).nullish(),
  /** Languages `params.language` may name, when the model takes one. */
  languages: z.array(z.string()).optional(),
  /**
   * The model reads a written description of the voice (voice design): the
   * app sends it as `params.prompt` on a "speak" job. Unset: no description.
   */
  voice_description: z.boolean().optional(),
  /**
   * A "separate" model that returns one cleaned-up recording (speech with the
   * noise taken out) rather than stems. The app offers it as its own action.
   */
  cleanup: z.boolean().optional(),
});
export type CloudModel = z.infer<typeof cloudModel>;

export const modelsResponse = z.object({ price_version: z.number().int(), models: z.array(cloudModel) });

export const jobParams = z
  .object({
    prompt: z.string().max(2000).optional(),
    negative_prompt: z.string().max(1000).nullish(),
    lyrics: z.string().max(5000).nullish(),
    duration_s: z.number().positive().max(600).optional(),
    seed: z.number().int().nullish(),
    text: z.string().max(5000).optional(),
    voice: z.string().max(200).nullish(),
    language: z.string().max(20).nullish(),
    /** A voice reference clip, from POST /v1/uploads. Needs `consent`. */
    reference_upload: z.string().uuid().nullish(),
    /** The words spoken in the reference clip, when known. */
    reference_text: z.string().max(2000).nullish(),
    /** The audio to re-voice, for "convert". From POST /v1/uploads. */
    source_upload: z.string().uuid().nullish(),
    /** The name the user gave the voice. Checked, never sent to a model. */
    voice_label: z.string().max(200).nullish(),
  })
  .strict();
export type JobParams = z.infer<typeof jobParams>;

export const quoteRequest = z.object({ model: z.string(), task, params: jobParams });
export const quoteResponse = z.object({ credits: z.number().int(), units: z.number(), price_version: z.number().int() });

export const createJobRequest = z.object({
  model: z.string(),
  task,
  params: jobParams,
  /** The client's per-call cap. A quote above it is refused, not trimmed. */
  max_credits: z.number().int().positive(),
  /**
   * Required whenever a reference clip is used: the person ticked "this is my
   * voice, or I have permission to use it". Logged on the job.
   */
  consent: z.literal("own_voice_or_permission").optional(),
});

/** POST /v1/uploads takes the raw WAV bytes as the body. */
export const uploadResponse = z.object({
  upload_id: z.string().uuid(),
  expires_at: z.string(),
  duration_s: z.number(),
});

export const jobState = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobState = z.infer<typeof jobState>;

export const jobOutput = z.object({ url: z.string().url(), mime: z.string().nullable(), stem: z.string().nullable() });

export const jobResponse = z.object({
  job_id: z.string().uuid(),
  state: jobState,
  progress: z.number(),
  message: z.string().nullable(),
  quoted: z.number().int(),
  charged: z.number().int().nullable(),
  outputs: z.array(jobOutput),
  error: z.string().nullable(),
});
export type JobResponse = z.infer<typeof jobResponse>;

export const accountResponse = z.object({
  email: z.string(),
  balance: z.number().int(),
  held: z.number().int(),
  spent_today: z.number().int(),
  first_paid: z.boolean(),
});

export const deviceCodeRequest = z.object({ device_name: z.string().min(1).max(80) });
export const deviceCodeResponse = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url(),
  interval: z.number().int(),
  expires_in: z.number().int(),
});
export const deviceTokenRequest = z.object({ device_code: z.string() });

/** Every error body. `message` is a sentence the app may show as is. */
export const errorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid_params",
  "insufficient_credits",
  "over_cap",
  "rate_limited",
  "authorization_pending",
  "slow_down",
  "expired_token",
  "access_denied",
  "paused",
  "backend_error",
  /** A reference clip was sent without the consent box ticked. */
  "consent_required",
  /** Voice cloning opens after the account's first purchase. */
  "purchase_required",
  /** The request names a real public figure as the voice to imitate. */
  "blocked_content",
]);
export type ErrorCode = z.infer<typeof errorCode>;
export const errorBody = z.object({
  error: z.object({ code: errorCode, message: z.string(), details: z.record(z.string(), z.unknown()).optional() }),
});

/** Credit packs. Prices are public on the pricing page, so they can live here. */
export const packId = z.enum(["p10", "p25", "p50"]);
export type PackId = z.infer<typeof packId>;
export const checkoutRequest = z.object({ pack: packId });
export const checkoutResponse = z.object({ url: z.string().url() });
