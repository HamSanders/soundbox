/**
 * In-memory job queue.
 *
 * Generation is serialised through a single worker: the GPU can only do one of
 * these at a time anyway, and a queue that admits concurrency just turns one
 * slow render into two slower ones plus an OOM risk. The Python version used a
 * worker thread with an `asyncio` hand-off; here the runner is an async
 * function and "the worker" is a single in-flight loop, so no cross-thread
 * marshalling is needed.
 *
 * Subscribers get an async queue of job snapshots, which the SSE endpoint
 * streams.
 */

import { randomUUID } from "node:crypto";

import { CancelledJob, GpuBusy, QueueFull } from "./errors.js";
import { buildFailure } from "./failure.js";
import { getLogger } from "./logging.js";
import type { Job, JobPhase } from "./schemas.js";

// A job's log lines are what makes `grep <job-id> soundbox.log` reconstruct
// the whole story of one generation (see docs/INSTALL.md's troubleshooting
// section) and what the Activity page's log tail actually shows — so these
// must go through the real file-backed logger, not console.info, which never
// reaches the rotating file at all.
const log = getLogger("soundbox.jobs");

function now(): string {
  return new Date().toISOString();
}

/** Minimum gap, in fractional progress, between throttled progress log lines. */
const LOG_PROGRESS_STEP = 0.1;

/** How many recent completed-job durations to keep per (kind, model) for ETA. */
const DURATION_HISTORY = 8;

/**
 * How many generations may be waiting at once.
 *
 * The queue is serialised through one worker because the GPU is, so a deep
 * queue is not throughput — it is a promise to spend the next hour on work
 * somebody queued by holding a key down. Refusing at the door says so while
 * the person is still looking at the button; silently accepting forty renders
 * and discovering it later does not.
 *
 * Only generation counts against it. A download or an engine install is not
 * competing for the same worker and must never be refused because a render
 * queue is full.
 */
const MAX_QUEUED_GENERATIONS = 10;

/** Job kinds that run on the generation worker and count toward the cap. */
const GENERATION_KINDS = new Set(["generate", "speak", "convert", "separate"]);

export type JobRunner = (
  handle: JobHandle,
) => Promise<Record<string, unknown> | null | undefined> | Record<string, unknown> | null | undefined;

/**
 * A multi-consumer-safe single-consumer channel. Each subscriber gets its own
 * instance, so slow readers buffer rather than steal each other's events.
 */
export class AsyncQueue<T> implements AsyncIterableIterator<T> {
  private buffer: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.buffer.length) {
      return Promise.resolve({ value: this.buffer.shift() as T, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

/** What a runner sees. Reports progress and observes cancellation. */
export class JobHandle {
  readonly job: Job;
  private readonly manager: JobManager;
  private cancelFlag = false;
  private lastLoggedProgress = -1.0;

  constructor(job: Job, manager: JobManager) {
    this.job = job;
    this.manager = manager;
  }

  get id(): string {
    return this.job.id;
  }

  get request(): Record<string, unknown> {
    return this.job.request;
  }

  cancel(): void {
    this.cancelFlag = true;
  }

  get cancelled(): boolean {
    return this.cancelFlag;
  }

  checkCancelled(): void {
    if (this.cancelFlag) throw new CancelledJob();
  }

  progress(fraction: number, message = "", phase?: JobPhase | string): void {
    this.checkCancelled();
    this.job.progress = Math.max(0, Math.min(1, Number(fraction)));
    if (message) this.job.message = message;
    if (phase) this.job.phase = phase as JobPhase;
    // Throttled so a 100-step generation doesn't write 100 log lines — one
    // every ~10% of progress is enough to reconstruct the timeline.
    if (this.job.progress - this.lastLoggedProgress >= LOG_PROGRESS_STEP) {
      this.lastLoggedProgress = this.job.progress;
      log.info(
        `job ${this.job.id} ${Math.round(this.job.progress * 100)}% ` +
          `phase=${this.job.phase} ${this.job.message}`,
      );
    }
    this.manager.publish(this.job);
  }

  phase(phase: JobPhase | string, message = ""): void {
    this.job.phase = phase as JobPhase;
    if (message) this.job.message = message;
    this.manager.publish(this.job);
  }
}

export class JobManager {
  private readonly historyLimit: number;
  private readonly jobs = new Map<string, JobHandle>();
  /** Job ids newest-first; the ring buffer that bounds retained history. */
  private readonly order: string[] = [];
  private readonly pending: [JobHandle, JobRunner][] = [];
  private readonly subscribers = new Map<string, AsyncQueue<Job>[]>();
  /** Recent successful-generation durations, keyed by "kind:model", used to
   *  give queued jobs a rough ETA and the UI a pre-submit estimate. */
  private readonly durations = new Map<string, number[]>();
  private workerRunning = false;
  private stopped = false;
  private wake: (() => void) | null = null;
  /** Held while a speech stream owns the GPU; the worker waits on it before
   *  starting the next job. See `acquireExclusive`. */
  private exclusive: { released: Promise<void>; release: () => void } | null = null;

  constructor(history = 200) {
    this.historyLimit = history;
  }

  // ----------------------------------------------------------- lifecycle

  start(): void {
    this.stopped = false;
    if (this.workerRunning) return;
    this.workerRunning = true;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  // ----------------------------------------------------------- submission

  /** Generations currently waiting to start. */
  get queuedGenerations(): number {
    let n = 0;
    for (const handle of this.jobs.values()) {
      if (handle.job.status === "queued" && GENERATION_KINDS.has(handle.job.kind)) n += 1;
    }
    return n;
  }

  submit(kind: Job["kind"], request: Record<string, unknown>, runner: JobRunner): Job {
    if (GENERATION_KINDS.has(kind) && this.queuedGenerations >= MAX_QUEUED_GENERATIONS) {
      throw new QueueFull(
        `${MAX_QUEUED_GENERATIONS} generations are already waiting. ` +
          `Let some finish, or cancel one, before adding more.`,
      );
    }
    const job: Job = {
      id: randomUUID(),
      kind,
      status: "queued",
      phase: "queued",
      progress: 0,
      message: "",
      error: null,
      request,
      result: null,
      created_at: now(),
      started_at: null,
      finished_at: null,
      queue_position: null,
      eta_s: null,
    };
    const handle = new JobHandle(job, this);
    this.jobs.set(job.id, handle);
    this.order.unshift(job.id);
    // Trim any job the ring buffer pushed out.
    for (const stale of this.order.splice(this.historyLimit)) {
      this.jobs.delete(stale);
    }
    this.pending.push([handle, runner]);
    this.start();
    this.wake?.();
    log.info(`job ${job.id} queued (kind=${kind} model=${String(request.model ?? "-")})`);
    this.publish(job);
    return job;
  }

  /**
   * Take the GPU for a speech stream, or throw `GpuBusy` if it's not free.
   *
   * Streams don't queue: a game or a chat agent asking for a line wants it now
   * or wants to know it can't have it, not to wait behind a music render. So a
   * running generation (or another stream) refuses at once. Jobs submitted
   * while a stream holds the GPU queue as usual and start when it's released.
   *
   * The returned function releases it; calling it twice is harmless.
   */
  acquireExclusive(): () => void {
    if (this.exclusive) throw new GpuBusy("Another stream is using the GPU.", 1);
    const running = [...this.jobs.values()]
      .map((h) => h.job)
      .find((j) => j.status === "running" && GENERATION_KINDS.has(j.kind));
    if (running) {
      const avg = this.avgDuration(running.kind, running.request.model as string | undefined);
      const left = avg === null ? null : Math.max(1, Math.ceil(avg * (1 - (running.progress || 0))));
      throw new GpuBusy(`A ${running.kind} job is using the GPU.`, left);
    }
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const lock = { released, release };
    this.exclusive = lock;
    return () => {
      if (this.exclusive !== lock) return;
      this.exclusive = null;
      lock.release();
    };
  }

  /** Is a speech stream holding the GPU right now? */
  get streaming(): boolean {
    return this.exclusive !== null;
  }

  /** Is anything queued or running? Asked before a profile switch, which
   *  must not move the library out from under a job that is mid-write. */
  hasActive(): boolean {
    for (const handle of this.jobs.values()) {
      if (handle.job.status === "queued" || handle.job.status === "running") return true;
    }
    return false;
  }

  get(jobId: string): Job | null {
    const handle = this.jobs.get(jobId);
    return handle ? this.enrich(handle.job) : null;
  }

  list(limit = 50): Job[] {
    const out: Job[] = [];
    for (const id of this.order.slice(0, limit)) {
      const handle = this.jobs.get(id);
      if (handle) out.push(this.enrich(handle.job));
    }
    return out;
  }

  /**
   * Most recent non-terminal job of `kind` for `modelId`, if any.
   *
   * Lets the model status endpoint report `downloading` from server state
   * alone, so the UI is correct on a fresh page load or after a client loses
   * track of the job id — it doesn't have to have watched the job itself.
   * Falls back for the row's own progress bar too, so a tab switch that
   * unmounts the component doesn't strand it.
   */
  findActive(kind: string, modelId: string): Job | null {
    const candidates = [...this.jobs.values()]
      .map((h) => h.job)
      .filter(
        (j) =>
          j.kind === kind &&
          j.request.model === modelId &&
          (j.status === "queued" || j.status === "running"),
      );
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    return this.enrich(candidates[0]!);
  }

  // ------------------------------------------------- queue position / ETA

  /** Snapshot with queue_position/eta_s attached while the job is queued. */
  private enrich(job: Job): Job {
    const snap = structuredClone(job);
    if (job.status !== "queued") return snap;
    snap.queue_position = this.queuePosition(job.id);
    snap.eta_s = this.eta(job.id);
    return snap;
  }

  /** 1-indexed position among jobs still waiting, oldest first. */
  private queuePosition(jobId: string): number | null {
    const queued = [...this.jobs.values()]
      .map((h) => h.job)
      .filter((j) => j.status === "queued")
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    const index = queued.findIndex((j) => j.id === jobId);
    return index === -1 ? null : index + 1;
  }

  private eta(jobId: string): number | null {
    const handle = this.jobs.get(jobId);
    if (!handle || handle.job.status !== "queued") return null;
    const pos = this.queuePosition(jobId);
    if (pos === null) return null;
    const job = handle.job;
    const avg = this.avgDuration(job.kind, job.request.model as string | undefined);
    let remainingCurrent = 0;
    let haveRunningEstimate = false;
    const running = [...this.jobs.values()].map((h) => h.job).find((j) => j.status === "running");
    if (running) {
      const runningAvg = this.avgDuration(running.kind, running.request.model as string | undefined);
      if (runningAvg !== null) {
        remainingCurrent = Math.max(0, runningAvg * (1 - (running.progress || 0)));
        haveRunningEstimate = true;
      }
    }
    const ahead = pos - 1; // jobs strictly ahead of this one in the queue
    if (avg === null && !haveRunningEstimate) {
      // Nothing to base any estimate on yet — 0.0 would misleadingly read as
      // "about to start" rather than "we don't know".
      return null;
    }
    return remainingCurrent + ahead * (avg ?? 0);
  }

  private durationKey(kind: string, model: string | null | undefined): string {
    return `${kind}:${model ?? ""}`;
  }

  /**
   * Feed a just-finished job's wall time into the rolling average used for ETA
   * and pre-submit duration estimates. Only successful runs count — a cancelled
   * or errored job's elapsed time says nothing about how long a normal run takes.
   */
  private recordDuration(job: Job): void {
    if (job.status !== "done" || !job.started_at || !job.finished_at) return;
    const dur = elapsedSeconds(job.started_at, job.finished_at);
    if (dur === null || dur <= 0) return;
    const key = this.durationKey(job.kind, job.request.model as string | undefined);
    const history = this.durations.get(key) ?? [];
    history.push(dur);
    if (history.length > DURATION_HISTORY) history.splice(0, history.length - DURATION_HISTORY);
    this.durations.set(key, history);
  }

  /** Rough average wall time for recent successful jobs of this kind+model,
   *  or null if we have no history yet. */
  avgDuration(kind: string, model: string | null | undefined): number | null {
    const history = this.durations.get(this.durationKey(kind, model));
    if (!history || !history.length) return null;
    return history.reduce((a, b) => a + b, 0) / history.length;
  }

  cancel(jobId: string): Job | null {
    const handle = this.jobs.get(jobId);
    if (!handle) return null;
    if (["done", "error", "cancelled"].includes(handle.job.status)) {
      return structuredClone(handle.job);
    }
    log.info(`job ${jobId} cancel requested (status=${handle.job.status})`);
    handle.cancel();
    if (handle.job.status === "queued") {
      // Never started — mark it now; the worker will skip it.
      handle.job.status = "cancelled";
      handle.job.finished_at = now();
      handle.job.message = "Cancelled before it started";
      log.info(`job ${jobId} cancelled before it started`);
      this.publish(handle.job);
    }
    return this.enrich(handle.job);
  }

  get queueLength(): number {
    return this.pending.length;
  }

  // ----------------------------------------------------------- pub/sub

  subscribe(jobId: string): AsyncQueue<Job> {
    const q = new AsyncQueue<Job>();
    const subs = this.subscribers.get(jobId);
    if (subs) subs.push(q);
    else this.subscribers.set(jobId, [q]);
    return q;
  }

  unsubscribe(jobId: string, q: AsyncQueue<Job>): void {
    const subs = this.subscribers.get(jobId);
    if (!subs) return;
    const i = subs.indexOf(q);
    if (i !== -1) subs.splice(i, 1);
    if (!subs.length) this.subscribers.delete(jobId);
    q.close();
  }

  /** Fan a snapshot out to this job's subscribers. Internal, but the JobHandle
   *  calls it, so it cannot be `private`. */
  publish(job: Job): void {
    const subs = this.subscribers.get(job.id);
    if (!subs || !subs.length) return;
    const snapshot = this.enrich(job);
    for (const q of subs) q.push(structuredClone(snapshot));
  }

  // ----------------------------------------------------------- the worker

  private async run(): Promise<void> {
    while (!this.stopped) {
      const item = this.pending.shift();
      if (!item) {
        await new Promise<void>((resolve) => {
          this.wake = () => {
            this.wake = null;
            resolve();
          };
        });
        continue;
      }
      const [handle, runner] = item;
      const job = handle.job;
      // A stream owns the GPU: hold this job (still "queued") until it's done.
      // Only generation waits — a download doesn't touch the GPU.
      while (this.exclusive && GENERATION_KINDS.has(job.kind) && !handle.cancelled) {
        await this.exclusive.released;
      }
      if (handle.cancelled) {
        job.status = "cancelled";
        job.finished_at = job.finished_at ?? now();
        log.info(`job ${job.id} skipped: cancelled while still queued`);
        this.publish(job);
        continue;
      }
      job.status = "running";
      job.started_at = now();
      log.info(`job ${job.id} started (kind=${job.kind} model=${String(job.request.model)})`);
      this.publish(job);
      try {
        const result = await runner(handle);
        job.result = result ?? null;
        job.status = "done";
        job.phase = "done";
        job.progress = 1.0;
        job.message = job.message || "Complete";
      } catch (exc) {
        if (exc instanceof CancelledJob) {
          job.status = "cancelled";
          job.message = "Cancelled";
          log.info(`job ${job.id} cancelled mid-run`);
        } else {
          const message = exc instanceof Error ? exc.message : String(exc);
          log.error(`job ${job.id} failed: ${message}`);
          if (exc instanceof Error && exc.stack) log.error(exc.stack);
          job.status = "error";
          job.error = message;
          job.failure = buildFailure(exc, { stage: job.phase });
          job.message = "Failed";
        }
      } finally {
        job.finished_at = now();
        if (job.status === "done") {
          const dur = job.started_at ? elapsedSeconds(job.started_at, job.finished_at) : null;
          log.info(`job ${job.id} done in ${dur === null ? "?" : `${dur.toFixed(1)}s`}`);
          this.recordDuration(job);
        }
        this.publish(job);
      }
    }
    this.workerRunning = false;
  }
}

/** Seconds between two ISO timestamps, or null if either fails to parse. */
function elapsedSeconds(startedAt: string, finishedAt: string): number | null {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) return null;
  return (finished - started) / 1000;
}
