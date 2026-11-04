/**
 * Artwork generation: cover art for music, avatars for voices.
 *
 * Sibling of `llm/service.ts`, and the same three modes for the same reason —
 * "off", "managed" (we install an engine and a checkpoint), "external" (you
 * already run one). `resolveEndpoint()` collapses the last two into a base
 * URL plus an API shape, so `generate()` has one code path.
 *
 * Artwork is derived and disposable: every image is written to
 * `<data dir>/artwork/` and referenced by a `/artwork/<file>` URL, never
 * inlined into a response, and deleting one is always safe.
 */

import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { Config, ImageApiKind } from "../config.js";
import { ModelError } from "../errors.js";
import * as sdBinary from "../models/sdServerBinary.js";
import {
  type ImageModelSpec,
  type ImageProgressFn,
  customCatalogPath,
  deleteWeights,
  downloadWeights,
  imageCatalog,
  imageModelSpec,
  isDownloaded,
  loadArgs,
  missingFiles,
  totalBytes,
} from "./catalog.js";
import { generateImage } from "./client.js";
import { ImageRuntime } from "./runtime.js";
import { NEGATIVE_PROMPT } from "./prompts.js";
import { probeAll, type DetectedImageEndpoint } from "./probe.js";

export interface ImageCatalogEntry extends ImageModelSpec {
  installed: boolean;
  /** Total bytes still to fetch — 0 once installed, and 0 for a model whose
   *  files you supplied yourself. The UI shows this before you commit. */
  size_bytes: number;
}

export interface ImageStatus {
  mode: Config["settings"]["image_mode"];
  /** Whether artwork can actually be produced right now. The UI hides its
   *  generate buttons on this one value rather than re-deriving the rule. */
  ready: boolean;
  /** Why not, when `ready` is false and the mode isn't "off". */
  detail: string | null;
  engine: { installed: boolean; version: string | null; backend: string | null };
  model: ImageCatalogEntry | null;
  catalog: ImageCatalogEntry[];
  external: { kind: ImageApiKind; base_url: string; model: string; api_key_set: boolean };
  running: boolean;
  auto_artwork: boolean;
  /** Image servers already listening on this machine, for one-click setup. */
  detected: DetectedImageEndpoint[];
}

/** What the caller asked to have drawn. `kind` only picks the aspect ratio and
 *  the filename prefix — the prompt is built by the caller from `prompts.ts`. */
export interface ArtworkRequest {
  prompt: string;
  kind: "cover" | "avatar";
  seed?: number | null;
}

export interface Artwork {
  /** Served path, e.g. `/artwork/<uuid>.png`. */
  url: string;
  filename: string;
}

export class ImageService {
  private readonly config: Config;
  private readonly runtime = new ImageRuntime();

  constructor(config: Config) {
    this.config = config;
  }

  private get settings() {
    return this.config.settings;
  }

  /* -------------------------------------------------------------- status */

  async status(): Promise<ImageStatus> {
    const [engine, detected] = await Promise.all([sdBinary.status(), probeAll()]);
    const modelsDir = this.config.paths.models;
    const catalog: ImageCatalogEntry[] = await Promise.all(
      imageCatalog().map(async (spec) => ({
        ...spec,
        installed: await isDownloaded(modelsDir, spec),
        size_bytes: totalBytes(spec),
      })),
    );
    const spec = imageModelSpec(this.settings.image_model);
    const model = spec ? (catalog.find((c) => c.id === spec.id) ?? null) : null;
    const detail = this.readiness(engine.installed, model);

    return {
      mode: this.settings.image_mode,
      ready: this.settings.image_mode !== "off" && detail === null,
      detail,
      engine: { installed: engine.installed, version: engine.version, backend: engine.backend },
      model,
      catalog,
      external: {
        kind: this.settings.image_external_kind,
        base_url: this.settings.image_external_base_url,
        model: this.settings.image_external_model,
        api_key_set: Boolean(this.settings.image_external_api_key),
      },
      running: this.runtime.isRunning,
      auto_artwork: this.settings.image_auto_artwork,
      detected,
    };
  }

  /** The one missing piece, phrased for a human, or null when nothing is
   *  missing. Kept separate from `generate()` so the UI can say what to do
   *  before somebody clicks a button that was always going to fail. */
  private readiness(engineInstalled: boolean, model: ImageCatalogEntry | null): string | null {
    if (this.settings.image_mode === "off") return "Artwork is turned off.";
    if (this.settings.image_mode === "external") {
      return this.settings.image_external_base_url.trim()
        ? null
        : "No endpoint set — add the base URL of your image server.";
    }
    if (!engineInstalled) return "The artwork engine isn't installed yet.";
    if (model === null) return `Unknown artwork model '${this.settings.image_model}'.`;
    if (!model.installed) {
      // Name the files, not just the model: a multi-file model that is three
      // quarters downloaded, or one of yours whose path moved, both land here
      // and "not downloaded yet" would be unhelpful for either.
      const missing = missingFiles(this.config.paths.models, model).map((f) =>
        // Both separators: a repo-relative path uses "/", a Windows path you
        // wrote in custom.json uses "\".
        f.path.split(/[\\/]/).pop(),
      );
      return missing.length === model.files.length
        ? `${model.name} hasn't been downloaded yet.`
        : `${model.name} is missing ${missing.join(", ")}.`;
    }
    return null;
  }

  /* ------------------------------------------------------------ generate */

  /**
   * Render one image and write it into the artwork directory.
   *
   * Returns the served URL. Callers persist that string against a sound or a
   * voice; nothing here knows about either.
   */
  async generate(req: ArtworkRequest): Promise<Artwork> {
    const { baseUrl, kind, apiKey, model, steps, cfg, resolution } = await this.resolveEndpoint();
    // Square for a cover, square for an avatar too: every consumer of these
    // crops to a circle or a tile, and a turbo checkpoint rendered off its
    // training aspect degrades for no gain.
    const bytes = await generateImage({
      baseUrl,
      kind,
      apiKey,
      model,
      prompt: req.prompt,
      negativePrompt: NEGATIVE_PROMPT,
      width: resolution,
      height: resolution,
      steps,
      cfg,
      seed: req.seed ?? null,
    });

    const filename = `${req.kind}-${randomUUID()}.png`;
    await writeFile(join(this.config.paths.artwork, filename), bytes);
    this.runtime.touch();
    return { url: `/artwork/${filename}`, filename };
  }

  /**
   * Where to send the request, and with what parameters.
   *
   * The managed path starts the engine if it isn't up; the external path is
   * whatever the user configured. Steps and cfg come from the catalog entry
   * for a managed model — a turbo checkpoint wants 1–4 steps at cfg 1.0 — and
   * from conservative defaults for an external endpoint, whose checkpoint we
   * know nothing about.
   */
  private async resolveEndpoint(): Promise<{
    baseUrl: string;
    kind: ImageApiKind;
    apiKey: string | null;
    model: string | null;
    steps: number;
    cfg: number;
    resolution: number;
  }> {
    const mode = this.settings.image_mode;
    if (mode === "off") {
      throw new ModelError(
        "Artwork is turned off. Turn it on in Settings — either install the local " +
          "engine, or point Konchi at an image server you already run.",
      );
    }

    if (mode === "external") {
      const baseUrl = this.settings.image_external_base_url.trim();
      if (!baseUrl) {
        throw new ModelError(
          "No image endpoint configured. Add its base URL in Settings, or switch " +
            "artwork to the local engine.",
        );
      }
      return {
        baseUrl,
        kind: this.settings.image_external_kind,
        apiKey: this.settings.image_external_api_key,
        model: this.settings.image_external_model || null,
        // Somebody else's endpoint, somebody else's checkpoint: these are the
        // safe middle ground rather than turbo settings that would ruin a
        // normal SD render.
        steps: 20,
        cfg: 7.0,
        resolution: 512,
      };
    }

    const spec = imageModelSpec(this.settings.image_model);
    if (!spec) throw new ModelError(`Unknown artwork model '${this.settings.image_model}'.`);
    const modelsDir = this.config.paths.models;
    if (!(await isDownloaded(modelsDir, spec))) {
      const missing = missingFiles(modelsDir, spec);
      const local = missing.filter((f) => isAbsolute(f.path));
      throw new ModelError(
        local.length > 0
          ? `${spec.name} is missing files you pointed it at: ${local
              .map((f) => f.path)
              .join(", ")}. Check the paths in ${customCatalogPath()}.`
          : `${spec.name} hasn't finished downloading (${missing.length} of ` +
            `${spec.files.length} file(s) missing) — download it from Settings first.`,
      );
    }
    const binaryPath = await sdBinary.findBinary();
    if (binaryPath === null) {
      throw new ModelError(
        "The artwork engine (sd-server) isn't installed. Install it from Settings, or " +
          `point Konchi at your own build with ${sdBinary.BIN_ENV}.`,
      );
    }
    // The catalog decides what loading this model means — one checkpoint, or
    // SD 3.5's four files plus --clip-on-cpu. See `loadArgs`.
    const { baseUrl } = await this.runtime.ensureRunning(binaryPath, loadArgs(modelsDir, spec));
    return {
      baseUrl,
      // sd-server serves both shapes; the A1111 one is chosen because it is
      // the only one that can carry this checkpoint's steps and cfg.
      kind: "a1111",
      apiKey: null,
      model: null,
      steps: spec.steps,
      cfg: spec.cfg,
      resolution: spec.resolution,
    };
  }

  /* ------------------------------------------------------------- engine */

  async installEngine(version: string | undefined, progress?: sdBinary.InstallProgressFn) {
    return await sdBinary.install(version ?? sdBinary.DEFAULT_VERSION, null, progress);
  }

  async downloadModel(modelId: string, progress?: ImageProgressFn): Promise<void> {
    const spec = imageModelSpec(modelId);
    if (!spec) throw new ModelError(`Unknown artwork model '${modelId}'.`);
    await downloadWeights(
      this.config.paths.models,
      spec,
      this.settings.effectiveHfToken(),
      progress,
    );
  }

  async deleteModel(modelId: string): Promise<void> {
    const spec = imageModelSpec(modelId);
    if (!spec) throw new ModelError(`Unknown artwork model '${modelId}'.`);
    // Stop first: the engine holds the file open on Windows, where a delete
    // under an open handle fails outright rather than deferring.
    if (this.settings.image_model === modelId) await this.runtime.stop();
    await deleteWeights(this.config.paths.models, spec);
  }

  /** Delete one artwork file. Missing is success — the caller is clearing a
   *  reference either way, and a half-deleted pair is worse than neither. */
  async deleteArtwork(filename: string): Promise<void> {
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return;
    }
    await rm(join(this.config.paths.artwork, filename), { force: true }).catch(() => {});
  }

  /** Called after a settings PATCH touches an image_* key — the running
   *  engine may be serving the model that just stopped being the choice. */
  async onSettingsChanged(): Promise<void> {
    if (this.settings.image_mode !== "managed") await this.runtime.stop();
  }

  async maybeAutoStop(idleMinutes: number): Promise<boolean> {
    return await this.runtime.maybeAutoStop(idleMinutes);
  }

  async shutdown(): Promise<void> {
    await this.runtime.stop();
  }
}
