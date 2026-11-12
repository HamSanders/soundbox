/**
 * One failure taxonomy for everything that can go wrong on the way to a
 * sound: a generation, a model load, a download, a runtime that will not
 * start.
 *
 * `classify()` turns the text of an error into a stable topic, and
 * `buildFailure()` turns an error into the structured `Failure` the UI
 * renders as a card: a title that says what happened, a hint that says why,
 * what to do and what is kept, up to two fixes that link into the app, and
 * the raw text under Details. Rules are ordered most-specific first, and
 * each matches on the message rather than the exception type, because the
 * same cause reaches us as a `ModelError`, a `DownloadError`, a Node errno
 * or an audio.cpp stderr tail depending on where it surfaced.
 *
 * The hints are written for a person, with the wrong diagnosis ruled out
 * where it is common ("this is VRAM, not system RAM"), and never promise
 * more than the server knows.
 */

import type { Failure, FailureFix, FailureTopic } from "./schemas.js";

export type { Failure, FailureFix, FailureTopic };

/** Fixes reused by several topics. The `to` is an app route. */
const FIX = {
  models: { label: "Open Models", to: "/models" },
  smallerModel: { label: "Pick a smaller model", to: "/models" },
  downloadModel: { label: "Download it in Models", to: "/models" },
  installRuntime: { label: "Install the runtime in Models", to: "/models" },
  storage: { label: "Check storage in Settings", to: "/settings" },
  hfToken: { label: "Add a Hugging Face token in Settings", to: "/settings" },
  activity: { label: "See the server log", to: "/activity" },
} satisfies Record<string, FailureFix>;

interface Rule {
  topic: FailureTopic;
  /** Every pattern must match (an AND), so a rule can require both "out of
   *  memory" and a GPU word without one swallowing the host-memory case. */
  all: RegExp[];
  title: string;
  hint: string;
  fixes: FailureFix[];
  /** A retry with nothing changed would fail the same way. */
  terminal: boolean;
}

const RULES: Rule[] = [
  {
    topic: "paging_file",
    all: [/(?:error|winerror|os error)\s*1455|paging file/i],
    title: "Windows could not map the model into memory",
    hint:
      "Windows error 1455: the paging file is too small to map a model this size, " +
      "even with RAM to spare. Let Windows manage the paging file size, or set it " +
      "to a few GB more than the model, then try again. Nothing on disk changed.",
    fixes: [FIX.smallerModel],
    terminal: true,
  },
  {
    topic: "gpu_oom",
    all: [
      /out of memory|OutOfMemory|cudaMalloc|CUDA_ERROR_OUT_OF_MEMORY|OutOfDeviceMemory|alloc_buffer/i,
      /cuda|gpu|vram|vk::|vulkan|device|ggml/i,
    ],
    title: "The GPU ran out of memory",
    hint:
      "This is video memory, not system RAM. A shorter duration, fewer steps or " +
      "variations, or a smaller model fits; closing other programs that use the GPU " +
      "frees some. Everything already in the library is kept.",
    fixes: [FIX.smallerModel],
    terminal: false,
  },
  {
    topic: "host_memory",
    all: [
      /bad_alloc|ERR_MEMORY_ALLOCATION_FAILED|Cannot allocate memory|ENOMEM|not enough memory|WinError 8\b|out of memory/i,
    ],
    title: "The machine ran out of system memory",
    hint:
      "This is RAM, not the GPU. Close other programs or pick a smaller model; on " +
      "Windows a larger paging file also helps. The request itself was fine.",
    fixes: [FIX.smallerModel],
    terminal: false,
  },
  {
    topic: "backend_mismatch",
    all: [/insufficient driver|cudaErrorInsufficientDriver|no CUDA-capable device|driver version is insufficient/i],
    title: "The CUDA runtime cannot use this GPU driver",
    hint:
      "The CUDA build of audio.cpp needs a newer NVIDIA driver than the one installed. " +
      "Update the driver, or install the CPU or Vulkan runtime instead. Models and " +
      "sounds are untouched.",
    fixes: [FIX.installRuntime],
    terminal: true,
  },
  {
    topic: "runtime_missing",
    all: [
      /audiocpp_cli (disappeared|not found|is missing)|Could not run audio\.cpp|spawn .*ENOENT|runtime (is )?(missing|not installed)|no audio\.cpp runtime/i,
    ],
    title: "The audio.cpp runtime is missing or cannot start",
    hint:
      "Every model runs through audio.cpp, and this server has no working copy of it. " +
      "Install it from Models (it is a one-off download). Your sounds and settings " +
      "are not affected.",
    fixes: [FIX.installRuntime],
    terminal: true,
  },
  {
    topic: "disk_full",
    all: [/ENOSPC|no space left|not enough space on the disk|WinError 112\b|disk (is )?full/i],
    title: "The disk is full",
    hint:
      "There was no room to write the file, so the partial file was removed. Free " +
      "space on the drive that holds the Konchi data directory, or move the models " +
      "folder to another drive, then try again.",
    fixes: [FIX.storage],
    terminal: true,
  },
  {
    topic: "hf_gated",
    all: [/gated|awaiting a review|\b40[13]\b/i, /hugging ?face|hf_repo|huggingface\.co|licence|license|token/i],
    title: "Hugging Face refused the download",
    hint:
      "This model is gated, or the request carried no token for it. Accept the " +
      "licence on the model's Hugging Face page with your account, add an access token " +
      "in Settings, then download again. Nothing was written.",
    fixes: [FIX.hfToken, FIX.models],
    terminal: true,
  },
  {
    topic: "download_stalled",
    all: [/stalled|no data for \d+s/i],
    title: "The download stopped receiving data",
    hint:
      "The connection went quiet for too long, so the partial file was discarded " +
      "and a retry starts clean. Check the network, a VPN or a proxy first.",
    fixes: [FIX.models],
    terminal: false,
  },
  {
    topic: "download_truncated",
    all: [/ended early|cut short|bytes, expected|got \d+ of \d+ bytes|download is incomplete/i],
    title: "The download ended before the whole file arrived",
    hint:
      "Fewer bytes came back than the server declared, so the partial file was " +
      "removed. Retry once; if it happens again the file upstream may have changed " +
      "and the catalog entry needs a look.",
    fixes: [FIX.models],
    terminal: false,
  },
  {
    topic: "hf_unreachable",
    all: [/Could not reach|fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|certificate|TLS|SSL/i],
    title: "The server could not reach huggingface.co",
    hint:
      "No bytes were downloaded. Check the network, a VPN or a proxy, then try " +
      "again. Models already on disk keep working offline.",
    fixes: [FIX.models],
    terminal: false,
  },
  {
    topic: "model_not_installed",
    all: [/not downloaded|isn'?t installed|Download the weights first|no file matching|has no weights/i],
    title: "The model's weights are not on this machine",
    hint:
      "The request was fine, but there is nothing to run it with yet. Download the " +
      "model from Models and try again.",
    fixes: [FIX.downloadModel],
    terminal: true,
  },
  {
    topic: "model_file_corrupt",
    all: [/gguf|model file|tensor|magic|header/i, /invalid|corrupt|bad|failed to (read|load|open)|unexpected end|truncated/i],
    title: "The model file could not be read",
    hint:
      "audio.cpp opened the weights and could not make sense of them, which usually " +
      "means the download was cut short. Delete the model in Models and download it " +
      "again; sounds made with it before are kept.",
    fixes: [FIX.models],
    terminal: true,
  },
  {
    topic: "timeout",
    all: [/did not finish within|timed out/i],
    title: "audio.cpp did not finish in time",
    hint:
      "A long duration, many steps or rendering on the CPU can take longer than the " +
      "limit. Try a shorter duration or fewer steps, or a lighter model.",
    fixes: [FIX.smallerModel],
    terminal: false,
  },
  {
    topic: "no_audio",
    all: [/wrote no audio|produced no stems|wrote no stems|exited with code/i],
    title: "audio.cpp ran but produced nothing",
    hint:
      "The runtime exited without writing a file. The tail of its output is under " +
      "Details and usually names the cause: a prompt this model cannot take, a " +
      "weights file that did not finish downloading, or a runtime built for other " +
      "hardware.",
    fixes: [FIX.activity, FIX.models],
    terminal: false,
  },
  {
    topic: "queue_full",
    all: [/queue is full|too many jobs/i],
    title: "The queue is full",
    hint: "Nothing was wrong with the request; there is no room for it this second. Wait for a job to finish and try again.",
    fixes: [FIX.activity],
    terminal: false,
  },
];

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** The text of anything thrown, with terminal colour codes removed. */
export function failureText(exc: unknown): string {
  const raw =
    exc instanceof Error
      ? exc.message
      : typeof exc === "string"
        ? exc
        : exc === undefined || exc === null
          ? ""
          : String(exc);
  return raw.replace(ANSI, "").trim();
}

/** The topic for an error or its text, or null when nothing matches. */
export function classify(exc: unknown): FailureTopic | null {
  const text = failureText(exc);
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.all.every((re) => re.test(text))) return rule.topic;
  }
  return null;
}

/** The structured failure for anything thrown. Unclassified errors still get
 *  a card: the first line of the message as the title, no hint, and the whole
 *  text under Details, so nothing is ever less than it was. */
export function buildFailure(exc: unknown, opts: { stage?: string | null } = {}): Failure {
  const detail = failureText(exc) || (exc instanceof Error ? exc.name : "Unknown error");
  const topic = classify(detail);
  const rule = topic ? RULES.find((r) => r.topic === topic)! : null;
  return {
    topic,
    title: rule ? rule.title : firstLine(detail),
    hint: rule ? rule.hint : null,
    fixes: rule ? rule.fixes.slice(0, 2) : [],
    terminal: rule ? rule.terminal : false,
    stage: opts.stage ?? null,
    detail,
  };
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line || "Something went wrong";
}
