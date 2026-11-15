/**
 * Shared error types.
 *
 * `ModelError` lives in its own module
 * so the DSP layer can throw it without
 * importing the model registry (which would be a cycle).
 */

/**
 * Raised for anything the user could plausibly fix (missing deps, gated repo,
 * OOM, a missing edit parameter). The message is shown verbatim in the UI, so
 * write it for a human.
 */
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

/**
 * Thrown by `JobHandle.checkCancelled()` to unwind a runner the user cancelled;
 * the job worker treats it as a clean stop rather than a failure.
 * Kept here so a model can
 * raise it mid-generation without importing the job queue.
 */
export class CancelledJob extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "CancelledJob";
  }
}

/**
 * Raised when the generation queue is already at its depth limit.
 *
 * Its own type rather than a `ModelError` because it is not about a model and
 * the caller can act on it specifically — the UI says how many are waiting and
 * offers the queue rather than showing a generation failure. Answered with 429
 * at the boundary: the request was fine, there is just no room right now.
 */
export class QueueFull extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueFull";
  }
}

/**
 * Raised when a streamed read is asked of a model, build or option that can't
 * stream. Answered with 409: the request is well-formed, but this model can't
 * do it here — the caller should use `/api/speak` (or another model) instead.
 */
export class StreamUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamUnsupported";
  }
}

/**
 * Raised when a stream would have to wait for the GPU. Answered with 409 and
 * `retry_after_s`: a game or agent would rather know now than queue behind a
 * long render.
 */
export class GpuBusy extends Error {
  readonly retryAfterS: number | null;
  constructor(message: string, retryAfterS: number | null = null) {
    super(message);
    this.name = "GpuBusy";
    this.retryAfterS = retryAfterS;
  }
}
