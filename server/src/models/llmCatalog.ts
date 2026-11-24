/**
 * Curated GGUF chat models for the prompt-assistant LLM.
 *
 * Deliberately small and hand-picked rather than "browse any HF repo": these
 * are single-file quantized chats sized for a machine that's also running an
 * audio model, all Apache-2.0 so the license story next to `audiocpp`'s
 * per-model licenses stays simple.
 */

import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  DownloadError,
  downloadToFile,
  MODEL_HEADROOM_BYTES,
  retryLine,
  TransferRate,
} from "../download.js";
import { ModelError } from "../errors.js";

export interface LlmModelSpec {
  id: string;
  name: string;
  vendor: string;
  license: string;
  /** HF repo holding the GGUF file. */
  hf_repo: string;
  /** Exact filename within the repo — single file, no glob needed. */
  filename: string;
  size_bytes: number;
  description: string;
  /** Shown as the default pick in the Models page's install flow. */
  recommended: boolean;
}

// Filenames and sizes verified against the repos' file listings directly
// (huggingface.co/api/models/<repo>) rather than assumed — the official Qwen3
// GGUF repos publish only Q8_0 for the two smaller sizes, not the Q4_K_M every
// third-party GGUF repo defaults to. Getting this wrong 404s at download time.
export const LLM_MODELS: LlmModelSpec[] = [
  {
    id: "qwen3-0.6b",
    name: "Qwen3 0.6B",
    vendor: "Alibaba",
    license: "Apache-2.0",
    hf_repo: "Qwen/Qwen3-0.6B-GGUF",
    filename: "Qwen3-0.6B-Q8_0.gguf",
    size_bytes: 639_446_688,
    description: "Smallest option — fastest on modest hardware, lower rewrite quality.",
    recommended: false,
  },
  {
    id: "qwen3-1.7b",
    name: "Qwen3 1.7B",
    vendor: "Alibaba",
    license: "Apache-2.0",
    hf_repo: "Qwen/Qwen3-1.7B-GGUF",
    filename: "Qwen3-1.7B-Q8_0.gguf",
    size_bytes: 1_834_426_016,
    description: "Default — a good balance of speed and rewrite quality on most GPUs.",
    recommended: true,
  },
  {
    id: "qwen3-4b",
    name: "Qwen3 4B",
    vendor: "Alibaba",
    license: "Apache-2.0",
    hf_repo: "Qwen/Qwen3-4B-GGUF",
    filename: "Qwen3-4B-Q4_K_M.gguf",
    size_bytes: 2_497_280_256,
    description: "Best rewrite quality; slower to load and more VRAM alongside an audio model.",
    recommended: false,
  },
];

export function llmModelSpec(id: string): LlmModelSpec | null {
  return LLM_MODELS.find((m) => m.id === id) ?? null;
}

/* -------------------------------------------------------------- weights */

export type LlmProgressFn = (fraction: number, message: string) => void;

/** `<dataDir>/models/llm/<id>/<filename>` — a sibling of `models/audiocpp/`,
 *  single file per model since the catalog pins an exact filename rather than
 *  a glob. */
export function weightsPath(modelsDir: string, spec: LlmModelSpec): string {
  return join(modelsDir, "llm", spec.id, spec.filename);
}

export async function isDownloaded(modelsDir: string, spec: LlmModelSpec): Promise<boolean> {
  try {
    return (await stat(weightsPath(modelsDir, spec))).isFile();
  } catch {
    return false;
  }
}

/**
 * Pull `spec.filename` from `spec.hf_repo`. Same direct-fetch approach as
 * `AudioCppModel.fetchWeights` — no glob to resolve, just one file. Streamed
 * to disk and checked against the catalog's `size_bytes`, so a cut-off
 * transfer fails here instead of at load time.
 */
export async function downloadWeights(
  modelsDir: string,
  spec: LlmModelSpec,
  hfToken: string | null,
  progress?: LlmProgressFn,
): Promise<void> {
  const url = `https://huggingface.co/${spec.hf_repo}/resolve/main/${spec.filename}`;
  const rate = new TransferRate();
  let fraction = 0;
  try {
    await downloadToFile(url, weightsPath(modelsDir, spec), {
      headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : {},
      expectedBytes: spec.size_bytes,
      headroomBytes: MODEL_HEADROOM_BYTES,
      onRetry: (notice) => progress?.(fraction, retryLine(notice)),
      checkResponse: (resp) => {
        if (resp.ok) return;
        if (resp.status === 401 || resp.status === 403) {
          throw new ModelError(
            `${spec.hf_repo} refused the download (HTTP ${resp.status}). If it's a gated ` +
              `repo, add a Hugging Face token in Settings.`,
          );
        }
        throw new ModelError(`HTTP ${resp.status} fetching ${spec.filename} from ${spec.hf_repo}.`);
      },
      onProgress: (done, total) => {
        if (progress && total) {
          fraction = Math.min(0.95, done / total);
          progress(fraction, `Downloading — ${rate.line(done, total)}`);
        }
      },
    });
  } catch (exc) {
    if (exc instanceof ModelError) throw exc;
    if (exc instanceof DownloadError) throw new ModelError(exc.message);
    throw new ModelError(`Could not reach Hugging Face to download ${spec.name}: ${String(exc)}`);
  }
  progress?.(1.0, "Download complete");
}

export async function deleteWeights(modelsDir: string, spec: LlmModelSpec): Promise<void> {
  await rm(join(modelsDir, "llm", spec.id), { recursive: true, force: true });
}

