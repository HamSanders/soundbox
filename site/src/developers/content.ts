/**
 * The content of `/developers/`, as data, with no React in it.
 *
 * Two things render from this module: the page itself
 * (`src/routes/developers.tsx`) and its Markdown twin, `/developers/index.md`,
 * which `plugins/crawlers.ts` writes after the prerender along with
 * `llms.txt` and `llms-full.txt`. Keeping the words here means the HTML an
 * answer engine indexes and the Markdown an agent fetches cannot drift apart.
 *
 * The facts that can be read from source are not in this file at all: the
 * MCP tools, the environment variables and the version come from
 * `virtual:developer-facts` (see `plugins/developer-facts.ts`), and both the
 * page and the Markdown take them as an argument.
 *
 * Naming: the product is Mirli. The identifiers that kept the old name are
 * written as code everywhere: the `soundbox.*` tools, the `soundbox` CLI,
 * the `X-Soundbox` header and the `ghcr.io/hamsanders/soundbox` image. They
 * are what an agent has to type. Environment variables are written `MIRLI_*`;
 * the server still reads the old `SOUNDBOX_*` names, which the page says once.
 *
 * Every claim is taken from docs/ (INSTALL.md, INSTALL-AGENT.md, API.md,
 * MCP.md, STREAMING.md) or README.md. Nothing here is new information.
 */

import type { DeveloperFacts, McpToolFact } from "../../plugins/developer-facts";

export const REPO = "https://github.com/HamSanders/soundbox";
export const BASE_URL = "http://127.0.0.1:17494";
export const MCP_URL = `${BASE_URL}/mcp`;
export const IMAGE = "ghcr.io/hamsanders/soundbox";

export const PAGE = {
  path: "/developers",
  title: "Mirli for developers and AI agents: MCP server, HTTP API and install",
  description:
    "Everything an AI agent needs to install and drive Mirli on one page: desktop, Docker and source installs, MCP config for Claude Code, Cursor, VS Code and Codex, every MCP tool, the HTTP API with curl, environment variables and hardware limits.",
  summary:
    "Mirli is a free, open-source (MIT) app that generates sound effects, music, speech and cloned voices on your own machine from open-weight models. Inference runs locally through the audio.cpp engine on an NVIDIA, Apple or CPU backend, so there is no account, no API key and no per-generation cost. One local server process serves the desktop and web UI, an HTTP API and an MCP server, all on 127.0.0.1:17494, and every result is a WAV file on disk with an absolute path.",
} as const;

/** Short, checkable facts an agent needs before it does anything. */
export const FACTS: { label: string; value: string; code?: boolean }[] = [
  { label: "Server", value: BASE_URL, code: true },
  { label: "MCP endpoint", value: `\`${MCP_URL}\` (Streamable HTTP)` },
  { label: "Health check", value: `GET ${BASE_URL}/api/health`, code: true },
  {
    label: "Auth",
    value:
      "None by default; the server binds to loopback. Set `MIRLI_API_TOKEN` to require `Authorization: Bearer <token>`.",
  },
  { label: "Output", value: "WAV files on local disk, returned as absolute paths" },
  { label: "Licence", value: "MIT (the app). Each model has its own licence." },
  { label: "Docker image", value: `\`${IMAGE}:latest\` (amd64), \`:cuda\` for NVIDIA` },
  { label: "Source", value: REPO },
];

export interface InstallPath {
  id: string;
  title: string;
  when: string;
  steps: { text: string; code?: string; lang?: string }[];
}

export const INSTALL: InstallPath[] = [
  {
    id: "desktop",
    title: "Desktop app (Windows, macOS)",
    when: "A person's own Windows 10/11 x64 or macOS machine (Apple silicon or Intel).",
    steps: [
      {
        text: "Download the installer for the machine from https://mirli.app/download/ (the latest GitHub release: an `x64-setup.exe`, an `aarch64.dmg` or an `x64.dmg`) and run it. The app carries its own Node and server.",
      },
      {
        text: "The builds are not code-signed yet, so the first launch shows SmartScreen (Windows) or Gatekeeper (macOS). An agent cannot click through that; ask the person to confirm it.",
      },
      {
        text: "With the app open, the server answers on `127.0.0.1:17494`:",
        code: `curl ${BASE_URL}/api/health`,
        lang: "bash",
      },
    ],
  },
  {
    id: "docker",
    title: "Docker (Linux server, NAS, rented GPU)",
    when: "A headless machine. Server and web UI in one container, no desktop app. Prebuilt images are amd64 only.",
    steps: [
      {
        text: "CPU image, port published on loopback only:",
        code: `docker run -d --name soundbox -p 127.0.0.1:17494:17494 \\
  -v soundbox-data:/data -v soundbox-models:/data/models \\
  ${IMAGE}:latest`,
        lang: "bash",
      },
      {
        text: "NVIDIA GPU (needs the NVIDIA Container Toolkit and a driver that supports CUDA 12.9, 575 or newer on GeForce):",
        code: `docker run -d --name soundbox --gpus all -p 127.0.0.1:17494:17494 \\
  -v soundbox-data:/data -v soundbox-models:/data/models \\
  ${IMAGE}:cuda`,
        lang: "bash",
      },
      {
        text: "The audio.cpp runtime is already in the image. Pull a model inside the container:",
        code: "docker exec soundbox soundbox pull audiocpp-stable-audio-3-sfx",
        lang: "bash",
      },
      {
        text: "Each release is also tagged by version (`:vX.Y.Z`, `:vX.Y.Z-cuda`). There is no authentication unless `MIRLI_API_TOKEN` is set, so never publish `0.0.0.0:17494` without a token or an authenticating proxy. Reaching `/mcp` by any name other than localhost needs that name in `MIRLI_ALLOWED_HOSTS`.",
      },
    ],
  },
  {
    id: "source",
    title: "From source (Linux, or any OS)",
    when: "Linux desktops, development, or arm64. Needs Node 22.12+ and git. The CLI is not published to npm.",
    steps: [
      {
        text: "Clone, build, install the audio.cpp runtime for this machine, and start the server:",
        code: `git clone ${REPO}
cd soundbox
npm install
npm run build
npx soundbox model install audiocpp
npx soundbox`,
        lang: "bash",
      },
      {
        text: "`npx soundbox` starts the server on port 17494 and serves the web app at the same address. `npx soundbox --help` lists the subcommands.",
      },
    ],
  },
];

/** The rules docs/INSTALL-AGENT.md sets for an agent installing Mirli. */
export const AGENT_RULES: string[] = [
  "Check the hardware first. `GET /api/health` reports `device` (`cuda`, `metal` or `cpu`), `gpu_name`, `vram_total_mb` and `vram_free_mb`.",
  "Say what each model costs before downloading it: `GET /api/models` gives `vram_estimate_mb`, `license.name` and `license.commercial` (`yes`, `conditional` or `no`). Wait for a yes.",
  "Never accept a model licence on the person's behalf.",
  "Reuse weights that are already installed; they live under `~/.mirli/models` and are shared by every profile.",
  "Do not change network or firewall settings. The server binds to loopback and needs nothing opened.",
];

export interface ClientConfig {
  id: string;
  client: string;
  where: string;
  code: string;
  lang: string;
  /** The same config as a file, where the client also takes one. */
  file?: { where: string; code: string; lang: string };
  /** A documented one-click install link. */
  install?: { label: string; href: string };
  note?: string;
  /** The client's own docs page for this syntax. */
  source: string;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);


/**
 * Each client's syntax as its own docs give it (linked in `source`, and
 * collected in docs/agents-discovery.md). The server label is `soundbox`,
 * matching docs/MCP.md and the bundled skills.
 */
export const CLIENTS: ClientConfig[] = [
  {
    id: "claude-code",
    client: "Claude Code",
    where: "Run in a terminal",
    code: `claude mcp add --transport http soundbox ${MCP_URL}`,
    lang: "bash",
    note: 'Add `--scope user` to make it available in every project. With an access token, add `--header "Authorization: Bearer <token>"`.',
    source: "https://code.claude.com/docs/en/mcp",
  },
  {
    id: "cursor",
    client: "Cursor",
    where: "`~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project)",
    code: json({ mcpServers: { soundbox: { url: MCP_URL } } }),
    lang: "json",
    install: {
      label: "Add to Cursor",
      href: `cursor://anysphere.cursor-deeplink/mcp/install?name=soundbox&config=${encodeURIComponent(btoa(JSON.stringify({ url: MCP_URL })))}`,
    },
    source: "https://cursor.com/docs/context/mcp",
  },
  {
    id: "vscode",
    client: "VS Code",
    where: "Run in a terminal",
    code: `code --add-mcp '${JSON.stringify({ name: "soundbox", type: "http", url: MCP_URL })}'`,
    lang: "bash",
    file: {
      where: "`.vscode/mcp.json`",
      code: json({ servers: { soundbox: { type: "http", url: MCP_URL } } }),
      lang: "json",
    },
    install: {
      label: "Add to VS Code",
      href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "soundbox", type: "http", url: MCP_URL }))}`,
    },
    source: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
  },
  {
    id: "codex",
    client: "Codex CLI",
    where: "Run in a terminal",
    code: `codex mcp add soundbox --url ${MCP_URL}`,
    lang: "bash",
    file: { where: "`~/.codex/config.toml`", code: `[mcp_servers.soundbox]
url = "${MCP_URL}"`, lang: "toml" },
    source: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
  },
  {
    id: "gemini",
    client: "Gemini CLI",
    where: "Run in a terminal",
    code: `gemini mcp add --transport http soundbox ${MCP_URL}`,
    lang: "bash",
    file: {
      where: "`~/.gemini/settings.json` (`httpUrl` is Streamable HTTP; `url` would mean SSE)",
      code: json({ mcpServers: { soundbox: { httpUrl: MCP_URL } } }),
      lang: "json",
    },
    source: "https://geminicli.com/docs/tools/mcp-server/",
  },
  {
    id: "zed",
    client: "Zed",
    where: "Zed's `settings.json`",
    code: json({ context_servers: { soundbox: { url: MCP_URL } } }),
    lang: "json",
    source: "https://zed.dev/docs/ai/mcp",
  },
  {
    id: "stdio",
    client: "Claude Desktop and other stdio-only clients",
    where: "`claude_desktop_config.json`, or the client's own MCP config",
    code: json({
      mcpServers: {
        soundbox: {
          command: "node",
          args: ["/absolute/path/to/soundbox/server/dist/mcp/stdio.js"],
        },
      },
    }),
    lang: "json",
    note: "Claude Desktop's config file takes stdio servers, and its custom connectors connect from Anthropic's cloud, which cannot reach 127.0.0.1. The stdio bridge proxies onto the running server and loads no models. It needs a source checkout after `npm run build` and an absolute path, and covers six tools: `generate`, `enhance_prompt`, `list_models`, `list_sounds`, `get_sound` and `delete_sound`. Use HTTP for the rest. `MIRLI_URL` and `MIRLI_API_TOKEN` point it at another server.",
    source: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
  },
];

export const MCP_NOTES: string[] = [
  "The MCP server runs inside the main Mirli process. There is no separate daemon: if the app or `soundbox` server is running, the tools are there; if not, connecting fails.",
  "The URL has no trailing slash.",
  "The server name in the configs above (`soundbox`) is the client-side label; the tool names are `soundbox.*` whatever you call it.",
  "Generation is serialised: one GPU, one job at a time. Parallel calls queue. Use `variations` for several takes of one idea.",
  "Tool calls block until the audio is on disk and return absolute file paths, so there is no job id to poll over MCP.",
  "Licences are per model. `soundbox.list_models` reports `commercial_use` as yes, conditional or no; check it before generating for commercial work.",
  "Optional agent skills ship with the server: `soundbox skills install` copies them to `~/.claude/skills/` (`--target cursor` for `~/.cursor/skills/`).",
];

export interface CurlExample {
  title: string;
  text: string;
  code: string;
}

export const CURL: CurlExample[] = [
  {
    title: "Is it running, and on what hardware?",
    text: "Version, `device` (`cuda`, `metal` or `cpu`), GPU name, VRAM, loaded model and queue length. Stays open even when a token is set.",
    code: `curl ${BASE_URL}/api/health`,
  },
  {
    title: "Which models are there?",
    text: "Every enabled model with `status` (`installed`, `loaded`, …), licence, `max_duration_s` and `vram_estimate_mb`.",
    code: `curl ${BASE_URL}/api/models`,
  },
  {
    title: "Download a model",
    text: "Returns `202 { job_id }`. A POST with no JSON body needs the `X-Soundbox` header.",
    code: `curl -X POST -H 'X-Soundbox: 1' \\
  ${BASE_URL}/api/models/audiocpp-stable-audio-3-sfx/download`,
  },
  {
    title: "Render and get the WAV back in one call",
    text: "`POST /api/render` runs one job, waits, and answers `200 audio/wav`. The body is a `/api/generate` or `/api/speak` body. `400` on bad input, `429` when the queue is full.",
    code: `curl -X POST ${BASE_URL}/api/render \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"audiocpp-stable-audio-3-sfx","prompt":"heavy wooden door slam, dry room","duration_s":3}' \\
  -o door.wav`,
  },
  {
    title: "Queue a generation and follow the job",
    text: "`POST /api/generate` returns `202 { job_id }`. Poll `GET /api/jobs/{id}` (or `GET /api/jobs/{id}/events` for server-sent events) until `status` is `done`, then read `result.sounds`.",
    code: `curl -X POST ${BASE_URL}/api/generate \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"audiocpp-stable-audio-3-sfx","prompt":"glass bottle shattering on tile","duration_s":2,"variations":2}'

curl ${BASE_URL}/api/jobs/<job_id>`,
  },
  {
    title: "Find a sound and its file",
    text: "`GET /api/sounds` searches the library; each sound carries `path` (absolute) and `duration_s`.",
    code: `curl '${BASE_URL}/api/sounds?q=door&limit=5'
curl ${BASE_URL}/api/sounds/<sound_id>`,
  },
  {
    title: "Stream speech as it is made",
    text: "`POST /api/speak/stream` sends server-sent events with base64 16-bit PCM, or raw PCM with `format: \"pcm\"`. Not a job: it holds the GPU, never queues (`409` when busy), and closing the connection cancels it.",
    code: `curl -N -X POST ${BASE_URL}/api/speak/stream \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"audiocpp-supertonic-3","text":"Halt! Who goes there?","format":"sse"}'`,
  },
];

export const API_RULES: string[] = [
  "Base URL `http://127.0.0.1:17494`, JSON in and out.",
  "The `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (or a name in `MIRLI_ALLOWED_HOSTS`); anything else is `403`. This blocks DNS rebinding.",
  "`POST`, `PUT`, `PATCH` and `DELETE` under `/api/` need `Content-Type: application/json` (or a raw audio type on uploads) or an `X-Soundbox` header, or they get `403`.",
  "With `MIRLI_API_TOKEN` set, `/api/*`, `/v1/*`, `/mcp`, `/files` and `/artwork` need `Authorization: Bearer <token>`; `GET /api/health` stays open.",
];

export const LIMITS: { label: string; value: string }[] = [
  { label: "NVIDIA GPU", value: "CUDA. A few GB of VRAM covers the verified models; MiniMax Music 3 wants about 10 GB." },
  { label: "Apple silicon", value: "Metal. Installers exist; none of the verified models has been confirmed on a Mac yet." },
  {
    label: "AMD or Intel GPU",
    value: "Runs on the CPU unless `MIRLI_AUDIOCPP_BACKEND=vulkan` is set. Vulkan is not yet confirmed on the verified models.",
  },
  { label: "No GPU", value: "Works, slowly: a clip that takes seconds on a GPU takes minutes on the CPU." },
  { label: "Disk", value: "Model weights are one to ten gigabytes each, under `~/.mirli/models`." },
  { label: "Clip length", value: "`duration_s` 0.5–300, clamped to each model's own `max_duration_s` (see `soundbox.list_models`)." },
  { label: "Concurrency", value: "One job at a time on one GPU; the rest queue. Streams never queue and answer `409` when the GPU is busy." },
  { label: "Long renders", value: "`/api/render` holds the request open. Behind a proxy with a ~100 s timeout, use `/api/generate` and follow the job." },
  { label: "Platforms", value: "Desktop installers for Windows 10/11 x64 and macOS. Linux runs from source or Docker. Docker images are amd64 only." },
];

export const DOCS: { label: string; path: string; blurb: string }[] = [
  { label: "Installing with a coding agent", path: "https://github.com/HamSanders/soundbox/blob/main/docs/INSTALL-AGENT.md", blurb: "The step-by-step guide written for an agent." },
  { label: "Install", path: "/docs/install", blurb: "The CLI, audio.cpp backends, models, Docker, access tokens, every env var." },
  { label: "MCP reference", path: "/docs/mcp", blurb: "Every tool with arguments, the stdio bridge, telemetry, skills." },
  { label: "HTTP API", path: "/docs/api", blurb: "Every route, request rules, job and model shapes." },
  { label: "Streaming speech", path: "https://github.com/HamSanders/soundbox/blob/main/docs/STREAMING.md", blurb: "SSE and raw PCM speech streams, with client examples." },
  { label: "audio.cpp", path: "/docs/audiocpp", blurb: "The native engine, its backends and how to choose one." },
  { label: "Models", path: "/models", blurb: "Every model it runs, with its licence." },
];

/** Machine-readable files, all at the site root or next to this page. */
export const AGENT_FILES: { label: string; path: string; blurb: string }[] = [
  { label: "This page as Markdown", path: "/developers/index.md", blurb: "The same content, plain Markdown." },
  { label: "llms.txt", path: "/llms.txt", blurb: "A curated map of the site for language models (llmstxt.org)." },
  { label: "llms-full.txt", path: "/llms-full.txt", blurb: "This page plus the MCP, API and install docs in one file." },
  { label: "server.json", path: `${REPO}/blob/main/server.json`, blurb: "The MCP Registry entry for the server." },
  { label: "AGENTS.md", path: `${REPO}/blob/main/AGENTS.md`, blurb: "How to build, test and change the code, for coding agents." },
];

/* ------------------------------------------------------------- Markdown */

/** One argument as a compact signature: `duration_s?: number = 5.0 (0.5–300)`. */
export function argSignature(a: McpToolFact["args"][number]): string {
  return `${a.name}${a.required ? "" : "?"}: ${a.type}${a.default !== undefined ? ` = ${a.default}` : ""}${a.range ? ` (${a.range})` : ""}`;
}

function abs(origin: string, p: string): string {
  return p.startsWith("http") ? p : `${origin}${p}${p.includes(".") ? "" : "/"}`;
}

/**
 * Text that is safe inside one Markdown table cell. Backslashes are escaped
 * first, so a `\` already in the text cannot pair with the `\|` added for a
 * pipe and turn it back into a column break.
 */
const cell = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n+/g, " ");

/**
 * `/developers/index.md`: the page as Markdown, for agents that fetch it and
 * for llms-full.txt. `origin` makes every link absolute, since the file is
 * read out of context.
 */
export function developersMarkdown(facts: DeveloperFacts, origin: string): string {
  const out: string[] = [];
  const fence = (lang: string, code: string) => out.push("```" + lang, code, "```", "");

  out.push(`# Mirli for developers and AI agents`, "", `> ${PAGE.summary}`, "");
  out.push(
    `Version ${facts.version}. Canonical page: ${abs(origin, PAGE.path)}. Source: ${REPO}.`,
    "",
    "Kept identifiers: the product is Mirli, but the MCP tools are `soundbox.*`, the CLI is `soundbox` and the Docker image is `" +
      IMAGE +
      "`. The environment variables are `MIRLI_*`; the old `SOUNDBOX_*` names still work, and are the only ones 0.5.0 and earlier read.",
    "",
  );

  out.push("## Facts", "");
  for (const f of FACTS) out.push(`- **${f.label}:** ${f.code ? "`" + f.value + "`" : f.value}`);
  out.push("");

  out.push("## Install", "");
  for (const p of INSTALL) {
    out.push(`### ${p.title}`, "", p.when, "");
    for (const s of p.steps) {
      out.push(s.text, "");
      if (s.code) fence(s.lang ?? "", s.code);
    }
  }
  out.push("### Rules for an agent installing Mirli", "");
  for (const r of AGENT_RULES) out.push(`- ${r}`);
  out.push("");

  out.push("## Connect the MCP server", "", `Endpoint: \`${MCP_URL}\` (Streamable HTTP, no auth by default).`, "");
  for (const c of CLIENTS) {
    out.push(`### ${c.client}`, "", `${c.where}:`, "");
    fence(c.lang, c.code);
    if (c.file) {
      out.push(`Or in ${c.file.where}:`, "");
      fence(c.file.lang, c.file.code);
    }
    if (c.install) out.push(`One-click: [${c.install.label}](${c.install.href})`, "");
    if (c.note) out.push(c.note, "");
    out.push(`Syntax from ${c.source}`, "");
  }
  for (const n of MCP_NOTES) out.push(`- ${n}`);
  out.push("");

  out.push(
    `## MCP tools (${facts.tools.length})`,
    "",
    "Read from the server source (`server/src/mcp/server.ts`) at build time. `?` marks an optional argument.",
    "",
  );
  for (const t of facts.tools) {
    out.push(`### \`${t.name}\`: ${t.title}`, "", t.description, "");
    if (t.args.length) {
      for (const a of t.args)
        out.push(`- \`${argSignature(a)}\`${a.description ? `: ${a.description.replace(/\n+/g, " ")}` : ""}`);
    } else out.push("No arguments.");
    out.push("");
  }

  out.push("## HTTP API quick reference", "");
  for (const r of API_RULES) out.push(`- ${r}`);
  out.push("");
  for (const c of CURL) {
    out.push(`### ${c.title}`, "", c.text, "");
    fence("bash", c.code);
  }
  out.push(`The full route list is at ${abs(origin, "/docs/api")}.`, "");

  out.push("## Environment variables", "", "| Variable | Read by | What it does |", "|---|---|---|");
  for (const e of facts.envVars)
    out.push(`| ${e.names.map((n) => "`" + n + "`").join(" / ")} | ${cell(e.readBy)} | ${cell(stripLinks(e.description))} |`);
  out.push("");

  out.push("## Hardware and limits", "");
  for (const l of LIMITS) out.push(`- **${l.label}:** ${l.value}`);
  out.push("");

  out.push("## Full documentation", "");
  for (const d of DOCS) out.push(`- [${d.label}](${abs(origin, d.path)}): ${d.blurb}`);
  out.push("");
  out.push("## Machine-readable files", "");
  for (const f of AGENT_FILES) out.push(`- [${f.label}](${abs(origin, f.path)}): ${f.blurb}`);
  out.push("");
  return out.join("\n");
}

/** `[text](target)` → `text`, for doc-relative links that mean nothing out of context. */
export function stripLinks(md: string): string {
  return md.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
