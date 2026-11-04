/**
 * Image checkpoints for the artwork engine — the shipped ones, and yours.
 *
 * Sibling of `models/llmCatalog.ts` and `models/audiocpp.ts`, and it borrows
 * the important idea from the latter: the catalog is *data*. A model is a list
 * of files, each with the flag it goes to sd-server as, so adding a model — or
 * fixing a flag upstream renamed — is an edit to a JSON-shaped literal rather
 * than a change to argv-building code.
 *
 * That shape exists because one file per model was wrong. SD 3.5 loads as four
 * separate safetensors (`-m`, `--clip_l`, `--clip_g`, `--t5xxl`), Flux-style
 * models split differently again, and the turbo checkpoints really are one
 * file. Encoding "which files, under which flags" per model covers all three
 * without a branch per family.
 *
 * Filenames and byte sizes are read from each repo's own listing
 * (`huggingface.co/api/models/<repo>?blobs=true`), never assumed — a wrong
 * filename 404s at download time, which is the trap `llmCatalog.ts` documents.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { defaultDataDir, getConfig } from "../config.js";
import { DownloadError, downloadToFile } from "../download.js";
import { ModelError } from "../errors.js";
import type { LicenseInfo } from "../schemas.js";

/**
 * One weight file and the sd-server flag it is passed as.
 *
 * The flag lives here rather than being inferred from the filename because it
 * is a property of the model's architecture, not of the file: the same
 * `t5xxl_fp16.safetensors` is `--t5xxl` for SD 3.5 and would be something else
 * for a family that used it differently.
 */
export interface ImageWeightFile {
  /** Verbatim sd-server flag: "-m", "--diffusion-model", "--clip_l",
   *  "--clip_g", "--t5xxl", "--vae", "--llm". */
  flag: string;
  /**
   * Where the file is. Relative to `hf_repo` for a catalog model; an absolute
   * path on this machine for one you added yourself.
   */
  path: string;
  /** Only meaningful for a downloadable file — used for the size shown before
   *  you commit to the download, and for progress weighting. */
  size_bytes: number;
}

export interface ImageModelSpec {
  id: string;
  name: string;
  vendor: string;
  license: LicenseInfo;
  /** Empty for a model whose files are already on your disk. */
  hf_repo: string;
  files: ImageWeightFile[];
  description: string;
  /** Native training resolution. Rendering far off it degrades badly, so this
   *  is what the service asks for rather than a fixed 1024. */
  resolution: number;
  /** Turbo models are trained for a handful of steps at cfg 1.0; sending them
   *  a normal 20/7.5 produces mush, and sending SD 3.5 a turbo's 1/1.0
   *  produces noise. Both live with the model for the same reason the audio
   *  catalog's defaults do. */
  steps: number;
  cfg: number;
  /** Extra verbatim sd-server flags — the escape hatch for anything without a
   *  field of its own (`--sampling-method euler`, `--clip-on-cpu`). */
  extra_args: string[];
  recommended: boolean;
  /** "builtin" is this file; "custom" is your own `custom.json` entry. */
  source: "builtin" | "custom";
}

/** Total download for a model, for the size shown in Settings. Zero for a
 *  local model, which is the honest number: nothing will be downloaded. */
export function totalBytes(spec: ImageModelSpec): number {
  return spec.files.reduce((sum, f) => sum + (isAbsolute(f.path) ? 0 : f.size_bytes), 0);
}

const STABILITY_COMMUNITY: LicenseInfo = {
  name: "Stability AI Community License",
  commercial: "conditional",
  url: "https://stability.ai/license",
  note: "Free for commercial use below USD $1M annual revenue; above that an Enterprise licence is required. A GGUF conversion does not change the weights' licence.",
};

const STABILITY_NON_COMMERCIAL: LicenseInfo = {
  name: "Stability AI Non-Commercial Community License",
  commercial: "no",
  url: "https://stability.ai/license",
  note: "Non-commercial use only. Cover art made with this model cannot be used in anything you sell.",
};

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: "sd-turbo",
    name: "SD-Turbo (Q8)",
    vendor: "Stability AI",
    license: STABILITY_COMMUNITY,
    hf_repo: "Green-Sky/SD-Turbo-GGUF",
    files: [{ flag: "-m", path: "sd_turbo-f16-q8_0.gguf", size_bytes: 2_023_745_376 }],
    description:
      "Default — 512px in a single step. Small enough to sit beside an audio model without evicting it.",
    resolution: 512,
    steps: 1,
    cfg: 1.0,
    extra_args: [],
    recommended: true,
    source: "builtin",
  },
  {
    id: "sdxl-turbo",
    name: "SDXL-Turbo (Q8)",
    vendor: "Stability AI",
    license: STABILITY_NON_COMMERCIAL,
    hf_repo: "OlegSkutte/sdxl-turbo-GGUF",
    files: [{ flag: "-m", path: "sd_xl_turbo_1.0.q8_0.gguf", size_bytes: 4_098_988_672 }],
    description:
      "Better composition than SD-Turbo for twice the VRAM. Non-commercial licence — check it before shipping what it makes.",
    resolution: 512,
    steps: 4,
    cfg: 1.0,
    extra_args: [],
    recommended: false,
    source: "builtin",
  },
  {
    /**
     * The full-size option, and the one that motivated multi-file support.
     *
     * Four separate safetensors, exactly as stable-diffusion.cpp's own SD3
     * docs run it — no GGUF conversion and no Python. The fp8 T5 rather than
     * the fp16 halves 9.8 GB to 4.9 GB for a text encoder that mostly matters
     * for prompts with text in them, which cover art specifically avoids.
     *
     * `--clip-on-cpu` keeps the three text encoders off the GPU, which is the
     * difference between this coexisting with a resident audio model and
     * evicting it. It costs seconds per render, not minutes, because the
     * encoders run once per prompt while the transformer runs once per step.
     */
    id: "sd35-medium",
    name: "Stable Diffusion 3.5 Medium",
    vendor: "Stability AI",
    license: STABILITY_COMMUNITY,
    hf_repo: "stabilityai/stable-diffusion-3.5-medium",
    files: [
      { flag: "-m", path: "sd3.5_medium.safetensors", size_bytes: 5_107_104_286 },
      { flag: "--clip_l", path: "text_encoders/clip_l.safetensors", size_bytes: 246_144_152 },
      { flag: "--clip_g", path: "text_encoders/clip_g.safetensors", size_bytes: 1_389_382_176 },
      {
        flag: "--t5xxl",
        path: "text_encoders/t5xxl_fp8_e4m3fn.safetensors",
        size_bytes: 4_893_934_904,
      },
    ],
    description:
      "Full-size quality at 1024px, in exchange for a long download and most of a 16 GB card. Turn auto-covers off if an audio model is resident.",
    resolution: 1024,
    steps: 28,
    cfg: 4.5,
    extra_args: ["--sampling-method", "euler", "--clip-on-cpu"],
    recommended: false,
    source: "builtin",
  },
];

/* ------------------------------------------------------------ your own */

interface RawImageEntry {
  id?: string;
  name?: string;
  vendor?: string;
  license?: LicenseInfo;
  hf_repo?: string;
  files?: { flag?: string; path?: string; size_bytes?: number }[];
  description?: string;
  resolution?: number;
  steps?: number;
  cfg?: number;
  extra_args?: string[];
}

interface RawCustomCatalog {
  image_models?: RawImageEntry[];
}

/** The licence a user entry gets when it names none — the same honest unknown
 *  the audio side uses, and for the same reason. */
const UNKNOWN_LICENSE: LicenseInfo = {
  name: "Unspecified",
  commercial: "no",
  url: "",
  note: "Added locally with no licence declared — check the weights' own terms before using output commercially.",
};

/**
 * `<data dir>/models/custom.json` — the same file audio models are added in.
 *
 * One file for "models I added myself" rather than two with different names:
 * the audio loader reads `models`, this reads `image_models`, and neither
 * minds the other's key being present.
 */
export function customCatalogPath(): string {
  let root: string;
  try {
    root = getConfig().paths.models;
  } catch {
    root = join(defaultDataDir(), "models");
  }
  return join(root, "custom.json");
}

let userCache: { key: string; specs: ImageModelSpec[] } | null = null;

/**
 * Your own entries, re-read whenever the file changes.
 *
 * Same cache-on-mtime approach as the audio catalog: this file is edited by
 * hand while the server runs, and making someone restart to see their own
 * model is exactly the friction the escape hatch exists to remove. A malformed
 * file yields an empty list and a warning, never a throw.
 */
export function userImageModels(): ImageModelSpec[] {
  const path = customCatalogPath();
  let key: string;
  try {
    const st = statSync(path);
    key = `${path}:${st.mtimeMs}:${st.size}`;
  } catch {
    userCache = null;
    return [];
  }
  if (userCache?.key === key) return userCache.specs;

  let specs: ImageModelSpec[] = [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as RawCustomCatalog;
    const seen = new Set<string>();
    for (const entry of raw.image_models ?? []) {
      const problem = validateEntry(entry, seen);
      if (problem) {
        console.warn(`custom.json: skipping image model '${entry?.id ?? "(no id)"}' — ${problem}`);
        continue;
      }
      seen.add(entry.id!);
      specs.push({
        id: entry.id!,
        name: entry.name || entry.id!,
        vendor: entry.vendor ?? "",
        license: entry.license ?? UNKNOWN_LICENSE,
        hf_repo: entry.hf_repo ?? "",
        files: (entry.files ?? []).map((f) => ({
          flag: f.flag!,
          path: f.path!,
          size_bytes: f.size_bytes ?? 0,
        })),
        description: entry.description ?? "Added locally.",
        resolution: entry.resolution ?? 512,
        steps: entry.steps ?? 20,
        cfg: entry.cfg ?? 7.0,
        extra_args: [...(entry.extra_args ?? [])],
        recommended: false,
        source: "custom",
      });
    }
  } catch (exc) {
    console.warn(
      `custom.json: image models ignored — ${exc instanceof Error ? exc.message : String(exc)}`,
    );
    specs = [];
  }
  userCache = { key, specs };
  return specs;
}

/** Why one entry can't be used, or null if it can. Only the fields with no
 *  sane default are checked; a wrong-but-present number is yours to fix. */
function validateEntry(
  entry: RawImageEntry | undefined,
  seen: ReadonlySet<string>,
): string | null {
  if (!entry || typeof entry !== "object") return "not an object";
  if (typeof entry.id !== "string" || !entry.id.trim()) return "missing 'id'";
  if (seen.has(entry.id)) return "duplicate id within custom.json";
  if (!Array.isArray(entry.files) || entry.files.length === 0) {
    return "needs a 'files' array — at least one { flag, path }";
  }
  for (const f of entry.files) {
    if (!f || typeof f.flag !== "string" || !f.flag.startsWith("-")) {
      return "every file needs a 'flag' like \"-m\" or \"--clip_l\"";
    }
    if (typeof f.path !== "string" || !f.path.trim()) return "every file needs a 'path'";
    // Relative paths are only meaningful alongside a repo to resolve them in.
    if (!isAbsolute(f.path) && !entry.hf_repo) {
      return `'${f.path}' is relative, so it needs an 'hf_repo' to download from — ` +
        `use an absolute path for a file already on this machine`;
    }
  }
  return null;
}

/** Built-ins plus your own, the latter winning on id collision — pointing an
 *  id at your own copy of the same model is a supported reason to be here. */
export function imageCatalog(): ImageModelSpec[] {
  const user = userImageModels();
  const shadowed = new Set(user.map((s) => s.id));
  return [...IMAGE_MODELS.filter((s) => !shadowed.has(s.id)), ...user];
}

export function imageModelSpec(id: string): ImageModelSpec | null {
  return imageCatalog().find((m) => m.id === id) ?? null;
}

/* ---------------------------------------------------------------- weights */

export type ImageProgressFn = (fraction: number, message: string) => void;

/** `<dataDir>/models/image/<id>/` — sibling of `models/llm/`. */
export function weightsDir(modelsDir: string, spec: ImageModelSpec): string {
  return join(modelsDir, "image", spec.id);
}

/** Where one file actually lives: your absolute path as given, or inside the
 *  model's download directory, keeping the repo's own subfolders. */
export function filePath(
  modelsDir: string,
  spec: ImageModelSpec,
  file: ImageWeightFile,
): string {
  if (isAbsolute(file.path)) return file.path;
  return join(weightsDir(modelsDir, spec), ...file.path.split("/"));
}

/** Every file present. A model is only usable when all of them are — a
 *  half-downloaded SD 3.5 fails deep inside ggml rather than at the door. */
export async function isDownloaded(modelsDir: string, spec: ImageModelSpec): Promise<boolean> {
  for (const file of spec.files) {
    if (!existsSync(filePath(modelsDir, spec, file))) return false;
  }
  return spec.files.length > 0;
}

/** The files still missing, for an error that says which. */
export function missingFiles(modelsDir: string, spec: ImageModelSpec): ImageWeightFile[] {
  return spec.files.filter((f) => !existsSync(filePath(modelsDir, spec, f)));
}

/**
 * The argv fragment that loads this model — `[flag, path, flag, path, …]`
 * plus any extra flags the entry declares.
 *
 * Built here rather than in the runtime so that "how a model is loaded" stays
 * next to "what a model is", and so a family needing a different flag is a
 * catalog edit.
 */
export function loadArgs(modelsDir: string, spec: ImageModelSpec): string[] {
  const args: string[] = [];
  for (const file of spec.files) {
    args.push(file.flag, filePath(modelsDir, spec, file));
  }
  args.push(...spec.extra_args);
  return args;
}

/**
 * Pull every missing file. Files already present are skipped, so an
 * interrupted multi-file download resumes at file granularity rather than
 * starting the whole 11 GB again.
 */
export async function downloadWeights(
  modelsDir: string,
  spec: ImageModelSpec,
  hfToken: string | null,
  progress?: ImageProgressFn,
): Promise<void> {
  const wanted = missingFiles(modelsDir, spec).filter((f) => !isAbsolute(f.path));
  const local = missingFiles(modelsDir, spec).filter((f) => isAbsolute(f.path));
  if (local.length > 0) {
    throw new ModelError(
      `${spec.name} points at local files that aren't there: ${local
        .map((f) => f.path)
        .join(", ")}. Fix the paths for '${spec.id}' in ${customCatalogPath()}.`,
    );
  }
  if (wanted.length === 0) {
    progress?.(1.0, "Already downloaded");
    return;
  }
  if (!spec.hf_repo) throw new ModelError(`${spec.name} has no repo to download from.`);

  // Weighted by size so a 4.9 GB encoder doesn't advance the bar the same
  // amount as a 246 MB one.
  const total = wanted.reduce((sum, f) => sum + f.size_bytes, 0) || 1;
  let completed = 0;

  for (const file of wanted) {
    const url = `https://huggingface.co/${spec.hf_repo}/resolve/main/${file.path}`;
    const label = file.path.split("/").pop() ?? file.path;
    try {
      // Streamed to `<dest>.part` and renamed into place, so `isDownloaded()`
      // never sees a half-written checkpoint. Only a built-in entry's size is
      // enforced: those were measured, where a size in your own custom.json
      // is a number typed by hand and may be approximate.
      await downloadToFile(url, filePath(modelsDir, spec, file), {
        headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : {},
        expectedBytes: spec.source === "builtin" ? file.size_bytes : 0,
        checkResponse: (resp) => {
          if (resp.ok) return;
          if (resp.status === 401 || resp.status === 403) {
            throw new ModelError(
              `${spec.hf_repo} refused the download (HTTP ${resp.status}). If it's a gated ` +
                `repo, accept its terms on Hugging Face and add a token in Settings.`,
            );
          }
          throw new ModelError(`HTTP ${resp.status} fetching ${file.path} from ${spec.hf_repo}.`);
        },
        onProgress: (done, length) => {
          const declared = length || file.size_bytes;
          progress?.(
            Math.min(0.99, (completed + Math.min(done, declared)) / total),
            `Downloading ${label} — ${Math.floor(done / 1024 / 1024)} MB`,
          );
        },
      });
    } catch (exc) {
      if (exc instanceof ModelError) throw exc;
      if (exc instanceof DownloadError) throw new ModelError(exc.message);
      throw new ModelError(`Could not reach Hugging Face to download ${label}: ${String(exc)}`);
    }
    completed += file.size_bytes;
  }
  progress?.(1.0, "Download complete");
}

/**
 * Remove a model's downloaded weights.
 *
 * Only ever the download directory. A model whose files you supplied by
 * absolute path has nothing here to delete, and deleting *your* files because
 * you listed them in a catalog would be indefensible.
 */
export async function deleteWeights(modelsDir: string, spec: ImageModelSpec): Promise<void> {
  if (spec.files.every((f) => isAbsolute(f.path))) {
    throw new ModelError(
      `${spec.name} uses files already on your disk — Konchi didn't download them and ` +
        `won't delete them.`,
    );
  }
  await rm(weightsDir(modelsDir, spec), { recursive: true, force: true });
}
