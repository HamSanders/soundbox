/**
 * Carry browser storage over from before the rename to Konchi.
 *
 * Every key this app writes is `konchi.*`; before the rename they were
 * `soundbox.*`. This copies each old key to its new name once, when the new
 * one isn't set yet, and leaves the old key alone so a downgrade still works.
 *
 * Imported first in main.tsx: the persisted stores read storage as their
 * modules load, so this has to run before any of them are imported.
 */

const OLD = "soundbox.";
const NEW = "konchi.";

export function migrateLegacyStorage(storage: Storage): number {
  let copied = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(OLD)) continue;
    const renamed = NEW + key.slice(OLD.length);
    if (storage.getItem(renamed) !== null) continue;
    const value = storage.getItem(key);
    if (value !== null) {
      storage.setItem(renamed, value);
      copied++;
    }
  }
  return copied;
}

try {
  migrateLegacyStorage(window.localStorage);
} catch {
  // Storage can be blocked (private windows, some embeds); the app's
  // defaults apply, same as on a fresh install.
}
