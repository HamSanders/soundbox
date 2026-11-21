/**
 * Custom endpoints as a model source: one model per enabled endpoint.
 *
 * `EndpointService` keeps the list in step with the profile's settings and
 * calls `ModelManager.refreshSource()` after each change.
 */

import { ModelError } from "../errors.js";
import type { ModelSource } from "../models/source.js";
import type { GenerationModel } from "../models/types.js";
import { EndpointModel } from "./model.js";
import { type AudioEndpoint, endpointModelId } from "./types.js";

export class EndpointSource implements ModelSource {
  readonly name = "endpoint";
  private endpoints: AudioEndpoint[];

  constructor(endpoints: readonly AudioEndpoint[] = []) {
    this.endpoints = [...endpoints];
  }

  /** Replace the list. The manager sees it after `refreshSource(this)`. */
  set(endpoints: readonly AudioEndpoint[]): void {
    this.endpoints = [...endpoints];
  }

  ids(): string[] {
    return this.endpoints.filter((e) => e.enabled).map((e) => endpointModelId(e.id));
  }

  create(id: string): GenerationModel {
    const endpoint = this.endpoints.find((e) => e.enabled && endpointModelId(e.id) === id);
    if (!endpoint) throw new ModelError(`No endpoint for model '${id}'.`);
    return new EndpointModel(endpoint);
  }
}
