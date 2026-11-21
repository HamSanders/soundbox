/**
 * Every setting on the Settings page, grouped by what a person is trying to
 * do rather than by which service stores it.
 *
 * This list is the search index and the section nav. A row on the page looks
 * its label and description up here by id, so the words you search for are
 * the words you see, and `#/settings?s=<id>` deep-links to it.
 */

import type { Capabilities, CapabilityKey } from "@/lib/api";

export interface SettingsGroupMeta {
  id: string;
  title: string;
  description: string;
  /** Dangerous or one-way actions: rendered last, with confirmation. */
  danger?: boolean;
}

export interface SettingMeta {
  id: string;
  group: string;
  label: string;
  description: string;
  /** Extra words people search with that are not in the label. */
  keywords?: string[];
}

export const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  {
    id: "sound",
    title: "Sound & files",
    description: "How you hear audio here, and what every generated file is like.",
  },
  {
    id: "performance",
    title: "Performance",
    description: "Where generation runs and how long it holds onto memory.",
  },
  {
    id: "models",
    title: "Models & engines",
    description: "Where models come from: audio.cpp, your own servers, Hugging Face.",
  },
  {
    id: "helpers",
    title: "Prompt assistant & artwork",
    description: "Optional helper models. Both are off by default.",
  },
  {
    id: "storage",
    title: "Storage",
    description: "Where sounds, weights and the index live on disk.",
  },
  {
    id: "interface",
    title: "Interface",
    description: "Kept in this browser, not on the server.",
  },
  {
    id: "privacy",
    title: "Updates & telemetry",
    description: "Everything that can leave this machine, and how to stop it.",
  },
  {
    id: "danger",
    title: "Reset",
    description: "One-way actions. Each asks before it does anything.",
    danger: true,
  },
];

export const SETTINGS: SettingMeta[] = [
  // Sound & files
  {
    id: "output-device",
    group: "sound",
    label: "Playback device",
    description: "Where Mirli plays audio. Previews only; generated files are unchanged.",
    keywords: ["speaker", "headphones", "headset", "output", "test tone", "sink"],
  },
  {
    id: "output-format",
    group: "sound",
    label: "File format",
    description: "WAV keeps full quality; MP3 is transcoded on download.",
    keywords: ["wav", "mp3", "export", "codec"],
  },
  {
    id: "normalize",
    group: "sound",
    label: "Normalise loudness",
    description: "Bring every sound to a consistent integrated loudness, in LUFS.",
    keywords: ["lufs", "volume", "level", "loudness", "normalize"],
  },
  {
    id: "trim-silence",
    group: "sound",
    label: "Trim silence",
    description: "Strip leading and trailing silence from generated audio.",
    keywords: ["silence", "cut", "gap"],
  },
  // Performance
  {
    id: "device",
    group: "performance",
    label: "Compute device",
    description: "Where generation runs. Auto picks the fastest available.",
    keywords: ["gpu", "cuda", "mps", "cpu", "hardware"],
  },
  {
    id: "auto-unload",
    group: "performance",
    label: "Auto-unload model",
    description: "Free VRAM after this many idle minutes. 0 keeps the model resident.",
    keywords: ["vram", "memory", "idle", "timeout", "unload"],
  },
  // Models & engines
  {
    id: "audiocpp-mode",
    group: "models",
    label: "Audio engine",
    description: "Local uses the runtime Mirli manages; External uses your own audio.cpp.",
    keywords: ["audio.cpp", "audiocpp", "runtime", "binary", "external", "managed"],
  },
  {
    id: "models-dir",
    group: "models",
    label: "Models folder",
    description: "Where model weights live. Editable in External mode, to share one set of weights.",
    keywords: ["weights", "path", "directory", "audio.cpp"],
  },
  {
    id: "endpoints",
    group: "models",
    label: "Custom endpoints",
    description:
      "Send generation to a server you run, or to a provider with your own key. Each shows up in the model pickers.",
    keywords: ["localai", "elevenlabs", "fal", "api", "server", "gateway", "remote"],
  },
  {
    id: "hf-token",
    group: "models",
    label: "Hugging Face token",
    description: "Needed for gated repositories. Write-only: never shown again once saved.",
    keywords: ["huggingface", "hf", "access token", "credentials", "account", "gated"],
  },
  // Prompt assistant & artwork
  {
    id: "llm-mode",
    group: "helpers",
    label: "Prompt assistant",
    description: "A small model that rewrites terse prompts into descriptive ones.",
    keywords: ["llm", "ollama", "lm studio", "enhance", "rewrite", "openai"],
  },
  {
    id: "artwork",
    group: "helpers",
    label: "Artwork",
    description: "Cover art for music and avatars for voices, drawn by a small local image model.",
    keywords: ["image", "cover", "avatar", "stable diffusion", "automatic1111", "comfyui", "sd"],
  },
  // Storage
  {
    id: "data-dir",
    group: "storage",
    label: "Data directory",
    description: "The open profile's folder. Set the install root with MIRLI_DATA_DIR.",
    keywords: ["profile", "path", "library", "MIRLI_DATA_DIR"],
  },
  {
    id: "sounds-dir",
    group: "storage",
    label: "Sounds folder",
    description:
      "Where generated audio is written. Existing sounds move across, so not while something is generating.",
    keywords: ["path", "directory", "disk", "output folder"],
  },
  {
    id: "weights-dir",
    group: "storage",
    label: "Model weights",
    description: "Shared by every profile, and the largest thing here. Changed under Models folder.",
    keywords: ["path", "disk", "size"],
  },
  // Interface
  {
    id: "sidebar-keep",
    group: "interface",
    label: "Keep the sidebar open in the studio",
    description:
      "Off: on studio, Music and Voice Lab pages the navigation folds to an icon rail so the timeline gets the width.",
    keywords: ["navigation", "rail", "collapse", "layout"],
  },
  // Updates & telemetry
  {
    id: "update-check",
    group: "privacy",
    label: "Check for updates",
    description: "Ask once a day whether a newer version is out. Never downloads anything.",
    keywords: ["version", "upgrade", "privacy", "network"],
  },
  {
    id: "otel-endpoint",
    group: "privacy",
    label: "MCP telemetry",
    description: "Export agent tool calls as OpenTelemetry traces and metrics to your own collector.",
    keywords: ["otel", "otlp", "opentelemetry", "traces", "metrics", "jaeger", "honeycomb", "agents"],
  },
  // Reset
  {
    id: "clear-hf-token",
    group: "danger",
    label: "Clear Hugging Face token",
    description: "Removes the saved token. Gated downloads stop working until you add one again.",
    keywords: ["delete", "remove", "credentials"],
  },
  {
    id: "rerun-setup",
    group: "danger",
    label: "Run first-run setup again",
    description:
      "Walks through the model picks again. It only opens on its own when no models are installed.",
    keywords: ["onboarding", "wizard", "welcome", "reset"],
  },
];

const BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));

/**
 * The capability a setting needs (see `Capabilities`). A server that turns it
 * off neither shows the row nor finds it in search; rows not listed are
 * always there.
 */
const NEEDS: Record<string, CapabilityKey> = {
  device: "local_models",
  "auto-unload": "local_models",
  "audiocpp-mode": "downloads",
  "models-dir": "filesystem",
  endpoints: "custom_endpoints",
  "hf-token": "downloads",
  "llm-mode": "downloads",
  artwork: "downloads",
  "data-dir": "filesystem",
  "sounds-dir": "filesystem",
  "weights-dir": "filesystem",
  "update-check": "updates",
  // The server sends traces to a URL you give it: the same trust as an endpoint.
  "otel-endpoint": "custom_endpoints",
  "clear-hf-token": "downloads",
  "rerun-setup": "setup_wizard",
};

export function settingAllowed(id: string, can: Capabilities): boolean {
  const need = NEEDS[id];
  return !need || can[need];
}

export function settingMeta(id: string): SettingMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`Unknown setting id: ${id}`);
  return meta;
}

export function matchesQuery(meta: SettingMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const group = SETTINGS_GROUPS.find((g) => g.id === meta.group)?.title ?? "";
  const hay = [meta.label, meta.description, group, ...(meta.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
