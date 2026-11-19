/**
 * Sampled instruments for the Studio's MIDI dry render.
 *
 * The piano roll's notes are rendered in the browser and the browser plays
 * the samples, so the server's part is small: download an instrument's files
 * on request, say which are installed, read the .sfz into regions the app can
 * use, and serve the sample files back. Nothing here decodes audio.
 *
 * Layout on disk, under the shared models directory (so a profile switch does
 * not lose them and uninstalling is one folder):
 *
 *     <models>/instruments/vsco2ce/<id>/<files as in the repo>
 *     <models>/instruments/vsco2ce/<id>/installed.json   ← written last
 *
 * The marker is what "installed" means. A download that dies halfway leaves
 * files but no marker, and the next download skips what is already the right
 * size and fetches the rest.
 */

import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { downloadToFile } from "../download.js";
import { ModelError } from "../errors.js";
import { parseSfz, type SfzRegion } from "./sfz.js";
import {
  VSCO2CE_COMMIT,
  VSCO2CE_INSTRUMENTS,
  VSCO2CE_LICENSE,
  VSCO2CE_REPO,
  type InstrumentFamily,
  type InstrumentManifest,
} from "./vsco2ce.js";

export type { SfzRegion } from "./sfz.js";

/** One row of `GET /api/instruments`. */
export interface InstrumentInfo {
  id: string;
  label: string;
  family: InstrumentFamily;
  library: "VSCO 2 CE";
  license: string;
  size_bytes: number;
  installed: boolean;
}

/** `GET /api/instruments/:id`: what the app needs to play it. */
export interface InstrumentRegions {
  id: string;
  /** Sample paths in `regions` are relative to this, and served under it. */
  files_url: string;
  regions: SfzRegion[];
}

const MARKER = "installed.json";

export function instrumentManifest(id: string): InstrumentManifest | null {
  return VSCO2CE_INSTRUMENTS.find((i) => i.id === id) ?? null;
}

function manifestOrThrow(id: string): InstrumentManifest {
  const m = instrumentManifest(id);
  if (!m) throw new ModelError(`Unknown instrument '${id}'.`);
  return m;
}

/** Where raw.githubusercontent.com serves a file at the pinned commit. Each
 *  segment is encoded on its own: VSCO's names carry `#` (A#2) and spaces,
 *  and an unencoded `#` would end the URL at the fragment. */
export function sampleUrl(path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${VSCO2CE_REPO}/${VSCO2CE_COMMIT}/${encoded}`;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

export class InstrumentLibrary {
  /** A function, not a path: the models directory can move with settings. */
  constructor(private readonly modelsDir: () => string) {}

  private dir(id: string): string {
    return join(this.modelsDir(), "instruments", "vsco2ce", id);
  }

  isInstalled(id: string): boolean {
    return instrumentManifest(id) !== null && existsSync(join(this.dir(id), MARKER));
  }

  list(): InstrumentInfo[] {
    return VSCO2CE_INSTRUMENTS.map((m) => ({
      id: m.id,
      label: m.label,
      family: m.family,
      library: "VSCO 2 CE",
      license: VSCO2CE_LICENSE,
      size_bytes: m.files.reduce((sum, [, bytes]) => sum + bytes, 0),
      installed: this.isInstalled(m.id),
    }));
  }

  /**
   * Fetch every file the instrument needs, then write the marker.
   *
   * One file at a time: these are a couple of megabytes each, so parallelism
   * buys little, and a sequential loop is one where a cancel stops at once.
   */
  async install(
    id: string,
    progress: (fraction: number, message: string) => void,
    fetchFile: typeof downloadToFile = downloadToFile,
  ): Promise<void> {
    const manifest = manifestOrThrow(id);
    const root = this.dir(id);
    await mkdir(root, { recursive: true });
    const total = manifest.files.reduce((sum, [, bytes]) => sum + bytes, 0);
    let done = 0;
    // Binary megabytes, as the app's formatBytes shows the instrument's size.
    const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MB`;

    for (const [path, bytes] of manifest.files) {
      const dest = join(root, ...path.split("/"));
      if (sizeOf(dest) !== bytes) {
        await fetchFile(sampleUrl(path), dest, {
          expectedBytes: bytes,
          onProgress: (got) => progress((done + got) / total, `${mb(done + got)} / ${mb(total)}`),
        });
      }
      done += bytes;
      progress(done / total, `${mb(done)} / ${mb(total)}`);
    }

    await writeFile(
      join(root, MARKER),
      JSON.stringify(
        {
          library: "VSCO 2 Community Edition",
          license: VSCO2CE_LICENSE,
          source: `https://github.com/${VSCO2CE_REPO}/tree/${VSCO2CE_COMMIT}`,
          installed_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  async remove(id: string): Promise<void> {
    manifestOrThrow(id);
    await rm(this.dir(id), { recursive: true, force: true });
  }

  /** The parsed .sfz, or null when the instrument is not installed. */
  async regions(id: string, filesUrl: string): Promise<InstrumentRegions | null> {
    const manifest = manifestOrThrow(id);
    if (!this.isInstalled(id)) return null;
    const text = await readFile(join(this.dir(id), manifest.sfz), "utf-8");
    const { regions } = parseSfz(text);
    return { id, files_url: filesUrl, regions };
  }

  /**
   * The absolute path of one of an installed instrument's files, or null.
   *
   * Only paths in the manifest resolve, so a request can never name anything
   * outside the instrument's own folder however it is spelled.
   */
  filePath(id: string, path: string): string | null {
    const manifest = instrumentManifest(id);
    if (!manifest || !this.isInstalled(id)) return null;
    if (!manifest.files.some(([p]) => p === path)) return null;
    const root = resolve(this.dir(id));
    const abs = resolve(root, ...path.split("/"));
    return abs.startsWith(root + sep) ? abs : null;
  }
}
