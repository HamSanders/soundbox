// The Mirli server's Call API (live/README.md), as the bot uses it: characters and voices for autocomplete,
// a call grant (socket URL, token, persona, voice) per voice channel, heartbeats, character switches, hang-up.

export class MirliError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function mirliClient(baseUrl, fetchFn = fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  async function req(method, path, body, timeoutMs = 5000) {
    // X-Soundbox: the Mirli server refuses mutating requests without it (a cross-site page can't send it).
    const headers = { Accept: "application/json", "X-Soundbox": "1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let r;
    try {
      r = await fetchFn(`${base}/api${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new MirliError(0, "unreachable", `Can't reach Mirli at ${base}. Is it running?`);
    }
    if (r.status === 204) return undefined;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new MirliError(r.status, data.error?.code ?? "error", data.error?.message ?? `HTTP ${r.status}`);
    return data;
  }
  return {
    base,
    characters: () => req("GET", "/characters").then((d) => d.characters ?? []),
    voices: () => req("GET", "/calls/voices").then((d) => d.voices ?? []),
    status: () => req("GET", "/calls/status"),
    /** `character` is an id or a name; null talks to Mirli itself. */
    startCall: (character) => req("POST", "/calls", { character: character ?? null }),
    heartbeat: (id) => req("POST", `/calls/${id}/heartbeat`, {}),
    setCharacter: (id, character) => req("POST", `/calls/${id}/character`, { character }),
    endCall: (id) => req("DELETE", `/calls/${id}`),
  };
}

/** Discord autocomplete: at most 25 choices, name and value up to 100 characters. */
export function choices(items, query = "") {
  const q = query.trim().toLowerCase();
  return items
    .filter((v) => v && typeof v.id === "string" && typeof v.name === "string" && v.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, 25)
    .map((v) => ({ name: v.name.slice(0, 100), value: v.id.slice(0, 100) }));
}

/** Accepts an id (from autocomplete) or a typed name; returns the id, or the input when nothing matches. */
export function resolveId(items, wanted) {
  const w = String(wanted).trim().toLowerCase();
  const hit = items.find((v) => v.id.toLowerCase() === w) ?? items.find((v) => v.name.toLowerCase() === w);
  return hit ? hit.id : wanted;
}

/**
 * Autocomplete must answer within Discord's 3 seconds, so this never waits on the network once it has a list:
 * it serves the last good list and refreshes in the background. The first call waits for the first fetch.
 */
export function cached(load, ttlMs = 30_000) {
  let at = 0;
  let list = [];
  let inflight = null;
  const refresh = () =>
    (inflight ??= load()
      .then((l) => { list = l; at = Date.now(); })
      .finally(() => { inflight = null; }));
  return async () => {
    if (!at) await refresh();
    else if (Date.now() - at > ttlMs) refresh().catch(() => {});
    return list;
  };
}

/** Asks the live socket to switch voice and waits for its answer. Resolves { name } or { error }. */
export function setVoice(live, id, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const done = (r) => {
      clearTimeout(timer);
      live.off("voice", onVoice);
      live.off("error", onError);
      resolve(r);
    };
    const onVoice = (m) => done({ name: m.name });
    const onError = (m) => done({ error: m.message ?? "the live server refused" });
    const timer = setTimeout(() => done({ error: "the live server did not answer" }), timeoutMs);
    live.on("voice", onVoice);
    live.on("error", onError);
    live.control({ type: "voice", id });
  });
}

/** Puts a granted persona and voice on the socket: the persona starts a fresh conversation, then the voice. */
export async function applyGrant(live, grant, voiceOverride) {
  live.control({ type: "persona", text: grant.persona });
  const voice = voiceOverride || grant.voice_id;
  if (!voice) return {};
  const r = await setVoice(live, voice);
  return r.error ? { voiceError: r.error } : { voiceName: r.name };
}
