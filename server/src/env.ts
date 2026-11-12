/**
 * Environment variables are named `KONCHI_*`. Before the rename they were
 * `SOUNDBOX_*`, and those names keep working: `envVar("KONCHI_PORT")` reads
 * `KONCHI_PORT`, then `SOUNDBOX_PORT`. The new name wins when both are set.
 */
export function envVar(name: string): string | undefined {
  return process.env[name] ?? process.env[legacyName(name)];
}

/** `KONCHI_X` → `SOUNDBOX_X`, the pre-rename spelling of the same variable. */
export function legacyName(name: string): string {
  return name.replace(/^KONCHI_/, "SOUNDBOX_");
}
