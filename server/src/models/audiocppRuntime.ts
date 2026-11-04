/**
 * Lifecycle of the managed `audiocpp_server` child process.
 *
 * Konchi has always shipped this binary — it comes down in the same release
 * archive as `audiocpp_cli` — and never run it. That left Konchi
 * reimplementing, in TypeScript, work the runtime already does natively:
 * resolving which Hugging Face files a package needs, fetching them, and
 * deciding whether a package on disk counts as installed. Two implementations
 * of one job, and they disagreed — weights installed by a standalone audio.cpp
 * were invisible to Konchi and vice versa, because each looked for its own
 * bookkeeping.
 *
 * It now runs inference too. A one-shot `audiocpp_cli` reloaded the model on
 * every single generation: measured against Stable Audio Small, ~8.5s of a
 * ~8.8s invocation was process startup and model load, and the same request
 * against a resident model came back in ~190ms. The CLI path survives as the
 * fallback for an install whose binary has no management endpoints.
 *
 * The awkward corner is cancellation. audio.cpp exposes no per-request cancel,
 * so stopping a generation means killing the process running it — which takes
 * the resident model down with it and makes the next request pay the load
 * again. That trade is deliberate: cancelling is occasional, and the reload
 * was being paid every time.
 *
 * Modelled closely on `llm/runtime.ts`, which does the same dance for
 * llama-server. The differences are all in what makes this one *optional*:
 * the management endpoints are an opt-in build flag upstream
 * (`-DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=ON`), and a user pointing
 * KONCHI_AUDIOCPP_BIN at their own build may well have a binary without
 * them — or no `audiocpp_server` beside it at all. Every entry point here can
 * answer "not available", and the caller falls back to the legacy downloader.
 */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";

import { CancelledJob, ModelError } from "../errors.js";
import { findBinary } from "./audiocppBinary.js";

type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

export const SERVER_NAME =
  process.platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server";

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 250;
/** Management calls are metadata-sized; a download's own progress is polled
 *  separately, so nothing here should ever take long. */
const CALL_TIMEOUT_MS = 30_000;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : null;
      srv.close(() => (port ? resolve(port) : reject(new Error("could not allocate a port"))));
    });
  });
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The `audiocpp_server` that belongs to the `audiocpp_cli` we resolved.
 *
 * Deliberately a sibling lookup rather than its own PATH search: the two
 * binaries share a release archive and a set of runtime DLLs, so pairing a
 * managed CLI with some other server found on PATH could mix versions whose
 * model_specs disagree.
 */
export async function findServerBinary(): Promise<string | null> {
  const cli = await findBinary();
  if (cli === null) return null;
  const candidate = join(dirname(cli), SERVER_NAME);
  if (!(await isFile(candidate))) return null;
  try {
    await access(candidate, fsConstants.X_OK);
  } catch {
    return null;
  }
  return candidate;
}

/** Why management is unavailable, in words a user could act on. */
export type UnavailableReason = "no-binary" | "no-server" | "no-management";

export interface ManagementCapability {
  available: boolean;
  reason: UnavailableReason | null;
  serverPath: string | null;
}

interface RunningServer {
  proc: ServerProcess;
  baseUrl: string;
  binaryPath: string;
  modelsRoot: string;
  stderrTail: string[];
  /** Model ids loaded into *this* process. A replacement process starts with
   *  none, however many were resident in the one it replaced. */
  resident: Set<string>;
}

interface Health {
  status?: string;
  backend?: string;
  ui_management?: boolean;
}

/**
 * `GET /v1/ui/models/install-status?id=…`, verbatim.
 *
 * `state` runs idle → queued → … → cancelled, but the state names are not the
 * reliable part: `exit_code` stays -1 until the job finishes and is then 0 for
 * success, which is what this code keys off. A failed install reports state
 * "cancelled" with the real reason in `message`.
 */
export interface InstallStatus {
  id: string;
  state: string;
  message: string;
  exit_code: number;
  downloaded_bytes: number;
  total_bytes: number;
  progress_percent: number;
  started_at_ms: number;
  finished_at_ms: number;
}

const INSTALL_POLL_MS = 700;
/** Loading a multi-GB package off a cold disk is slow; this is not a request. */
const LOAD_TIMEOUT_MS = 10 * 60_000;
/** How often an in-flight generation checks whether the job was cancelled. */
const CANCEL_POLL_MS = 250;

/** Just enough of `ProgressFn` to notice a cancellation, without importing it. */
export interface ProgressLike {
  handle?: { cancelled: boolean };
}

/** One audio artifact from `/v1/tasks/run` — `audio` is a base64 WAV. */
export interface TaskAudio {
  id?: string;
  audio: string;
  sample_rate?: number;
  channels?: number;
}

/**
 * A task response.
 *
 * Single-output tasks answer with `audio` at the top level; separation answers
 * with `named_audio_outputs` and no top-level audio, one entry per stem, named
 * by whatever the loader produced rather than a fixed vocals/drums/bass/other.
 */
export interface TaskResult {
  audio?: string;
  sample_rate?: number;
  channels?: number;
  named_audio_outputs?: TaskAudio[];
  timing?: Record<string, number>;
}

/** Pull the human part out of audio.cpp's `{"error":{"message":…}}` body. */
function extractError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON — the raw body is the best we have.
  }
  return text.slice(0, 400);
}

function fmtBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export class AudioCppRuntime {
  private running: RunningServer | null = null;
  private starting: Promise<RunningServer> | null = null;
  private lastUsed = Date.now();
  /** Cached negative result, so a machine without management doesn't pay a
   *  spawn-and-time-out on every status refresh. Cleared by `reconfigure()`. */
  private unavailable: UnavailableReason | null = null;

  /**
   * Forget what we learned about the binary.
   *
   * Called when the mode or the models root changes: the user may have just
   * pointed us at a different audio.cpp, and the running process is bound to
   * the old one's root.
   */
  async reconfigure(): Promise<void> {
    this.unavailable = null;
    await this.stop();
  }

  async capability(): Promise<ManagementCapability> {
    if (this.unavailable !== null) {
      return { available: false, reason: this.unavailable, serverPath: null };
    }
    if ((await findBinary()) === null) {
      return { available: false, reason: "no-binary", serverPath: null };
    }
    const server = await findServerBinary();
    if (server === null) {
      return { available: false, reason: "no-server", serverPath: null };
    }
    return { available: true, reason: null, serverPath: server };
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  touch(): void {
    this.lastUsed = Date.now();
  }

  /**
   * Base URL of a server serving `modelsRoot`, starting one if needed.
   *
   * Returns null rather than throwing when management simply isn't available
   * on this install — that is an expected configuration, not a failure, and
   * every caller has a legacy path to fall back to.
   */
  async ensureRunning(modelsRoot: string, backend: string | null): Promise<string | null> {
    return (await this.ensureServer(modelsRoot, backend))?.baseUrl ?? null;
  }

  private async ensureServer(
    modelsRoot: string,
    backend: string | null,
  ): Promise<RunningServer | null> {
    if (this.running && this.running.modelsRoot === modelsRoot) {
      this.lastUsed = Date.now();
      return this.running;
    }
    // Pointed somewhere else since it started — the models root is set once,
    // at startup, so a new root means a new process.
    if (this.running) await this.stop();

    if (this.starting) {
      const r = await this.starting;
      this.lastUsed = Date.now();
      return r;
    }

    const cap = await this.capability();
    if (!cap.available || cap.serverPath === null) {
      this.unavailable = cap.reason;
      return null;
    }

    this.starting = this.start(cap.serverPath, modelsRoot, backend);
    try {
      const r = await this.starting;
      this.running = r;
      this.lastUsed = Date.now();
      return r;
    } catch (exc) {
      // A server that won't start is indistinguishable, from here, from one
      // built without management. Remember it so we stop retrying, and let
      // the caller use the downloader that does work.
      this.unavailable = "no-management";
      log(`audio.cpp management unavailable: ${String(exc)}`);
      return null;
    } finally {
      this.starting = null;
    }
  }

  private async start(
    binaryPath: string,
    modelsRoot: string,
    backend: string | null,
  ): Promise<RunningServer> {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const args = [
      // `--ui` without `--config` is audio.cpp's documented "native
      // model-management host" mode, and it is the only way to get the
      // management endpoints: `--no-ui` is rejected outright unless a
      // `--config` is supplied. The embedded WebUI comes along with it, but it
      // is bound to 127.0.0.1 on a port we picked and never linked to.
      "--ui",
      "--ui-management",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ];
    if (backend) args.push("--backend", backend);

    const proc = spawn(binaryPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // The runtime DLLs sit beside the binary; on Windows they are found
      // relative to the working directory of the process that loads them.
      cwd: dirname(binaryPath),
    });

    const stderrTail: string[] = [];
    const onOutput = (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split(/\r?\n/).filter(Boolean);
      stderrTail.push(...lines);
      if (stderrTail.length > 40) stderrTail.splice(0, stderrTail.length - 40);
    };
    proc.stdout.on("data", onOutput);
    proc.stderr.on("data", onOutput);

    let exited: { code: number | null } | null = null;
    proc.on("exit", (code) => {
      exited = { code };
      if (this.running?.proc === proc) this.running = null;
    });

    try {
      const health = await this.waitForHealth(baseUrl, () => exited, stderrTail);
      // The management endpoints are an opt-in build flag upstream
      // (-DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=ON), and /health says outright
      // whether this build has them. Much better than discovering it from a
      // 404 partway through someone's download.
      if (health.ui_management !== true) {
        throw new ModelError(
          "this audiocpp_server was built without the native model manager " +
            "(--ui-management is inert), so downloads fall back to Konchi's own.",
        );
      }
      await this.setModelsRoot(baseUrl, modelsRoot);
    } catch (exc) {
      proc.kill();
      throw exc;
    }

    return { proc, baseUrl, binaryPath, modelsRoot, stderrTail, resident: new Set() };
  }

  private async waitForHealth(
    baseUrl: string,
    getExited: () => { code: number | null } | null,
    stderrTail: string[],
  ): Promise<Health> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const exited = getExited();
      if (exited) {
        throw new ModelError(
          `audiocpp_server exited (code ${exited.code}) before it became ready.\n\n` +
            stderrTail.slice(-15).join("\n"),
        );
      }
      try {
        const resp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
        if (resp.ok) return (await resp.json()) as Health;
      } catch {
        // Not up yet — keep polling.
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }
    throw new ModelError(
      `audiocpp_server did not become ready within ${HEALTH_TIMEOUT_MS / 1000}s.\n\n` +
        stderrTail.slice(-15).join("\n"),
    );
  }

  /**
   * Point the server at our packages folder.
   *
   * This is the hinge of the whole arrangement: in managed mode it is our own
   * `<base>/models/audiocpp`, and in external mode it is the user's audio.cpp
   * models folder — at which point both installs are managing one directory
   * and finally agree about what is installed.
   */
  private async setModelsRoot(baseUrl: string, modelsRoot: string): Promise<void> {
    const resp = await fetch(`${baseUrl}/v1/ui/models-root`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: modelsRoot }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new ModelError(
        `audiocpp_server refused models root '${modelsRoot}' (HTTP ${resp.status}). ` +
          `Check the folder exists and is writable.`,
      );
    }
  }

  /* ------------------------------------------------------------- requests */

  /** A management call against the running server, or null if unavailable. */
  async request<T>(
    modelsRoot: string,
    backend: string | null,
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T | null> {
    const server = await this.ensureServer(modelsRoot, backend);
    if (server === null) return null;
    return await this.send<T>(server, path, init);
  }

  private async send<T>(
    server: RunningServer,
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T | null> {
    this.lastUsed = Date.now();
    const resp = await fetch(`${server.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal ?? AbortSignal.timeout(init?.timeoutMs ?? CALL_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ModelError(
        `audio.cpp management call ${path} failed (HTTP ${resp.status})${
          text ? `: ${extractError(text)}` : ""
        }`,
      );
    }
    if (resp.status === 204) return null;
    return (await resp.json()) as T;
  }

  /* -------------------------------------------------------------- packages */

  /**
   * Install one package through audio.cpp's own package manager.
   *
   * Returns false when this install has no management support, which is the
   * caller's cue to fall back to Konchi's downloader rather than fail. Any
   * other problem — a package the runtime rejects, a download that dies — is
   * thrown, because at that point delegation *was* the path taken and a silent
   * fallback would just download the same broken thing twice.
   */
  async installPackage(
    packageId: string,
    modelsRoot: string,
    backend: string | null,
    progress?: (fraction: number, message: string) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const started = await this.request<InstallStatus>(modelsRoot, backend, "/v1/ui/models/install", {
      method: "POST",
      body: { id: packageId },
    });
    if (started === null) return false;

    try {
      await this.pollInstall(packageId, modelsRoot, backend, progress, signal);
    } catch (exc) {
      // Whatever went wrong — the user cancelled (the progress callback throws
      // CancelledJob), the runtime failed, the poll died — an install still
      // queued on the other side would keep pulling gigabytes and leave
      // staging files behind. Stopping is cheap and safe if it already ended.
      await this.stopInstall(packageId, modelsRoot, backend);
      throw exc;
    }
    return true;
  }

  private async pollInstall(
    packageId: string,
    modelsRoot: string,
    backend: string | null,
    progress?: (fraction: number, message: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new ModelError("Download cancelled");

      const status = await this.request<InstallStatus>(
        modelsRoot,
        backend,
        `/v1/ui/models/install-status?id=${encodeURIComponent(packageId)}`,
      );
      if (status === null) throw new ModelError("audio.cpp stopped reporting install status");

      if (progress) {
        // Prefer real byte counts; `progress_percent` is -1 until the runtime
        // knows a total, and a bar that starts at -1% helps nobody. Held
        // inside 5%-95% so it never claims done before the files are in place.
        const fraction =
          status.total_bytes > 0
            ? status.downloaded_bytes / status.total_bytes
            : Math.max(0, status.progress_percent) / 100;
        const detail =
          status.total_bytes > 0
            ? `${fmtBytes(status.downloaded_bytes)} of ${fmtBytes(status.total_bytes)}`
            : status.message;
        progress(0.05 + 0.9 * Math.min(1, fraction), `Downloading — ${detail}`);
      }

      // exit_code is the only unambiguous "finished" signal: it stays -1 while
      // the job runs, whatever the state is called.
      if (status.exit_code >= 0 || status.finished_at_ms > 0) {
        if (status.exit_code === 0) return;
        throw new ModelError(
          `audio.cpp could not install ${packageId}: ${status.message || "unknown error"}`,
        );
      }
      await new Promise((r) => setTimeout(r, INSTALL_POLL_MS));
    }
  }

  async stopInstall(packageId: string, modelsRoot: string, backend: string | null): Promise<void> {
    await this
      .request(modelsRoot, backend, "/v1/ui/models/install/stop", {
        method: "POST",
        body: { id: packageId },
      })
      .catch(() => undefined);
  }

  /**
   * Remove one package precision through the runtime.
   *
   * Necessary rather than cosmetic now that several catalog entries share a
   * directory: deleting `ACE-Step1.5-GGUF` wholesale to remove the turbo build
   * would take the base build with it. audio.cpp deletes per package.
   */
  async deletePackage(
    packageId: string,
    modelsRoot: string,
    backend: string | null,
  ): Promise<boolean> {
    const done = await this.request(modelsRoot, backend, "/v1/ui/models/delete", {
      method: "POST",
      body: { id: packageId },
    });
    return done !== null;
  }

  /* ------------------------------------------------------------- inference */

  /**
   * Make a model resident.
   *
   * `id` is ours to choose and `path` is the weights we resolved, so Konchi
   * keeps owning model identity — the runtime is being told what to hold, not
   * asked what it has.
   */
  async loadModel(
    req: {
      id: string;
      path: string;
      family: string;
      task: string;
      loadOptions?: Record<string, string>;
    },
    modelsRoot: string,
    backend: string | null,
  ): Promise<boolean> {
    const server = await this.ensureServer(modelsRoot, backend);
    if (server === null) return false;
    await this.send<{ loaded?: boolean }>(server, "/v1/models/load", {
      method: "POST",
      body: { ...req, load_options: req.loadOptions },
      timeoutMs: LOAD_TIMEOUT_MS,
    });
    // Recorded against the process that answered, not whichever is current
    // now: if this one was replaced while the load was in flight, the new one
    // must not be credited with a model it never saw.
    server.resident.add(req.id);
    return true;
  }

  async unloadModel(id: string, modelsRoot: string, backend: string | null): Promise<void> {
    this.running?.resident.delete(id);
    await this
      .request(modelsRoot, backend, "/v1/models/unload", { method: "POST", body: { id } })
      .catch(() => undefined);
  }

  /**
   * Whether `id` is loaded in the server process running right now.
   *
   * A model's own record of "I am resident" outlives the process it was
   * loaded into: a cancel, the idle stop, or a settings change pointing at a
   * different models folder all replace or end the process, and the next
   * request then reaches a server that answers "unknown model id". This is
   * how a model notices and loads itself again.
   */
  isResident(id: string): boolean {
    return this.running?.resident.has(id) ?? false;
  }

  /**
   * Run one inference request against a resident model.
   *
   * Returns null when management is unavailable, so the caller falls back to a
   * one-shot CLI invocation exactly as before.
   *
   * Cancellation is a blunt instrument here: audio.cpp exposes no per-request
   * cancel, so the only way to actually stop a generation is to kill the
   * process running it. That is what `progress.handle.cancelled` triggers
   * below — deliberate, and the cost is that the resident model dies with it
   * and the next request pays the load again. Cancelling is rare; paying eight
   * seconds on every generation was not.
   */
  async runTask(
    body: Record<string, unknown>,
    modelsRoot: string,
    backend: string | null,
    progress?: ProgressLike,
  ): Promise<TaskResult | null> {
    const baseUrl = await this.ensureRunning(modelsRoot, backend);
    if (baseUrl === null) return null;
    this.lastUsed = Date.now();

    const abort = new AbortController();
    let cancelled = false;
    // Poll rather than await a signal: the job system cancels by setting a
    // flag on the handle (see jobs.ts), and nothing pushes an event when it
    // flips.
    const watch = progress?.handle
      ? setInterval(() => {
          if (!progress.handle?.cancelled || cancelled) return;
          cancelled = true;
          abort.abort();
          void this.stop();
        }, CANCEL_POLL_MS)
      : null;

    try {
      const resp = await fetch(`${baseUrl}/v1/tasks/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new ModelError(
          `audio.cpp could not run this request (HTTP ${resp.status})` +
            (text ? `: ${extractError(text)}` : ""),
        );
      }
      return (await resp.json()) as TaskResult;
    } catch (exc) {
      if (cancelled) throw new CancelledJob();
      throw exc;
    } finally {
      if (watch) clearInterval(watch);
    }
  }

  /* -------------------------------------------------------------- shutdown */

  /** Called by the same 30s tick that drives `ModelManager.maybeAutoUnload`. */
  async maybeAutoStop(idleMinutes: number): Promise<boolean> {
    if (idleMinutes <= 0 || this.running === null) return false;
    if (Date.now() - this.lastUsed < idleMinutes * 60_000) return false;
    await this.stop();
    return true;
  }

  async stop(): Promise<void> {
    const r = this.running;
    this.running = null;
    if (!r) return;
    await new Promise<void>((resolve) => {
      r.proc.once("exit", () => resolve());
      r.proc.kill();
      setTimeout(resolve, 3_000).unref();
    });
  }
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}
