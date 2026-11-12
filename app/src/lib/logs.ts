/**
 * Reading the server's log.
 *
 * The backend writes a rotating file under the data directory and `/api/logs`
 * hands back its tail as a list of raw lines. Everything that turns those
 * lines into something you can look at lives here, because two places now
 * show them — the Activity page, and the studio's Logs panel — and a log
 * viewer that parses levels slightly differently from the other one is a
 * quiet way to make the same failure look like two.
 */

export type Level = "INFO" | "WARNING" | "ERROR" | "DEBUG" | "CRITICAL";

export interface LogEntry {
  key: number;
  time: string;
  level: Level | null;
  source: string;
  message: string;
  jobId: string | null;
  raw: string;
}

/** How often to re-read the tail while following. Matches the pace a
 *  generation actually emits lines at — throttled to ~10 per job — so
 *  anything faster is just load for no new information. */
export const LOG_POLL_MS = 2000;
/** How much of the tail to ask for. The panel in the studio is a corner of a
 *  column, but the lines it wants are the same ones. */
export const LOG_TAIL_LINES = 500;

/** `14:52:08 INFO    soundbox.jobs: job <uuid> 57% phase=generating Step 34/100` */
const LINE = /^(\d{2}:\d{2}:\d{2})\s+(\w+)\s+([\w.]+):\s*(.*)$/;
const JOB_ID = /\bjob ([0-9a-f]{8}-[0-9a-f-]{27})/i;

export function parseLog(lines: string[]): LogEntry[] {
  return lines.map((raw, i) => {
    const m = LINE.exec(raw);
    if (!m) {
      // Tracebacks and uvicorn's own access lines don't match; keep them
      // rather than dropping them — a stack trace is exactly what you came for.
      return { key: i, time: "", level: null, source: "", message: raw, jobId: null, raw };
    }
    const [, time, level, source, message] = m;
    return {
      key: i,
      time: time!,
      level: level as Level,
      source: source!.replace(/^soundbox\./, ""),
      message: message!,
      jobId: JOB_ID.exec(message!)?.[1] ?? null,
      raw,
    };
  });
}

export function isProblem(entry: LogEntry): boolean {
  return entry.level === "ERROR" || entry.level === "WARNING" || entry.level === "CRITICAL";
}

export const LEVEL_CLASS: Record<string, string> = {
  ERROR: "text-red-500",
  CRITICAL: "text-red-500",
  WARNING: "text-warn",
  INFO: "text-muted-foreground",
  DEBUG: "text-muted-foreground/60",
};
