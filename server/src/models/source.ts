/**
 * A source of models that don't run on this machine's audio.cpp.
 *
 * `ModelManager` owns the local models itself, because residency, weights on
 * disk and the shared package folders are all about this machine. Everything
 * else (custom endpoints today, any other remote provider later) plugs in as
 * a source: it says which ids it offers and builds a `GenerationModel` for
 * one, and the manager does the rest. Then the library, the studio, MCP and
 * export work with it unchanged.
 *
 * The manager never knows what a source is. Adding a provider means writing a
 * source and handing it to the manager, not editing the manager.
 */

import type { GenerationModel } from "./types.js";

export interface ModelSource {
  /** For logs and errors, e.g. "endpoint". */
  readonly name: string;
  /**
   * The ids this source offers right now, in the order the pickers show them.
   * An id a local model already uses is ignored: local always wins.
   */
  ids(): readonly string[];
  /**
   * Build the model for one of `ids()`. The manager caches the instance until
   * `ModelManager.refreshSource()` is called for this source, so building one
   * should be cheap and hold no state beyond its configuration.
   */
  create(id: string): GenerationModel;
}
