/**
 * A custom audio endpoint: somebody else's server that Soundbox sends a
 * request to instead of running a model itself.
 *
 * The case this exists for is a machine that already runs LocalAI, a gateway
 * or another model manager, where Soundbox downloading its own copy of the
 * same weights wastes disk and bandwidth (or is not possible at all, on an
 * isolated network). Each endpoint shows up in the model pickers as one model,
 * `endpoint:<id>`, for one task.
 *
 * Stored in the profile's settings.json, under `audio_endpoints`.
 */

/** Which surface the endpoint belongs to. "sfx" and "music" are both prompt →
 *  audio (the Generate composer's two tabs); "speech" is a script → voice. */
export type EndpointTask = "sfx" | "music" | "speech";

export interface AudioEndpoint {
  /** Lower-case slug, unique within the profile. The model id is
   *  `endpoint:<id>`, so this is what library sounds record as their model —
   *  renaming an endpoint must not orphan them, hence a separate `name`. */
  id: string;
  name: string;
  task: EndpointTask;
  /** The full URL to POST to, path included. May hold `{{variable}}`
   *  placeholders (ElevenLabs puts the voice in the path); each is filled
   *  URL-encoded. */
  url: string;
  /** Sent in `api_key_header` when set. Never returned by the API. */
  api_key: string | null;
  /** The header the key goes in, and what precedes it there. The defaults
   *  are the OpenAI convention, `Authorization: Bearer <key>`; ElevenLabs wants
   *  `xi-api-key: <key>` and fal `Authorization: Key <key>`. Kept apart from
   *  `headers` because those are returned by the API and the key never is. */
  api_key_header: string;
  api_key_prefix: string;
  /** Extra request headers. Returned by the API, so never a secret. */
  headers: Record<string, string>;
  /** JSON with `{{variable}}` placeholders — see `template.ts`. */
  body_template: string;
  /** Dotted path into a JSON response: to base64 audio, or to a link to the
   *  audio file (fal and Replicate answer with a link), which is then fetched.
   *  "" when the response body is the audio itself. */
  response_path: string;
  /** Rate to read a headerless `audio/pcm` response at. */
  pcm_sample_rate: number;
  /** The longest clip the composer should offer. */
  max_duration_s: number;
  /** Voice names to offer (speech only). The first is the default. */
  voices: string[];
  /** Off hides it from the pickers without forgetting its settings. */
  enabled: boolean;
}

/** What the API returns: the key replaced by whether there is one. */
export type PublicAudioEndpoint = Omit<AudioEndpoint, "api_key"> & { api_key_set: boolean };

export const DEFAULT_KEY_HEADER = "Authorization";
export const DEFAULT_KEY_PREFIX = "Bearer ";

/**
 * Fill fields added after an endpoint was saved.
 *
 * settings.json is read as-is, so an endpoint written by an older version has
 * no `api_key_header`. Without this its key would go out under an `undefined`
 * header name, which is no key at all.
 */
export function withEndpointDefaults(ep: AudioEndpoint): AudioEndpoint {
  return {
    ...ep,
    api_key_header: ep.api_key_header || DEFAULT_KEY_HEADER,
    api_key_prefix: ep.api_key_prefix ?? DEFAULT_KEY_PREFIX,
    headers: ep.headers ?? {},
  };
}

export const ENDPOINT_MODEL_PREFIX = "endpoint:";

export function endpointModelId(id: string): string {
  return `${ENDPOINT_MODEL_PREFIX}${id}`;
}

/**
 * Whether a URL points at this machine or the local network.
 *
 * Decides whether the UI warns that prompts leave the network. Judged from the
 * hostname alone, without a DNS lookup: loopback, the private IPv4 ranges,
 * IPv6 unique-local and link-local, single-label names (`homeserver`) and the
 * usual home-network suffixes. A public name that resolves to a LAN address is
 * reported as remote, which errs toward warning.
 */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  if (/\.(local|lan|home|internal|home\.arpa)$/.test(host)) return true;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

export function toPublicEndpoint(ep: AudioEndpoint): PublicAudioEndpoint {
  const { api_key, ...rest } = ep;
  return { ...rest, api_key_set: Boolean(api_key) };
}
