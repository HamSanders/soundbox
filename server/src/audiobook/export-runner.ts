/**
 * Runs mastering jobs on a worker thread (`export-worker.ts`), so a long
 * chapter never blocks the server's event loop.
 *
 * One worker, created on first use and unref'd so it never keeps the
 * process alive; jobs are posted to it in order. The built server runs the
 * compiled `export-worker.js`; from source (tsx in dev, vitest in tests) the
 * worker is the `.ts` file loaded through tsx. If a worker can't start, or
 * `MIRLI_EXPORT_INLINE=1` is set, jobs run inline instead: slower to live
 * with, same result.
 */

import { Worker } from "node:worker_threads";

import { type MasterJob, type MasterJobResult, runMasterJob } from "./export-worker.js";

type Pending = { resolve: (r: MasterJobResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerUrl(): { url: URL; execArgv: string[] } {
  const fromSource = import.meta.url.endsWith(".ts");
  return fromSource
    ? { url: new URL("./export-worker.ts", import.meta.url), execArgv: ["--import", "tsx"] }
    : { url: new URL("./export-worker.js", import.meta.url), execArgv: [] };
}

function failAll(error: Error): void {
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}

function getWorker(): Worker | null {
  if (broken || process.env.MIRLI_EXPORT_INLINE === "1") return null;
  if (worker) return worker;
  try {
    const { url, execArgv } = workerUrl();
    const w = new Worker(url, { execArgv });
    w.unref();
    w.on("message", (msg: { id: number; ok: boolean; result?: MasterJobResult; error?: string }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result!);
      else p.reject(new Error(msg.error ?? "Mastering failed."));
    });
    w.on("error", (err) => {
      failAll(err instanceof Error ? err : new Error(String(err)));
      worker = null;
    });
    w.on("exit", (code) => {
      if (pending.size) failAll(new Error(`The mastering worker stopped (exit ${code}).`));
      worker = null;
    });
    worker = w;
    return w;
  } catch {
    broken = true;
    return null;
  }
}

/**
 * Master (and optionally write) one chapter off the main thread. The input
 * buffers are transferred: the caller must not use `job.audio` afterwards.
 */
export function runMaster(job: MasterJob): Promise<MasterJobResult> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => runMasterJob(job));
  const id = nextId++;
  return new Promise<MasterJobResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Transfer each channel's buffer. A channel that is a view into a larger
    // buffer would take the whole buffer with it, so copy those first.
    const audio = job.audio?.map((ch) =>
      ch.byteOffset === 0 && ch.byteLength === ch.buffer.byteLength ? ch : ch.slice(),
    );
    w.ref();
    w.postMessage({ id, job: { ...job, audio } }, (audio ?? []).map((ch) => ch.buffer as ArrayBuffer));
  }).finally(() => {
    if (pending.size === 0) worker?.unref();
  });
}

/** Stop the worker (tests, shutdown). */
export async function stopMasterWorker(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}
