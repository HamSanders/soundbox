/**
 * Environment variables are named `MIRLI_*`. Before the rename they were
 * `SOUNDBOX_*`, and those names keep working: `envVar("MIRLI_PORT")` reads
 * `MIRLI_PORT`, then `SOUNDBOX_PORT`. The new name wins when both are set, so
 * an existing Dockerfile, compose file or MCP client config carries on as is.
 */
export function envVar(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[name] ?? env[legacyName(name)];
}

/** `MIRLI_X` → `SOUNDBOX_X`, the pre-rename spelling of the same variable. */
export function legacyName(name: string): string {
  return name.replace(/^MIRLI_/, "SOUNDBOX_");
}
