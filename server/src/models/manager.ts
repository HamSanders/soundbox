/**
 * Model registry and residency manager.
 *
 * One model is resident at a time. Loading model B unloads model A first —
 * with a 16 GB consumer card as the design target, letting two models share
 * VRAM is how you get an OOM halfway through someone's render.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { ModelError } from "../errors.js";
import { buildFailure } from "../failure.js";
import type { ModelInfo } from "../schemas.js";
import {
  AudioCppModel,
  backend,
  catalog,
  CATALOG_EXTRA,
  modelSpecs,
  type ModelSpec,
  type ProgressFn,
} from "./audiocpp.js";
import { AudioCppRuntime } from "./audiocppRuntime.js";
import type { GenerationModel } from "./types.js";
import { EndpointModel } from "../endpoints/model.js";
import { type AudioEndpoint, endpointModelId } from "../endpoints/types.js";

/**
 * A registry entry. Tagged so `instantiate()` stays the single place that
 * knows which class runs which kind of entry.
 */
type Entry = { kind: "local"; spec: ModelSpec } | { kind: "endpoint"; endpoint: AudioEndpoint };

/**
 * audio.cpp runs everything that runs on this machine; every model-specific
 * Python stack (MOSS, Stable Audio, TangoFlux, AudioLDM2, AudioGen) was
 * removed in favour of it. See docs/AUDIOCPP.md.
 *
 * Custom endpoints come after the local models, so anything that picks "the
 * first installed model" lands on one this machine runs.
 */
function registry(
  enabledAudiocppIds: ReadonlySet<string>,
  endpoints: readonly AudioEndpoint[],
): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const spec of modelSpecs(enabledAudiocppIds)) {
    entries.set(spec.id, { kind: "local", spec });
  }
  for (const endpoint of endpoints) {
    if (endpoint.enabled) entries.set(endpointModelId(endpoint.id), { kind: "endpoint", endpoint });
  }
  return entries;
}

/** The local entries, for the paths that are about packages on disk. */
function localSpec(entry: Entry | undefined): ModelSpec | null {
  return entry?.kind === "local" ? entry.spec : null;
}

export class ModelManager {
  readonly modelsDir: string;
  hfToken: string | null;
  /** Where audio.cpp packages are installed. Mutable because switching between
   *  managed and external is a settings change, not a restart. */
  audiocppRoot: string;
  /**
   * audio.cpp's package manager, run on demand.
   *
   * Only management goes through it — generation is still one-shot
   * `audiocpp_cli` — so it spends almost all of its life stopped, started for
   * a download and idled back out by the same tick that unloads models.
   */
  readonly runtime = new AudioCppRuntime();

  private enabledAudiocpp: Set<string>;
  /**
   * Catalog ids whose weights are already on this machine.
   *
   * Enablement is a *profile* setting, but weights live under `base/models`,
   * which every profile shares (see `Paths`). Without this set, downloading an
   * unverified model in one profile and then making a second profile hides a
   * model that is sitting right there on the disk, and the only way back is to
   * find and re-tick it — for a download that has already happened.
   *
   * So presence on disk is treated as its own opt-in, unioned with the
   * profile's list. The toggle still means something: it is what lets an
   * unverified model be downloaded in the first place. What it stops meaning
   * is "hide the weights I already have".
   */
  private presentAudiocpp = new Set<string>();
  /** The profile's custom endpoints, as of the last `setEndpoints()`. */
  private endpoints: AudioEndpoint[] = [];
  private specs: Map<string, Entry>;
  private instances = new Map<string, GenerationModel>();
  private _resident: string | null = null;
  private lastUsed = Date.now();
  /** Serialises load/unload so two concurrent loads can't both believe the
   *  residency slot is free. Node is single-threaded, but `load()` awaits, and
   *  that is enough to interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    modelsDir: string,
    hfToken: string | null = null,
    enabledAudiocppModels: string[] = [],
    audiocppRoot?: string,
    endpoints: AudioEndpoint[] = [],
  ) {
    this.modelsDir = modelsDir;
    this.hfToken = hfToken;
    this.audiocppRoot = audiocppRoot ?? join(modelsDir, "audiocpp");
    this.enabledAudiocpp = new Set(enabledAudiocppModels);
    this.endpoints = [...endpoints];
    this.specs = registry(this.audiocppEnabled(), this.endpoints);
  }

  /**
   * The ids that count as enabled: the profile's own list, plus everything
   * already downloaded. One accessor rather than a union at each call site,
   * because a `registry()` built from only one of the two is the exact bug
   * `presentAudiocpp` exists to fix.
   */
  private audiocppEnabled(): ReadonlySet<string> {
    return new Set([...this.enabledAudiocpp, ...this.presentAudiocpp]);
  }

  /**
   * Adopt every catalog model whose weights are on this machine.
   *
   * Called at startup, after a profile switch, and after anything that changes
   * what is on disk (a download, a delete, a change of models folder). Cheap
   * despite touching the filesystem: each model installs into its own
   * directory under the packages root, so a missing directory rules an entry
   * out before any walking happens.
   *
   * Returns the ids newly adopted, for the log line — a model appearing in the
   * list without the user ticking anything deserves a trace.
   */
  async adoptDownloaded(): Promise<string[]> {
    const present = new Set<string>();
    // Only the opt-in tier is worth checking. The verified models and the
    // user's own custom.json entries are in the registry unconditionally, so
    // asking the disk about them would be pure cost.
    for (const spec of CATALOG_EXTRA) {
      const model = new AudioCppModel(
        spec,
        this.modelsDir,
        this.hfToken,
        this.audiocppRoot,
        this.runtime,
      );
      try {
        if (await model.isDownloaded()) present.add(spec.id);
      } catch {
        // An unreadable weights directory is not a reason to fail startup —
        // it just means this entry does not get adopted.
      }
    }
    const added = [...present].filter((id) => !this.presentAudiocpp.has(id));
    const dropped = [...this.presentAudiocpp].filter((id) => !present.has(id));
    if (!added.length && !dropped.length) return [];
    await this.locked(async () => {
      this.presentAudiocpp = present;
      const next = registry(this.audiocppEnabled(), this.endpoints);
      for (const id of this.specs.keys()) {
        if (next.has(id) || !this.instances.has(id)) continue;
        if (this._resident === id) await this.unloadInner(id);
        this.instances.delete(id);
      }
      this.specs = next;
    });
    return added.filter((id) => !this.enabledAudiocpp.has(id));
  }

  /** The one place that knows which class runs which kind of entry. */
  private instantiate(entry: Entry, hfToken = this.hfToken): GenerationModel {
    if (entry.kind === "endpoint") return new EndpointModel(entry.endpoint);
    return new AudioCppModel(entry.spec, this.modelsDir, hfToken, this.audiocppRoot, this.runtime);
  }

  /**
   * Replace the custom endpoints, after an edit or a profile switch.
   *
   * Every endpoint instance is dropped rather than just the changed ones: an
   * instance holds its config, so an edited URL or template has to reach the
   * next request, and rebuilding one is free. Local instances are untouched.
   */
  async setEndpoints(endpoints: AudioEndpoint[]): Promise<void> {
    await this.locked(async () => {
      this.endpoints = [...endpoints];
      this.specs = registry(this.audiocppEnabled(), this.endpoints);
      for (const [id, model] of this.instances) {
        if (model instanceof EndpointModel) this.instances.delete(id);
      }
    });
  }

  /**
   * Repoint at another packages folder, dropping cached instances so the next
   * `get()` builds them against the new root. Called when the user switches
   * between a managed install and their own audio.cpp.
   */
  setAudiocppRoot(root: string): void {
    if (root === this.audiocppRoot) return;
    this.audiocppRoot = root;
    this.instances.clear();
    // The running server was told the old root at startup and has no way to
    // be told otherwise, so it has to go.
    void this.runtime.reconfigure();
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /* ------------------------------------------------------------ discovery */

  ids(): string[] {
    return [...this.specs.keys()];
  }

  get(modelId: string): GenerationModel {
    const entry = this.specs.get(modelId);
    if (!entry) {
      throw new ModelError(
        `Unknown model '${modelId}'. Available: ${this.ids().join(", ")}`,
      );
    }
    let model = this.instances.get(modelId);
    if (!model) {
      model = this.instantiate(entry);
      this.instances.set(modelId, model);
    }
    return model;
  }

  async listInfo(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    for (const id of this.specs.keys()) {
      try {
        out.push(await this.get(id).status());
      } catch (exc) {
        // One bad adapter shouldn't hide the rest.
        const info = this.instantiate(this.specs.get(id)!, null).describe();
        info.status = "error";
        info.error = String(exc);
        info.failure = buildFailure(exc, { stage: "status" });
        out.push(info);
      }
    }
    return out;
  }

  setHfToken(token: string | null): void {
    this.hfToken = token;
    for (const model of this.instances.values()) {
      if (model instanceof AudioCppModel) model.hfToken = token;
    }
  }

  /**
   * Rebuild the registry after Settings.enabled_audiocpp_models changes.
   *
   * Toggling a catalog model on or off takes effect immediately — no restart,
   * matching how setHfToken applies without one. An id being *removed* gets
   * unloaded first: if the manager kept serving it after the setting says it's
   * off, "enabled" would stop meaning anything, and the resident-model slot
   * would be held by a model the user can no longer see in the list to unload
   * themselves.
   */
  async setAudiocppEnabled(enabledIds: string[]): Promise<void> {
    await this.locked(async () => {
      this.enabledAudiocpp = new Set(enabledIds);
      const next = registry(this.audiocppEnabled(), this.endpoints);
      for (const id of this.specs.keys()) {
        if (next.has(id) || !this.instances.has(id)) continue;
        if (this._resident === id) await this.unloadInner(id);
        this.instances.delete(id);
      }
      this.specs = next;
    });
  }

  /** Catalog ids whose weights are on this machine, as of the last adopt
   *  pass — what the Models page marks "On this device". */
  get downloadedCatalogIds(): ReadonlySet<string> {
    return this.presentAudiocpp;
  }

  get resident(): string | null {
    return this._resident;
  }

  /**
   * Whether another catalog entry installs into the same package directory.
   *
   * Checked against the whole catalog, not just the enabled models: an entry
   * the user has switched off still has weights on disk, and deleting them out
   * from under it would be just as wrong.
   */
  private sharesPackageDir(modelId: string): boolean {
    const target = localSpec(this.specs.get(modelId))?.audiocpp_target_dir;
    if (!target) return false;
    return catalog().some((s) => s.id !== modelId && s.audiocpp_target_dir === target);
  }

  /* ------------------------------------------------------------ lifecycle */

  async download(modelId: string, progress?: ProgressFn, signal?: AbortSignal): Promise<ModelInfo> {
    const model = this.get(modelId);
    await model.requireDeps();
    await model.download(progress, signal);
    // The weights are now on the shared disk, so this model belongs to every
    // profile from here on — not just the one that happened to download it.
    await this.adoptDownloaded();
    return await model.status();
  }

  async load(modelId: string, progress?: ProgressFn): Promise<ModelInfo> {
    return await this.locked(async () => {
      const model = this.get(modelId);
      if (model.loaded) {
        this.lastUsed = Date.now();
        return await model.status();
      }
      await model.requireDeps();
      if (this._resident && this._resident !== modelId) {
        progress?.(0.02, `Unloading ${this._resident}`);
        await this.unloadInner(this._resident);
      }
      progress?.(0.05, `Loading ${model.describe().name}`);
      model.error = null;
      try {
        await model.load(progress);
      } catch (exc) {
        if (exc instanceof ModelError) throw exc;
        model.error = String(exc);
        throw new ModelError(`Failed to load ${modelId}: ${exc}`);
      }
      this._resident = modelId;
      this.lastUsed = Date.now();
      return await model.status();
    });
  }

  async unload(modelId: string | null = null): Promise<ModelInfo | null> {
    return await this.locked(() => this.unloadInner(modelId));
  }

  private async unloadInner(modelId: string | null): Promise<ModelInfo | null> {
    const target = modelId ?? this._resident;
    if (target === null) return null;
    const model = this.get(target);
    // Awaited: unloading now really releases VRAM through the runtime, so the
    // status below must not be read while the model is still resident — and
    // the caller that unloads to make room for another model needs the space
    // actually free before it loads one.
    await model.unload();
    if (this._resident === target) this._resident = null;
    return await model.status();
  }

  touch(): void {
    this.lastUsed = Date.now();
  }

  /** Called by a background ticker. Returns true if it unloaded something. */
  async maybeAutoUnload(idleMinutes: number): Promise<boolean> {
    if (idleMinutes <= 0 || this._resident === null) return false;
    if (Date.now() - this.lastUsed < idleMinutes * 60_000) return false;
    await this.unload();
    return true;
  }

  /**
   * Remove this model's downloaded weights.
   *
   * Deviation from the Python, which only cleared the shared HF cache folder
   * (`models--<repo>`). The repo folder is still removed when present, for
   * caches populated by an older install.
   *
   * The weights directory itself is *not* safe to delete wholesale any more:
   * since Konchi adopted audio.cpp's layout, several catalog entries can
   * share one package directory — removing ACE-Step turbo by deleting
   * `ACE-Step1.5-GGUF` would take the base build with it. So when the runtime
   * can do it, deletion goes through audio.cpp, which removes one package
   * precision and leaves its neighbours alone.
   */
  async deleteWeights(modelId: string): Promise<void> {
    const model = this.get(modelId);
    if (!(model instanceof AudioCppModel)) {
      throw new ModelError(`${model.describe().name} has no weights on this machine to delete.`);
    }
    const info = model.describe();
    if (!info.hf_repo) {
      throw new ModelError(`${info.name} has no downloadable weights to delete.`);
    }
    const hadWeights = await model.isDownloaded();
    if (this._resident === modelId) await this.unload(modelId);

    const pkg = localSpec(this.specs.get(modelId))?.audiocpp_package_id ?? null;
    let removed = hadWeights;
    if (pkg) {
      const delegated = await this.runtime
        .deletePackage(pkg, this.audiocppRoot, backend())
        .catch(() => false);
      if (delegated) {
        this.instances.delete(modelId);
        // Its weights are gone, so an entry that was only in the list because
        // they were there drops back out. One the user enabled explicitly
        // stays — that tick is a separate statement from what is on disk.
        await this.adoptDownloaded();
        return;
      }
    }

    const folder = "models--" + info.hf_repo.replace(/\//g, "--");
    const targets = [
      // Only safe to remove outright when this entry owns the directory: a
      // bring-your-own model, or one whose package nothing else shares.
      ...(pkg && this.sharesPackageDir(modelId) ? [] : [model.weightsDir()]),
      join(this.modelsDir, "hub", folder),
      join(this.modelsDir, folder),
    ];
    for (const target of targets) {
      try {
        await rm(target, { recursive: true });
        removed = true;
      } catch {
        // Missing is the common case — only "nothing anywhere" is an error.
      }
    }
    if (!removed) throw new ModelError(`No cached weights found for ${info.name}.`);
    await this.adoptDownloaded();
  }
}
