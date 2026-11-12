#!/usr/bin/env node
/**
 * CLI entry point: the `konchi` binary.
 *
 * Subcommand names, output text and exit codes are stable so docs and muscle
 * memory keep working.
 */

import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { buildApp } from "./app.js";
import { Config, DEFAULT_HOST, DEFAULT_PORT, VERSION, setConfig } from "./config.js";
import * as audiocpp from "./models/audiocpp.js";
import * as audiocppBinary from "./models/audiocppBinary.js";
import * as llamaServerBinary from "./models/llamaServerBinary.js";
import { downloadWeights, isDownloaded, llmModelSpec, LLM_MODELS } from "./models/llmCatalog.js";
import {
  configureLogging,
  getLogger,
  LOG_LEVELS,
  resolveLogLevel,
  setLoggerLevel,
} from "./logging.js";
import * as skills from "./skills.js";
import { writeWav } from "./audio/dsp.js";

const log = getLogger("konchi.cli");

/** `str(exc)` equivalent: the Python printed the exception message alone, and
 *  ModelError/InstallError messages are already written for a human. */
function message(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

function fail(text: string): number {
  process.stderr.write(`${text}\n`);
  return 1;
}

function printProgress(fraction: number, msg: string): void {
  process.stdout.write(`\r  [${(fraction * 100).toFixed(1).padStart(5)}%] ${msg}${" ".repeat(10)}`);
}

/** A Config for headless model-management commands — no server, no DB. It is
 *  installed globally so audiocppBinary's install root resolves to the same
 *  data directory the server would use. */
function audiocppConfig(): Config {
  const config = new Config();
  setConfig(config);
  return config;
}

/* ------------------------------------------------------------------ skills */

async function skillsMain(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "path") {
    console.log(skills.ROOT);
    return 0;
  }
  if (cmd === "list") {
    for (const s of skills.listSkills()) {
      const where =
        Object.entries(s.installed_at)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ") || "not installed";
      console.log(`${s.name}\n    ${s.description.slice(0, 110)}…\n    ${where}`);
    }
    return 0;
  }
  if (cmd !== "install") {
    return fail("error: konchi skills: expected one of list, path, install");
  }
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      target: { type: "string", default: "claude" },
      path: { type: "string" },
    },
    allowPositionals: true,
  });
  try {
    const result = skills.install(values.target, values.path ?? null, positionals.length ? positionals : null);
    console.log(`Installed ${result.installed.join(", ")} -> ${result.dest}`);
    return 0;
  } catch (exc) {
    return fail(`error: ${message(exc)}`);
  }
}

/* ------------------------------------------------------------------ model */

async function modelMain(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd !== "install" && cmd !== "status") {
    return fail("error: konchi model: expected one of install, status");
  }
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      version: { type: "string" },
      backend: { type: "string" },
      "engine-only": { type: "boolean", default: false },
      model: { type: "string" },
    },
    allowPositionals: true,
  });
  const target = positionals[0];
  if (target === "audiocpp") return await audiocppModelMain(cmd, values);
  if (target === "llm") return await llmModelMain(cmd, values);
  return fail("error: konchi model: expected one of 'audiocpp', 'llm'");
}

/** How a resolved binary is described in `status` output. A managed install
 *  shows its version; a bring-your-own binary shows where it came from
 *  instead, since we have no version to report for it. */
function binaryLabel(s: { version: string | null; source: string | null }): string {
  return s.version ?? (s.source === "env" ? "external (env)" : "external (PATH)");
}

async function audiocppModelMain(
  cmd: "install" | "status",
  values: { version?: string; backend?: string },
): Promise<number> {
  audiocppConfig(); // establishes the data dir the binary installs under

  if (cmd === "status") {
    const s = await audiocppBinary.status();
    if (!s.installed) {
      console.log("audio.cpp: not installed. Run `konchi model install audiocpp`.");
      return 1;
    }
    console.log(`audio.cpp: ${binaryLabel(s)} (${s.backend}) -> ${s.path}`);
    return 0;
  }

  try {
    const binary = await audiocppBinary.install(
      values.version ?? audiocppBinary.DEFAULT_VERSION,
      values.backend ?? null,
      printProgress,
    );
    console.log(`\nInstalled -> ${binary}`);
    return 0;
  } catch (exc) {
    return fail(`\nerror: ${message(exc)}`);
  }
}

/** `konchi model install llm` installs the engine AND the default catalog
 *  model in one command — a working prompt assistant, not just a binary. Pass
 *  `--engine-only` to skip the weights (e.g. to pick a different model with
 *  `konchi model download llm:<id>` afterwards). */
async function llmModelMain(
  cmd: "install" | "status",
  values: { version?: string; backend?: string; "engine-only"?: boolean; model?: string },
): Promise<number> {
  const config = audiocppConfig();

  if (cmd === "status") {
    const s = await llamaServerBinary.status();
    if (!s.installed) {
      console.log("llm engine: not installed. Run `konchi model install llm`.");
    } else {
      console.log(`llm engine: ${binaryLabel(s)} (${s.backend}) -> ${s.path}`);
    }
    for (const spec of LLM_MODELS) {
      const downloaded = (await isDownloaded(config.paths.models, spec)) ? "downloaded" : "not downloaded";
      console.log(`  ${spec.id.padEnd(16)} ${downloaded.padEnd(15)} ${spec.name}`);
    }
    return s.installed ? 0 : 1;
  }

  try {
    const binary = await llamaServerBinary.install(
      values.version ?? llamaServerBinary.DEFAULT_VERSION,
      values.backend ?? null,
      printProgress,
    );
    console.log(`\nInstalled -> ${binary}`);
  } catch (exc) {
    return fail(`\nerror: ${message(exc)}`);
  }

  if (values["engine-only"]) return 0;

  const wantedId = values.model ?? config.settings.llm_model;
  const spec = llmModelSpec(wantedId) ?? LLM_MODELS.find((m) => m.recommended)!;
  if (values.model && !llmModelSpec(values.model)) {
    return fail(
      `error: unknown model '${values.model}'. Available: ${LLM_MODELS.map((m) => m.id).join(", ")}`,
    );
  }
  if (await isDownloaded(config.paths.models, spec)) {
    console.log(`${spec.id} is already downloaded.`);
    return 0;
  }
  try {
    console.log();
    await downloadWeights(config.paths.models, spec, config.settings.effectiveHfToken(), printProgress);
    console.log(`\nDownloaded ${spec.id}.`);
  } catch (exc) {
    return fail(`\nerror: ${message(exc)}`);
  }
  return 0;
}

/* ------------------------------------------------------------- model admin */

class ExitCode extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** A live AudioCppModel for `modelId`, headless (no server). */
function modelModel(modelId: string): audiocpp.AudioCppModel {
  const spec = audiocpp.catalogById().get(modelId);
  if (spec === undefined) {
    process.stderr.write(
      `error: unknown model '${modelId}'. Run \`konchi list\` to see the catalog.\n`,
    );
    throw new ExitCode(1);
  }
  const config = audiocppConfig();
  return new audiocpp.AudioCppModel(
    spec,
    config.paths.models,
    config.settings.effectiveHfToken(),
    config.settings.effectiveAudiocppModelsDir(config.paths),
  );
}

async function listMain(): Promise<number> {
  audiocppConfig();
  for (const spec of audiocpp.catalog()) {
    const eng = modelModel(spec.id);
    const downloaded = (await eng.isDownloaded()) ? "downloaded" : "not downloaded";
    const tag =
      spec.source === "custom"
        ? "  [custom - from your custom.json]"
        : spec.verified
          ? ""
          : "  [unverified - opt in via Settings to use in the app]";
    console.log(`${spec.id.padEnd(38)} ${downloaded.padEnd(15)} ${spec.name}${tag}`);
  }
  return 0;
}

async function pullMain(argv: string[]): Promise<number> {
  const modelId = argv[0];
  if (!modelId) return fail("error: konchi pull: model_id is required");
  const eng = modelModel(modelId);
  if (await eng.isDownloaded()) {
    console.log(`${modelId} is already downloaded.`);
    return 0;
  }
  try {
    await eng.download(printProgress);
  } catch (exc) {
    return fail(`\nerror: ${message(exc)}`);
  }
  console.log(`\nPulled ${modelId}.`);
  return 0;
}

async function rmMain(argv: string[]): Promise<number> {
  const modelId = argv[0];
  if (!modelId) return fail("error: konchi rm: model_id is required");
  const eng = modelModel(modelId);
  const weightsDir = eng.weightsDir();
  if (!existsSync(weightsDir)) {
    console.log(`${modelId} is not downloaded.`);
    return 0;
  }
  rmSync(weightsDir, { recursive: true, force: true });
  console.log(`Removed ${weightsDir}`);
  return 0;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const reply = await rl.question(question);
    return ["y", "yes"].includes(reply.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function runMain(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      duration: { type: "string" },
      seed: { type: "string" },
      steps: { type: "string" },
      cfg: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
    },
    allowPositionals: true,
  });
  const [modelId, prompt] = positionals;
  if (!modelId || prompt === undefined) {
    return fail("error: konchi run: model_id and prompt are required");
  }
  // parseArgs has no numeric types, so the conversions argparse did for us
  // happen here; NaN would silently become a bad flag value downstream.
  const num = (raw: string | undefined, flag: string): number | null => {
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new ExitCode(fail(`error: --${flag} must be a number`));
    return value;
  };
  const duration = num(values.duration, "duration");
  const seed = num(values.seed, "seed");
  const steps = num(values.steps, "steps");
  const cfg = num(values.cfg, "cfg");

  const eng = modelModel(modelId);
  if (!(await eng.isDownloaded())) {
    if (!values.yes) {
      const vramMb = eng.describe().vram_estimate_mb;
      const ok = await confirm(
        `${modelId} is not downloaded. Pull it now (${vramMb} MB+ weights)? [y/N] `,
      );
      if (!ok) {
        console.log("Aborted.");
        return 1;
      }
    }
    try {
      await eng.download(printProgress);
      console.log();
    } catch (exc) {
      return fail(`\nerror: ${message(exc)}`);
    }
  }

  const info = eng.describe();
  const effectiveDuration = duration ?? info.defaults.duration_s ?? 10.0;
  const outPath = values.out ? resolve(values.out) : resolve(`${modelId}.wav`);

  try {
    await eng.load(printProgress);
    console.log();
    const { audio, sampleRate } = await eng.generate(prompt, effectiveDuration, {
      seed,
      steps,
      cfg,
      progress: printProgress,
    });
    writeWav(outPath, audio, sampleRate);
  } catch (exc) {
    return fail(`\nerror: ${message(exc)}`);
  }
  console.log(`\nWrote ${outPath}`);
  return 0;
}

/* ---------------------------------------------------------------------- ps */

async function psMain(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: "string", default: DEFAULT_HOST },
      port: { type: "string", default: String(DEFAULT_PORT) },
    },
    allowPositionals: true,
  });
  const url = `http://${values.host}:${values.port}/models`;
  let models: { id: string; name: string; status?: string }[];
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    models = (await resp.json()) as typeof models;
  } catch (exc) {
    return fail(
      `error: could not reach a running konchi server at ${values.host}:${values.port} ` +
        `(${message(exc)})`,
    );
  }
  const loaded = models.filter((e) => e.status === "loaded");
  if (loaded.length === 0) {
    console.log("(nothing loaded)");
    return 0;
  }
  for (const e of loaded) console.log(`${e.id.padEnd(38)} ${e.name}`);
  return 0;
}

/* -------------------------------------------------------------- enhance */

/** Hits a running server's `POST /api/enhance` — headless prompt enhancement
 *  for scripting, same "talk to the server, don't reimplement it" approach
 *  `psMain` uses. */
async function enhanceMain(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      host: { type: "string", default: DEFAULT_HOST },
      port: { type: "string", default: String(DEFAULT_PORT) },
      n: { type: "string", default: "1" },
      category: { type: "string" },
    },
    allowPositionals: true,
  });
  const prompt = positionals.join(" ");
  if (!prompt) return fail("error: konchi enhance: a prompt is required");
  const n = Number(values.n);
  if (!Number.isInteger(n) || n < 1 || n > 5) return fail("error: --n must be an integer 1-5");

  const url = `http://${values.host}:${values.port}/api/enhance`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Konchi": "1" },
      body: JSON.stringify({ prompt, n, category: values.category }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await resp.json()) as { variations?: string[]; detail?: string };
    if (!resp.ok) return fail(`error: ${body.detail ?? `HTTP ${resp.status}`}`);
    for (const v of body.variations ?? []) console.log(v);
    return 0;
  } catch (exc) {
    return fail(
      `error: could not reach a running konchi server at ${values.host}:${values.port} ` +
        `(${message(exc)})`,
    );
  }
}

/* ------------------------------------------------------------------ server */

const USAGE = `usage: konchi [--host HOST] [--port PORT] [--data-dir DIR] [--no-ui]
                [--profile NAME] [--log-level LEVEL] [--version]

Local sound-effects generation server (HTTP + MCP).

  --host       default ${DEFAULT_HOST}
  --port       default ${DEFAULT_PORT}
  --data-dir   default ~/.konchi
  --profile    library to open (default: whichever was last active)
  --no-ui      serve the API only
  --log-level  debug|info|warning|error|critical (default: KONCHI_LOG_LEVEL,
               else info)

Also: \`konchi model install audiocpp\` to install the audio.cpp runtime,
\`konchi pull|list|rm|run|ps\` to manage audio.cpp models without the server
or app running, \`konchi model install llm\` to install the local prompt
assistant (engine + default model), \`konchi enhance "prompt" [--n N]
[--category sfx|music]\` to rewrite a prompt via a running server, and
\`konchi skills list|install|path\` for bundled agent skills.`;

async function serveMain(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: "string", default: DEFAULT_HOST },
      port: { type: "string", default: String(DEFAULT_PORT) },
      "data-dir": { type: "string" },
      profile: { type: "string" },
      "no-ui": { type: "boolean", default: false },
      "log-level": { type: "string" },
      version: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.version) {
    console.log(`konchi ${VERSION}`);
    return 0;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port)) return fail("error: --port must be an integer");
  const host = values.host;

  const config = new Config(values["data-dir"], values.profile);
  setConfig(config);

  // One file per instance, not per data directory. Two Konchi processes
  // sharing a data dir would interleave their lines into one file — which looks
  // like duplicate output — while both trying to rotate it at 10MB, which is a
  // genuine race over the rename.
  const logPath = resolve(config.paths.root, `konchi-${port}.log`);
  const logLevel = resolveLogLevel(values["log-level"]);
  configureLogging(logLevel.level, logPath);
  if (logLevel.invalid !== null) {
    log.warning(
      `Unknown log level "${logLevel.invalid}" from ` +
        `${logLevel.source === "flag" ? "--log-level" : "KONCHI_LOG_LEVEL"}; using info. ` +
        `Valid levels: ${LOG_LEVELS.join(", ")}.`,
    );
  }
  // Fastify's own request logging is one line per request — every UI poll tick —
  // which drowns the throttled, job-tagged lines that actually tell the story.
  setLoggerLevel("fastify", "warning");

  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    log.warning(
      `Binding ${host} exposes Konchi beyond this machine. There is no authentication; ` +
        `anyone who can reach this port can generate audio and read your library.`,
    );
  }

  // A deliberate non-loopback bind adds that host to the Host-header allowlist
  // (DNS-rebinding defence in app.ts); a wildcard bind can be reached under any
  // name, so it turns the check off — the warning above already applies.
  const wildcard = ["0.0.0.0", "::", "[::]"].includes(host);
  const app = await buildApp(config, {
    serveUi: !values["no-ui"],
    allowedHosts: wildcard ? "any" : [host],
  });
  console.log(`\n  Konchi ${VERSION}  ->  http://${host}:${port}`);
  console.log(`  MCP endpoint       ->  http://${host}:${port}/mcp`);
  console.log(`  Profile            ->  ${config.profile}`);
  console.log(`  Data directory     ->  ${config.paths.root}`);
  console.log(`  Log file           ->  ${logPath}`);
  console.log(
    `  Log level          ->  ${logLevel.level}` +
      (logLevel.source === "env" && !logLevel.invalid ? " (KONCHI_LOG_LEVEL)" : "") +
      "\n",
  );
  await app.listen({ host, port });
  closeOnSignals(app);
  return 0;
}

/** How long a graceful shutdown may take before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

/**
 * Shut down properly on Ctrl+C, a service manager's SIGTERM, or Windows'
 * Ctrl+Break.
 *
 * Node's default for these is to die on the spot, which skips every onClose
 * hook: the audio.cpp, llama-server and sd-server children the service
 * started are left running (holding the GPU and their ports for the next
 * launch to trip over), MCP streams are cut rather than ended, and SQLite
 * never gets its close. `app.close()` runs all of that. If something in it
 * hangs, the timer makes sure the process still goes; a second signal skips
 * the wait entirely.
 */
function closeOnSignals(app: { close(): Promise<unknown> }): void {
  let closing = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (closing) {
      process.exit(1);
    }
    closing = true;
    log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => {
      log.warning(`shutdown took over ${SHUTDOWN_GRACE_MS / 1000}s; exiting anyway`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    app.close().then(
      () => process.exit(0),
      (exc: unknown) => {
        log.warning(`error during shutdown: ${message(exc)}`);
        process.exit(1);
      },
    );
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  if (process.platform === "win32") signals.push("SIGBREAK");
  for (const signal of signals) process.on(signal, onSignal);
}

/* -------------------------------------------------------------------- main */

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    switch (argv[0]) {
      case "skills":
        return await skillsMain(argv.slice(1));
      case "model":
        return await modelMain(argv.slice(1));
      case "list":
        return await listMain();
      case "pull":
        return await pullMain(argv.slice(1));
      case "rm":
        return await rmMain(argv.slice(1));
      case "run":
        return await runMain(argv.slice(1));
      case "ps":
        return await psMain(argv.slice(1));
      case "enhance":
        return await enhanceMain(argv.slice(1));
      default:
        return await serveMain(argv);
    }
  } catch (exc) {
    if (exc instanceof ExitCode) return exc.code;
    return fail(`error: ${message(exc)}`);
  }
}

// Run only as the binary, not when imported by a test. `.ts` covers `tsx`.
const invokedDirectly = /\/cli\.(js|ts)$/.test(import.meta.url);
if (invokedDirectly) {
  const code = await main();
  // The server path never returns while listening; anything else is done.
  if (code !== 0) process.exit(code);
}
