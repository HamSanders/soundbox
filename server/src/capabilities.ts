/**
 * What this server lets its user do, reported at `GET /api/capabilities`.
 *
 * The app reads this instead of guessing from the deployment ("is this a
 * desktop?", "is this behind a proxy?"), and the server's own guards are built
 * from the same object, so what the UI offers and what the server allows
 * cannot drift apart.
 *
 * On a desktop everything is on. `MIRLI_SANDBOXED=1` is for running Mirli on a
 * machine the person using it doesn't own (a shared server, a NAS, a container
 * behind a signing-in proxy): nothing in the UI may touch the host, so folder
 * browsing, revealing files, downloads and engine installs, local models,
 * custom endpoints (a server must not fetch whatever URL a page hands it), the
 * update check and installing agent skills are all off, and the settings that
 * name things on the host are locked. `MIRLI_DISABLE` turns off single
 * capabilities on top of either, e.g. `MIRLI_DISABLE=reveal,updates`.
 */

import type { FastifyInstance } from "fastify";

import { envVar } from "./env.js";

/** The switchable capabilities, each a yes/no the UI and the guards share. */
export const CAPABILITY_KEYS = [
  /** Browse folders, set folder paths, see where a profile's data lives, and
   *  make or remove profiles (each is a directory on this machine). */
  "filesystem",
  /** Show a sound's file in the system file manager. */
  "reveal",
  /** Download model weights, engines and sample packs. */
  "downloads",
  /** Run models on this machine (audio.cpp). Off: only models from elsewhere. */
  "local_models",
  /** Add and edit custom endpoints. */
  "custom_endpoints",
  /** The daily update check and the update notice. */
  "updates",
  /** Show this machine's GPU and memory. */
  "gpu_status",
  /** Hand out an MCP endpoint and stdio command for agents to connect with. */
  "agent_connect",
  /** Install the bundled agent skills into a client's folder on this machine. */
  "skills_install",
  /** Read the server's log, which names paths and hardware on this machine. */
  "logs",
  /** The first-run setup dialog (which models to download). */
  "setup_wizard",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type Capabilities = Record<CapabilityKey, boolean> & {
  /** Set by `MIRLI_SANDBOXED=1`; the UI uses it only for wording. */
  sandboxed: boolean;
  /** Settings keys that PATCH /api/settings ignores. */
  settings_locked: string[];
  /**
   * Which of the two paths is in force. "full": models on this machine, plus
   * any from elsewhere the user added. "simple": only models that run
   * elsewhere. The profile chooses (setting `setup`) unless the server can't
   * run models itself, which makes it "simple" and `setup_locked`.
   */
  setup: "full" | "simple";
  setup_locked: boolean;
};

/** Off when sandboxed: each touches the machine underneath. */
const HOST_CAPABILITIES: readonly CapabilityKey[] = [
  "filesystem",
  "reveal",
  "downloads",
  "local_models",
  "custom_endpoints",
  "updates",
  "gpu_status",
  "agent_connect",
  "skills_install",
  "logs",
  "setup_wizard",
];

/**
 * Settings that only make sense with a capability, ignored on PATCH without
 * it: a path on the host, a local engine, or a URL the server would fetch.
 */
const SETTINGS_NEEDING: Partial<Record<CapabilityKey, readonly string[]>> = {
  filesystem: ["sounds_dir", "audiocpp_models_dir"],
  downloads: ["hf_token"],
  local_models: ["audiocpp_mode", "enabled_audiocpp_models", "device", "llm_mode", "llm_model", "image_mode", "image_model"],
  custom_endpoints: [
    "audio_endpoints",
    "otel_endpoint",
    "llm_external_base_url",
    "llm_external_model",
    "llm_external_api_key",
    "image_external_kind",
    "image_external_base_url",
    "image_external_model",
    "image_external_api_key",
  ],
};

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function capabilitiesFromEnv(env: NodeJS.ProcessEnv = process.env): Capabilities {
  const sandboxed = truthy(envVar("MIRLI_SANDBOXED", env));
  const disabled = new Set(
    (envVar("MIRLI_DISABLE", env) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const caps = {
    sandboxed,
    settings_locked: [] as string[],
    setup: "full",
    setup_locked: false,
  } as Capabilities;
  for (const key of CAPABILITY_KEYS) {
    caps[key] = !(sandboxed && HOST_CAPABILITIES.includes(key)) && !disabled.has(key);
    if (!caps[key]) caps.settings_locked.push(...(SETTINGS_NEEDING[key] ?? []));
  }
  if (!caps.local_models) {
    caps.setup = "simple";
    caps.setup_locked = true;
  }
  return caps;
}

/**
 * The server's capabilities narrowed by the profile's chosen path.
 *
 * The simple setup is the same app with the local half switched off: no
 * downloads, no GPU readout, and no local models unless the profile asked to
 * keep the ones already installed. What the server allows is the ceiling; the
 * setup can only take away.
 */
export function withSetup(
  server: Capabilities,
  settings: { setup: "full" | "simple"; setup_include_local: boolean },
): Capabilities {
  if (server.setup_locked || settings.setup !== "simple") return server;
  return {
    ...server,
    setup: "simple",
    downloads: false,
    gpu_status: false,
    local_models: server.local_models && settings.setup_include_local,
  };
}

/**
 * Routes refused when a capability is off, keyed by method and the route
 * pattern Fastify matched (`request.routeOptions.url`), never the raw URL: the
 * router decodes the path before matching, so `/api/%66s/dirs` reaches the
 * `/api/fs/dirs` handler, and a regex on `request.url` would let it through.
 *
 * Every registered route is either here or in `UNGUARDED_ROUTES`; a test fails
 * when a new route is in neither, so adding one means deciding which it is.
 */
export const GUARDED_ROUTES: Record<string, CapabilityKey> = {
  "GET /api/fs/dirs": "filesystem",
  "POST /api/profiles": "filesystem",
  "DELETE /api/profiles/:id": "filesystem",
  "GET /api/endpoints": "custom_endpoints",
  "POST /api/endpoints/test": "custom_endpoints",
  "PUT /api/endpoints/:id": "custom_endpoints",
  "DELETE /api/endpoints/:id": "custom_endpoints",
  "POST /api/models/:model_id/download": "downloads",
  "DELETE /api/models/:model_id/weights": "downloads",
  "DELETE /api/models/:model_id/download-failure": "downloads",
  "POST /api/models/audiocpp/engine/install": "downloads",
  "POST /api/llm/engine/install": "downloads",
  "POST /api/llm/models/:model_id/download": "downloads",
  "DELETE /api/llm/models/:model_id": "downloads",
  "POST /api/image/engine/install": "downloads",
  "POST /api/image/models/:model_id/download": "downloads",
  "DELETE /api/image/models/:model_id": "downloads",
  "POST /api/instruments/:id/download": "downloads",
  "DELETE /api/instruments/:id": "downloads",
  "POST /api/models/:model_id/load": "local_models",
  "POST /api/models/:model_id/unload": "local_models",
  "POST /api/models/:model_id/selftest": "local_models",
  "POST /api/mcp/skills/install": "skills_install",
  "POST /api/sounds/:sound_id/reveal": "reveal",
  "POST /api/update/check": "updates",
  "GET /api/logs": "logs",
};

/**
 * Routes that stay open whatever the capabilities, because they touch only the
 * library and the server's own data directory. Some still trim what they say:
 * `/api/health` leaves out the GPU without `gpu_status`, and PATCH
 * `/api/settings` ignores the keys in `settings_locked`. The web UI's own
 * static files (served when the server hosts the app) are open too.
 */
export const UNGUARDED_ROUTES: readonly string[] = [
  // Audiobooks, Listen and the pronunciation dictionary: books, takes,
  // exports and published files all live in the data directory. Web import
  // fetches only public addresses unless MIRLI_IMPORT_PRIVATE_HOSTS allows one.
  "GET /api/audiobooks/listen/shelf",
  "GET /api/audiobooks/:id/listen",
  "GET /api/audiobooks/:id/listen/chapters/:cid/audio",
  "GET /api/audiobooks/:id/progress",
  "PUT /api/audiobooks/:id/progress",
  "DELETE /api/audiobooks/:id/progress",
  "GET /api/audiobooks/:id/bookmarks",
  "POST /api/audiobooks/:id/bookmarks",
  "PATCH /api/audiobooks/:id/bookmarks/:bid",
  "DELETE /api/audiobooks/:id/bookmarks/:bid",
  "PUT /api/audiobooks/:id/tags",
  "GET /api/audiobooks/:id/publish/checklist",
  "POST /api/audiobooks/:id/publish/webplayer",
  "POST /api/audiobooks/:id/publish/rss",
  "GET /api/audiobooks/:id/publish/files/:name",
  "GET /api/audiobooks/:id/beds",
  "GET /api/audiobooks/:id/beds/export-info",
  "POST /api/audiobooks/:id/chapters/:cid/beds",
  "POST /api/audiobooks/:id/chapters/:cid/beds/layout",
  "POST /api/audiobooks/:id/chapters/:cid/beds/suggest",
  "PATCH /api/audiobooks/:id/beds/:bid",
  "POST /api/audiobooks/:id/beds/:bid/layout",
  "DELETE /api/audiobooks/:id/beds/:bid",
  "GET /api/audiobooks/ffmpeg",
  "POST /api/audiobooks/:id/master/analyze",
  "POST /api/audiobooks/:id/credits",
  "POST /api/audiobooks/:id/exports",
  "GET /api/audiobooks/:id/exports",
  "GET /api/audiobooks/:id/exports/:eid",
  "DELETE /api/audiobooks/:id/exports/:eid",
  "GET /api/audiobooks/:id/exports/:eid/download",
  "GET /api/audiobooks/:id/chapters/:cid/timings",
  "GET /api/audiobooks",
  "POST /api/audiobooks",
  "GET /api/audiobooks/:id",
  "PATCH /api/audiobooks/:id",
  "DELETE /api/audiobooks/:id",
  "PUT /api/audiobooks/:id/cover",
  "GET /api/audiobooks/:id/cover",
  "GET /api/audiobooks/:id/events",
  "POST /api/audiobooks/:id/chapters",
  "POST /api/audiobooks/:id/duplicate",
  "POST /api/audiobooks/:id/chapters/from-text",
  "POST /api/audiobooks/:id/chapters/reorder",
  "PATCH /api/audiobooks/:id/chapters/:cid",
  "DELETE /api/audiobooks/:id/chapters/:cid",
  "GET /api/audiobooks/:id/chapters/:cid/paragraphs",
  "POST /api/audiobooks/:id/chapters/:cid/paragraphs",
  "POST /api/audiobooks/:id/chapters/:cid/paragraphs/reorder",
  "POST /api/audiobooks/:id/paragraphs/:sid/split",
  "POST /api/audiobooks/:id/paragraphs/:sid/merge-next",
  "POST /api/audiobooks/:id/paragraphs/cast",
  "PATCH /api/audiobooks/:id/paragraphs/:sid",
  "DELETE /api/audiobooks/:id/paragraphs/:sid",
  "GET /api/audiobooks/:id/notes",
  "POST /api/audiobooks/:id/paragraphs/:sid/notes",
  "PATCH /api/audiobooks/:id/notes/:nid",
  "DELETE /api/audiobooks/:id/notes/:nid",
  "GET /api/audiobooks/:id/snapshots",
  "POST /api/audiobooks/:id/snapshots",
  "GET /api/audiobooks/:id/snapshots/:snid",
  "GET /api/audiobooks/:id/snapshots/:snid/diff",
  "POST /api/audiobooks/:id/snapshots/:snid/restore",
  "DELETE /api/audiobooks/:id/snapshots/:snid",
  "POST /api/audiobooks/:id/replace",
  "POST /api/audiobooks/import/parse",
  "POST /api/audiobooks/import/text",
  "POST /api/audiobooks/import/url",
  "GET /api/audiobooks/classics",
  "POST /api/audiobooks/import/classic",
  "GET /api/audiobooks/import/cover/:token",
  "GET /api/audiobooks/import/:preview_id",
  "PUT /api/audiobooks/import/:preview_id/cover",
  "DELETE /api/audiobooks/import/:preview_id/cover",
  "DELETE /api/audiobooks/import/:preview_id",
  "POST /api/audiobooks/import/commit",
  "GET /api/audiobooks/:id/characters",
  "POST /api/audiobooks/:id/characters",
  "PATCH /api/audiobooks/:id/characters/:chid",
  "DELETE /api/audiobooks/:id/characters/:chid",
  "POST /api/audiobooks/:id/characters/detect",
  "POST /api/audiobooks/:id/characters/merge",
  "POST /api/audiobooks/:id/characters/suggest-voices",
  "POST /api/audiobooks/:id/characters/:chid/suggest-voice",
  "POST /api/audiobooks/:id/characters/:chid/preview",
  "GET /api/audiobooks/:id/characters/:chid/sample",
  "POST /api/audiobooks/:id/voices/replace",
  "GET /api/audiobooks/:id/pronunciations",
  "POST /api/audiobooks/:id/pronunciations",
  "POST /api/audiobooks/:id/pronunciations/reorder",
  "POST /api/audiobooks/:id/pronunciations/import",
  "GET /api/audiobooks/:id/pronunciations/export.pls",
  "GET /api/audiobooks/:id/pronunciations/export.txt",
  "GET /api/pronunciations",
  "POST /api/pronunciations",
  "POST /api/pronunciations/reorder",
  "POST /api/pronunciations/import",
  "GET /api/pronunciations/export.pls",
  "GET /api/pronunciations/export.txt",
  "PATCH /api/audiobooks/:id/pronunciations/:rid",
  "DELETE /api/audiobooks/:id/pronunciations/:rid",
  "PATCH /api/pronunciations/:rid",
  "DELETE /api/pronunciations/:rid",
  "POST /api/audiobooks/:id/pronunciations/suggest",
  "POST /api/audiobooks/:id/pronunciations/play",
  "GET /api/audiobooks/:id/paragraphs/:sid/takes",
  "POST /api/audiobooks/:id/paragraphs/:sid/takes/:tid/select",
  "DELETE /api/audiobooks/:id/paragraphs/:sid/takes/:tid",
  "POST /api/audiobooks/:id/paragraphs/:sid/generate",
  "POST /api/audiobooks/:id/render",
  "GET /api/audiobooks/:id/renders",
  "GET /api/audiobooks/:id/renders/:rid",
  "POST /api/audiobooks/:id/renders/:rid/pause",
  "POST /api/audiobooks/:id/renders/:rid/resume",
  "POST /api/audiobooks/:id/renders/:rid/cancel",
  "GET /api/audiobooks/:id/estimate",
  "GET /api/auth/status",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/assistant/chat",
  "POST /api/assistant/openers",
  "GET /api/health",
  "GET /api/models",
  "GET /api/models/audiocpp/catalog",
  "GET /api/models/audiocpp/runtime",
  "GET /api/models/:model_id",
  "GET /api/mcp/status",
  "GET /api/mcp/calls",
  "POST /api/mcp/calls",
  "GET /api/mcp/calls/events",
  "PATCH /api/mcp/calls/:call_id",
  "GET /api/instruments",
  "GET /api/instruments/:id",
  "GET /api/instruments/:id/files/*",
  "GET /api/image/status",
  "POST /api/generate",
  "POST /api/separate",
  "GET /api/sessions",
  "POST /api/sessions",
  "GET /api/sessions/:session_id",
  "PATCH /api/sessions/:session_id",
  "DELETE /api/sessions/:session_id",
  "GET /api/settings",
  "PATCH /api/settings",
  "POST /api/speak",
  "POST /api/speak/stream",
  "GET /api/sounds",
  "POST /api/sounds/upload",
  "GET /api/sounds/:sound_id",
  "PATCH /api/sounds/:sound_id",
  "DELETE /api/sounds/:sound_id",
  "POST /api/sounds/:sound_id/edit",
  "POST /api/sounds/:sound_id/artwork",
  "DELETE /api/sounds/:sound_id/artwork",
  "GET /api/stories",
  "POST /api/stories",
  "POST /api/stories/from-sound",
  "GET /api/stories/:story_id",
  "PATCH /api/stories/:story_id",
  "DELETE /api/stories/:story_id",
  "GET /api/stories/:story_id/events",
  "POST /api/stories/:story_id/export",
  "GET /api/stories/:story_id/tracks",
  "PATCH /api/stories/:story_id/tracks/:track_index",
  "DELETE /api/stories/:story_id/tracks/:track_index",
  "GET /api/stories/:story_id/segments",
  "POST /api/stories/:story_id/segments",
  "PUT /api/stories/:story_id/segments/reorder",
  "PATCH /api/stories/:story_id/segments/:segment_id",
  "DELETE /api/stories/:story_id/segments/:segment_id",
  "POST /api/stories/:story_id/segments/:segment_id/generate",
  "POST /api/stories/:story_id/segments/:segment_id/split",
  "POST /api/studio/command",
  "POST /api/repaint",
  "POST /api/render",
  "POST /api/convert",
  "GET /api/conversations",
  "POST /api/conversations",
  "GET /api/conversations/:conversation_id",
  "PATCH /api/conversations/:conversation_id",
  "DELETE /api/conversations/:conversation_id",
  "GET /api/conversations/:conversation_id/entries",
  "POST /api/conversations/:conversation_id/entries",
  "GET /api/capabilities",
  "GET /api/jobs",
  "GET /api/jobs/:job_id",
  "POST /api/jobs/:job_id/cancel",
  "GET /api/jobs/:job_id/events",
  "GET /api/tags",
  "POST /api/transcribe",
  "GET /api/voices",
  "POST /api/voices",
  "POST /api/voices/upload",
  "POST /api/voices/import",
  "GET /api/voices/:voice_id",
  "PATCH /api/voices/:voice_id",
  "DELETE /api/voices/:voice_id",
  "POST /api/voices/:voice_id/samples",
  "DELETE /api/voices/:voice_id/samples/:sample_id",
  "GET /api/voices/:voice_id/export",
  "POST /api/voices/:voice_id/artwork",
  "DELETE /api/voices/:voice_id/artwork",
  "GET /api/projects",
  "POST /api/projects",
  "DELETE /api/projects/:project_id",
  "GET /api/profiles",
  "PATCH /api/profiles/:id",
  "POST /api/profiles/:id/activate",
  "GET /api/update",
  "GET /api/llm/status",
  "POST /api/enhance",
  "POST /api/enhance/lyrics",
  "GET /artwork/:filename",
  "GET /files/:filename",
  "POST /v1/audio/speech",
  "POST /v1/audio/transcriptions",
  "GET /v1/models",
  "GET /v1/audio/voices",
  "POST /mcp",
  "GET /mcp",
  "DELETE /mcp",
  "POST /mcp/",
  "GET /mcp/",
  "DELETE /mcp/",
];

/**
 * The capability a request needs that this server has turned off, or null.
 * `route` is the matched pattern, not the URL. HEAD is checked as GET.
 */
export function refusedBy(caps: Capabilities, method: string, route: string | undefined): CapabilityKey | null {
  if (route === undefined) return null;
  const cap = GUARDED_ROUTES[`${method === "HEAD" ? "GET" : method} ${route}`];
  return cap && !caps[cap] ? cap : null;
}

/** `caps` is read per request: switching setup changes what is allowed. */
export function registerCapabilityGuards(app: FastifyInstance, caps: () => Capabilities): void {
  // onRequest runs after routing, so the matched pattern is already known and
  // nothing (body parsing included) happens for a refused request.
  app.addHook("onRequest", async (request, reply) => {
    if (refusedBy(caps(), request.method, request.routeOptions.url)) {
      return reply.code(403).send({ detail: "This server doesn't allow that." });
    }
  });
}
