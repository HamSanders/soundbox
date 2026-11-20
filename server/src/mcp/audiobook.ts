/**
 * The audiobook MCP tools' work. `server.ts` declares them (MCP_TOOLS plus
 * their `registerTool` calls, which the site build reads); this module does
 * what they say.
 *
 * Every call goes through the audiobook HTTP API in-process (`app.inject`),
 * not through the area services directly. The API is the contract the six
 * audiobook areas build to, so the tools validate exactly as the app does and
 * keep working as those services change underneath. No network is involved.
 */

import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";

import type { FastifyInstance } from "fastify";

import { tokenFromEnv } from "../auth.js";
import { DEFAULT_HOST, DEFAULT_PORT } from "../config.js";
import { isUncPath } from "../pathGuards.js";
import type { MirliService } from "../service.js";

/* ---------------------------------------------------------------- routing */

const apps = new WeakMap<MirliService, FastifyInstance>();

/** Called by `registerAudiobookBeds`, so the tools can reach the routes. */
export function setAudiobookRoutes(svc: MirliService, app: FastifyInstance): void {
  apps.set(svc, app);
}

export type Progress = (fraction: number, message?: string) => void;

interface CallOptions {
  raw?: Buffer;
  contentType?: string;
}

/** One audiobook API call. Throws the route's own error message on failure. */
export async function call<T = any>(
  svc: MirliService,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<T> {
  const app = apps.get(svc);
  if (!app) throw new Error("The audiobook API is not mounted in this server.");
  const headers: Record<string, string> = { "x-soundbox": "1" };
  const token = tokenFromEnv();
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: string | Buffer | undefined;
  if (opts.raw) {
    headers["content-type"] = opts.contentType ?? "application/octet-stream";
    payload = opts.raw;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await app.inject({ method, url, headers, payload });
  if (res.statusCode >= 400) {
    let detail = res.body;
    try {
      const parsed = JSON.parse(res.body) as { detail?: unknown; message?: unknown };
      detail = String(parsed.detail ?? parsed.message ?? res.body);
    } catch {
      /* plain text */
    }
    // The app's not-found handler answers an unknown route with this exact
    // detail; routes say what was missing ("Book not found").
    if (res.statusCode === 404 && (detail === "Not Found" || /^Route .* not found/.test(detail))) {
      throw new Error(`${method} ${url.split("?")[0]} is not available in this version of Mirli.`);
    }
    throw new Error(detail || `${method} ${url} failed (${res.statusCode})`);
  }
  return (res.body ? JSON.parse(res.body) : undefined) as T;
}

const enc = encodeURIComponent;
const book = (id: string) => `/api/audiobooks/${enc(id)}`;

/** Poll `read` until `done` says so. Returns the last value. */
async function pollUntil<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  onTick: (v: T) => void,
  timeoutS: number,
  intervalMs = 1000,
): Promise<T> {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    const v = await read();
    onTick(v);
    if (done(v)) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* ---------------------------------------------------------------- shaping */

interface ChapterLike {
  id: string;
  story_id: string;
  title: string;
  kind: string;
  included: boolean;
  status?: string;
  stats?: { paragraphs: number; voiced: number; duration_s: number };
}

interface BookLike {
  id: string;
  title: string;
  author: string | null;
  narrator: string | null;
  language: string;
  settings: Record<string, unknown>;
  chapters?: ChapterLike[];
  characters?: { id: string; name: string; voice_id: string | null; model_id: string | null }[];
  stats?: Record<string, number>;
}

export function appUrl(path: string): string {
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}/#${path}`;
}

/** What a book looks like to an agent: ids it needs next, nothing it doesn't. */
export function bookView(b: BookLike) {
  return {
    book_id: b.id,
    title: b.title,
    author: b.author,
    narrator: b.narrator,
    language: b.language,
    settings: b.settings,
    stats: b.stats,
    chapters: (b.chapters ?? []).map((c) => ({
      chapter_id: c.id,
      story_id: c.story_id,
      title: c.title,
      kind: c.kind,
      included: c.included,
      status: c.status,
      paragraphs: c.stats?.paragraphs,
      voiced: c.stats?.voiced,
      duration_s: c.stats?.duration_s,
    })),
    characters: (b.characters ?? []).map((c) => ({
      character_id: c.id,
      name: c.name,
      voice_id: c.voice_id,
      model_id: c.model_id,
    })),
    open_in_app: appUrl(`/audiobooks/${b.id}`),
  };
}

/* ------------------------------------------------------------------ tools */

export async function createAudiobook(
  svc: MirliService,
  args: {
    title: string;
    author?: string;
    narrator?: string;
    language?: string;
    model_id?: string;
    narrator_voice_id?: string;
    cast_mode?: "single" | "multi";
  },
) {
  const settings: Record<string, unknown> = {};
  if (args.model_id) settings.model_id = args.model_id;
  if (args.narrator_voice_id) settings.narrator_voice_id = args.narrator_voice_id;
  if (args.cast_mode) settings.cast_mode = args.cast_mode;
  const created = await call<BookLike>(svc, "POST", "/api/audiobooks", {
    title: args.title,
    author: args.author ?? null,
    narrator: args.narrator ?? null,
    ...(args.language ? { language: args.language } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
  });
  return bookView(created);
}

/** Manuscript formats the importer reads. */
const MANUSCRIPT_EXTENSIONS = new Set([".epub", ".pdf", ".docx", ".txt", ".md", ".markdown", ".html", ".htm", ".xhtml"]);
const MAX_MANUSCRIPT_BYTES = 200 * 1024 * 1024;

export async function importManuscript(
  svc: MirliService,
  args: {
    path?: string;
    text?: string;
    url?: string;
    format?: "txt" | "md" | "html";
    title?: string;
    author?: string;
    model_id?: string;
    narrator_voice_id?: string;
    cast_mode?: "single" | "multi";
  },
) {
  const given = [args.path, args.text, args.url].filter((v) => v !== undefined && v !== "").length;
  if (given !== 1) throw new Error("Give exactly one of `path`, `text` or `url`.");

  let preview: Record<string, unknown>;
  if (args.url) {
    preview = await call(svc, "POST", "/api/audiobooks/import/url", { url: args.url });
  } else if (args.text !== undefined && (args.format ?? "txt") === "txt") {
    // Plain pasted text has its own route, which splits chapters on headings.
    preview = await call(svc, "POST", "/api/audiobooks/import/text", { text: args.text, title: args.title ?? null });
  } else {
    let bytes: Buffer;
    let filename: string;
    if (args.path) {
      const path = args.path.trim();
      if (!isAbsolute(path)) throw new Error("`path` must be absolute.");
      if (isUncPath(path)) throw new Error("Network paths are not read.");
      const ext = extname(path).toLowerCase();
      if (!MANUSCRIPT_EXTENSIONS.has(ext)) {
        throw new Error(`Mirli imports ${[...MANUSCRIPT_EXTENSIONS].join(", ")} manuscripts; '${ext || "no extension"}' is not one.`);
      }
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new Error(`No file at ${path}.`);
      if (info.size > MAX_MANUSCRIPT_BYTES) throw new Error("That manuscript is larger than 200 MB.");
      bytes = await readFile(path);
      filename = basename(path);
    } else {
      bytes = Buffer.from(args.text!, "utf8");
      filename = `manuscript.${args.format ?? "txt"}`;
    }
    preview = await call(svc, "POST", `/api/audiobooks/import/parse?filename=${enc(filename)}`, undefined, {
      raw: bytes,
    });
  }

  // The preview's own id field; commit takes it back as `preview_id`.
  const previewId = preview.id as string | undefined;
  if (!previewId) throw new Error("The importer returned no preview id.");
  const settings: Record<string, unknown> = {};
  if (args.model_id) settings.model_id = args.model_id;
  if (args.narrator_voice_id) settings.narrator_voice_id = args.narrator_voice_id;
  if (args.cast_mode) settings.cast_mode = args.cast_mode;
  const metadata: Record<string, unknown> = {};
  if (args.title) metadata.title = args.title;
  if (args.author) metadata.author = args.author;
  const edits = Object.keys(metadata).length ? { metadata } : {};
  const committed = await call<BookLike | { book: BookLike }>(svc, "POST", "/api/audiobooks/import/commit", {
    preview_id: previewId,
    edits,
    settings,
  });
  const created = "book" in committed ? committed.book : committed;
  // The detail route carries chapters and stats whatever commit returned.
  const full = await call<BookLike>(svc, "GET", book(created.id));
  return { ...bookView(full), warnings: (preview.warnings as string[] | undefined) ?? [] };
}

export async function listAudiobooks(svc: MirliService) {
  const books = await call<BookLike[]>(svc, "GET", "/api/audiobooks");
  return {
    books: books.map((b) => ({
      book_id: b.id,
      title: b.title,
      author: b.author,
      stats: b.stats,
      open_in_app: appUrl(`/audiobooks/${b.id}`),
    })),
  };
}

export async function getAudiobook(
  svc: MirliService,
  args: { book_id: string; chapter_id?: string; offset?: number; limit?: number },
) {
  const detail = bookView(await call<BookLike>(svc, "GET", book(args.book_id)));
  if (!args.chapter_id) return detail;
  const paragraphs = await call<
    {
      id: string;
      text: string;
      kind: string;
      character_id: string | null;
      status: string;
      locked: boolean;
      is_heading: boolean;
      track_index: number;
      start_s: number;
      duration_s: number | null;
    }[]
  >(svc, "GET", `${book(args.book_id)}/chapters/${enc(args.chapter_id)}/paragraphs`);
  const narration = paragraphs.filter((p) => p.track_index === 0);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 100;
  return {
    ...detail,
    chapter_id: args.chapter_id,
    total_paragraphs: narration.length,
    offset,
    paragraphs: narration.slice(offset, offset + limit).map((p) => ({
      paragraph_id: p.id,
      text: p.text,
      kind: p.kind,
      character_id: p.character_id,
      status: p.status,
      locked: p.locked,
      is_heading: p.is_heading,
      start_s: p.start_s,
      duration_s: p.duration_s,
    })),
  };
}

export async function setCharacterVoice(
  svc: MirliService,
  args: { book_id: string; character: string; voice_id: string | null; model_id?: string | null; create?: boolean },
) {
  const who = args.character.trim();
  if (who.toLowerCase() === "narrator") {
    const settings: Record<string, unknown> = { narrator_voice_id: args.voice_id };
    if (args.model_id !== undefined) settings.model_id = args.model_id;
    const updated = await call<BookLike>(svc, "PATCH", book(args.book_id), { settings });
    return { character: "narrator", voice_id: args.voice_id, book: bookView(updated) };
  }
  const characters = await call<{ id: string; name: string; aliases?: string[] }[]>(
    svc,
    "GET",
    `${book(args.book_id)}/characters`,
  );
  const lower = who.toLowerCase();
  const match =
    characters.find((c) => c.id === who) ??
    characters.find((c) => c.name.toLowerCase() === lower) ??
    characters.find((c) => (c.aliases ?? []).some((a) => a.toLowerCase() === lower));
  const patch: Record<string, unknown> = { voice_id: args.voice_id };
  if (args.model_id !== undefined) patch.model_id = args.model_id;
  if (!match) {
    if (!args.create) {
      throw new Error(
        `No character '${who}' in this book. Known: ${characters.map((c) => c.name).join(", ") || "none"}. ` +
          "Pass create: true to add one.",
      );
    }
    const created = await call<Record<string, unknown>>(svc, "POST", `${book(args.book_id)}/characters`, {
      name: who,
      ...patch,
    });
    return { created: true, character: created };
  }
  const updated = await call<Record<string, unknown>>(
    svc,
    "PATCH",
    `${book(args.book_id)}/characters/${enc(match.id)}`,
    patch,
  );
  return { created: false, character: updated };
}

export async function addPronunciation(
  svc: MirliService,
  args: {
    book_id?: string;
    term: string;
    replacement: string;
    kind?: "alias" | "ipa" | "cmu";
    case_sensitive?: boolean;
    whole_word?: boolean;
  },
) {
  const url = args.book_id ? `${book(args.book_id)}/pronunciations` : "/api/pronunciations";
  const rule = await call<Record<string, unknown>>(svc, "POST", url, {
    term: args.term,
    replacement: args.replacement,
    kind: args.kind ?? "alias",
    case_sensitive: args.case_sensitive ?? false,
    whole_word: args.whole_word ?? true,
  });
  return { rule, scope: args.book_id ? "book" : "global" };
}

interface RunLike {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  error: string | null;
}

const RUN_FINISHED = new Set(["done", "failed", "cancelled", "paused"]);

export async function renderAudiobook(
  svc: MirliService,
  args: {
    book_id: string;
    chapter_id?: string;
    paragraph_ids?: string[];
    overwrite?: boolean;
    wait?: boolean;
    timeout_s?: number;
  },
  progress: Progress,
) {
  const scope = args.paragraph_ids?.length
    ? { kind: "paragraphs", segment_ids: args.paragraph_ids }
    : args.chapter_id
      ? { kind: "chapter", chapter_id: args.chapter_id }
      : { kind: "book" };
  const started = await call<RunLike>(svc, "POST", `${book(args.book_id)}/render`, {
    scope,
    overwrite: args.overwrite ?? false,
  });
  if (args.wait === false) return { run: started, waited: false };
  const run = await pollUntil(
    async () =>
      (await call<RunLike[]>(svc, "GET", `${book(args.book_id)}/renders`)).find((r) => r.id === started.id) ?? started,
    (r) => RUN_FINISHED.has(r.status),
    (r) => progress(r.total ? (r.done + r.failed) / r.total : 0, `${r.done} of ${r.total} paragraphs voiced`),
    args.timeout_s ?? 3600,
    1500,
  );
  const detail = bookView(await call<BookLike>(svc, "GET", book(args.book_id)));
  return {
    run,
    waited: true,
    finished: RUN_FINISHED.has(run.status),
    ...(RUN_FINISHED.has(run.status)
      ? {}
      : { note: "Still rendering. Call again with wait to keep following it, or watch it in the app." }),
    book: detail,
  };
}

interface ExportLike {
  id: string;
  status: string;
  path: string | null;
  error: string | null;
  qc: { chapter_id: string; checks: { id: string; pass: boolean; message: string }[] }[];
}

export async function masterAndExport(
  svc: MirliService,
  args: {
    book_id: string;
    format?: "mp3" | "wav" | "flac" | "m4b";
    layout?: "files" | "single";
    mastering?: "acx" | "podcast" | "none";
    bitrate_kbps?: number;
    chapter_ids?: string[];
    include_cover?: boolean;
    include_transcripts?: boolean;
    include_beds?: boolean;
    timeout_s?: number;
  },
  progress: Progress,
) {
  const format = args.format ?? "mp3";
  const request = {
    format,
    layout: args.layout ?? (format === "m4b" ? "single" : "files"),
    mastering: args.mastering ?? "acx",
    ...(format === "mp3" ? { bitrate_kbps: args.bitrate_kbps ?? 192 } : {}),
    ...(args.chapter_ids?.length ? { chapter_ids: args.chapter_ids } : {}),
    include_cover: args.include_cover ?? true,
    include_transcripts: args.include_transcripts ?? false,
    ...(args.include_beds !== undefined ? { include_beds: args.include_beds } : {}),
  };
  const beds = await call<{ has_beds: boolean; include_beds_default: boolean; warnings: { message: string }[] }>(
    svc,
    "GET",
    `${book(args.book_id)}/beds/export-info${args.chapter_ids?.length ? `?chapter_ids=${args.chapter_ids.map(enc).join(",")}` : ""}`,
  );
  if (args.include_beds === undefined && beds.has_beds) {
    (request as Record<string, unknown>).include_beds = beds.include_beds_default;
  }
  progress(0, "Mastering");
  const started = await call<ExportLike>(svc, "POST", `${book(args.book_id)}/exports`, request);
  const done = await pollUntil(
    () => call<ExportLike>(svc, "GET", `${book(args.book_id)}/exports/${enc(started.id)}`),
    (e) => e.status === "done" || e.status === "failed",
    (e) => progress(e.status === "done" ? 1 : e.status === "running" ? 0.5 : 0.1, e.status),
    args.timeout_s ?? 3600,
    1000,
  );
  if (done.status === "failed") throw new Error(done.error ?? "The export failed.");
  if (done.status !== "done") {
    return {
      export_id: done.id,
      status: done.status,
      note: "Still exporting. It carries on in the app; call soundbox.get_audiobook later or open the export history.",
      request,
    };
  }
  const failing = (done.qc ?? []).flatMap((c) =>
    c.checks.filter((k) => !k.pass).map((k) => ({ chapter_id: c.chapter_id, check: k.id, message: k.message })),
  );
  return {
    export_id: done.id,
    status: done.status,
    path: done.path,
    download_url: `http://${DEFAULT_HOST}:${DEFAULT_PORT}${book(args.book_id)}/exports/${enc(done.id)}/download`,
    request,
    qc_failures: failing,
    qc_passed: done.status === "done" && failing.length === 0,
    bed_warnings: (request as Record<string, unknown>).include_beds === false ? [] : beds.warnings.map((w) => w.message),
  };
}

interface BedLike {
  id: string;
  status: string;
  error: string | null;
  track_index: number;
  label: string;
  segment_ids: string[];
}

export async function addBed(
  svc: MirliService,
  args: {
    book_id: string;
    chapter_id: string;
    kind?: "music" | "ambience" | "sfx";
    sound_id?: string;
    prompt?: string;
    model?: string;
    duration_s?: number;
    gain_db?: number;
    mode?: "full" | "intro" | "outro" | "intro_outro";
    intro_s?: number;
    loop?: boolean;
    fade_in_s?: number;
    fade_out_s?: number;
    paragraph_id?: string;
    offset_s?: number;
    duck_db?: number;
  },
  progress: Progress,
) {
  const body: Record<string, unknown> = {
    kind: args.kind ?? "music",
    sound_id: args.sound_id,
    prompt: args.prompt,
    model_id: args.model,
    duration_s: args.duration_s,
    gain_db: args.gain_db,
    mode: args.mode,
    intro_s: args.intro_s,
    loop: args.loop,
    fade_in_s: args.fade_in_s,
    fade_out_s: args.fade_out_s,
    anchor_segment_id: args.paragraph_id,
    offset_s: args.offset_s,
  };
  if (args.duck_db !== undefined) body.duck = args.duck_db <= 0 ? false : { depth_db: args.duck_db };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const created = await call<BedLike>(
    svc,
    "POST",
    `${book(args.book_id)}/chapters/${enc(args.chapter_id)}/beds`,
    body,
  );
  let bed = created;
  if (bed.status === "generating") {
    progress(0, "Generating the bed");
    bed = await pollUntil(
      async () =>
        (await call<BedLike[]>(svc, "GET", `${book(args.book_id)}/beds?chapter_id=${enc(args.chapter_id)}`)).find(
          (b) => b.id === created.id,
        ) ?? created,
      (b) => b.status !== "generating",
      () => progress(0.5, "Generating the bed"),
      900,
      500,
    );
  }
  if (bed.status === "failed") throw new Error(bed.error ?? "The bed could not be made.");
  const chapter = (await call<BookLike>(svc, "GET", book(args.book_id))).chapters?.find((c) => c.id === args.chapter_id);
  return {
    bed,
    clips: bed.segment_ids.length,
    note: "Ducking is applied when the book is exported. Export with include_beds false for retail samples.",
    ...(chapter ? { open_in_studio: appUrl(`/studio/script/${chapter.story_id}`) } : {}),
  };
}
