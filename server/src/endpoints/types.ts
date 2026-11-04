/**
 * A custom audio endpoint: somebody else's server that Konchi sends a
 * request to instead of running a model itself.
 *
 * The case this exists for is a machine that already runs LocalAI, a gateway
 * or another model manager, where Konchi downloading its own copy of the
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
  /** The full URL to POST to, path included. */
  url: string;
  /** Sent as `Authorization: Bearer …` when set. Never returned by the API. */
  api_key: string | null;
  /** Extra request headers, for servers that want a key somewhere else. */
  headers: Record<string, string>;
  /** JSON with `{{variable}}` placeholders — see `template.ts`. */
  body_template: string;
  /** Dotted path to base64 audio in a JSON response; "" when the response
   *  body is the audio itself (the usual case). */
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
