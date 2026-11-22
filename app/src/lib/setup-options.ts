/**
 * Ways to get models that run elsewhere, offered by the first-run setup.
 *
 * The simple setup ("nothing to download") needs at least one place for
 * renders to go. Custom endpoints are always one; a feature that adds another
 * kind of model source registers itself here, and the setup shows its panel
 * beside the endpoint one, without the setup knowing what it is.
 */

import type { ComponentType } from "react";

export interface SetupOption {
  id: string;
  /** Short name, listed on the "elsewhere" card: "or <label>". */
  label: string;
  /** Shown in the setup's connect step: whatever the option needs (a sign-in, say). */
  Panel: ComponentType;
}

const options: SetupOption[] = [];

export function registerSetupOption(option: SetupOption): void {
  if (!options.some((o) => o.id === option.id)) options.push(option);
}

export function setupOptions(): readonly SetupOption[] {
  return options;
}
