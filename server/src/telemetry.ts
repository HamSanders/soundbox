/**
 * MCP call telemetry: the record of what agents did through Konchi.
 *
 * Three consumers, one source of truth:
 *
 * 1. **The Agents page.** Every tool call is written to the `mcp_calls` table
 *    (see `db.ts`) and pushed to live subscribers over SSE, so the app can show
 *    "Claude Code called konchi.generate 4s ago → 2 sounds" the moment it
 *    happens, and still show it tomorrow.
 * 2. **The log file.** One structured line per call, so grepping the server log
 *    gives the same trail without the app.
 * 3. **OpenTelemetry.** Reported but not implemented — see `OtelBridge` below.
 *
 * The telemetry object is owned by the service; the MCP tools wrap themselves
 * in `telemetry.track(...)`.
 */

import { randomUUID } from "node:crypto";

import { trace, type Counter, type Histogram, type Span } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import type { Config } from "./config.js";
import { VERSION } from "./config.js";
import { AsyncQueue } from "./jobs.js";
import { getLogger } from "./logging.js";
import type { McpCall, OtelStatus } from "./schemas.js";

// Every MCP call gets one structured line here — same file the jobs queue
// writes to, same reason: `grep mcp konchi.log` and the Activity page's
// tail both depend on this actually reaching the rotating file rather than
// console.info, which doesn't.
const _logger = getLogger("konchi.telemetry");
const log = { info: (msg: string) => _logger.info(msg), warn: (msg: string) => _logger.warning(msg) };

/** A client counts as "active" if it made a call within this window. */
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
/** Long argument strings are truncated for display; the log/DB row is not the
 *  place to store a 2000-character prompt four times over. */
const ARG_MAX = 300;
/** Retention for the persisted call log. */
const KEEP_CALLS = 5000;

const SERVICE_NAME = "konchi";

/** The slice of the database this module needs, so telemetry can be constructed
 *  with any conforming store (and tested with a fake). */
export interface TelemetryDatabase {
  insertMcpCall(call: McpCall): void;
  finishMcpCall(call: McpCall): void;
  pruneMcpCalls(keep: number): number;
}

function now(): string {
  return new Date().toISOString();
}

function trimArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" && v.length > ARG_MAX ? `${v.slice(0, ARG_MAX - 1)}…` : v;
  }
  return out;
}

/** The span interface the rest of this module codes against. */
export interface TelemetrySpan {
  setAttribute(key: string, value: unknown): void;
  recordException(exc: unknown): void;
  setStatusError(message: string): void;
  end(): void;
}

class NoopSpan implements TelemetrySpan {
  setAttribute(): void {}
  recordException(): void {}
  setStatusError(): void {}
  end(): void {}
}

/** Wraps a real OTel `Span` behind the narrow interface the rest of this
 *  module codes against, so callers never touch the SDK directly. */
class RealSpan implements TelemetrySpan {
  constructor(private readonly span: Span) {}

  setAttribute(key: string, value: unknown): void {
    if (value === null || value === undefined) return;
    this.span.setAttribute(key, value as string | number | boolean);
  }

  recordException(exc: unknown): void {
    this.span.recordException(exc instanceof Error ? exc : String(exc));
  }

  setStatusError(message: string): void {
    this.span.setStatus({ code: 2 /* SpanStatusCode.ERROR */, message });
  }

  end(): void {
    this.span.end();
  }
}

interface Metrics {
  callCounter: Counter;
  durationHistogram: Histogram;
  soundsCounter: Counter;
}

/**
 * Bridges MCP call telemetry to a real OTLP/HTTP collector — traces on
 * `/v1/traces`, metrics on `/v1/metrics`. `@opentelemetry/sdk-trace-node` and
 * the OTLP HTTP exporters are ordinary dependencies of this package (see
 * `package.json`), not an optional extra: there's nothing for a Node user to
 * separately install, so wiring an endpoint in Settings is enough to start
 * exporting.
 */
export class OtelBridge {
  status: OtelStatus;
  private readonly config: Config;
  private tracerProvider: NodeTracerProvider | null = null;
  private meterProvider: MeterProvider | null = null;
  private tracer = trace.getTracer(SERVICE_NAME, VERSION);
  private metrics: Metrics | null = null;

  constructor(config: Config) {
    this.config = config;
    this.status = this.buildStatus();
    this.setup();
  }

  private buildStatus(): OtelStatus {
    const [endpoint, source] = this.config.settings.effectiveOtelEndpoint();
    return {
      enabled: Boolean(endpoint),
      installed: true,
      endpoint,
      source,
      service_name: SERVICE_NAME,
      error: null,
    };
  }

  private setup(): void {
    this.teardown();
    const { endpoint } = this.status;
    if (!endpoint) return;
    try {
      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: VERSION,
      });

      const tracerProvider = new NodeTracerProvider({
        resource,
        spanProcessors: [
          new BatchSpanProcessor(
            new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }),
          ),
        ],
      });
      tracerProvider.register();
      this.tracerProvider = tracerProvider;
      this.tracer = trace.getTracer(SERVICE_NAME, VERSION);

      const meterProvider = new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/metrics` }),
            exportIntervalMillis: 10_000,
          }),
        ],
      });
      this.meterProvider = meterProvider;
      const meter = meterProvider.getMeter(SERVICE_NAME, VERSION);
      this.metrics = {
        callCounter: meter.createCounter("konchi.mcp.calls", {
          description: "Number of MCP tool calls",
        }),
        durationHistogram: meter.createHistogram("konchi.mcp.call.duration", {
          description: "MCP tool call duration",
          unit: "ms",
        }),
        soundsCounter: meter.createCounter("konchi.mcp.sounds_generated", {
          description: "Sounds produced by MCP tool calls",
        }),
      };

      log.info(`OTel export enabled → ${endpoint} (source=${this.status.source})`);
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      this.status = { ...this.status, enabled: false, error: message };
      log.warn(`could not set up OTel export for ${endpoint}: ${message}`);
      this.teardown();
    }
  }

  private teardown(): void {
    this.tracerProvider?.shutdown().catch(() => {});
    this.meterProvider?.shutdown().catch(() => {});
    this.tracerProvider = null;
    this.meterProvider = null;
    this.metrics = null;
  }

  /** Re-read the endpoint after a settings change and rebuild exporters. */
  reconfigure(): OtelStatus {
    this.status = this.buildStatus();
    this.setup();
    return this.status;
  }

  close(): void {
    this.teardown();
  }

  span(name: string, attributes: Record<string, unknown>): { span: TelemetrySpan; traceId: string | null } {
    if (!this.metrics) return { span: new NoopSpan(), traceId: null };
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== null && v !== undefined) clean[k] = v as string | number | boolean;
    }
    const span = this.tracer.startSpan(name, { attributes: clean });
    const traceId = span.spanContext().traceId || null;
    return { span: new RealSpan(span), traceId };
  }

  recordCall(attrs: Record<string, unknown>, durationMs: number, sounds: number): void {
    if (!this.metrics) return;
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined) clean[k] = v as string | number | boolean;
    }
    this.metrics.callCounter.add(1, clean);
    this.metrics.durationHistogram.record(durationMs, clean);
    if (sounds > 0) this.metrics.soundsCounter.add(sounds, clean);
  }
}

/**
 * Mutable handle for one in-flight call, handed to the tool body so it can
 * attach the job id and resulting sound ids before the record is finalised.
 */
export class CallRecord {
  readonly call: McpCall;
  readonly span: TelemetrySpan;
  private readonly t0: number;

  constructor(call: McpCall, span: TelemetrySpan, t0: number) {
    this.call = call;
    this.span = span;
    this.t0 = t0;
  }

  setJob(jobId: string): void {
    this.call.job_id = jobId;
    this.span.setAttribute("konchi.job.id", jobId);
  }

  setSounds(soundIds: string[]): void {
    this.call.sound_ids = [...soundIds];
    this.span.setAttribute("konchi.sound.count", soundIds.length);
    this.span.setAttribute("konchi.sound.ids", soundIds.join(","));
  }

  setModel(modelId: string): void {
    this.span.setAttribute("konchi.model", modelId);
  }

  elapsedMs(): number {
    return Math.round(performance.now() - this.t0);
  }
}

export interface TrackOptions {
  clientName?: string | null;
  clientVersion?: string | null;
  sessionId?: string | null;
  transport?: "http" | "stdio";
}

export class McpTelemetry {
  /** Not `readonly`: a profile switch hands this a different database while
   *  the OTel bridge, the live subscribers and the in-flight calls carry on —
   *  recreating the whole telemetry object would drop every SSE watcher and
   *  tear down an export pipeline that has nothing to do with which library
   *  is open. */
  db: TelemetryDatabase;
  readonly otel: OtelBridge;
  private readonly subscribers: AsyncQueue<McpCall>[] = [];
  private readonly runningCalls = new Map<string, McpCall>();

  constructor(db: TelemetryDatabase, config: Config) {
    this.db = db;
    this.otel = new OtelBridge(config);
    try {
      this.db.pruneMcpCalls(KEEP_CALLS);
    } catch {
      // Retention is best-effort; a pruning failure must not stop startup.
    }
  }

  close(): void {
    this.otel.close();
  }

  /** Record subsequent calls into `db` instead. Used by a profile switch;
   *  calls already in flight finish against whichever database they started
   *  on, which is the honest place for them. */
  useDatabase(db: TelemetryDatabase): void {
    this.db = db;
    try {
      this.db.pruneMcpCalls(KEEP_CALLS);
    } catch {
      // Best-effort, as at construction.
    }
  }

  // ------------------------------------------------------------- recording

  /**
   * Wrap one tool invocation. Records start/finish to the DB, publishes both to
   * live subscribers, writes a log line, and (when configured) emits an OTel
   * span + metrics. Exceptions propagate unchanged after being recorded — the
   * agent still gets the real error.
   */
  async track<T>(
    tool: string,
    args: Record<string, unknown>,
    opts: TrackOptions,
    fn: (rec: CallRecord) => Promise<T> | T,
  ): Promise<T> {
    const { clientName = null, clientVersion = null, sessionId = null, transport = "http" } = opts;
    const call: McpCall = {
      id: randomUUID(),
      ts: now(),
      tool,
      status: "running",
      client_name: clientName,
      client_version: clientVersion,
      session_id: sessionId,
      transport,
      args: trimArgs(args),
      duration_ms: null,
      error: null,
      job_id: null,
      sound_ids: [],
      trace_id: null,
    };
    const attrs: Record<string, unknown> = {
      "mcp.tool.name": tool,
      "mcp.client.name": clientName,
      "mcp.client.version": clientVersion,
      "mcp.session.id": sessionId,
      "mcp.transport": transport,
    };
    const t0 = performance.now();
    const { span, traceId } = this.otel.span(`mcp.tool ${tool}`, attrs);
    call.trace_id = traceId;
    const rec = new CallRecord(call, span, t0);
    this.persist(call, true);
    try {
      const result = await fn(rec);
      call.status = "ok";
      return result;
    } catch (exc) {
      call.status = "error";
      const name = exc instanceof Error ? exc.name : "Error";
      const message = exc instanceof Error ? exc.message : String(exc);
      call.error = `${name}: ${message}`.slice(0, 500);
      span.recordException(exc);
      span.setStatusError(message);
      throw exc;
    } finally {
      call.duration_ms = rec.elapsedMs();
      span.end();
      this.persist(call, false);
      const metricAttrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== null && v !== undefined) metricAttrs[k] = v;
      }
      metricAttrs.status = call.status;
      metricAttrs["konchi.model"] = String(call.args.model ?? "");
      this.otel.recordCall(metricAttrs, call.duration_ms, call.sound_ids.length);
      const client = `${clientName || "unknown"}${clientVersion ? `/${clientVersion}` : ""}`;
      log.info(
        `mcp ${call.tool} ${call.status} client=${client} session=${(sessionId || "-").slice(0, 8)} ` +
          `${call.duration_ms}ms` +
          (call.sound_ids.length ? ` sounds=${call.sound_ids.length}` : "") +
          (call.error ? ` error=${call.error}` : ""),
      );
    }
  }

  private persist(call: McpCall, isNew: boolean): void {
    if (isNew) this.runningCalls.set(call.id, call);
    else this.runningCalls.delete(call.id);
    try {
      if (isNew) this.db.insertMcpCall(call);
      else this.db.finishMcpCall(call);
    } catch (exc) {
      log.warn(
        `could not persist MCP call ${call.id}: ${exc instanceof Error ? exc.message : String(exc)}`,
      );
    }
    this.publish(call);
  }

  // ------------------------------------------- calls reported by the bridge

  /** A call proxied by the stdio bridge, reported over HTTP. Trusted the same
   *  as any local caller — this is a local, unauthenticated API. */
  recordExternal(call: McpCall): McpCall {
    const copy: McpCall = { ...structuredClone(call), status: "running", ts: call.ts || now() };
    this.persist(copy, true);
    return copy;
  }

  finishExternal(callId: string, patch: Partial<McpCall>): McpCall | null {
    const call = this.runningCalls.get(callId);
    if (!call) return null;
    const keys = ["status", "duration_ms", "error", "job_id", "sound_ids"] as const;
    for (const k of keys) {
      const value = patch[k];
      if (value !== undefined && value !== null) {
        (call as unknown as Record<string, unknown>)[k] = value;
      }
    }
    if (call.status === "running") call.status = "ok";
    this.persist(call, false);
    log.info(
      `mcp ${call.tool} ${call.status} client=${call.client_name || "unknown"} (stdio) ` +
        `${call.duration_ms ?? 0}ms` +
        (call.error ? ` error=${call.error}` : ""),
    );
    return call;
  }

  // -------------------------------------------------------------- queries

  running(): McpCall[] {
    return [...this.runningCalls.values()];
  }

  activeSince(): string {
    return new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  }

  // --------------------------------------------------------------- pub/sub

  subscribe(): AsyncQueue<McpCall> {
    const q = new AsyncQueue<McpCall>();
    this.subscribers.push(q);
    return q;
  }

  unsubscribe(q: AsyncQueue<McpCall>): void {
    const i = this.subscribers.indexOf(q);
    if (i !== -1) this.subscribers.splice(i, 1);
    q.close();
  }

  private publish(call: McpCall): void {
    if (!this.subscribers.length) return;
    for (const q of this.subscribers) q.push(structuredClone(call));
  }
}
