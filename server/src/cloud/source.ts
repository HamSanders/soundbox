/**
 * Mirli Cloud as a model source (models/source.ts): one model per catalog
 * entry the gateway offers, plus the voice-clip transcriber.
 *
 * `CloudService` replaces the list when the catalog or the sign-in changes and
 * then calls `ModelManager.refreshSource(this)`, which drops the live cloud
 * instances so the next call sees the new sign-in. The manager puts sources
 * after the local models, so "the first installed model" is never one that
 * costs credits.
 */

import { ModelError } from "../errors.js";
import type { ModelSource } from "../models/source.js";
import type { GenerationModel } from "../models/types.js";
import type { CloudModel as CloudModelInfo } from "./contract.js";
import { type CloudContext, CloudModel } from "./model.js";

export class CloudSource implements ModelSource {
  readonly name = "cloud";
  private models: CloudModelInfo[] = [];
  private ctx: CloudContext | null = null;

  /** Replace the catalog. The manager sees it after `refreshSource(this)`. */
  set(models: readonly CloudModelInfo[], ctx: CloudContext): void {
    this.models = [...models];
    this.ctx = ctx;
  }

  ids(): string[] {
    return this.models.map((m) => m.id);
  }

  create(id: string): GenerationModel {
    const info = this.models.find((m) => m.id === id);
    if (!info || !this.ctx) throw new ModelError(`Mirli Cloud doesn't offer '${id}'.`);
    return new CloudModel(info, this.ctx);
  }
}
