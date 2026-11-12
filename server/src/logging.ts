/**
 * Console + rotating-file logging.
 *
 * What's needed here is small —
 * a level, a format, a
 * console handler and a size-rotating file handler — so this implements that
 * directly rather than pulling in a logging framework.
 *
 * Every job-related line is tagged with its job id (see jobs.ts), so
 * `grep <job-id>` over the file tells the whole story of one generation without
 * needing to poll the API by hand.
 */

import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { envVar } from "./env.js";

/**
 * Kept small on purpose — a job's progress lines are throttled, so even a long
 * run writes a handful of lines, not thousands. 3 x 10MB is months of normal
 * use.
 */
export const LOG_MAX_BYTES = 10_000_000;
export const LOG_BACKUP_COUNT = 3;

export type LogLevel = "debug" | "info" | "warning" | "error" | "critical";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  critical: 50,
};

let threshold = LEVELS.info;

/** Per-logger overrides, so one noisy source can be quietened without raising
 *  the global level (the Python did this for httpx). */
const overrides = new Map<string, number>();

interface FileSink {
  path: string;
  fd: number;
  size: number;
}

let sink: FileSink | null = null;

function parseLevel(name: string): number {
  return LEVELS[name.toLowerCase() as LogLevel] ?? LEVELS.info;
}

export const LOG_LEVELS = Object.keys(LEVELS) as LogLevel[];

/**
 * The level to run at: `--log-level` if given, else `KONCHI_LOG_LEVEL`, else
 * info.
 *
 * The environment variable exists because nothing that starts the server
 * passes the flag: not `npm run dev`, the Docker image or the desktop app.
 * All of them inherit the environment, so one variable reaches every one.
 * `"warn"` is accepted for `"warning"`, since that's what people type. An
 * unknown value is reported rather than silently treated as info, so a typo
 * doesn't look like "debug logging shows nothing new".
 */
export function resolveLogLevel(
  flag: string | undefined,
  env: string | undefined = envVar("KONCHI_LOG_LEVEL"),
): { level: LogLevel; source: "flag" | "env" | "default"; invalid: string | null } {
  const pick = (raw: string | undefined): LogLevel | null => {
    const v = raw?.trim().toLowerCase();
    if (!v) return null;
    if (v === "warn") return "warning";
    return (LOG_LEVELS as string[]).includes(v) ? (v as LogLevel) : null;
  };
  for (const [raw, source] of [
    [flag, "flag"],
    [env, "env"],
  ] as const) {
    if (raw === undefined || !raw.trim()) continue;
    const level = pick(raw);
    return level ? { level, source, invalid: null } : { level: "info", source, invalid: raw };
  }
  return { level: "info", source: "default", invalid: null };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function openSink(path: string): FileSink | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, "a");
    const size = existsSync(path) ? statSync(path).size : 0;
    return { path, fd, size };
  } catch (exc) {
    // Logging setup must not crash the server.
    console.warn(
      `${stamp()} WARNING konchi: could not open log file ${path} ` +
        `(${String(exc)}); logging to console only`,
    );
    return null;
  }
}

/** Size-check-and-rotate, matching RotatingFileHandler: `.log` -> `.log.1`,
 *  each backup shifting up one and the oldest dropped. */
function rotate(current: FileSink): void {
  closeSync(current.fd);
  rmSync(`${current.path}.${LOG_BACKUP_COUNT}`, { force: true });
  for (let i = LOG_BACKUP_COUNT - 1; i >= 1; i--) {
    const from = `${current.path}.${i}`;
    if (existsSync(from)) renameSync(from, `${current.path}.${i + 1}`);
  }
  renameSync(current.path, `${current.path}.1`);
  current.fd = openSync(current.path, "a");
  current.size = 0;
}

function emit(level: number, levelName: string, name: string, message: string): void {
  const effective = overrides.get(name) ?? threshold;
  if (level < effective) return;
  const line = `${stamp()} ${levelName.toUpperCase().padEnd(7)} ${name}: ${message}`;
  if (level >= LEVELS.warning) console.error(line);
  else console.log(line);
  if (sink === null) return;
  const bytes = Buffer.from(`${line}\n`, "utf-8");
  try {
    if (sink.size + bytes.length > LOG_MAX_BYTES) rotate(sink);
    writeSync(sink.fd, bytes);
    sink.size += bytes.length;
  } catch {
    // A full disk or a rotation losing a race with another process must not
    // take the server down; the console handler still has the line.
  }
}

export class Logger {
  constructor(private readonly name: string) {}

  debug(message: string): void {
    emit(LEVELS.debug, "debug", this.name, message);
  }
  info(message: string): void {
    emit(LEVELS.info, "info", this.name, message);
  }
  warning(message: string): void {
    emit(LEVELS.warning, "warning", this.name, message);
  }
  error(message: string): void {
    emit(LEVELS.error, "error", this.name, message);
  }
  critical(message: string): void {
    emit(LEVELS.critical, "critical", this.name, message);
  }
}

export function getLogger(name: string): Logger {
  return new Logger(name);
}

/** Raise the floor for one logger by name — the Python muted httpx this way. */
export function setLoggerLevel(name: string, level: string): void {
  overrides.set(name, parseLevel(level));
}

/**
 * Console + a rotating file at `logPath`. Calling twice re-points the file
 * sink rather than doubling every line, which is what adding a second set of
 * handlers in Python would have done — duplicate output reads as the server
 * doing everything twice.
 */
export function configureLogging(logLevel: string, logPath: string): void {
  threshold = parseLevel(logLevel);
  if (sink !== null) {
    try {
      closeSync(sink.fd);
    } catch {
      /* already gone */
    }
    sink = null;
  }
  sink = openSink(logPath);
  // service.tailLog() reads this to show the log in the app.
  process.env.KONCHI_LOG_FILE = logPath;
}
