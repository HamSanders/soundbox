/**
 * The application service — everything the HTTP routes and MCP tools share.
 *
 * Routes are thin adapters over this.
 * MCP tools call the same methods, which is why the two surfaces can't drift.
 */

import { randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { copyFile, mkdtemp, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import * as dsp from "./audio/dsp.js";
import * as reference from "./audio/reference.js";
import {
  VERSION,
  type AudioCppMode,
  type Config,
  type PublicSettings,
  type SettingsData,
} from "./config.js";
import {
  DEFAULT_PROFILE_ID,
  profileRoot,
  toInfo,
  uniqueId,
  writeRegistry,
  type ProfileInfo,
} from "./profiles.js";
import { Database, type ListSoundsOptions, type UpdateSoundPatch } from "./db.js";
import { normalizeChain } from "./devices.js";
import {
  CATALOG_EXTRA,
  MODELS,
  backend,
  catalog,
  catalogById,
  userModelSpecs,
  type EditSpec,
} from "./models/audiocpp.js";
import { listGpus, pickGpu } from "./gpu.js";
import { HistoryStore } from "./history.js";
import { ModelManager } from "./models/manager.js";
import * as audiocppBinary from "./models/audiocppBinary.js";
import { migrateLayout } from "./models/audiocppMigrate.js";
import { withRequirements } from "./models/params.js";
import { llmModelSpec } from "./models/llmCatalog.js";
import { CancelledJob, ModelError } from "./errors.js";
import { JobHandle, JobManager } from "./jobs.js";
import { LlmService, type LlmStatus } from "./llm/service.js";
import type { StudioContext } from "./llm/studio.js";
import type {
  AssistantModelCard,
  AssistantProposal,
  AssistantStudio,
  AssistantTurn,
} from "./llm/assistant.js";
import { ImageService, type ImageStatus } from "./image/service.js";
import { EndpointService } from "./endpoints/service.js";

/**
 * What `GET /api/models/audiocpp/runtime` answers. Shaped like `LlmStatus`'s
 * `engine` block so the Models page can render both with one component.
 */
export interface AudioCppRuntimeStatus {
  mode: AudioCppMode;
  engine: audiocppBinary.InstallStatus;
  /** The packages folder actually in force. */
  models_dir: string;
  /** What a managed install would use, so the UI can label an override as one
   *  and offer to clear it. */
  models_dir_default: string;
}
import { coverArtPrompt, voiceAvatarPrompt } from "./image/prompts.js";
import { imageModelSpec } from "./image/catalog.js";
import type { EnhanceCategory, EnhanceResult, ModelContext } from "./llm/enhance.js";
import { getLogger } from "./logging.js";
import { isUncPath, isWithin, samePath } from "./pathGuards.js";
import type {
  ModelSelfTest,
  AudioCppCatalogEntry,
  ModelInfo,
  EditKind,
  GenerateRequest,
  HealthStatus,
  Job,
  McpStatus,
  McpToolInfo,
  ConvertRequest,
  Project,
  SegmentCreate,
  SegmentGenerate,
  SegmentPatch,
  RepaintRequest,
  SeparateRequest,
  Session,
  Sound,
  SoundEditRequest,
  SoundPage,
  SpeakRequest,
  Story,
  StoryBuilder,
  StorySegment,
  StoryTrack,
  TagCount,
  TrackPatch,
  Voice,
  VoiceCreate,
  VoiceExport,
  VoicePatch,
} from "./schemas.js";
import { originLabel } from "./schemas.js";
import * as skillsMod from "./skills.js";
import {
  REST_STEM_NAME,
  selectStems,
  selectionSatisfied,
  stemKey,
  type StemSelection,
} from "./stems.js";
import { StoryHub } from "./story-hub.js";
import { McpTelemetry } from "./telemetry.js";

const log = getLogger("soundbox.service");

/** `replace(/\/+$/, "")` backtracks quadratically on a long run of slashes. */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Progress callback handed to `Model.generate()`.
 *
 * The Python version was a class so a wrapper model could reach the owning
 * `JobHandle` through a public attribute; audio.cpp's `ProgressFn` already
 * declares an optional `handle` property for exactly that, so the closure
 * carries it as a property instead of needing a class.
 */
function reporter(
  handle: JobHandle,
  base: number,
  span: number,
  label: string,
  phase = "generating",
) {
  const fn = (fraction: number, message = ""): void => {
    handle.progress(base + fraction * span, message || label, phase);
  };
  return Object.assign(fn, { handle });
}

const EDIT_LABELS: Record<SoundEditRequest["op"], string> = {
  trim: "trimmed",
  normalize: "normalised",
  reverse: "reversed",
  gain: "gain",
  highpass: "high-pass",
  lowpass: "low-pass",
  pitch: "pitch shift",
  stretch: "time-stretch",
};

/** How a derived take is named after its source: "Night drive (extended)". */
const EDIT_KIND_LABEL: Record<EditKind, string> = {
  extend: "extended",
  cover: "cover",
  repaint: "repainted",
};

export function defaultName(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  let name = words.slice(0, 6).join(" ");
  if (words.length > 6) name += "…";
  return name ? name.slice(0, 1).toUpperCase() + name.slice(1) : "Untitled";
}

/** Format a number the way Python's `%g` does, so the refusal messages below
 *  read "10s" rather than "10.0s" and match the Python byte for byte. */
function g(value: number): string {
  return String(Number(value));
}

/** Seed the generation. There is no global RNG to seed here (the sampler lives
 *  in the audio.cpp process and takes `--seed`), so this only *chooses* the
 *  seed — the Python `seed_everything()` also had to seed torch/numpy. */
function chooseSeed(seed: number | null | undefined): number {
  if (seed !== null && seed !== undefined) return seed;
  return Math.floor(Math.random() * 2 ** 31);
}

/** What "New story" names a story before you name it yourself. Also the
 *  marker `pruneEmptyStories` uses to tell an abandoned one from a deliberate
 *  blank. */
const DEFAULT_STORY_TITLE = "Untitled story";

/**
 * Open a library database, optionally sweeping what a crash left behind.
 *
 * `prune` is for startup only. The sweep exists to clear sessions and stories
 * a previous *run* abandoned, and a profile switch is not a previous run — an
 * empty session you just started, switched away from and came back to is one
 * you still mean to use, not a stray.
 */
function openDatabase(path: string, prune: boolean): Database {
  const db = new Database(path);
  if (!prune) return db;
  // Strays from a crash, where the per-job cleanup never got to run.
  const pruned = db.pruneEmptySessions();
  if (pruned) log.info(`pruned ${pruned} empty session(s) left over from a previous run`);
  const prunedStories = db.pruneEmptyStories(DEFAULT_STORY_TITLE);
  if (prunedStories) log.info(`pruned ${prunedStories} unnamed empty story/stories`);
  return db;
}

export class SoundboxService {
  readonly config: Config;
  /** Not `readonly`: switching profile closes this and opens the next
   *  profile's file. Everything else reaches the database through `svc.db` at
   *  call time, so the reassignment is the whole of it. */
  db: Database;
  readonly models: ModelManager;
  readonly jobs: JobManager;
  readonly llm: LlmService;
  readonly image: ImageService;
  /** Custom audio endpoints — see endpoints/service.ts. */
  readonly endpoints: EndpointService;
  readonly telemetry: McpTelemetry;
  /** Live story activity — see story-hub.ts. */
  readonly stories = new StoryHub();

  constructor(config: Config) {
    this.config = config;
    this.db = openDatabase(config.paths.db, true);
    this.models = new ModelManager(
      config.paths.models,
      config.settings.effectiveHfToken(),
      config.settings.enabled_audiocpp_models,
      config.settings.effectiveAudiocppModelsDir(config.paths),
      config.settings.audio_endpoints,
    );
    this.endpoints = new EndpointService(config, this.models);
    this.jobs = new JobManager();
    this.llm = new LlmService(config);
    this.image = new ImageService(config);
    this.telemetry = new McpTelemetry(this.db, config);
  }

  /** Start the background machinery. The Python took the event loop to bind
   *  its worker thread to; here the job worker is a plain async loop. */
  start(): void {
    this.jobs.start();
  }

  async close(): Promise<void> {
    this.jobs.stop();
    this.telemetry.close();
    await this.models.unload();
    // Our child process, so it does not outlive us.
    await this.models.runtime.stop();
    await this.llm.close();
    await this.image.shutdown();
    this.db.close();
  }

  /* --------------------------------------------------------------- health */

  async health(): Promise<HealthStatus> {
    // Deviation: the Python asked torch for the device, the GPU name and VRAM.
    // There is no torch in this runtime — inference happens inside audio.cpp —
    // so `device` comes from the same ggml backend detection the model uses,
    // and the hardware detail comes from nvidia-smi (see gpu.ts). Without it
    // (Metal, AMD, Intel, CPU) those fields stay null rather than being guessed.
    const gpu = pickGpu(await listGpus());
    return {
      status: "ok",
      version: VERSION,
      device: backend(),
      gpu_name: gpu?.name ?? null,
      vram_total_mb: gpu?.vram_total_mb ?? null,
      vram_free_mb: gpu?.vram_free_mb ?? null,
      loaded_model: this.models.resident,
      queue_length: this.jobs.queueLength,
    };
  }

  /* -------------------------------------------------------------- models */

  async listModels(): Promise<ModelInfo[]> {
    const infos = await this.models.listInfo();
    for (const info of infos) {
      info.avg_duration_s = this.jobs.avgDuration("generate", info.id);
      this.overlayActiveDownload(info);
    }
    return infos;
  }

  async getModel(modelId: string): Promise<ModelInfo> {
    const info = await this.models.get(modelId).status();
    info.avg_duration_s = this.jobs.avgDuration("generate", modelId);
    this.overlayActiveDownload(info);
    return info;
  }

  /**
   * Report `downloading` from the job queue itself rather than local model
   * state, so it's correct even if this is the first request a client has made
   * about the job (fresh load, or a reconnect after losing track of the job id
   * across a tab switch).
   */
  private overlayActiveDownload(info: ModelInfo): void {
    if (info.status === "error") return;
    const job = this.jobs.findActive("download", info.id);
    if (job === null) return;
    info.status = "downloading";
    info.active_job_id = job.id;
  }

  submitDownload(modelId: string): Job {
    this.models.get(modelId); // validate id before queueing
    // One download per model, ever. A second click (or a second client) while
    // the first is still in flight used to queue a duplicate job that sat
    // behind it and then re-downloaded the same 3 GB from scratch the moment
    // it finished, looking exactly like a download loop. Hand back the job
    // that is already running instead — the caller subscribes to it and sees
    // the real progress.
    const active = this.jobs.findActive("download", modelId);
    if (active !== null) return active;

    // audio.cpp has no pip extras to install — it's a native binary, not a
    // Python stack — so unlike the removed model-specific models there's
    // nothing to auto-install before downloading weights.
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      handle.phase("downloading", `Downloading ${modelId}`);
      const report = reporter(handle, 0.0, 1.0, `Downloading ${modelId}`, "downloading");
      // The fetch loop reports once per chunk, so checking here is what makes
      // a cancel actually stop the transfer. Without it the job was marked
      // cancelled while the socket kept pulling the remaining gigabytes.
      const cancellable = Object.assign(
        (fraction: number, message = ""): void => {
          handle.checkCancelled();
          report(fraction, message);
        },
        { handle },
      );
      await this.models.download(modelId, cancellable);
      return { model: modelId };
    };

    return this.jobs.submit("download", { model: modelId }, runner);
  }

  async loadModel(modelId: string): Promise<ModelInfo> {
    return await this.models.load(modelId);
  }

  async unloadModel(modelId: string | null = null): Promise<ModelInfo | null> {
    return await this.models.unload(modelId);
  }

  async deleteWeights(modelId: string): Promise<void> {
    await this.models.deleteWeights(modelId);
  }

  /**
   * One short render through the normal path, timed, and thrown away: the
   * quickest way to learn whether a model actually runs here, and how fast,
   * without a sound landing in the library. Loads the model if it is not
   * resident, which is part of what is being measured.
   */
  async selfTestModel(modelId: string): Promise<ModelSelfTest> {
    const model = this.models.get(modelId); // throws ModelError on an unknown id
    const info = model.describe();
    const device = (await this.health()).device;
    const fail = (error: string, elapsedS = 0): ModelSelfTest => ({
      model: modelId,
      device,
      ok: false,
      elapsed_s: elapsedS,
      rendered_s: null,
      error,
    });
    if (info.task !== "gen" && info.task !== "tts") {
      return fail(
        `${info.name} is a ${info.task} model: the self-test renders a one-second clip from a ` +
          `prompt and has nothing to feed it. Run it on a real sound instead.`,
      );
    }
    if (info.requires_voice_reference) {
      return fail(
        `${info.name} only reads with a cloned voice, so it has no voice of its own to test ` +
          `with. Try it from the Voice Lab instead.`,
      );
    }

    // Through the queue, like any render: running beside a job could load
    // this model over one that is mid-render. The route waits for the job,
    // which the runner settles; a job cancelled before it starts settles it
    // from the poll below instead.
    let settle!: (result: ModelSelfTest) => void;
    const result = new Promise<ModelSelfTest>((resolve) => (settle = resolve));
    const job = this.jobs.submit("selftest", { model: modelId }, async (handle) => {
      const started = Date.now();
      try {
        if (!model.loaded) {
          handle.phase("loading", `Loading ${info.name}`);
          await this.models.load(modelId);
        }
        this.models.touch();
        handle.phase("generating", "Self-test");
        const rendered =
          info.task === "gen"
            ? await model.generate("a single short wooden click", 1, {
                steps: info.defaults.steps ?? null,
              })
            : await model.speak("Soundbox self test.", {});
        const samples = rendered.audio[0]?.length ?? 0;
        settle({
          model: modelId,
          device,
          ok: true,
          elapsed_s: round3((Date.now() - started) / 1000),
          rendered_s: round3(samples / rendered.sampleRate),
          error: null,
        });
      } catch (exc) {
        settle(fail(exc instanceof Error ? exc.message : String(exc), round3((Date.now() - started) / 1000)));
      }
      return { sounds: [] };
    });
    const watch = setInterval(() => {
      const status = this.jobs.get(job.id)?.status;
      if (status === "cancelled") settle(fail("Cancelled before it ran."));
    }, 500);
    try {
      return await result;
    } finally {
      clearInterval(watch);
    }
  }

  /* ------------------------------------------------------------- generate */

  submitGenerate(request: GenerateRequest): Job {
    const model = this.models.get(request.model); // throws ModelError on unknown id
    const info = model.describe();
    if (request.duration_s > info.max_duration_s) {
      throw new ModelError(
        `${info.name} generates at most ${g(info.max_duration_s)}s; ` +
          `${g(request.duration_s)}s was requested.`,
      );
    }
    if (info.max_cfg !== null && info.max_cfg !== undefined && request.cfg !== null && request.cfg !== undefined && request.cfg > info.max_cfg) {
      // Refused rather than clamped: silently rendering at a different guidance
      // than asked for is how you get a "why does seed 7 sound different" bug
      // report. Past this ceiling the output is broadband noise, so failing
      // loudly is the kinder outcome.
      throw new ModelError(
        `${info.name} is tuned for a guidance scale of ` +
          `${g(info.defaults.cfg ?? 1.0)} and degrades into noise above ` +
          `${g(info.max_cfg)}; cfg ${g(request.cfg)} was requested. ` +
          `Lower the CFG scale to ${g(info.max_cfg)} or less.`,
      );
    }

    // A named separator is checked on submit, like the edit source above, so a
    // wrong id fails now rather than after a full render.
    if (request.separate?.model) {
      const sep = this.models.get(request.separate.model).describe();
      if (sep.task !== "sep") {
        throw new ModelError(`${sep.name} does not support stem separation.`);
      }
    }

    // Resolve the session up front rather than inside the runner: the id comes
    // back on the job's request, so a brand-new session shows up in the sidebar
    // the moment the job is queued instead of only once the first sound lands,
    // which can be minutes later.
    const req: GenerateRequest = {
      ...request,
      session_id: this.ensureSession({ ...request, title: request.prompt }),
    };

    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      try {
        return await this.runGenerate(handle, req);
      } catch (exc) {
        // Cancelled or failed before writing anything: don't strand an empty
        // session in the sidebar. deleteIfEmpty only prunes a session with no
        // sounds, so a partly-successful batch stays.
        if (req.session_id && this.db.deleteIfEmpty(req.session_id)) {
          log.info(`pruned empty session ${req.session_id}`);
        }
        throw exc;
      }
    };

    return this.jobs.submit("generate", { ...req }, runner);
  }

  private async runGenerate(
    handle: JobHandle,
    req: GenerateRequest,
  ): Promise<Record<string, unknown>> {
    const model = this.models.get(req.model);
    const info = model.describe();
    const origin = req.origin ?? null;

    // An edit of an existing sound: resolve the source before loading
    // anything, so a bad id fails in milliseconds rather than after a model
    // load. The schema already guarantees `edit` and `source_sound_id` come
    // together.
    let source: Sound | null = null;
    if (req.edit && req.source_sound_id) {
      if (!info.supports[req.edit]) {
        throw new ModelError(`${info.name} cannot ${req.edit} an existing sound.`);
      }
      source = this.db.getSound(req.source_sound_id);
      if (source === null) throw new ModelError(`Source sound '${req.source_sound_id}' not found.`);
      if (req.edit === "extend" && req.duration_s <= source.duration_s) {
        throw new ModelError(
          `Extending needs a duration longer than the source (${g(round3(source.duration_s))}s).`,
        );
      }
      // A target past the model's own ceiling is not refused: it is run as a
      // series of windowed passes instead. See `extendWindowed`.
      if (req.edit === "repaint" && (req.edit_options?.repaint_end_s ?? 0) > source.duration_s) {
        throw new ModelError(`Repaint window ends past the source (${g(round3(source.duration_s))}s).`);
      }
    }

    if (!model.loaded) {
      handle.phase("loading", `Loading ${info.name}`);
      await this.models.load(req.model, (f, m) => handle.progress(f * 0.3, m, "loading"));
    }
    this.models.touch();

    // The edit routes want the clip at the model's own rate — same
    // constraint as stem separation (see runSeparate), same fix: resample
    // into a temp file rather than push that onto every library sound.
    let editSpec: EditSpec | null = null;
    let editTmp: string | null = null;
    /** Set when the extend has to be windowed: the source's own samples. */
    let windowed: { audio: dsp.Audio; sampleRate: number } | null = null;
    if (source && req.edit) {
      const sourcePath = this.absolutePath(source.id);
      if (sourcePath === null) throw new ModelError(`Source sound '${source.id}' has no file on disk.`);
      let inputPath = sourcePath;
      const { audio: sourceAudio, sampleRate: sourceRate } = dsp.readWav(sourcePath);
      if (sourceRate !== info.sample_rate) {
        editTmp = await mkdtemp(join(tmpdir(), "soundbox-edit-resample-"));
        inputPath = join(editTmp, "resampled.wav");
        dsp.writeWav(
          inputPath,
          dsp.resampleAudio(sourceAudio, sourceRate, info.sample_rate),
          info.sample_rate,
        );
      }
      editSpec = {
        kind: req.edit,
        sourceAudioPath: inputPath,
        sourceDurationS: sourceAudio[0].length / sourceRate,
        options: req.edit_options ?? {},
      };
      // A target past what the model can render in one pass is run as a series
      // of windowed passes instead of refused — see `extendWindowed`. The
      // samples are kept rather than re-read there, since they are already
      // decoded here.
      if (req.edit === "extend" && req.duration_s > info.max_duration_s) {
        windowed = { audio: sourceAudio, sampleRate: sourceRate };
      }
    }

    const soundIds: string[] = [];
    const n = req.variations;
    try {
      for (let i = 0; i < n; i++) {
        handle.checkCancelled();
        const base = 0.3 + (i / n) * 0.7;
        const span = 0.7 / n;
        const label = n > 1 ? `Variation ${i + 1}/${n}` : "Generating";
        handle.phase("generating", label);

        // Only reuse an explicit seed for the first variation — otherwise every
        // "variation" would be byte-identical.
        const usedSeed = chooseSeed(i === 0 ? req.seed : null);

        let generated: { audio: dsp.Audio; sampleRate: number };
        try {
          // A target the model cannot reach in one render is assembled from
          // several windowed passes. Everything downstream — writing the file,
          // the peaks, the Sound row — is the same either way.
          generated = windowed
            ? await this.extendWindowed(model, info, req, windowed, usedSeed, handle)
            : await model.generate(req.prompt, req.duration_s, {
                negativePrompt: req.negative_prompt,
                seed: usedSeed,
                steps: req.steps,
                cfg: req.cfg,
                lyrics: info.supports.lyrics ? req.lyrics : null,
                trackName: info.supports.lyrics ? req.track_name : null,
                edit: editSpec,
                progress: reporter(handle, base, span, label),
              });
        } catch (exc) {
          if (exc instanceof ModelError || exc instanceof CancelledJob) throw exc;
          // Deviation: the Python ran the exception through
          // `explain_runtime_error()`, which mapped torch OOM/CUDA failures to
          // advice. Those cases live inside the audio.cpp process now and the
          // adapter already turns its failures into ModelError with the child's
          // output attached, so anything reaching here is genuinely unexpected.
          throw new ModelError(exc instanceof Error ? exc.message : String(exc));
        }

        handle.checkCancelled();
        handle.progress(base + span * 0.9, "Writing audio", "encoding");

        const soundId = randomUUID();
        const path = join(this.config.paths.sounds, `${soundId}.wav`);
        const settings = this.config.settings;
        const { sizeBytes, durationS, peaks, channels } = dsp.processAndWrite(
          generated.audio,
          generated.sampleRate,
          path,
          { trim: settings.trim_silence, normalizeLufs: settings.normalize_lufs },
        );

        const sound: Sound = {
          id: soundId,
          created_at: now(),
          model: req.model,
          prompt: req.prompt,
          negative_prompt: req.negative_prompt ?? null,
          lyrics: info.supports.lyrics ? req.lyrics ?? null : null,
          track_name: info.supports.lyrics ? req.track_name ?? null : null,
          edit: req.edit ?? null,
          edit_options: req.edit ? req.edit_options ?? null : null,
          duration_s: round3(durationS),
          seed: usedSeed,
          steps: info.supports.steps ? req.steps ?? null : null,
          cfg: info.supports.cfg ? req.cfg ?? null : null,
          sample_rate: generated.sampleRate,
          channels,
          file: `/files/${soundId}.wav`,
          peaks,
          favorite: false,
          tags: req.tags,
          name:
            (source && req.edit ? `${source.name} (${EDIT_KIND_LABEL[req.edit]})` : defaultName(req.prompt)) +
            (n > 1 ? ` ${i + 1}` : ""),
          size_bytes: sizeBytes,
          session_id: req.session_id ?? null,
          source: origin?.source ?? "api",
          client: originLabel(origin),
          parent_id: source?.id ?? null,
        };
        this.db.insertSound(sound, `${soundId}.wav`);
        soundIds.push(soundId);
        // After the sound is committed, never before: artwork is a follow-on
        // that must not delay or fail the generation it decorates.
        this.maybeQueueArtwork(sound);
      }
    } finally {
      if (editTmp) await rm(editTmp, { recursive: true, force: true }).catch(() => {});
    }

    this.models.touch();

    // Asked for stems rather than a mix: the render was the means, so the job
    // is not done until the split is. Reporting the mix first and separating
    // afterwards would hand back the one thing that was not wanted, and leave
    // the caller polling for the parts.
    if (req.separate && soundIds.length) {
      const sepModel = req.separate.model ?? (await this.pickSeparator());
      const stemIds: string[] = [];
      for (const id of soundIds) {
        const rendered = this.db.getSound(id);
        if (rendered === null) continue;
        const result = await this.runSeparate(
          handle,
          { model: sepModel, source_sound_id: id, stems: req.separate },
          rendered,
        );
        stemIds.push(...((result.sounds as string[]) ?? []));
      }
      this.models.touch();
      // `sounds` is what a caller lays out, so it is the stems. The mixes stay
      // in the library as their parents and are named rather than hidden.
      if (stemIds.length) return { sounds: stemIds, sources: soundIds };
    }

    return { sounds: soundIds };
  }

  /* -------------------------------------------------------------- sessions */

  listSessions(limit = 50): Session[] {
    return this.db.listSessions(limit);
  }

  getSession(sessionId: string): Session | null {
    return this.db.getSession(sessionId);
  }

  createSession(title?: string | null, projectId: string | null = null): Session {
    return this.db.createSession(randomUUID(), title || "New session", now(), projectId);
  }

  renameSession(sessionId: string, title: string): Session | null {
    return this.db.renameSession(sessionId, title);
  }

  setSessionProject(sessionId: string, projectId: string | null): Session | null {
    return this.db.setSessionProject(sessionId, projectId);
  }

  /** Delete a session and everything generated in it. */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (this.db.getSession(sessionId) === null) return false;
    for (const filename of this.db.deleteSession(sessionId)) {
      // Removing the row does not reclaim the disk, and the audio is the part
      // that actually takes space.
      await unlinkQuiet(join(this.config.paths.sounds, filename));
    }
    return true;
  }

  /**
   * Resolve the session a generation belongs to, creating one if needed.
   *
   * Titling it from the first prompt is what makes the sidebar readable — a
   * list of "New session" entries is no more use than a list of uuids. A stale
   * id (the session was deleted mid-compose) starts a fresh one rather than
   * failing the generation the user just asked for.
   */
  /**
   * The session this request belongs in, creating one if it doesn't exist.
   *
   * Takes the title source rather than a whole GenerateRequest so a spoken
   * read threads into the sidebar exactly like a generated sound does — the
   * title comes from the script instead of a prompt, but nothing else about
   * "which conversation is this part of" differs by task.
   */
  ensureSession(req: {
    session_id?: string | null;
    project_id?: string | null;
    title: string;
  }): string {
    if (req.session_id && this.db.getSession(req.session_id) !== null) return req.session_id;
    return this.createSession(defaultName(req.title), req.project_id ?? null).id;
  }

  /* -------------------------------------------------------------- projects */

  listProjects(): Project[] {
    return this.db.listProjects();
  }

  createProject(name: string): Project {
    return this.db.createProject(randomUUID(), name, now());
  }

  /** Delete the project. Its sounds stay in the library, just unfiled —
   *  organisation, unlike a session, isn't history worth losing. */
  deleteProject(projectId: string): boolean {
    return this.db.deleteProject(projectId);
  }

  /* --------------------------------------------------------------- stories */

  listStories(limit = 50, withTimeline = false): Story[] {
    return this.db.listStories(limit, withTimeline);
  }

  getStory(storyId: string): Story | null {
    return this.db.getStory(storyId);
  }

  createStory(
    title?: string | null,
    projectId: string | null = null,
    builder: StoryBuilder = "script",
  ): Story {
    return this.db.createStory(
      randomUUID(),
      title || DEFAULT_STORY_TITLE,
      now(),
      projectId,
      builder,
    );
  }

  renameStory(storyId: string, title: string): Story | null {
    const story = this.db.renameStory(storyId, title);
    if (story) this.stories.changed(storyId);
    return story;
  }

  /** Set the story's default delivery. Empty puts every line that has no
   *  override of its own back on the model's defaults. */
  setStoryOptions(storyId: string, options: Record<string, string>): Story | null {
    const story = this.db.setStoryOptions(storyId, options);
    if (story !== null) this.stories.changed(storyId);
    return story;
  }

  setStoryProject(storyId: string, projectId: string | null): Story | null {
    const story = this.db.setStoryProject(storyId, projectId);
    if (story) this.stories.changed(storyId);
    return story;
  }

  /** Delete a story. `deleteSounds` decides whether its generated audio goes
   *  with it or stays in the library unfiled — see `Database.deleteStory`. */
  async deleteStory(storyId: string, deleteSounds = false): Promise<boolean> {
    if (this.db.getStory(storyId) === null) return false;
    for (const filename of this.db.deleteStory(storyId, deleteSounds)) {
      await unlinkQuiet(join(this.config.paths.sounds, filename));
      await unlinkQuiet(join(this.config.paths.cache, `${filename.replace(/\.[^.]*$/, "")}.mp3`));
    }
    return true;
  }

  listSegments(storyId: string): StorySegment[] {
    return this.db.listSegments(storyId);
  }

  getSegment(segmentId: string): StorySegment | null {
    return this.db.getSegment(segmentId);
  }

  createSegment(storyId: string, values: SegmentCreate): StorySegment {
    // A clip needs a duration up front or it has no width and the
    // auto-placement after it has nothing to measure. An inserted sound gets
    // its own; a pause is *only* its duration, so the caller states it.
    let durationS: number | null = values.duration_s ?? null;
    if (values.sound_id) {
      const sound = this.db.getSound(values.sound_id);
      if (sound === null) throw new ModelError(`Sound '${values.sound_id}' not found.`);
      // A stated duration is a trimmed clip being put back; it can play less
      // of the sound than there is, never more.
      const available = Math.max(0, sound.duration_s - (values.trim_start_s ?? 0));
      durationS = values.duration_s != null ? Math.min(values.duration_s, available) : available;
    }
    const segment = this.db.createSegment(randomUUID(), storyId, now(), {
      ...values,
      durationS,
    });
    this.stories.changed(storyId);
    return segment;
  }

  updateSegment(segmentId: string, patch: SegmentPatch): StorySegment | null {
    // A clip pointed at audio that is not there plays silence and says
    // nothing about why, so the id is checked here rather than discovered at
    // playback.
    if (patch.sound_id) {
      if (this.db.getSound(patch.sound_id) === null) {
        throw new ModelError(`Sound '${patch.sound_id}' not found.`);
      }
    }
    // A move re-reads the script to match, so undoing a drag (or an agent
    // moving a clip) keeps the two views in step without a second call.
    const segment = this.db.updateSegment(segmentId, patch, { followPlacement: true });
    if (segment) this.stories.changed(segment.story_id);
    return segment;
  }

  reorderSegments(storyId: string, orderedIds: string[]): boolean {
    const ok = this.db.reorderSegments(storyId, orderedIds);
    if (ok) this.stories.changed(storyId);
    return ok;
  }

  deleteSegment(segmentId: string): boolean {
    // Read the parent before the row goes, or there is nothing left to tell.
    const storyId = this.db.getSegment(segmentId)?.story_id ?? null;
    const ok = this.db.deleteSegment(segmentId);
    if (ok && storyId) this.stories.changed(storyId);
    return ok;
  }


  listTracks(storyId: string): StoryTrack[] {
    return this.db.listTracks(storyId);
  }

  updateTrack(storyId: string, trackIndex: number, patch: TrackPatch): StoryTrack | null {
    if (this.db.getStory(storyId) === null) return null;
    // Every chain is normalised on the way in, whoever sent it, so what reads
    // back is always a chain the studio's rack can build.
    if (patch.devices !== undefined) patch = { ...patch, devices: normalizeChain(patch.devices) };
    const track = this.db.updateTrack(storyId, trackIndex, patch);
    this.stories.changed(storyId);
    return track;
  }

  /** Remove a lane and the clips on it. Returns how many clips went, or null
   *  when the story does not exist. */
  deleteTrack(storyId: string, trackIndex: number): number | null {
    if (this.db.getStory(storyId) === null) return null;
    const removed = this.db.deleteTrack(storyId, trackIndex);
    this.stories.changed(storyId);
    return removed.length;
  }

  /**
   * Which tracks are audible, and how loud.
   *
   * Solo wins over mute, as it does on any desk: the moment one track is
   * soloed the question stops being "what have I silenced" and becomes "what
   * am I listening to". Returns null for a track that should not be heard, so
   * callers can skip rather than mix in silence.
   */
  private trackGains(storyId: string): Map<number, number | null> {
    const tracks = this.db.listTracks(storyId);
    const soloing = tracks.some((t) => t.soloed);
    const gains = new Map<number, number | null>();
    for (const t of tracks) {
      const audible = soloing ? t.soloed : !t.muted;
      gains.set(t.track_index, audible ? t.gain_db : null);
    }
    // A track with no row is at defaults: audible unless something else is
    // soloed, and at unity gain.
    gains.set(Number.NaN, soloing ? null : 0);
    return gains;
  }

  /**
   * Speak one segment and attach the result to it.
   *
   * The same per-line synthesis `runSpeak` does, for one line, kept in the
   * timeline's terms: the audio lands in the library as an ordinary Sound (so
   * it is playable, renameable and exportable like anything else) and the
   * segment simply points at it. Regenerating leaves the old take in the
   * library rather than destroying it — same non-destructive bargain as
   * `editSound`.
   */
  async generateSegment(
    segmentId: string,
    req: SegmentGenerate,
    handle?: JobHandle,
  ): Promise<StorySegment | null> {
    const segment = this.db.getSegment(segmentId);
    if (segment === null) return null;
    if (!segment.text.trim()) throw new ModelError("This line has no text to speak.");

    const model = this.models.get(req.model);
    const info = model.describe();
    if (info.task !== "tts") {
      throw new ModelError(`${info.name} is not a text-to-speech model.`);
    }
    if (!model.loaded) {
      handle?.phase("loading", `Loading ${info.name}`);
      await this.models.load(req.model, (f, m) => handle?.progress(f * 0.2, m, "loading"));
    }
    this.models.touch();

    handle?.phase("generating", "Speaking");
    const { refPath, builtinId } = this.resolveVoice(segment.voice_id ?? null);
    const clip = await model.speak(segment.text, {
      voiceRefPath: refPath,
      voiceId: builtinId,
      seed: req.seed ?? null,
      steps: req.steps ?? null,
      cfg: req.cfg ?? null,
      loadOptions: req.load_options,
      requestOptions: this.deliveryFor(segment, info.family, req.request_options),
      progress: handle ? reporter(handle, 0.2, 0.7, "Speaking") : undefined,
    });

    handle?.progress(0.93, "Writing audio", "encoding");
    const story = this.db.getStory(segment.story_id);
    const sound = this.writeSound(clip.audio, clip.sampleRate, {
      model: req.model,
      prompt: segment.text.slice(0, 2000),
      name: defaultName(segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text),
      seed: req.seed ?? null,
      steps: info.supports.steps ? req.steps ?? null : null,
      cfg: info.supports.cfg ? req.cfg ?? null : null,
      projectId: story?.project_id ?? null,
      voiceId: segment.voice_id ?? null,
      // Never trim: a line's leading silence is part of its timing, and the
      // timeline positions clips itself.
      trim: false,
      normalize: true,
    });

    this.models.touch();
    const voiced = this.db.setSegmentSound(segmentId, sound.id, sound.duration_s);
    this.stories.changed(segment.story_id);

    // A line that has never been placed sits at 0:00, because until it has
    // audio there is no length to append it after — so every unvoiced line in
    // a fresh story stacks in the same spot. Now that this one has a duration,
    // lay it after whatever else is on its track. Only when it is still at
    // zero: a clip the user has already dragged somewhere keeps its place.
    if (voiced && voiced.start_s === 0) {
      const trackEnd = this.db
        .listSegments(segment.story_id)
        .filter((s) => s.id !== segmentId && s.track_index === voiced.track_index)
        .reduce((end, s) => Math.max(end, s.start_s + (s.duration_s ?? 0)), 0);
      if (trackEnd > 0) {
        return this.db.updateSegment(segmentId, { start_s: round3(trackEnd) });
      }
    }
    return voiced;
  }

  /**
   * What this line is actually read with.
   *
   * Three layers, narrowest last: the story's default delivery, then the
   * line's own override, then anything the caller sent for this take alone.
   * That order is the point of storing them at all — a script is written once
   * with one delivery and then argued with on two lines, and a re-read has to
   * reproduce those two lines rather than flattening everything back to the
   * model's defaults.
   *
   * `withRequirements` closes the trap on the way out: a family can list a knob
   * that does nothing until its companion is set (VibeVoice's `temperature`
   * needs `do_sample=true`), and a slider that silently does nothing is worse
   * than no slider at all.
   */
  private deliveryFor(
    segment: StorySegment,
    family: string,
    override?: Record<string, string>,
  ): Record<string, string> {
    const story = this.db.getStory(segment.story_id);
    return withRequirements(family, {
      ...(story?.request_options ?? {}),
      ...segment.request_options,
      ...(override ?? {}),
    });
  }

  /** Speaking a line goes through the job queue for the same reason every
   *  other generation does: it takes real time, and the UI already knows how
   *  to show a job's progress. */
  submitSegmentGenerate(segmentId: string, request: SegmentGenerate): Job {
    if (this.db.getSegment(segmentId) === null) {
      throw new ModelError("Line not found.");
    }
    this.models.get(request.model); // throws ModelError on unknown id, before queueing
    return this.jobs.submit("segment", { ...request, segment_id: segmentId }, async (handle) => {
      const segment = await this.generateSegment(segmentId, request, handle);
      return { sounds: segment?.sound_id ? [segment.sound_id] : [], segment_id: segmentId };
    });
  }

  submitStoryExport(storyId: string): Job {
    if (this.db.getStory(storyId) === null) {
      throw new ModelError("Story not found.");
    }
    return this.jobs.submit("export", { story_id: storyId }, async (handle) => {
      const sound = this.exportStory(storyId, handle);
      return { sounds: sound ? [sound.id] : [], story_id: storyId };
    });
  }

  /**
   * Cut a generated segment in two at `atS`, seconds into the clip as it plays
   * on the timeline — not into its source sound, which a trimmed clip only
   * plays part of.
   *
   * Both halves become real derived Sounds (`parent_id` pointing at the take
   * they came from) rather than start/end offsets into the original, because
   * every other thing that consumes a segment — playback, export, the library
   * — already knows how to handle a Sound and would otherwise each need to
   * learn about partial clips. Each half is cut from the part of the source
   * the clip actually plays, `trim_start_s` onward for `duration_s`, so both
   * are untrimmed clips of exactly what was heard either side of the cut. The
   * second half keeps the original's place in time by starting exactly where
   * the first half ends.
   */
  splitSegment(segmentId: string, atS: number): StorySegment[] | null {
    const segment = this.db.getSegment(segmentId);
    if (segment === null) return null;
    if (!segment.sound_id || !segment.sound) {
      throw new ModelError("This line has not been generated yet, so there is nothing to split.");
    }
    // What plays: `duration_s` of the source from `trim_start_s`, or the rest
    // of the source when no length is set — the same reading the export makes.
    const inPoint = segment.trim_start_s ?? 0;
    const available = segment.sound.duration_s - inPoint;
    const duration = Math.min(segment.duration_s ?? available, available);
    if (atS <= 0 || atS >= duration) {
      throw new ModelError("Split point has to fall inside the clip.");
    }

    const filename = this.db.getFilename(segment.sound_id);
    if (filename === null) throw new ModelError("The audio for this line is missing.");
    const { audio, sampleRate } = dsp.readWav(join(this.config.paths.sounds, filename));

    const source = segment.sound;
    const cut = inPoint + atS;
    const halves = [
      { audio: dsp.trimRange(audio, sampleRate, inPoint, cut), suffix: "a" },
      { audio: dsp.trimRange(audio, sampleRate, cut, inPoint + duration), suffix: "b" },
    ].map(({ audio: half, suffix }) =>
      this.writeSound(half, sampleRate, {
        model: source.model,
        prompt: source.prompt,
        name: `${source.name} (${suffix})`,
        seed: source.seed ?? null,
        steps: source.steps ?? null,
        cfg: source.cfg ?? null,
        projectId: source.project_id ?? null,
        parentId: source.id,
        trim: false,
        // Nor normalised: loudness is measured per file, so each half would
        // get its own gain and the level would jump where they meet. A split
        // only moves where the take is cut, never how loud it is.
        normalize: false,
      }),
    );

    // The text goes with the first half rather than being guessed at: there is
    // no honest way to know which words fell either side of an arbitrary cut,
    // and silently truncating a line's script would be worse than leaving the
    // second half's text for the user to fill in.
    //
    // The clip's edges go with the edges they belong to: the head keeps the
    // fade in and the tail takes the fade out, and neither fades at the cut,
    // where the two halves meet and should play straight through. Gain and
    // mute are the clip's, so both halves keep them. The head's trim goes to
    // 0 because its new sound already starts at the old in-point.
    const [head, rest] = [halves[0]!, halves[1]!];
    this.db.updateSegment(segmentId, {
      sound_id: head.id,
      duration_s: head.duration_s,
      trim_start_s: 0,
      fade_out_s: 0,
    });
    const tail = this.db.createSegment(randomUUID(), segment.story_id, now(), {
      speaker: segment.speaker,
      voice_id: segment.voice_id,
      text: "",
      language: segment.language,
      track_index: segment.track_index,
      position: segment.position + 1,
      start_s: segment.start_s + head.duration_s,
      sound_id: rest.id,
      durationS: rest.duration_s,
      fade_out_s: segment.fade_out_s,
      gain_db: segment.gain_db,
      muted: segment.muted,
    });

    this.stories.changed(segment.story_id);
    return [this.db.getSegment(segmentId)!, this.db.getSegment(tail.id)!];
  }

  /**
   * Extend a clip past the model's own maximum length, by feeding it its own
   * tail.
   *
   * "Extend" is a repaint whose window starts past the end of the source, so
   * the target length is what runs into `max_duration_s` — a 60-second clip on
   * a 60-second model has nowhere to go, and every model here caps somewhere.
   *
   * The way through is that the repaint returns the clip it was given
   * **bit-for-bit** before the new material. So the model does not need the
   * whole take: hand it only the last `window` seconds, ask for
   * `window + stride` in total, and everything past `window` in the result is
   * new audio that continues from exactly where the source ended. Append it
   * and repeat until the caller's target length is reached.
   *
   * The cost is context, not continuity. Each pass sees only the previous
   * tail, so the join is seamless but long-range structure can drift — a
   * fourth pass has no memory of the opening. Feeding a longer window buys
   * coherence and costs stride, since the two must fit inside one generation:
   *
   *     window + stride ≤ max_duration_s
   *
   * Half and half is the default. It is the one split that is not obviously
   * wrong in either direction, and the caller can override it.
   */
  private async extendWindowed(
    model: ReturnType<ModelManager["get"]>,
    info: ReturnType<ReturnType<ModelManager["get"]>["describe"]>,
    req: GenerateRequest,
    source: { audio: dsp.Audio; sampleRate: number },
    seed: number | null,
    handle: JobHandle,
  ): Promise<{ audio: dsp.Audio; sampleRate: number }> {
    const rate = info.sample_rate;
    const cap = info.max_duration_s;
    // Everything below works at the model's rate; the caller resamples the
    // finished take back if the source was recorded at another.
    const sourceAtRate =
      source.sampleRate === rate
        ? source.audio
        : dsp.resampleAudio(source.audio, source.sampleRate, rate);

    const requestedWindow = req.edit_options?.extend_window_s ?? cap / 2;
    // Leave room for something to be generated, and never claim to feed more
    // tail than exists.
    const window = Math.min(
      Math.max(requestedWindow, cap * 0.1),
      cap * 0.9,
      dsp.frameCount(sourceAtRate) / rate,
    );
    const stride = cap - window;

    let take = sourceAtRate;
    const target = req.duration_s;
    const passes = Math.ceil((target - dsp.frameCount(take) / rate) / stride);

    for (let pass = 0; pass < passes; pass += 1) {
      handle.checkCancelled();
      const haveS = dsp.frameCount(take) / rate;
      if (haveS >= target - 0.01) break;

      handle.phase("generating", `Extending — pass ${pass + 1} of ${passes}`);
      handle.progress(0.3 + (pass / passes) * 0.6, `Extending — pass ${pass + 1} of ${passes}`);

      // The tail, written where the CLI can read it. A fresh directory per
      // pass rather than one file rewritten, so a crashed pass cannot leave a
      // half-written clip for the next one to read.
      const tmp = await mkdtemp(join(tmpdir(), "soundbox-extend-"));
      try {
        const tailPath = join(tmp, "tail.wav");
        const tail = dsp.trimRange(take, rate, haveS - window, haveS);
        dsp.writeWav(tailPath, tail, rate);

        // Ask for exactly as much as is still wanted, never more than the cap.
        const wantS = Math.min(cap, window + (target - haveS));
        const result = await model.generate(req.prompt, wantS, {
          negativePrompt: req.negative_prompt,
          seed,
          steps: req.steps,
          cfg: req.cfg,
          lyrics: req.lyrics,
          trackName: req.track_name,
          edit: {
            kind: "extend",
            sourceAudioPath: tailPath,
            sourceDurationS: window,
            options: req.edit_options ?? {},
          },
        });

        const produced = dsp.frameCount(result.audio) / result.sampleRate - window;
        if (produced <= 0.01) {
          // The model returned the tail and nothing else. Continuing would
          // spin, so stop with what there is rather than looping on empty.
          break;
        }
        take = dsp.concatAudio(
          [take, dsp.trimRange(result.audio, result.sampleRate, window, Number.MAX_SAFE_INTEGER)],
          rate,
        );
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    }

    // The final pass usually overshoots, because the model renders whole
    // seconds of its own choosing rather than stopping where asked.
    const haveS = dsp.frameCount(take) / rate;
    if (haveS > target + 0.01) take = dsp.trimRange(take, rate, 0, target);
    return { audio: take, sampleRate: rate };
  }

  /**
   * Flatten a story's timeline into one sound.
   *
   * Unlike `runSpeak`'s concatenation, this honours where clips actually sit:
   * each one is written at its own `start_s`, gaps stay silent, and clips that
   * overlap — the reason tracks exist — sum together. Muted clips are skipped
   * and per-clip gain is applied on the way in, so what you export is what the
   * timeline was playing.
   */
  exportStory(storyId: string, handle?: JobHandle): Sound | null {
    const story = this.db.getStory(storyId);
    if (story === null) return null;
    // A track's mute/solo and its gain sit on top of each clip's own — the
    // clip says "leave this line out", the track says "I am not listening to
    // this part". Both have to be honoured or the export is not what was
    // playing.
    const gains = this.trackGains(storyId);
    const trackGain = (lane: number): number | null =>
      gains.has(lane) ? gains.get(lane)! : gains.get(Number.NaN)!;
    const segments = this.db
      .listSegments(storyId)
      .filter((s) => !s.muted && s.sound_id && trackGain(s.track_index) !== null);
    if (segments.length === 0) {
      throw new ModelError("Nothing to export: no line in this story has audio yet.");
    }

    /**
     * How long each clip fades at each end.
     *
     * Two sources, taking whichever is longer. A clip's own `fade_in_s` and
     * `fade_out_s` are what someone asked for. On top of that, two clips that
     * overlap on the same lane get a crossfade across the overlap for free:
     * without one they sum, which is a lump in the level at best and a click
     * at both edges at worst, and *nobody* overlaps two clips wanting that.
     *
     * The timeline applies exactly this rule when it schedules playback, so
     * what you hear while arranging is what the mixdown writes.
     */
    const crossfades = new Map<string, { in: number; out: number }>();
    {
      const lanes = new Map<number, typeof segments>();
      for (const segment of segments) {
        const lane = lanes.get(segment.track_index) ?? [];
        lane.push(segment);
        lanes.set(segment.track_index, lane);
        crossfades.set(segment.id, {
          in: segment.fade_in_s ?? 0,
          out: segment.fade_out_s ?? 0,
        });
      }
      for (const lane of lanes.values()) {
        const order = [...lane].sort((a, b) => a.start_s - b.start_s);
        for (let i = 0; i < order.length - 1; i += 1) {
          const first = order[i];
          const next = order[i + 1];
          const firstEnd = first.start_s + (first.duration_s ?? 0);
          const overlap = firstEnd - next.start_s;
          if (overlap <= 0) continue;
          // Never longer than either clip: a short clip dropped on top of a
          // long one crossfades over its own length, not the overlap's.
          const span = Math.min(overlap, first.duration_s ?? overlap, next.duration_s ?? overlap);
          const a = crossfades.get(first.id)!;
          const b = crossfades.get(next.id)!;
          a.out = Math.max(a.out, span);
          b.in = Math.max(b.in, span);
        }
      }
    }

    handle?.phase("encoding", "Reading clips");
    const placed: { audio: dsp.Audio; startS: number }[] = [];
    let sampleRate = 0;
    for (const segment of segments) {
      const filename = this.db.getFilename(segment.sound_id!);
      if (filename === null) continue; // sound deleted out from under the story
      const clip = dsp.readWav(join(this.config.paths.sounds, filename));
      // Everything mixes at one rate, and the first clip's is as good a choice
      // as any — the same call `runSpeak` makes when joining lines.
      if (sampleRate === 0) sampleRate = clip.sampleRate;
      let audio =
        clip.sampleRate === sampleRate
          ? clip.audio
          : dsp.resampleAudio(clip.audio, clip.sampleRate, sampleRate);

      // Honour the clip's trim: what plays is `duration_s` of the source
      // starting at `trim_start_s`, not the whole file. Dropped entirely if
      // the trim leaves nothing, rather than exporting a zero-length clip.
      const from = segment.trim_start_s ?? 0;
      const length = segment.duration_s ?? null;
      if (from > 0 || length !== null) {
        const full = dsp.frameCount(audio) / sampleRate;
        const to = length === null ? full : Math.min(full, from + length);
        if (to <= from) continue;
        if (from > 0 || to < full) audio = dsp.trimRange(audio, sampleRate, from, to);
      }

      const gainDb = segment.gain_db + (trackGain(segment.track_index) ?? 0);
      // Fades last, after the trim that decides where the clip's edges are.
      // The lengths are the clip's own plus whatever an overlap on this lane
      // asks for — see `crossfades`.
      const fades = crossfades.get(segment.id);
      const faded =
        fades && (fades.in > 0 || fades.out > 0)
          ? dsp.applyFades(audio, sampleRate, fades.in, fades.out)
          : audio;
      placed.push({
        audio: gainDb ? dsp.applyGainDb(faded, gainDb) : faded,
        startS: segment.start_s,
      });
    }
    if (placed.length === 0) {
      throw new ModelError("Nothing to export: every line's audio is missing from disk.");
    }

    handle?.progress(0.7, "Mixing timeline", "encoding");
    const mixed = dsp.mixTimeline(placed, sampleRate);
    return this.writeSound(mixed, sampleRate, {
      model: "story",
      prompt: segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join("\n").slice(0, 2000),
      name: story.title,
      seed: null,
      steps: null,
      cfg: null,
      projectId: story.project_id ?? null,
      trim: false,
      // One gain over the whole mixdown, so the clips keep their levels
      // relative to each other; only the file's overall loudness moves.
      normalize: true,
    });
  }

  /**
   * Resolve a saved voice id into what the model layer actually takes: a
   * reference clip on disk, or a name from the family's own builtin list.
   *
   * Shared by `runSpeak` (which resolves every line up front, before
   * synthesising anything) and by single-segment generation, so a stale voice
   * id fails the same way in both.
   */
  private resolveVoice(voiceId: string | null): {
    refPath: string | null;
    builtinId: string | null;
  } {
    if (!voiceId) return { refPath: null, builtinId: null };
    const voice = this.db.getVoice(voiceId);
    if (voice === null) throw new ModelError(`Voice '${voiceId}' not found.`);
    if (voice.kind === "builtin") return { refPath: null, builtinId: voice.voice_id ?? null };
    const refPath = this.voiceRefPath(voice.id);
    if (refPath === null) {
      throw new ModelError(`Voice '${voice.name}' has no reference clip on disk.`);
    }
    return { refPath, builtinId: null };
  }

  /**
   * Write audio to the library as a new Sound row and file.
   *
   * The tail end of every generation path is the same — encode, measure,
   * insert — and the story paths (per-segment reads, split halves, the export
   * mixdown) each need it without also needing the job/session machinery
   * `runSpeak` wraps around it.
   */
  /**
   * Take audio that came from outside — a microphone take, a file the user
   * picked — and give it a place in the library.
   *
   * Recordings are library sounds like any other on purpose: the timeline
   * references clips by `sound_id` and the export reads them off disk, so a
   * take that lived only in the browser could be arranged and then vanish from
   * its own mixdown. The provenance fields say where it came from rather than
   * inventing a model that never ran.
   *
   * Never trimmed on the way in. A generated clip has silence at its edges
   * because the model padded it; a take has silence at its edges because the
   * person was breathing, and cutting that is an edit, not an import.
   */
  importSound(
    audio: dsp.Audio,
    sampleRate: number,
    options: { name: string; source: string; projectId?: string | null },
  ): Sound {
    return this.writeSound(audio, sampleRate, {
      model: options.source,
      prompt: "",
      name: options.name,
      seed: null,
      steps: null,
      cfg: null,
      projectId: options.projectId ?? null,
      trim: false,
      normalize: true,
    });
  }

  private writeSound(
    audio: dsp.Audio,
    sampleRate: number,
    meta: {
      model: string;
      prompt: string;
      name: string;
      seed: number | null;
      steps: number | null;
      cfg: number | null;
      projectId: string | null;
      parentId?: string | null;
      /** The saved Voice that read this, for spoken sounds — see `Sound.voice_id`. */
      voiceId?: string | null;
      trim: boolean;
      /** Bring it to the `normalize_lufs` setting; false writes it at the level it came in at. */
      normalize: boolean;
    },
  ): Sound {
    const soundId = randomUUID();
    const path = join(this.config.paths.sounds, `${soundId}.wav`);
    const { sizeBytes, durationS, peaks, channels } = dsp.processAndWrite(audio, sampleRate, path, {
      trim: meta.trim,
      normalizeLufs: meta.normalize ? this.config.settings.normalize_lufs : null,
    });
    const sound: Sound = {
      id: soundId,
      created_at: now(),
      model: meta.model,
      prompt: meta.prompt,
      negative_prompt: null,
      duration_s: round3(durationS),
      seed: meta.seed,
      steps: meta.steps,
      cfg: meta.cfg,
      sample_rate: sampleRate,
      channels,
      file: `/files/${soundId}.wav`,
      peaks,
      favorite: false,
      tags: [],
      name: meta.name,
      size_bytes: sizeBytes,
      session_id: null,
      project_id: meta.projectId,
      source: "app",
      parent_id: meta.parentId ?? null,
      voice_id: meta.voiceId ?? null,
    };
    this.db.insertSound(sound, `${soundId}.wav`);
    return sound;
  }

  /* --------------------------------------------------------------- library */

  listSounds(options: ListSoundsOptions = {}): SoundPage {
    const [items, total] = this.db.listSounds(options);
    return { items, total };
  }

  getSound(soundId: string): Sound | null {
    return this.db.getSound(soundId);
  }

  updateSound(soundId: string, patch: UpdateSoundPatch): Sound | null {
    return this.db.updateSound(soundId, patch);
  }

  async deleteSound(soundId: string): Promise<boolean> {
    const filename = this.db.deleteSound(soundId);
    if (filename === null) return false;
    const stem = filename.replace(/\.[^.]*$/, "");
    await unlinkQuiet(join(this.config.paths.sounds, filename));
    await unlinkQuiet(join(this.config.paths.cache, `${stem}.mp3`));
    return true;
  }

  listTags(): TagCount[] {
    return this.db.listTags();
  }

  /**
   * Apply one non-destructive edit, writing a new derived sound rather than
   * touching the source — see `Sound.parent_id`.
   */
  editSound(soundId: string, req: SoundEditRequest): Sound | null {
    const source = this.db.getSound(soundId);
    if (source === null) return null;
    const filename = this.db.getFilename(soundId)!; // getSound just succeeded
    const { audio, sampleRate } = dsp.readWav(join(this.config.paths.sounds, filename));
    let a = audio;

    try {
      switch (req.op) {
        case "trim":
          if (req.start_s === null || req.start_s === undefined || req.end_s === null || req.end_s === undefined) {
            throw new ModelError("Trim needs both start_s and end_s.");
          }
          a = dsp.trimRange(a, sampleRate, req.start_s, req.end_s);
          break;
        case "normalize":
          a = dsp.normalizeLoudness(
            a,
            sampleRate,
            req.target_lufs !== null && req.target_lufs !== undefined ? req.target_lufs : -16.0,
          );
          break;
        case "reverse":
          a = dsp.reverse(a);
          break;
        case "gain":
          if (req.gain_db === null || req.gain_db === undefined) {
            throw new ModelError("Gain needs gain_db.");
          }
          a = dsp.applyGainDb(a, req.gain_db);
          break;
        case "highpass":
          if (req.cutoff_hz === null || req.cutoff_hz === undefined) {
            throw new ModelError("High-pass needs cutoff_hz.");
          }
          a = dsp.highpass(a, sampleRate, req.cutoff_hz);
          break;
        case "lowpass":
          if (req.cutoff_hz === null || req.cutoff_hz === undefined) {
            throw new ModelError("Low-pass needs cutoff_hz.");
          }
          a = dsp.lowpass(a, sampleRate, req.cutoff_hz);
          break;
        case "pitch":
          if (req.semitones === null || req.semitones === undefined) {
            throw new ModelError("Pitch shift needs semitones.");
          }
          a = dsp.pitchShift(a, sampleRate, req.semitones);
          break;
        case "stretch":
          if (req.rate === null || req.rate === undefined) {
            throw new ModelError("Time-stretch needs rate.");
          }
          a = dsp.timeStretch(a, req.rate);
          break;
        default:
          // The schema already restricts this.
          throw new ModelError(`Unknown edit op '${String(req.op)}'`);
      }
    } catch (exc) {
      // A DSP-level RangeError/TypeError becomes a 400 with its own text, the
      // same as the Python's ValueError/RuntimeError funnel.
      if (exc instanceof ModelError) throw exc;
      throw new ModelError(exc instanceof Error ? exc.message : String(exc));
    }

    a = dsp.clip(a);
    const newId = randomUUID();
    const path = join(this.config.paths.sounds, `${newId}.wav`);
    const size = dsp.writeWav(path, a, sampleRate);
    const peaks = dsp.computePeaks(a);
    const duration = dsp.frameCount(a) / sampleRate;

    const sound: Sound = {
      id: newId,
      created_at: now(),
      model: source.model,
      prompt: source.prompt,
      negative_prompt: source.negative_prompt,
      duration_s: round3(duration),
      seed: source.seed,
      steps: source.steps,
      cfg: source.cfg,
      sample_rate: sampleRate,
      channels: a.length,
      file: `/files/${newId}.wav`,
      peaks,
      favorite: false,
      tags: source.tags,
      name: `${source.name} (${EDIT_LABELS[req.op]})`,
      size_bytes: size,
      session_id: source.session_id,
      source: source.source,
      client: source.client,
      parent_id: source.id,
    };
    this.db.insertSound(sound, `${newId}.wav`);
    return sound;
  }

  /* -------------------------------------------------------------- repaint */

  /**
   * Regenerate one window of an existing sound, leaving the rest of it alone.
   *
   * This is `submitGenerate` with `edit: "repaint"` underneath — the same job,
   * the same route, the same derived-sound bookkeeping. It exists as its own
   * entry point because the caller that reaches for it is the waveform editor
   * with a range highlighted, and all that caller knows is the window. Which
   * model, how long the result is, and what was being sung all follow from the
   * source, so asking for them again would be asking the wrong questions:
   * a repaint that comes back a different length, or singing something else,
   * is a new take rather than a repaint.
   *
   * Async only because choosing a model needs the catalogue's install status.
   * Everything it can refuse — a window past the end of the clip, a model that
   * cannot repaint, a clip longer than the model can hold — it refuses here,
   * on the click, rather than minutes into a render.
   */
  async submitRepaint(request: RepaintRequest): Promise<Job> {
    const source = this.db.getSound(request.source_sound_id);
    if (source === null) {
      throw new ModelError(`Sound '${request.source_sound_id}' not found.`);
    }
    if (request.end_s > source.duration_s) {
      throw new ModelError(
        `Repaint window ends past the source (${g(round3(source.duration_s))}s).`,
      );
    }

    const model = await this.pickRepainter(request.model ?? null, source.model);
    const info = this.models.get(model).describe();
    // A repaint renders the whole clip and keeps the part outside the window,
    // so a source longer than the model can render in one pass would come back
    // truncated. Extend has a windowed path for that; repaint does not, and
    // silently returning a shorter track is the worst of the options.
    if (source.duration_s > info.max_duration_s) {
      throw new ModelError(
        `${info.name} can only repaint clips up to ${g(round3(info.max_duration_s))}s; ` +
          `this one is ${g(round3(source.duration_s))}s.`,
      );
    }

    return this.submitGenerate({
      model,
      // The source's own prompt is the default on purpose: with no new
      // description, "repaint this bar" means "the same music, another roll".
      prompt: request.prompt?.trim() || source.prompt,
      negative_prompt: source.negative_prompt ?? null,
      duration_s: round3(source.duration_s),
      seed: request.seed ?? null,
      steps: info.supports.steps ? source.steps ?? null : null,
      cfg: info.supports.cfg ? source.cfg ?? null : null,
      lyrics: request.lyrics ?? source.lyrics ?? null,
      track_name: source.track_name ?? null,
      source_sound_id: source.id,
      edit: "repaint",
      edit_options: {
        repaint_start_s: round3(request.start_s),
        repaint_end_s: round3(request.end_s),
        repaint_mode: request.mode ?? null,
        repaint_strength: request.strength ?? null,
      },
      variations: request.variations,
      tags: source.tags,
      session_id: request.session_id ?? source.session_id ?? null,
      project_id: request.project_id ?? null,
      origin: request.origin ?? null,
      separate: null,
    });
  }

  /**
   * A model that can repaint, preferring the one that made the clip.
   *
   * Staying on the source's own model matters more here than anywhere else:
   * the untouched part of the render has to sound like the part being
   * replaced, and two families do not agree about that.
   */
  private async pickRepainter(
    requested: string | null,
    sourceModel: string,
  ): Promise<string> {
    if (requested) {
      const info = this.models.get(requested).describe(); // throws on unknown id
      if (!info.supports.repaint) {
        throw new ModelError(`${info.name} cannot repaint an existing sound.`);
      }
      return requested;
    }
    const able = (await this.listModels()).filter((m) => m.supports.repaint);
    const own = able.find((m) => m.id === sourceModel);
    if (own) return own.id;
    const ready = able.filter((m) => m.status === "loaded" || m.status === "installed");
    if (!ready.length) {
      throw new ModelError(
        "No installed model can repaint. Download one that can — ACE-Step — from the Models tab.",
      );
    }
    return (ready.find((m) => m.status === "loaded") ?? ready[0]).id;
  }

  /* ------------------------------------------------------------- separate */

  /**
   * Split an existing library Sound into stems.
   *
   * Mirrors submitGenerate's job-submission shape — separation runs through
   * audio.cpp too and can take a while, so it's a queued job like generate,
   * not a synchronous call like editSound. Unlike generate, there's no prompt
   * or duration to validate; the only precondition is that the source sound
   * exists.
   */
  submitSeparate(request: SeparateRequest): Job {
    const model = this.models.get(request.model); // throws ModelError on unknown id
    const info = model.describe();
    if (info.task !== "sep") {
      throw new ModelError(`${info.name} does not support stem separation.`);
    }
    const source = this.db.getSound(request.source_sound_id);
    if (source === null) {
      throw new ModelError(`Sound '${request.source_sound_id}' not found.`);
    }

    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> =>
      this.runSeparate(handle, request, source);

    return this.jobs.submit("separate", { ...request }, runner);
  }

  private async runSeparate(
    handle: JobHandle,
    req: SeparateRequest,
    source: Sound,
  ): Promise<Record<string, unknown>> {
    const model = this.models.get(req.model);

    if (!model.loaded) {
      handle.phase("loading", `Loading ${model.describe().name}`);
      await this.models.load(req.model, (f, m) => handle.progress(f * 0.3, m, "loading"));
    }
    this.models.touch();

    const sourcePath = this.absolutePath(source.id);
    if (sourcePath === null) throw new ModelError(`Source sound '${source.id}' has no file on disk.`);

    // htdemucs (and presumably its sibling loaders) reject anything that
    // isn't exactly their trained rate — confirmed live: a 48kHz ACE-Step
    // source against htdemucs's 44100 fails with "sample rate mismatch",
    // not a silent resample. Convert here rather than push that requirement
    // onto every source sound.
    const info = model.describe();
    let sepInputPath = sourcePath;
    let tmpDir: string | null = null;
    const { audio: sourceAudio, sampleRate: sourceRate } = dsp.readWav(sourcePath);
    if (sourceRate !== info.sample_rate) {
      tmpDir = await mkdtemp(join(tmpdir(), "soundbox-sep-resample-"));
      sepInputPath = join(tmpDir, "resampled.wav");
      dsp.writeWav(
        sepInputPath,
        dsp.resampleAudio(sourceAudio, sourceRate, info.sample_rate),
        info.sample_rate,
      );
    }

    handle.checkCancelled();
    handle.phase("generating", "Separating stems");
    let stems;
    try {
      stems = await model.separate(sepInputPath, {
        progress: reporter(handle, 0.3, 0.65, "Separating stems"),
      });
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    handle.checkCancelled();

    // What comes back is always the full set — the separator has no idea only
    // the vocal was wanted — so choosing happens here, before anything is
    // written. A discarded stem never becomes a library sound at all.
    const wanted = req.stems ?? null;
    const { kept, rest, missing } = selectStems(stems, wanted);
    if (kept.length === 0) {
      throw new ModelError(
        `${model.describe().name} produced ${stems.map((s) => s.stemName).join(", ") || "no stems"}` +
          (missing.length ? `; nothing matched ${missing.join(", ")}.` : "."),
      );
    }
    const write = [...kept];
    if (wanted?.rest === "merge" && rest.length) {
      // Summed rather than re-rendered: these are the pieces of one mix, so
      // adding them back together *is* the original minus what was taken out,
      // sample for sample.
      const rate = rest[0].audio.sampleRate;
      write.push({
        stemName: REST_STEM_NAME,
        audio: {
          audio: dsp.mixTimeline(
            rest.map((s) => ({ audio: s.audio.audio, startS: 0 })),
            rate,
          ),
          sampleRate: rate,
        },
      });
    }

    handle.progress(0.95, "Writing stems", "encoding");

    const soundIds: string[] = [];
    for (const { stemName, audio } of write) {
      const soundId = randomUUID();
      const path = join(this.config.paths.sounds, `${soundId}.wav`);
      const settings = this.config.settings;
      const { sizeBytes, durationS, peaks, channels } = dsp.processAndWrite(
        audio.audio,
        audio.sampleRate,
        path,
        // Stems are already normalized/trimmed as part of the source — don't
        // re-trim silence out of a stem that's legitimately silent for long
        // stretches (e.g. "vocals" on an instrumental section).
        { trim: false, normalizeLufs: settings.normalize_lufs },
      );

      const sound: Sound = {
        id: soundId,
        created_at: now(),
        model: req.model,
        prompt: source.prompt,
        negative_prompt: source.negative_prompt,
        duration_s: round3(durationS),
        seed: source.seed,
        steps: null,
        cfg: null,
        sample_rate: audio.sampleRate,
        channels,
        file: `/files/${soundId}.wav`,
        peaks,
        favorite: false,
        tags: source.tags,
        name: `${source.name} (${stemName})`,
        size_bytes: sizeBytes,
        session_id: source.session_id,
        source: source.source,
        client: source.client,
        parent_id: source.id,
      };
      this.db.insertSound(sound, `${soundId}.wav`);
      soundIds.push(soundId);
    }

    this.models.touch();
    return { sounds: soundIds };
  }




  /**
   * Stems this sound has already been split into, oldest first.
   *
   * Children are matched by which model made them rather than by name: an
   * edit and a split half are also children with a "(something)" suffix, and
   * laying a trimmed copy out as though it were a stem would be wrong. Only a
   * separation model produces stems.
   */
  private async existingStems(soundId: string): Promise<{ id: string; stemName: string }[]> {
    const separators = new Set(
      (await this.listModels()).filter((m) => m.task === "sep").map((m) => m.id),
    );
    if (separators.size === 0) return [];
    const [children] = this.db.listSounds({ parent_id: soundId, limit: 64 });
    const stems = children.filter((c) => separators.has(c.model));

    // One set, not every set ever made. A sound separated twice — before this
    // reuse existed, or with two different separators — has two full sets of
    // children, and laying both out would give eight tracks of four stems.
    // Keyed by name because that is what distinguishes "vocals" from "drums",
    // keeping the newest of each.
    const newest = new Map<string, (typeof stems)[number]>();
    for (const stem of stems) {
      const seen = newest.get(stem.name);
      if (!seen || stem.created_at > seen.created_at) newest.set(stem.name, stem);
    }
    return [...newest.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      // The stem's own name is the parenthesised suffix the separation gave
      // it ("Take 3 (vocals)"), which is what a selection is matched against.
      .map((c) => ({ id: c.id, stemName: /\(([^()]*)\)\s*$/.exec(c.name)?.[1] ?? c.name }));
  }

  /** A ready stem-separation model, preferring one already loaded. Named
   *  rather than inlined so the "none installed" wording lives in one place —
   *  it is the message a user is most likely to see here. */
  private async pickSeparator(): Promise<string> {
    const ready = (await this.listModels()).filter(
      (m) => m.task === "sep" && (m.status === "loaded" || m.status === "installed"),
    );
    if (!ready.length) {
      throw new ModelError(
        "No stem-separation model is installed. Download one from the Models tab.",
      );
    }
    return (ready.find((m) => m.status === "loaded") ?? ready[0]).id;
  }

  /**
   * Open a library sound in the studio, splitting it into tracks if it can be.
   *
   * The interesting case is a mixed-down sound you want back in pieces: a
   * track whose vocal you need under new narration, a take you want to rebalance.
   * Separation already produces named stems as ordinary Sounds, so the studio
   * just needs them laid out — one per lane, all starting together, which is
   * what "back in pieces" means for something that was mixed.
   *
   * A job rather than a plain call because separation is slow, and the same
   * reason it is one endpoint rather than three round trips: a story half-built
   * because the client navigated away mid-separation is worse than no story.
   */
  submitStoryFromSound(
    soundId: string,
    options: { separate?: boolean; model?: string | null; stems?: StemSelection | null } = {},
  ): Job {
    const source = this.db.getSound(soundId);
    if (source === null) throw new ModelError(`Sound '${soundId}' not found.`);

    // A sound derived from another — a stem, a split half, an edit — has
    // already been taken apart as far as it goes. Asking a separator to split
    // a vocal stem out of a vocal stem produces four near-identical files and
    // no information, so this quietly opens it whole instead of refusing: the
    // user asked to work with it, and that part still makes sense.
    const separate = (options.separate ?? false) && source.parent_id == null;

    // An explicitly named model is checked now, so a wrong id fails on the
    // click. Choosing one automatically needs the async catalogue, so it
    // happens first thing in the runner — still before any slow work.
    if (separate && options.model) {
      const info = this.models.get(options.model).describe();
      if (info.task !== "sep") {
        throw new ModelError(`${info.name} does not support stem separation.`);
      }
    }

    return this.jobs.submit(
      "separate",
      { source_sound_id: soundId, model: options.model ?? undefined, open_in_studio: true },
      async (handle) => {
        let ids = [soundId];
        if (separate) {
          // Splitting the same sound twice would double its stems in the
          // library for no gain — separation is deterministic enough that the
          // second set is the first set again. Reuse what is there, but only
          // when it actually answers this request: a previous split that kept
          // the vocal alone has nothing to say about one that wants the drums.
          const selection = options.stems ?? null;
          const existing = await this.existingStems(soundId);
          if (existing.length && selectionSatisfied(existing.map((e) => e.stemName), selection)) {
            const { kept } = selectStems(existing, selection);
            const merged =
              selection?.rest === "merge"
                ? existing.filter((e) => stemKey(e.stemName) === REST_STEM_NAME)
                : [];
            ids = [...kept, ...merged].map((e) => e.id);
          } else {
            const sepModel = options.model ?? (await this.pickSeparator());
            const result = await this.runSeparate(
              handle,
              { model: sepModel, source_sound_id: soundId, stems: selection },
              source,
            );
            const stems = (result.sounds as string[]) ?? [];
            // A separator that produced nothing still leaves us a story worth
            // opening — the original, on one track.
            if (stems.length) ids = stems;
          }
        }

        // Stems on lanes are an arrangement, so this opens in the Music
        // Builder — there is no script to write, and the Script Builder would
        // greet a split-up track with an empty cast list.
        const story = this.createStory(source.name, null, "music");
        ids.forEach((id, lane) => {
          const sound = this.db.getSound(id);
          this.db.createSegment(randomUUID(), story.id, now(), {
            // The stem's own name is already "{source} ({stem})", so the
            // speaker column reads as the lane's label without further work.
            speaker: sound?.name ?? null,
            text: "",
            // One lane each, all starting at zero: they were simultaneous in
            // the mix and stacking them anywhere else would be a lie.
            track_index: lane,
            start_s: 0,
            sound_id: id,
            durationS: sound?.duration_s ?? null,
          });
        });
        return { story_id: story.id, sounds: ids };
      },
    );
  }

  /* ------------------------------------------------------------------ voices */

  listVoices(): Voice[] {
    return this.db.listVoices();
  }

  getVoice(voiceId: string): Voice | null {
    return this.db.getVoice(voiceId);
  }

  /**
   * Save a voice.
   *
   * A clone voice needs reference audio, which arrives one of two ways: an
   * uploaded clip (`uploadedWav`, already decoded) or an existing library
   * sound (`source_sound_id`) — the latter is what turns a generated read into
   * a reusable voice. Either way the clip is copied into the sounds directory
   * under the voice's own id, so deleting the original sound can't strand the
   * voice that was cloned from it.
   */
  createVoice(req: VoiceCreate, uploadedWav?: { audio: dsp.Audio; sampleRate: number }): Voice {
    const id = randomUUID();
    const created = now();

    if (req.kind === "builtin") {
      if (!req.voice_id) {
        throw new ModelError("A builtin voice needs the model's voice_id.");
      }
      // Validate against the family's actual list rather than trusting the
      // client: a cloning-only family (empty voice_ids) has no --voice-id to
      // select at all, so a "builtin" pointed at one would sail past every
      // check here and only fail once audio.cpp is already spawned — see the
      // Chatterbox "supports VoiceCloning and VoiceConversion" case.
      if (req.model_id) {
        const info = this.models.get(req.model_id).describe();
        if (!info.voice_ids.includes(req.voice_id)) {
          throw new ModelError(
            info.voice_ids.length === 0
              ? `${info.name} has no built-in voices — it only works from a reference ` +
                `clip. Create a "clone" voice instead.`
              : `'${req.voice_id}' isn't one of ${info.name}'s built-in voices ` +
                `(${info.voice_ids.join(", ")}).`,
          );
        }
      }
      return this.db.createVoice(
        {
          id,
          name: req.name,
          kind: "builtin",
          created_at: created,
          voice_id: req.voice_id,
          model_id: req.model_id ?? null,
          notes: req.notes ?? null,
        },
        null,
      );
    }

    // A clone is tied to a model too. The clip itself is portable — any
    // family that takes a --voice-ref could read it — but a voice is the
    // thing the UI picks, and letting it name its own model is what lets
    // every surface offer voices instead of models. Validated before the clip
    // is written so a typo'd or non-tts id fails at save time rather than at
    // speak time, and leaves no orphaned file behind.
    if (req.model_id) {
      const info = this.models.get(req.model_id).describe();
      if (info.task !== "tts") {
        throw new ModelError(`${info.name} is not a text-to-speech model.`);
      }
      if (!info.supports.voice_reference) {
        throw new ModelError(`${info.name} cannot read from a reference clip.`);
      }
    }

    const clip = this.prepareReferenceClip(
      uploadedWav ?? this.sourceSoundAudio(req.source_sound_id),
      req.tidy ?? false,
    );

    // The first clip takes the voice's own id, so its file keeps the
    // `voice-<id>.wav` name every clone has always had, and a one-clip voice
    // is laid out exactly as it was before voices could hold several.
    const filename = `voice-${id}.wav`;
    // Written as-is (or as tidied) rather than through processAndWrite: a
    // reference clip is an input to the model, not a deliverable, and
    // loudness-normalising it would change the voice we're trying to capture.
    dsp.writeWav(join(this.config.paths.sounds, filename), clip.audio, clip.sampleRate);

    this.db.createVoice(
      {
        id,
        name: req.name,
        kind: "clone",
        created_at: created,
        reference_file: `/files/${filename}`,
        model_id: req.model_id ?? null,
        notes: req.notes ?? null,
      },
      filename,
    );
    this.db.addVoiceSample({
      id,
      voice_id: id,
      filename,
      duration_s: dsp.frameCount(clip.audio) / clip.sampleRate,
      created_at: created,
    });
    return this.db.getVoice(id)!;
  }

  /** A library sound's audio, for a clip taken from the library rather than
   *  uploaded. */
  private sourceSoundAudio(soundId: string | null | undefined): {
    audio: dsp.Audio;
    sampleRate: number;
  } {
    if (!soundId) {
      throw new ModelError("A clone voice needs either an uploaded clip or a source_sound_id.");
    }
    const path = this.absolutePath(soundId);
    if (path === null) throw new ModelError(`Sound '${soundId}' not found.`);
    return dsp.readWav(path);
  }

  /** Refuse a clip that cannot make a voice, then tidy it if asked. */
  private prepareReferenceClip(
    clip: { audio: dsp.Audio; sampleRate: number },
    tidy: boolean,
  ): { audio: dsp.Audio; sampleRate: number } {
    reference.checkReference(clip.audio, clip.sampleRate);
    if (!tidy) return clip;
    const audio = reference.tidyReference(clip.audio, clip.sampleRate);
    // Trimming can only shorten it; recheck so a clip that was mostly silence
    // fails with the same message rather than saving a half-second voice.
    reference.checkReference(audio, clip.sampleRate);
    return { audio, sampleRate: clip.sampleRate };
  }

  /**
   * Add another clip to a clone voice.
   *
   * Several clips of the same speaker clone better than one — more phonemes,
   * more of their range — and it means a voice can be improved later without
   * being remade under a new id, which would orphan every script line cast to
   * it. The clips are joined into the one reference file the model reads.
   */
  addVoiceSample(
    voiceId: string,
    source: { audio: dsp.Audio; sampleRate: number } | { source_sound_id: string },
    tidy = false,
  ): Voice {
    const voice = this.db.getVoice(voiceId);
    if (voice === null) throw new ModelError(`Voice '${voiceId}' not found.`);
    if (voice.kind !== "clone") {
      throw new ModelError(
        `'${voice.name}' is a built-in voice — it has no clips, the model ships it.`,
      );
    }
    const existing = voice.samples ?? [];
    if (existing.length >= reference.MAX_SAMPLES) {
      throw new ModelError(
        `'${voice.name}' already has ${reference.MAX_SAMPLES} clips. Remove one before adding another.`,
      );
    }
    const clip = this.prepareReferenceClip(
      "source_sound_id" in source ? this.sourceSoundAudio(source.source_sound_id) : source,
      tidy,
    );
    const seconds = dsp.frameCount(clip.audio) / clip.sampleRate;
    const already = existing.reduce((n, s) => n + (s.duration_s ?? 0), 0);
    if (already + seconds > reference.MAX_COMBINED_S) {
      throw new ModelError(
        `With this clip '${voice.name}' would have ${Math.round(already + seconds)}s of reference ` +
          `audio. Keep it under ${reference.MAX_COMBINED_S}s — past that, models stop listening.`,
      );
    }

    const sampleId = randomUUID();
    const filename = `voice-${voiceId}-${sampleId.slice(0, 8)}.wav`;
    dsp.writeWav(join(this.config.paths.sounds, filename), clip.audio, clip.sampleRate);
    this.db.addVoiceSample({
      id: sampleId,
      voice_id: voiceId,
      filename,
      duration_s: seconds,
      created_at: now(),
    });
    this.rebuildVoiceReference(voiceId);
    return this.db.getVoice(voiceId)!;
  }

  /** Remove one clip. A clone keeps at least one — with none it is not a
   *  voice — so removing the last is refused rather than leaving a voice
   *  that fails at speak time. */
  async deleteVoiceSample(voiceId: string, sampleId: string): Promise<Voice | null> {
    const voice = this.db.getVoice(voiceId);
    if (voice === null) return null;
    const samples = voice.samples ?? [];
    if (!samples.some((s) => s.id === sampleId)) return null;
    if (samples.length <= 1) {
      throw new ModelError(
        `That is the only clip '${voice.name}' has. Add another first, or delete the voice.`,
      );
    }
    const filename = this.db.deleteVoiceSample(voiceId, sampleId);
    this.rebuildVoiceReference(voiceId);
    if (filename) {
      await rm(join(this.config.paths.sounds, filename), { force: true }).catch(() => {});
    }
    return this.db.getVoice(voiceId);
  }

  /**
   * Point a clone's `--voice-ref` at the right file after its clips changed:
   * the clip itself when there is one, otherwise a freshly joined file.
   *
   * The joined file gets a new name on every rebuild rather than being
   * overwritten. The app plays `reference_file` through a plain <audio>, and a
   * browser holding the old bytes under the same URL would keep playing a
   * reference the model no longer reads.
   */
  private rebuildVoiceReference(voiceId: string): void {
    const files = this.db.voiceSampleFilenames(voiceId);
    if (files.length === 0) return;
    const dir = this.config.paths.sounds;
    let target: string;
    if (files.length === 1) {
      target = files[0]!;
    } else {
      const joined = reference.combineReferences(files.map((f) => dsp.readWav(join(dir, f))));
      target = `voice-${voiceId}-joined-${randomUUID().slice(0, 8)}.wav`;
      dsp.writeWav(join(dir, target), joined.audio, joined.sampleRate);
    }
    const previous = this.db.setVoiceFilename(voiceId, target);
    // Only a joined file is ours to delete here — a sample's own file is
    // removed with its sample, and a previous single-clip reference is still
    // that clip.
    if (previous && previous !== target && !files.includes(previous)) {
      void rm(join(dir, previous), { force: true }).catch(() => {});
    }
  }

  /**
   * A voice as a portable file — see `voiceExportSchema`.
   *
   * The clips travel, the joined reference does not: import rebuilds it, so a
   * future change to how clips are joined applies to imported voices too.
   */
  exportVoice(voiceId: string): VoiceExport | null {
    const voice = this.db.getVoice(voiceId);
    if (voice === null) return null;
    const dir = this.config.paths.sounds;
    const samples = this.db.voiceSampleFilenames(voiceId).map((filename, i) => ({
      wav_base64: readFileSync(join(dir, filename)).toString("base64"),
      duration_s: voice.samples?.[i]?.duration_s ?? null,
    }));
    return {
      format: "soundbox-voice",
      version: 1,
      exported_at: now(),
      voice: {
        name: voice.name,
        kind: voice.kind,
        voice_id: voice.voice_id ?? null,
        model_id: voice.model_id ?? null,
        notes: voice.notes ?? null,
      },
      samples,
    };
  }

  /**
   * Recreate a voice from an exported file, under a new id.
   *
   * A name already in the library gets " (2)", " (3)"… rather than replacing
   * the existing voice: an import is a copy, and two voices called "Narrator"
   * would make every voice picker ambiguous. A model this library does not
   * know (an export from a newer Soundbox, or a custom entry) is dropped
   * rather than failing the import — the clips still work with any model
   * that clones, and the voice can be pointed at one afterwards. A built-in
   * whose model is unknown has nothing left to speak with, so that one fails.
   */
  async importVoice(file: VoiceExport): Promise<Voice> {
    const names = new Set(this.db.listVoices().map((v) => v.name));
    let name = file.voice.name;
    for (let n = 2; names.has(name); n++) name = `${file.voice.name} (${n})`;

    let modelId = file.voice.model_id ?? null;
    if (modelId !== null) {
      try {
        this.models.get(modelId).describe();
      } catch {
        modelId = null;
      }
    }

    if (file.voice.kind === "builtin") {
      if (modelId === null) {
        throw new ModelError(
          `'${file.voice.name}' is a built-in voice of ${file.voice.model_id ?? "an unnamed model"}, ` +
            "which this Soundbox doesn't have.",
        );
      }
      return this.createVoice({
        name,
        kind: "builtin",
        voice_id: file.voice.voice_id ?? null,
        model_id: modelId,
        notes: file.voice.notes ?? null,
      });
    }

    if (file.samples.length === 0) {
      throw new ModelError("That file has no clips in it, so there is no voice to make.");
    }
    const clips = file.samples.map((sample, i) => {
      try {
        return dsp.decodeWav(Buffer.from(sample.wav_base64, "base64"));
      } catch {
        throw new ModelError(`Clip ${i + 1} in that file isn't a readable WAV.`);
      }
    });
    const voice = this.createVoice(
      { name, kind: "clone", model_id: modelId, notes: file.voice.notes ?? null },
      clips[0],
    );
    try {
      for (const clip of clips.slice(1)) this.addVoiceSample(voice.id, clip);
    } catch (err) {
      // All or nothing: a half-imported voice would look complete and sound
      // like a fraction of the speaker.
      await this.deleteVoice(voice.id);
      throw err;
    }
    return this.db.getVoice(voice.id)!;
  }

  updateVoice(voiceId: string, patch: VoicePatch): Voice | null {
    return this.db.updateVoice(voiceId, patch);
  }

  /** Deletes the voice and its reference clip. The clip lives under the
   *  voice's own id (see createVoice), so nothing else references it. */
  async deleteVoice(voiceId: string): Promise<boolean> {
    const files = new Set(this.db.voiceSampleFilenames(voiceId));
    const reference = this.db.voiceFilename(voiceId);
    if (reference) files.add(reference);
    if (!this.db.deleteVoice(voiceId)) return false;
    for (const filename of files) {
      await rm(join(this.config.paths.sounds, filename), { force: true }).catch(() => {});
    }
    return true;
  }

  /** Absolute path to a clone voice's reference clip, for `--voice-ref`. */
  private voiceRefPath(voiceId: string): string | null {
    const filename = this.db.voiceFilename(voiceId);
    return filename === null ? null : resolve(this.config.paths.sounds, filename);
  }

  /* ------------------------------------------------------------------- speak */

  submitSpeak(request: SpeakRequest): Job {
    // Every model the read touches, checked before queueing: throws
    // ModelError on an unknown id or one that cannot speak.
    for (const id of new Set([request.model, ...request.lines.map((l) => l.model ?? request.model)])) {
      const info = this.models.get(id).describe();
      if (info.task !== "tts") {
        throw new ModelError(`${info.name} is not a text-to-speech model.`);
      }
    }

    // Same session handling as generate, for the same reason: a read started
    // from the composer is part of a thread, and the session has to exist by
    // the time the job is queued so the sidebar shows it immediately rather
    // than once the audio lands.
    const sessionId = this.ensureSession({
      session_id: request.session_id,
      project_id: request.project_id,
      title: request.name || request.lines[0]?.text || "Spoken",
    });
    const req: SpeakRequest = { ...request, session_id: sessionId };

    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      try {
        return await this.runSpeak(handle, req, sessionId);
      } catch (exc) {
        if (this.db.deleteIfEmpty(sessionId)) {
          log.info(`pruned empty session ${sessionId}`);
        }
        throw exc;
      }
    };
    return this.jobs.submit("speak", { ...req }, runner);
  }

  /**
   * Synthesise a script, one line per audio.cpp invocation, concatenated.
   *
   * Per-line rather than one call with the whole script because that is what
   * makes multi-speaker work at all: each line can carry a different voice,
   * including voices belonging to different families. The cost is one process
   * start per turn, which is the same trade the rest of this adapter already
   * makes.
   */
  private async runSpeak(
    handle: JobHandle,
    req: SpeakRequest,
    sessionId: string | null,
  ): Promise<Record<string, unknown>> {
    const model = this.models.get(req.model);
    const info = model.describe();
    if (info.task !== "tts") {
      throw new ModelError(`${info.name} is not a text-to-speech model.`);
    }

    // Resolve every voice before synthesising anything: failing on line 40 of
    // a 60-line script after five minutes of work, because one voice id was
    // stale, is the worst possible time to find out.
    const resolved = req.lines.map((line) => ({
      line,
      ...this.resolveVoice(line.voice_id ?? null),
    }));

    const clips: { audio: dsp.Audio; sampleRate: number }[] = [];
    const n = resolved.length;
    for (let i = 0; i < n; i++) {
      handle.checkCancelled();
      const { line, refPath, builtinId } = resolved[i]!;
      const base = 0.2 + (i / n) * 0.7;
      const span = 0.7 / n;
      const label = n > 1 ? `Line ${i + 1}/${n}` : "Speaking";

      // A line can name its own model — a dialogue whose voices were made on
      // different families. Loading is per line so a swap happens only when
      // the model actually changes between turns.
      const lineModelId = line.model ?? req.model;
      const lineModel = this.models.get(lineModelId);
      const lineInfo = lineModel.describe();
      if (!lineModel.loaded) {
        handle.phase("loading", `Loading ${lineInfo.name}`);
        await this.models.load(lineModelId, (f, m) =>
          handle.progress(i === 0 ? f * 0.2 : base, m, "loading"),
        );
      }
      this.models.touch();
      handle.phase("generating", label);

      clips.push(
        await lineModel.speak(line.text, {
          voiceRefPath: refPath,
          voiceId: builtinId,
          // One delivery for the whole read: `speak` is the one-off path with
          // no story behind it, so there is nothing per-line to merge.
          requestOptions: withRequirements(lineInfo.family, req.request_options),
          // One seed for the whole read, not one per line: varying it between
          // turns makes the same character drift audibly mid-conversation.
          seed: req.seed ?? null,
          steps: req.steps ?? null,
          cfg: req.cfg ?? null,
          loadOptions: req.load_options,
          progress: reporter(handle, base, span, label),
        }),
      );
    }

    handle.checkCancelled();
    handle.progress(0.93, "Joining lines", "encoding");

    const sampleRate = clips[0]!.sampleRate;
    // Lines can come from different families at different rates; the join has
    // to happen at one rate, and the first line's is as good a choice as any.
    const parts = clips.map((c) =>
      c.sampleRate === sampleRate ? c.audio : dsp.resampleAudio(c.audio, c.sampleRate, sampleRate),
    );
    const joined = dsp.concatAudio(parts, sampleRate, req.gap_s);

    const soundId = randomUUID();
    const path = join(this.config.paths.sounds, `${soundId}.wav`);
    const settings = this.config.settings;
    const { sizeBytes, durationS, peaks, channels } = dsp.processAndWrite(
      joined,
      sampleRate,
      path,
      // Never trim: the gaps between turns are deliberate, and leading silence
      // is part of a performance's timing.
      { trim: false, normalizeLufs: settings.normalize_lufs },
    );

    // The script itself is the prompt — it's what you'd search the library for.
    const script = req.lines
      .map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text))
      .join("\n");
    const origin = req.origin ?? null;

    // One avatar can only stand for one reader: a read where every line used
    // the same saved voice gets that voice stamped on it, a mixed dialogue
    // (or a model-default read) gets nothing.
    const lineVoices = new Set(req.lines.map((l) => l.voice_id ?? null));
    const soleVoice = lineVoices.size === 1 ? [...lineVoices][0]! : null;

    const sound: Sound = {
      id: soundId,
      created_at: now(),
      model: req.model,
      prompt: script.slice(0, 2000),
      negative_prompt: null,
      duration_s: round3(durationS),
      seed: req.seed ?? null,
      steps: info.supports.steps ? req.steps ?? null : null,
      cfg: info.supports.cfg ? req.cfg ?? null : null,
      sample_rate: sampleRate,
      channels,
      file: `/files/${soundId}.wav`,
      peaks,
      favorite: false,
      tags: req.tags,
      name: req.name || defaultName(req.lines[0]!.text),
      size_bytes: sizeBytes,
      session_id: sessionId,
      project_id: req.project_id ?? null,
      source: origin?.source ?? "api",
      client: originLabel(origin),
      voice_id: soleVoice,
    };
    this.db.insertSound(sound, `${soundId}.wav`);

    this.models.touch();
    return { sounds: [soundId] };
  }

  /* ----------------------------------------------------------------- convert */

  submitConvert(request: ConvertRequest): Job {
    const source = this.db.getSound(request.source_sound_id);
    if (source === null) {
      throw new ModelError(`Sound '${request.source_sound_id}' not found.`);
    }
    const voice = this.db.getVoice(request.voice_id);
    if (voice === null) throw new ModelError(`Voice '${request.voice_id}' not found.`);
    if (voice.kind !== "clone") {
      throw new ModelError(
        `'${voice.name}' is a built-in voice. Voice conversion needs a cloned voice with a reference clip to match against.`,
      );
    }
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> =>
      this.runConvert(handle, request, source);
    return this.jobs.submit("convert", { ...request }, runner);
  }

  private async runConvert(
    handle: JobHandle,
    req: ConvertRequest,
    source: Sound,
  ): Promise<Record<string, unknown>> {
    const model = this.models.get(req.model);
    const info = model.describe();
    if (info.task !== "vc") {
      throw new ModelError(`${info.name} is not a voice-conversion model.`);
    }

    if (!model.loaded) {
      handle.phase("loading", `Loading ${info.name}`);
      await this.models.load(req.model, (f, m) => handle.progress(f * 0.3, m, "loading"));
    }
    this.models.touch();

    const sourcePath = this.absolutePath(source.id);
    if (sourcePath === null) throw new ModelError(`Source sound '${source.id}' has no file on disk.`);
    const refPath = this.voiceRefPath(req.voice_id);
    if (refPath === null) throw new ModelError(`Voice '${req.voice_id}' has no reference clip.`);

    // Same rate-matching rule the separation path needs — these loaders are
    // trained at one rate and reject anything else rather than resampling.
    let inputPath = sourcePath;
    let tmpDir: string | null = null;
    const { audio: sourceAudio, sampleRate: sourceRate } = dsp.readWav(sourcePath);
    if (sourceRate !== info.sample_rate) {
      tmpDir = await mkdtemp(join(tmpdir(), "soundbox-vc-resample-"));
      inputPath = join(tmpDir, "resampled.wav");
      dsp.writeWav(
        inputPath,
        dsp.resampleAudio(sourceAudio, sourceRate, info.sample_rate),
        info.sample_rate,
      );
    }

    handle.checkCancelled();
    handle.phase("generating", "Converting voice");
    let converted;
    try {
      converted = await model.convert(inputPath, refPath, {
        seed: req.seed ?? null,
        progress: reporter(handle, 0.3, 0.62, "Converting voice"),
      });
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    handle.checkCancelled();
    handle.progress(0.95, "Writing audio", "encoding");

    const voice = this.db.getVoice(req.voice_id);
    const soundId = randomUUID();
    const path = join(this.config.paths.sounds, `${soundId}.wav`);
    const settings = this.config.settings;
    const { sizeBytes, durationS, peaks, channels } = dsp.processAndWrite(
      converted.audio,
      converted.sampleRate,
      path,
      { trim: false, normalizeLufs: settings.normalize_lufs },
    );

    const origin = req.origin ?? null;
    const sound: Sound = {
      id: soundId,
      created_at: now(),
      model: req.model,
      prompt: source.prompt,
      negative_prompt: null,
      duration_s: round3(durationS),
      seed: req.seed ?? null,
      steps: null,
      cfg: null,
      sample_rate: converted.sampleRate,
      channels,
      file: `/files/${soundId}.wav`,
      peaks,
      favorite: false,
      tags: source.tags,
      name: `${source.name} (${voice?.name ?? "converted"})`,
      size_bytes: sizeBytes,
      session_id: req.session_id ?? source.session_id,
      project_id: req.project_id ?? null,
      source: origin?.source ?? source.source,
      client: originLabel(origin) ?? source.client,
      parent_id: source.id,
      voice_id: req.voice_id,
    };
    this.db.insertSound(sound, `${soundId}.wav`);

    this.models.touch();
    return { sounds: [soundId] };
  }

  /** Filesystem path — MCP clients need this, HTTP clients need `file`. */
  absolutePath(soundId: string): string | null {
    const filename = this.db.getFilename(soundId);
    if (filename === null) return null;
    return resolve(this.config.paths.sounds, filename);
  }

  /* -------------------------------------------------------------- settings */

  getSettings(): PublicSettings {
    return this.config.settings.public(this.config.paths);
  }

  async updateSettings(patch: Partial<SettingsData>): Promise<PublicSettings> {
    // Read before the patch lands: once the config has taken it, the folder we
    // would be migrating *from* is gone.
    const previousSounds = "sounds_dir" in patch ? this.config.paths.sounds : null;
    if (previousSounds !== null) this.assertSoundsDirUsable(patch.sounds_dir ?? null);
    this.config.updateSettings(patch);
    if (previousSounds !== null && previousSounds !== this.config.paths.sounds) {
      await this.moveSounds(previousSounds, this.config.paths.sounds);
    }
    if ("hf_token" in patch) this.models.setHfToken(this.config.settings.effectiveHfToken());
    if ("otel_endpoint" in patch) this.telemetry.otel.reconfigure();
    if ("enabled_audiocpp_models" in patch) {
      await this.models.setAudiocppEnabled(this.config.settings.enabled_audiocpp_models);
    }
    if ("audiocpp_mode" in patch || "audiocpp_models_dir" in patch) {
      // Where the weights live just moved, so every cached model's idea of
      // whether it is downloaded is stale.
      this.models.setAudiocppRoot(
        this.config.settings.effectiveAudiocppModelsDir(this.config.paths),
      );
      // A different folder holds a different set of weights — including, for
      // someone pointing at their own audio.cpp, models this install has never
      // downloaded but can run today.
      await this.adoptDownloadedModels();
    }
    if ("llm_mode" in patch || "llm_model" in patch) {
      // Stop the managed process rather than let the next enhance() call keep
      // talking to whatever model it already had loaded.
      this.llm.reconfigure();
    }
    if (Object.keys(patch).some((k) => k.startsWith("image_"))) {
      // Same reason: the engine may be holding the checkpoint that just
      // stopped being the one we'd use.
      await this.image.onSettingsChanged();
    }
    return this.getSettings();
  }

  /**
   * Refuse a sounds-folder change we already know will not work.
   *
   * Checked before the patch is written rather than after, because
   * `Config.rebuildPaths` creates the directory as a side effect of applying
   * it: a path that cannot be created would otherwise throw with the new value
   * already persisted, leaving the next start pointed at a folder that isn't
   * there.
   */
  private assertSoundsDirUsable(target: string | null): void {
    if (this.jobs.hasActive()) {
      throw new ModelError(
        "Something is still generating. Let it finish or cancel it, then change the sounds folder.",
      );
    }
    const from = this.config.paths.sounds;
    const to = target?.trim() ? resolve(target.trim()) : this.config.paths.defaultSounds;
    // A network share is refused outright on Windows: resolving a UNC path
    // makes the OS contact that host (and offer it this user's credentials),
    // which no settings field should be able to trigger on its own.
    if (isUncPath(target?.trim() ?? "")) {
      throw new ModelError("The sounds folder has to be on this machine, not a network share.");
    }
    // Nested folders can't be moved into one another: the move would walk
    // into its own destination, and either folder is then a subtree of the
    // other's library.
    if (!samePath(from, to) && (isWithin(to, from) || isWithin(from, to))) {
      throw new ModelError(
        `The new sounds folder can't be inside the current one (${from}), or contain it.`,
      );
    }
    if (!target?.trim()) return;
    try {
      mkdirSync(resolve(target.trim()), { recursive: true });
    } catch (err) {
      throw new ModelError(
        `Could not use that sounds folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Carry the existing library across when the sounds folder changes.
   *
   * Not optional politeness: the database stores bare filenames and every
   * lookup joins them onto whatever `paths.sounds` currently is, so a change
   * without a move would leave every sound in the library pointing at a file
   * that is no longer where it is looked for. `rename` first for the common
   * same-disk case, falling back to copy-then-delete because the whole point
   * of the setting is pointing at a *different* drive.
   *
   * Only the files the database names are moved — not everything in the
   * folder. The old folder may be shared with another profile, or be a folder
   * the user already kept other things in, and none of that is ours to carry
   * off. A file that already exists at the destination is left where it is,
   * both copies intact, rather than overwritten: it may be someone's.
   *
   * Best-effort per file: one unreadable file should not strand the rest of
   * the library in the old folder, so failures are logged and the move goes on.
   */
  private async moveSounds(from: string, to: string): Promise<void> {
    let moved = 0;
    let failed = 0;
    let clashed = 0;
    for (const name of this.db.soundsDirFilenames()) {
      // Rows hold bare names; one that somehow holds a path must not steer a
      // move outside the two folders.
      if (!name || name !== basename(name) || name === "." || name === "..") {
        log.warning(`not moving library entry with unexpected filename ${JSON.stringify(name)}`);
        failed += 1;
        continue;
      }
      const src = join(from, name);
      const dst = join(to, name);
      if (!existsSync(src)) continue; // already gone; nothing to carry
      if (existsSync(dst)) {
        clashed += 1;
        log.warning(`${dst} already exists; left ${src} in place rather than overwrite it`);
        continue;
      }
      try {
        await rename(src, dst);
        moved += 1;
      } catch {
        try {
          // COPYFILE_EXCL: never clobber a file that appeared since the check.
          await copyFile(src, dst, fsConstants.COPYFILE_EXCL);
          await unlink(src).catch(() => {});
          moved += 1;
        } catch (err) {
          failed += 1;
          log.warning(`could not move ${name} to ${to}: ${String(err)}`);
        }
      }
    }
    log.info(
      `sounds folder ${from} -> ${to} (${moved} moved, ${clashed} already there, ${failed} failed)`,
    );
    if (failed > 0 || clashed > 0) {
      const parts: string[] = [];
      if (failed > 0) parts.push(`${failed} file(s) could not be moved`);
      if (clashed > 0) parts.push(`${clashed} file(s) already had a same-named file there`);
      throw new ModelError(
        `The sounds folder is now ${to}, but ${parts.join(" and ")} — those were left in ${from}. ` +
          "Sort them out by hand — the library expects them by name in the new folder.",
      );
    }
  }

  /* -------------------------------------------------------------- profiles */

  /** Every profile, and which one this server is currently running as. */
  listProfiles(): { active: string; profiles: ProfileInfo[] } {
    const registry = this.config.registry();
    return {
      active: registry.active,
      profiles: registry.profiles.map((p) => toInfo(this.config.base, p, registry.active)),
    };
  }

  /**
   * Create an empty profile. Does not switch to it — creating and opening are
   * separate decisions, and a "New profile" that yanked you out of the work
   * you were doing would be the wrong default for both of them.
   */
  createProfile(name: string): ProfileInfo {
    const trimmed = name.trim();
    if (!trimmed) throw new ModelError("A profile needs a name.");
    const registry = this.config.registry();
    const record = {
      id: uniqueId(trimmed, registry.profiles.map((p) => p.id)),
      name: trimmed,
      created_at: now(),
    };
    // The directory is made now rather than on first switch, so the profile
    // has a real `data_dir` to show in the UI and the failure (a read-only
    // disk, a bad --data-dir) surfaces here rather than mid-switch.
    mkdirSync(profileRoot(this.config.base, record.id), { recursive: true });
    writeRegistry(this.config.base, {
      ...registry,
      profiles: [...registry.profiles, record],
    });
    log.info(`created profile ${record.id} (${record.name})`);
    return toInfo(this.config.base, record, registry.active);
  }

  /** Rename a profile. The id — and so the directory on disk — is fixed at
   *  creation: renaming a directory out from under an open database is not
   *  worth the convenience of a tidy path. */
  renameProfile(id: string, name: string): ProfileInfo | null {
    const trimmed = name.trim();
    if (!trimmed) throw new ModelError("A profile needs a name.");
    const registry = this.config.registry();
    const record = registry.profiles.find((p) => p.id === id);
    if (!record) return null;
    const renamed = { ...record, name: trimmed };
    writeRegistry(this.config.base, {
      ...registry,
      profiles: registry.profiles.map((p) => (p.id === id ? renamed : p)),
    });
    return toInfo(this.config.base, renamed, registry.active);
  }

  /**
   * Forget a profile, and optionally delete its library.
   *
   * `deleteData` is off by default and the caller has to ask for it: the
   * directory holds generated audio that exists nowhere else, and "remove this
   * from the list" is a much smaller thing to want than "delete the sounds".
   */
  async deleteProfile(id: string, deleteData = false): Promise<boolean> {
    if (id === DEFAULT_PROFILE_ID) {
      throw new ModelError("The default profile cannot be deleted — it is the data directory itself.");
    }
    if (id === this.config.profile) {
      throw new ModelError("Switch to another profile before deleting this one.");
    }
    const registry = this.config.registry();
    if (!registry.profiles.some((p) => p.id === id)) return false;
    writeRegistry(this.config.base, {
      ...registry,
      profiles: registry.profiles.filter((p) => p.id !== id),
    });
    if (deleteData) {
      await rm(profileRoot(this.config.base, id), { recursive: true, force: true });
    }
    log.info(`deleted profile ${id}${deleteData ? " and its data" : ""}`);
    return true;
  }

  /**
   * Open another profile's library, in place, without restarting the server.
   *
   * The pieces that are per-profile are reconciled here; the ones that are not
   * — the loaded model in VRAM, the downloaded weights, the runtime binaries —
   * are deliberately left alone, which is what makes a switch take a moment
   * rather than a re-download. See `profiles.ts`.
   *
   * Refused while work is in flight. A generation writes its WAV into
   * `paths.sounds` and its row into the database at the end; moving both out
   * from under it mid-job would file the result in the wrong library or lose
   * it outright.
   */
  async switchProfile(id: string): Promise<{ active: string; profiles: ProfileInfo[] }> {
    if (id === this.config.profile) return this.listProfiles();
    if (!this.config.registry().profiles.some((p) => p.id === id)) {
      throw new ModelError(`No profile called "${id}".`);
    }
    if (this.jobs.hasActive()) {
      throw new ModelError(
        "Something is still generating. Let it finish or cancel it, then switch profile.",
      );
    }

    const previous = this.config.profile;
    this.db.close();
    this.config.useProfile(id);
    this.db = openDatabase(this.config.paths.db, false);
    this.telemetry.useDatabase(this.db);

    // Settings are per-profile, so the ones that describe the shared model
    // pool have to be re-applied: which audio.cpp models are on and the token
    // used to fetch gated weights.
    this.models.setHfToken(this.config.settings.effectiveHfToken());
    await this.models.setAudiocppEnabled(this.config.settings.enabled_audiocpp_models);
    this.models.setAudiocppRoot(
      this.config.settings.effectiveAudiocppModelsDir(this.config.paths),
    );
    // After the root is set, so it looks in the folder this profile actually
    // uses: what is on the disk is enabled here too, without a second tick.
    await this.adoptDownloadedModels();
    // Endpoints are per-profile too, and unlike weights nothing is shared.
    await this.endpoints.reload();
    this.telemetry.otel.reconfigure();
    // Both engines may be running the model the *previous* profile chose.
    this.llm.reconfigure();
    await this.image.onSettingsChanged();

    log.info(`switched profile ${previous} -> ${id} (${this.config.paths.root})`);
    return this.listProfiles();
  }

  /* ---------------------------------------------------------------- history */

  /**
   * What happened in a studio, and who caused it.
   *
   * Thin over `db.history` on purpose — history has no business logic worth
   * the name, it is a list you append to and read back. The one decision
   * here is the title, which comes from the first thing said rather than
   * being asked for: nobody names a conversation before having it.
   */
  createConversation(title: string | null, storyId: string | null) {
    return this.db.history.create(title?.trim() || "New conversation", storyId);
  }

  listConversations(limit = 50) {
    return this.db.history.list(limit);
  }

  getConversation(id: string) {
    return this.db.history.get(id);
  }

  conversationForStory(storyId: string) {
    return this.db.history.forStory(storyId);
  }

  conversationEntries(id: string) {
    return this.db.history.entries(id);
  }

  /**
   * Append, and name the conversation if it has not been named.
   *
   * A thread created before its first message has the placeholder title, and
   * the first thing a person says is a better name than anything they would
   * have typed into a "name this" box beforehand. Done here rather than in
   * the store so the store stays a list.
   */
  appendConversationEntries(id: string, entries: Parameters<typeof this.db.history.append>[1]) {
    const before = this.db.history.get(id);
    const appended = this.db.history.append(id, entries);
    if (before && before.entry_count === 0 && before.title === "New conversation") {
      const first = entries.find((e) => e.role === "user" && e.content?.trim());
      if (first?.content) this.db.history.rename(id, HistoryStore.titleFrom(first.content));
    }
    return appended;
  }

  renameConversation(id: string, title: string) {
    return this.db.history.rename(id, title.trim());
  }

  deleteConversation(id: string): boolean {
    return this.db.history.remove(id);
  }

  /* -------------------------------------------------------------------- llm */

  async llmStatus(): Promise<LlmStatus> {
    return await this.llm.status();
  }

  async enhancePrompt(input: {
    prompt: string;
    n: number;
    category?: EnhanceCategory;
    lyrics?: boolean;
    /** Model id the rewrite is actually for — resolved below into the real
     *  facts the prompt guidance is grounded in (loader family, default step
     *  count, guidance-scale ceiling), not just echoed back. */
    model?: string;
  }): Promise<EnhanceResult> {
    return await this.llm.enhance({
      prompt: input.prompt,
      n: input.n,
      category: input.category,
      lyrics: input.lyrics,
      model: input.model ? this.modelContext(input.model) : null,
    });
  }

  /** Turn a studio instruction into edits — see `llm/studio.ts`. The actions
   *  come back for the page to apply; nothing is written from here, so an
   *  agentic edit lands on the same undo stack as a manual one. */
  async studioCommand(instruction: string, context: StudioContext) {
    return await this.llm.studioCommand(instruction, context);
  }

  /**
   * One turn of the studio assistant. The catalogue it reasons over is the
   * live one — installed state, licence, limits — so a model that is not
   * ready is marked as such on its card rather than proposed and bounced.
   */
  async assistantChat(
    turns: AssistantTurn[],
    draft: AssistantProposal | null,
    studio: AssistantStudio | null = null,
  ) {
    return await this.llm.assistantChat(turns, {
      models: await this.assistantModelCards(),
      draft,
      studio,
    });
  }

  /** Empty-thread chips, from the same catalogue the chat uses. */
  async assistantOpeners(studio: AssistantStudio | null = null) {
    return await this.llm.assistantOpeners({
      models: await this.assistantModelCards(),
      studio,
    });
  }

  private async assistantModelCards(): Promise<AssistantModelCard[]> {
    const models = (await this.listModels()).filter((m) => m.task === "gen");
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      category: m.category,
      family: m.family,
      license: { name: m.license.name, commercial: m.license.commercial },
      max_duration_s: m.max_duration_s,
      ready: m.status === "installed" || m.status === "loaded",
      supports: {
        lyrics: m.supports.lyrics,
        negative_prompt: m.supports.negative_prompt,
        extend: m.supports.extend,
        cover: m.supports.cover,
      },
      defaults: {
        duration_s: m.defaults.duration_s ?? 10,
        steps: m.defaults.steps ?? null,
        cfg: m.defaults.cfg ?? null,
      },
      description: m.description,
    }));
  }

  async enhanceLyrics(theme: string, style?: string | null): Promise<string> {
    return await this.llm.enhanceLyrics({ theme, style });
  }

  /** Best-effort: an unknown or omitted model id just means the rewrite falls
   *  back to generic guidance, not a failed enhance call. */
  private modelContext(modelId: string): ModelContext | null {
    try {
      // `describe()` rather than the adapter's own `spec`: the two model
      // classes have different spec types, and everything wanted here is on
      // the wire type they share.
      const info = this.models.get(modelId).describe();
      return {
        family: info.family,
        defaultSteps: info.defaults.steps ?? null,
        maxCfg: info.max_cfg ?? null,
      };
    } catch {
      return null;
    }
  }

  submitLlmEngineInstall(version?: string): Job {
    const active = this.jobs.findActive("download", "llm-engine");
    if (active !== null) return active;
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      handle.phase("installing", "Installing prompt-assistant engine");
      await this.llm.installEngine(version, (fraction, message) =>
        handle.progress(fraction, message, "installing"),
      );
      return { model: "llm-engine" };
    };
    return this.jobs.submit("download", { model: "llm-engine" }, runner);
  }

  submitLlmModelDownload(modelId: string): Job {
    if (!llmModelSpec(modelId)) {
      throw new ModelError(`Unknown prompt-assistant model '${modelId}'.`);
    }
    const jobModel = `llm:${modelId}`;
    const active = this.jobs.findActive("download", jobModel);
    if (active !== null) return active;
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      handle.phase("downloading", `Downloading ${modelId}`);
      await this.llm.downloadModel(modelId, (fraction, message) =>
        handle.progress(fraction, message, "downloading"),
      );
      return { model: jobModel };
    };
    return this.jobs.submit("download", { model: jobModel }, runner);
  }

  async deleteLlmModel(modelId: string): Promise<void> {
    await this.llm.deleteModel(modelId);
  }

  /* ------------------------------------------------------------------ image */

  async imageStatus(): Promise<ImageStatus> {
    return await this.image.status();
  }

  submitImageEngineInstall(version?: string): Job {
    const active = this.jobs.findActive("download", "image-engine");
    if (active !== null) return active;
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      handle.phase("installing", "Installing artwork engine");
      await this.image.installEngine(version, (fraction, message) =>
        handle.progress(fraction, message, "installing"),
      );
      return { model: "image-engine" };
    };
    return this.jobs.submit("download", { model: "image-engine" }, runner);
  }

  submitImageModelDownload(modelId: string): Job {
    if (!imageModelSpec(modelId)) throw new ModelError(`Unknown artwork model '${modelId}'.`);
    const jobModel = `image:${modelId}`;
    const active = this.jobs.findActive("download", jobModel);
    if (active !== null) return active;
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      handle.phase("downloading", `Downloading ${modelId}`);
      await this.image.downloadModel(modelId, (fraction, message) =>
        handle.progress(fraction, message, "downloading"),
      );
      return { model: jobModel };
    };
    return this.jobs.submit("download", { model: jobModel }, runner);
  }

  async deleteImageModel(modelId: string): Promise<void> {
    await this.image.deleteModel(modelId);
  }

  /**
   * Draw cover art for one sound and attach it, replacing any it already had.
   *
   * The old file is deleted only after the new one exists: a failed render
   * should leave the sound with the cover it had, not with none.
   */
  async generateSoundArtwork(soundId: string): Promise<Sound> {
    const sound = this.db.getSound(soundId);
    if (sound === null) throw new ModelError(`Sound '${soundId}' not found.`);
    const art = await this.image.generate({
      prompt: coverArtPrompt(sound),
      kind: "cover",
      // Same sound, same picture: the seed is the sound's own, so a redraw
      // after an edit changes the art for a reason rather than at random.
      seed: sound.seed ?? null,
    });
    const previous = this.db.setSoundArtwork(soundId, art.filename);
    if (previous) await this.image.deleteArtwork(previous);
    const updated = this.db.getSound(soundId);
    if (updated === null) throw new ModelError(`Sound '${soundId}' not found.`);
    return updated;
  }

  async clearSoundArtwork(soundId: string): Promise<void> {
    const previous = this.db.setSoundArtwork(soundId, null);
    if (previous) await this.image.deleteArtwork(previous);
  }

  async generateVoiceArtwork(voiceId: string): Promise<Voice> {
    const voice = this.db.getVoice(voiceId);
    if (voice === null) throw new ModelError(`Voice '${voiceId}' not found.`);
    const art = await this.image.generate({
      prompt: voiceAvatarPrompt(voice),
      kind: "avatar",
    });
    const previous = this.db.setVoiceArtwork(voiceId, art.filename);
    if (previous) await this.image.deleteArtwork(previous);
    const updated = this.db.getVoice(voiceId);
    if (updated === null) throw new ModelError(`Voice '${voiceId}' not found.`);
    return updated;
  }

  async clearVoiceArtwork(voiceId: string): Promise<void> {
    const previous = this.db.setVoiceArtwork(voiceId, null);
    if (previous) await this.image.deleteArtwork(previous);
  }

  /**
   * Queue cover art for a freshly generated music sound, if the user asked
   * for that.
   *
   * Deliberately fire-and-forget and deliberately *after* the generate job has
   * returned: the image engine wants the same VRAM the audio model is holding,
   * so this must never sit between the user and their audio. A failure is
   * logged and dropped — nobody should see a generation reported as failed
   * because a picture didn't render.
   */
  maybeQueueArtwork(sound: Sound): void {
    if (!this.config.settings.image_auto_artwork) return;
    if (this.config.settings.image_mode === "off") return;
    if (this.modelCategory(sound.model) !== "music") return;
    void this.generateSoundArtwork(sound.id).catch((exc) => {
      log.warning(`artwork for ${sound.id} failed: ${exc instanceof Error ? exc.message : exc}`);
    });
  }

  /** A model's category, or null if it isn't one we know. The catalog first,
   *  then the registry, which is the only place a custom endpoint is known. */
  private modelCategory(modelId: string): string | null {
    const fromCatalog = catalogById().get(modelId)?.category;
    if (fromCatalog) return fromCatalog;
    try {
      return this.models.get(modelId).describe().category;
    } catch {
      return null;
    }
  }

  /** Every audio.cpp model the adapter knows about, verified or not, with
   *  whether the user currently has it enabled — the UI's Enable Model toggle
   *  reads this list. */
  audiocppCatalog(): AudioCppCatalogEntry[] {
    const enabled = new Set(this.config.settings.enabled_audiocpp_models);
    // Weights on the shared disk enable a model everywhere — see
    // `adoptDownloadedModels`. The row has to agree with the list, or the
    // toggle reads "off" beside a model the picker is already offering.
    const onDisk = this.models.downloadedCatalogIds;
    const entry = (
      spec: (typeof MODELS)[number],
      alwaysOn: boolean,
      isEnabled: boolean,
    ): AudioCppCatalogEntry => ({
      source: spec.source,
      id: spec.id,
      name: spec.name,
      vendor: spec.vendor,
      description: spec.description,
      license: spec.license,
      verified: spec.verified,
      always_on: alwaysOn,
      enabled: isEnabled || onDisk.has(spec.id),
      on_disk: onDisk.has(spec.id),
      category: spec.category,
    });
    // The user's own entries are always-on for the same reason they carry no
    // Settings toggle: putting one in custom.json is the decision. They come
    // last and shadow a built-in of the same id, matching `modelSpecs()`.
    const custom = userModelSpecs();
    const shadowed = new Set(custom.map((s) => s.id));
    return [
      ...MODELS.filter((s) => !shadowed.has(s.id)).map((spec) => entry(spec, true, true)),
      ...CATALOG_EXTRA.filter((s) => !shadowed.has(s.id)).map((spec) =>
        entry(spec, false, enabled.has(spec.id)),
      ),
      ...custom.map((spec) => entry(spec, true, true)),
    ];
  }

  /**
   * Move any weights still in the pre-0.2 per-model-id layout into audio.cpp's.
   *
   * Runs once at startup and is idempotent. Failures are logged rather than
   * raised: the worst case is one model reading as not-downloaded, which the
   * Download button fixes, and that is much better than refusing to start.
   */
  /**
   * Put every already-downloaded model back in the list, whatever profile
   * ticked it.
   *
   * Weights live under the install root, shared by every profile; the enable
   * list lives in each profile's own settings.json. That split is right for
   * both — nobody wants a second copy of ten gigabytes, and nobody wants one
   * profile's model choices imposed on another — but it left a gap: a model
   * downloaded in profile A read as missing in profile B, with a toggle
   * offering to "enable" something already sitting on the disk.
   *
   * Presence on disk is therefore its own opt-in, applied on top of the
   * profile's list rather than written into it. Nothing is persisted here, so
   * this stays true by construction rather than by remembering to sync a file.
   */
  async adoptDownloadedModels(): Promise<void> {
    try {
      const adopted = await this.models.adoptDownloaded();
      if (adopted.length) {
        log.info(
          `audio.cpp models: ${adopted.length} already downloaded on this machine, ` +
            `enabled for this profile (${adopted.join(", ")})`,
        );
      }
    } catch (exc) {
      log.warning(
        `could not check which models are downloaded: ${exc instanceof Error ? exc.message : exc}`,
      );
    }
  }

  async migrateAudiocppLayout(): Promise<void> {
    try {
      // The whole catalog, not just the enabled models: a user who downloaded
      // an extra and later switched it off still has its weights on disk, and
      // leaving those behind in the old layout would strand them.
      const result = await migrateLayout(this.models.audiocppRoot, catalog());
      if (result.moved.length) {
        log.info(
          `audio.cpp weights: moved ${result.moved.length} package(s) into the shared layout ` +
            `(${result.moved.join(", ")})`,
        );
      }
      for (const f of result.failed) {
        log.warning(`audio.cpp weights: could not move ${f.id} — ${f.error}`);
      }
    } catch (exc) {
      log.warning(`audio.cpp weights: layout migration skipped — ${String(exc)}`);
    }
  }

  /**
   * Which audio.cpp binary is in force, and where its weights live.
   *
   * The information existed only in `soundbox model status audiocpp` before
   * this — so a user whose binary resolved via SOUNDBOX_AUDIOCPP_BIN or PATH
   * had no way to see in the app which one won, or what backend it picked.
   */
  async audiocppRuntime(): Promise<AudioCppRuntimeStatus> {
    const engine = await audiocppBinary.status();
    return {
      mode: this.config.settings.audiocpp_mode,
      engine,
      models_dir: this.models.audiocppRoot,
      models_dir_default: join(this.config.paths.models, "audiocpp"),
    };
  }

  submitAudiocppEngineInstall(version?: string, backend?: string): Job {
    const active = this.jobs.findActive("download", "audiocpp-engine");
    if (active !== null) return active;
    const runner = async (handle: JobHandle): Promise<Record<string, unknown>> => {
      handle.phase("installing", "Installing the audio.cpp runtime");
      await audiocppBinary.install(
        version ?? audiocppBinary.DEFAULT_VERSION,
        backend ?? null,
        (fraction, message) => handle.progress(fraction, message, "installing"),
      );
      return { model: "audiocpp-engine" };
    };
    return this.jobs.submit("download", { model: "audiocpp-engine" }, runner);
  }

  /* ------------------------------------------------------------------- mcp */

  /** Everything the Agents page needs in one call. `tools` comes from the
   *  mounted MCP server (the API layer has it; the service doesn't). */
  mcpStatus(baseUrl: string, tools: McpToolInfo[]): McpStatus {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const totals = this.db.mcpCallTotals(since24h);
    for (const t of tools) t.calls = totals.per_tool[t.name] ?? 0;
    const clients = this.db.mcpClients(this.telemetry.activeSince());
    const running = this.telemetry.running();
    const sessions = new Set(running.map((c) => c.session_id).filter(Boolean));
    return {
      endpoint: `${trimTrailingSlashes(baseUrl)}/mcp`,
      // The absolute path to this install's own bridge, not a name.
      //
      // `npx soundbox-mcp` cannot work: the package is private and named
      // @soundbox/server, so nothing resolves from the registry. npm does link
      // the bin, but only into the checkout's own node_modules/.bin, which is
      // not on the PATH an MCP client spawns with — so a bare `soundbox-mcp`
      // fails too, and fails as "command not found" with nothing to go on.
      // Printing the resolved path means the copy button yields a line that
      // works on the machine reading it.
      //
      // Always the dist build. Under `npm run dev` this file is running from
      // src through tsx, but the bridge a client spawns is plain node, which
      // cannot execute the TypeScript sitting next to it.
      stdio_command: `node ${resolve(import.meta.dirname, "..", "dist", "mcp", "stdio.js")}`,
      server_name: "soundbox",
      server_version: VERSION,
      tools,
      clients,
      calls_total: totals.calls,
      errors_total: totals.errors,
      sounds_total: this.db.countSoundsBySource().mcp ?? 0,
      calls_24h: totals.calls_24h,
      last_call_at: totals.last_call_at,
      active_sessions: sessions.size,
      otel: this.telemetry.otel.status,
      skills: skillsMod.listSkills(),
      skill_targets: skillsMod.targets(),
    };
  }

  /* ------------------------------------------------------------------ logs */

  /**
   * Last `lines` of the persistent log file, oldest first.
   *
   * Cheap and best-effort: no log file yet (e.g. logging to file disabled, or
   * nothing written) just means an empty list, not an error — this backs an
   * optional debugging endpoint, not a contract.
   */
  tailLog(lines = 200): string[] {
    // The entry point records the file it actually opened; each server instance
    // has its own so a sidecar's lines don't interleave with ours.
    const envPath = process.env.SOUNDBOX_LOG_FILE;
    const path = envPath ? envPath : join(this.config.paths.root, "soundbox.log");
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      return [];
    }
    const all = text.split("\n");
    if (all.length && all[all.length - 1] === "") all.pop();
    return all.slice(-lines);
  }
}

/** Match Python's `round(x, 3)` closely enough for a duration in seconds. */
function round3(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

/** `Path.unlink(missing_ok=True)`: a file already gone is not a failure. */
async function unlinkQuiet(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* already gone */
  }
}
