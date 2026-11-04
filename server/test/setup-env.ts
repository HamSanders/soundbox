// Env vars fall back to their pre-rename SOUNDBOX_* names (src/env.ts), so a
// SOUNDBOX_* left in the developer's shell would leak into every test that
// clears the KONCHI_* name to get a default. Drop them; renameFallbacks.test.ts
// sets the ones it needs.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("SOUNDBOX_")) delete process.env[name];
}
