/**
 * `GET /api/fs/dirs` — directory listing, for the folder pickers in Settings.
 *
 * Nothing to do with the library; this is the "Browse…" affordance behind
 * paths like `sounds_dir`. It has to be a server route rather than anything in
 * the browser because the path the user picks is a path *the server* will
 * write to: a browser file input hands back a sandboxed name with no real
 * location, and on a Konchi reached over the network the user's own disk is
 * the wrong disk entirely.
 *
 * Read-only and directory-names-only — no file names, no contents, no
 * creation. It sits behind the same loopback bind as every other route (see
 * `isAllowedOrigin`), so its reach is the same as the rest of the API's, which
 * already reads and writes the data directory and runs local processes.
 */

import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";

import type { FastifyInstance } from "fastify";

import { isUncPath } from "../pathGuards.js";
import { HttpError, strQuery } from "./helpers.js";

interface DirEntry {
  name: string;
  path: string;
}

/**
 * The places a picker can start from with no path in hand.
 *
 * On Windows that is every drive letter that answers, which is the only way to
 * get from `C:` to `D:` — `..` from `C:\` is still `C:\`. On POSIX there is a
 * single root, so the list is one entry and the UI's root row is really just a
 * shortcut to `/`.
 */
function roots(): DirEntry[] {
  if (sep !== "\\") return [{ name: "/", path: "/" }];
  const found: DirEntry[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const path = `${letter}:\\`;
    // A drive that is not mounted (or a disconnected network mapping) throws
    // rather than answering false, and either way we just skip it.
    try {
      if (existsSync(path)) found.push({ name: `${letter}:`, path });
    } catch {
      /* not mounted */
    }
  }
  return found;
}

/** The nearest ancestor that exists, so a picker opened on a folder that has
 *  since been deleted lands somewhere real instead of erroring. */
function nearestExisting(path: string): string {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return homedir();
    current = parent;
  }
}

/** Best-effort "could we write here". A hint for the UI, not a guarantee — the
 *  answer can change between this call and the write, and on Windows the
 *  directory bit is only loosely related to what an ACL will actually allow. */
function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function registerFs(app: FastifyInstance): void {
  app.get("/api/fs/dirs", async (request) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    const asked = strQuery(query.path);
    // Before anything touches the path: on Windows even an existence check
    // on `\\host\share` connects to that host with the user's credentials.
    if (asked && isUncPath(asked)) {
      throw new HttpError(400, "Network paths can't be browsed here.");
    }
    const path = nearestExisting(asked?.trim() ? asked.trim() : homedir());

    let stats;
    try {
      stats = statSync(path);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    if (!stats.isDirectory()) throw new HttpError(400, `Not a folder: ${path}`);

    let entries: DirEntry[];
    try {
      entries = readdirSync(path, { withFileTypes: true })
        // `withFileTypes` still needs the isDirectory() guard for symlinks,
        // which report as links rather than as what they point at.
        .filter((e) => {
          if (e.isDirectory()) return true;
          if (!e.isSymbolicLink()) return false;
          try {
            return statSync(join(path, e.name)).isDirectory();
          } catch {
            return false;
          }
        })
        .map((e) => ({ name: e.name, path: join(path, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } catch (err) {
      // Permission denied on a folder we can see but not open is ordinary
      // while browsing — answer with the folder and no children rather than
      // an error the picker would have to special-case.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM") {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      entries = [];
    }

    // `parse().root` rather than comparing to dirname(): on Windows `dirname`
    // of `C:\` is `C:\`, so "am I at the top" has to be asked of the root.
    const atRoot = path === parse(path).root;
    return {
      path,
      parent: atRoot ? null : dirname(path),
      separator: sep,
      home: homedir(),
      writable: isWritable(path),
      roots: roots(),
      entries,
    };
  });
}
