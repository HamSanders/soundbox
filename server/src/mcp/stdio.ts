#!/usr/bin/env node
/**
 * Stdio MCP bridge for clients that cannot speak streamable HTTP.
 *
 * This does NOT load models. It is a thin proxy onto a running Konchi server —
 * one GPU, one process holding the weights. If the server isn't running, tools
 * return an actionable error rather than silently starting a second copy.
 *
 * Configure it as:
 *
 *     { "mcpServers": { "konchi": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/soundbox/server/dist/mcp/stdio.js"] } } }
 *
 * Prefer the HTTP endpoint (http://127.0.0.1:17494/mcp) where your client supports it.
 *
 * Calls made through this bridge are reported to the server (`POST /api/mcp/calls`)
 * so they show up on the Agents page with `transport: stdio`, attributed to the
 * client that connected to the bridge — the server itself only ever sees the
 * bridge's HTTP requests.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { DEFAULT_HOST, DEFAULT_PORT, VERSION } from "../config.js";
import { ProgressReporter } from "./progress.js";
import { MCP_INSTRUCTIONS } from "./server.js";
import { envVar } from "../env.js";

const BASE_URL = envVar("KONCHI_URL") || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
const NOT_RUNNING =
  `Cannot reach the Konchi server at ${BASE_URL}. Start it with \`npx konchi\` ` +
  `(or open the Konchi app), then try again. Set KONCHI_URL if it listens elsewhere.`;

/** Generation is slow by nature; a short timeout here would look like a bug. */
const REQUEST_TIMEOUT_MS = 900_000;

async function request(
  method: string,
  path: string,
  opts: { json?: unknown; params?: Record<string, unknown> } = {},
): Promise<any> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // X-Konchi marks this as a deliberate API call — the server refuses
      // body-less mutating requests without it (CSRF defence, see app.ts).
      headers:
        opts.json === undefined
          ? { "x-konchi": "1" }
          : { "content-type": "application/json", "x-konchi": "1" },
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (exc) {
    // Any transport-level failure means "no server there" as far as the agent
    // is concerned; the actionable message beats ECONNREFUSED.
    throw new Error(NOT_RUNNING, { cause: exc });
  }
  if (response.status >= 400) {
    const body = await response.text();
    let detail = body;
    try {
      detail = (JSON.parse(body) as { detail?: string }).detail ?? body;
    } catch {
      /* not JSON — use the raw text */
    }
    throw new Error(`Konchi error (${response.status}): ${detail}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

interface CallReport {
  status: "ok" | "error";
  error?: string;
  job_id?: string;
  sound_ids?: string[];
  duration_ms?: number;
}

/**
 * Best-effort call reporting to the server. Never fails the tool call — if the
 * server can't be reached the tool body raises its own clearer error.
 */
async function report<T>(
  tool: string,
  args: Record<string, unknown>,
  client: { name: string | null; version: string | null },
  fn: (rep: CallReport) => Promise<T>,
): Promise<T> {
  const id = randomUUID();
  const call = {
    id,
    ts: new Date().toISOString(),
    tool,
    status: "running",
    client_name: client.name,
    client_version: client.version,
    transport: "stdio",
    args: Object.fromEntries(
      Object.entries(args).filter(([, v]) => v !== null && v !== undefined),
    ),
  };
  await request("POST", "/api/mcp/calls", { json: call }).catch(() => undefined);
  const t0 = performance.now();
  const rep: CallReport = { status: "ok" };
  try {
    return await fn(rep);
  } catch (exc) {
    rep.status = "error";
    const name = exc instanceof Error ? exc.name : "Error";
    const message = exc instanceof Error ? exc.message : String(exc);
    rep.error = `${name}: ${message}`.slice(0, 500);
    throw exc;
  } finally {
    rep.duration_ms = Math.round(performance.now() - t0);
    await request("PATCH", `/api/mcp/calls/${id}`, { json: rep }).catch(() => undefined);
  }
}

function json(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function build(): McpServer {
  const mcp = new McpServer(
    { name: "konchi", version: VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  /** Whoever connected to *this bridge* — the server only sees our requests. */
  const clientOf = () => {
    const info = mcp.server.getClientVersion();
    return { name: info?.name || null, version: info?.version || null };
  };

  mcp.registerTool(
    "konchi.enhance_prompt",
    {
      title: "Rewrite a prompt for a sound model",
      description:
        "Rewrite a short or abstract prompt into a concrete, descriptive one, " +
        "grounded in the target model's own prompting conventions if you pass " +
        "`model`. Only works when the user has enabled the local prompt assistant.",
      inputSchema: {
        prompt: z.string().min(1).max(2000),
        n: z.number().int().min(1).max(5).default(1),
        category: z.enum(["sfx", "music"]).optional(),
        lyrics: z.boolean().optional(),
        model: z
          .string()
          .optional()
          .describe("The model id you intend to pass to konchi.generate."),
      },
    },
    async ({ prompt, n, category, lyrics, model }) =>
      await report("konchi.enhance_prompt", { prompt, n, category, model }, clientOf(), async () => {
        try {
          const body = await request("POST", "/api/enhance", {
            json: { prompt, n, category, lyrics, model },
          });
          return json({ variations: body.variations, tags: body.tags });
        } catch (exc) {
          // Same graceful-degrade as the HTTP-transport tool: "off" is normal,
          // not a broken call.
          return { content: [{ type: "text" as const, text: exc instanceof Error ? exc.message : String(exc) }] };
        }
      }),
  );

  mcp.registerTool(
    "konchi.generate",
    {
      title: "Generate a sound effect",
      description: "Generate sound effects and save them to the Konchi library.",
      inputSchema: {
        prompt: z
          .string()
          .describe(
            "Describe material, action and space. For a lyrics-conditioned model " +
              "(see `lyrics`), this instead sets the genre and instrumentation.",
          ),
        duration_s: z.number().min(0.5).max(300).default(5.0),
        model: z.string().optional(),
        negative_prompt: z.string().optional(),
        seed: z.number().int().min(0).optional(),
        variations: z.number().int().min(1).max(4).default(1),
        tags: z.array(z.string()).optional(),
        lyrics: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Words for a lyrics-conditioned vocal music model (ACE-Step) to sing. " +
              "Ignored by models that don't support lyrics. Omit for instrumental.",
          ),
        track_name: z.string().max(200).optional().describe("Optional track title."),
        source_sound_id: z
          .string()
          .optional()
          .describe("Edit an existing library sound (pair with `edit`); needs a model with supports.<edit>."),
        edit: z
          .enum(["extend", "cover", "repaint"])
          .optional()
          .describe(
            "'extend' continues the source to `duration_s` total; 'cover' re-renders it in the " +
              "style of `prompt` at the same length; 'repaint' redoes edit_options' window.",
          ),
        edit_options: z
          .object({
            cover_strength: z.number().min(0).max(1).optional(),
            repaint_start_s: z.number().min(0).optional(),
            repaint_end_s: z.number().min(0).optional(),
            repaint_mode: z.enum(["balanced", "conservative", "aggressive"]).optional(),
            repaint_strength: z.number().min(0).max(1).optional(),
          })
          .optional(),
      },
    },
    async (args, extra) => {
      const {
        prompt, duration_s, negative_prompt, seed, variations, tags, lyrics, track_name,
        source_sound_id, edit, edit_options,
      } = args;
      let model: string | undefined = args.model;
      const client = clientOf();
      return await report(
        "konchi.generate",
        {
          prompt, duration_s, model, negative_prompt, seed, variations, tags, lyrics, track_name,
          source_sound_id, edit, edit_options,
        },
        client,
        async (rep) => {
          if (model === undefined) {
            const health = await request("GET", "/api/health");
            model = health.loaded_model ?? undefined;
          }
          if (model === undefined || model === null) {
            const models = await request("GET", "/api/models");
            const ready = models.filter(
              (e: { status: string }) => e.status === "installed" || e.status === "loaded",
            );
            if (!ready.length) {
              throw new Error(
                "No model is installed. Open Konchi and download one from the " +
                  "Models tab first.",
              );
            }
            model = ready[0].id;
          }

          const body = {
            model,
            prompt,
            negative_prompt: negative_prompt ?? null,
            duration_s,
            seed: seed ?? null,
            variations,
            tags: tags ?? [],
            lyrics: lyrics ?? null,
            track_name: track_name ?? null,
            source_sound_id: source_sound_id ?? null,
            edit: edit ?? null,
            edit_options: edit_options ?? null,
            origin: {
              source: "mcp",
              client_name: client.name,
              client_version: client.version,
            },
          };
          const jobId: string = (await request("POST", "/api/generate", { json: body })).job_id;
          rep.job_id = jobId;

          // The server sees only our HTTP polls, so progress for the stdio
          // client has to come from here: relay what each poll says.
          const progress = new ProgressReporter(extra);
          const deadline = performance.now() + 900_000;
          while (performance.now() < deadline) {
            const job = await request("GET", `/api/jobs/${jobId}`);
            progress.job(job);
            if (job.status === "done") {
              const ids: string[] = job.result?.sounds ?? [];
              rep.sound_ids = ids;
              const sounds = [];
              for (const i of ids) sounds.push(await request("GET", `/api/sounds/${i}`));
              return json({ model, sounds });
            }
            if (job.status === "error") throw new Error(job.error || "Generation failed");
            if (job.status === "cancelled") throw new Error("Generation was cancelled");
            await new Promise((r) => setTimeout(r, 400));
          }
          await request("POST", `/api/jobs/${jobId}/cancel`);
          throw new Error("Generation did not finish within 15 minutes");
        },
      );
    },
  );

  mcp.registerTool(
    "konchi.list_models",
    {
      title: "List sound models",
      description: "List models with status and licence. Check commercial use terms.",
    },
    async () =>
      await report("konchi.list_models", {}, clientOf(), async () => {
        const models = await request("GET", "/api/models");
        return json(
          models.map((e: any) => ({
            id: e.id,
            name: e.name,
            vendor: e.vendor,
            status: e.status,
            license: e.license.name,
            commercial_use: e.license.commercial,
            max_duration_s: e.max_duration_s,
            sample_rate: e.sample_rate,
          })),
        );
      }),
  );

  mcp.registerTool(
    "konchi.list_sounds",
    {
      title: "Search the sound library",
      description: "Search previously generated sounds before generating something new.",
      inputSchema: {
        q: z.string().optional(),
        tag: z.string().optional(),
        voice_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ q, tag, voice_id, limit }) =>
      await report("konchi.list_sounds", { q, tag, voice_id, limit }, clientOf(), async (rep) => {
        const page = await request("GET", "/api/sounds", {
          params: { q, tag, voice_id, limit },
        });
        const items = page.items;
        rep.sound_ids = items.map((s: { id: string }) => s.id);
        return json(items);
      }),
  );

  mcp.registerTool(
    "konchi.get_sound",
    { title: "Get one sound", description: "Fetch a single sound by id.", inputSchema: { sound_id: z.string() } },
    async ({ sound_id }) =>
      await report("konchi.get_sound", { sound_id }, clientOf(), async (rep) => {
        rep.sound_ids = [sound_id];
        return json(await request("GET", `/api/sounds/${sound_id}`));
      }),
  );

  mcp.registerTool(
    "konchi.delete_sound",
    {
      title: "Delete a sound",
      description: "Permanently delete a sound and its audio file.",
      inputSchema: { sound_id: z.string() },
    },
    async ({ sound_id }) =>
      await report("konchi.delete_sound", { sound_id }, clientOf(), async (rep) => {
        rep.sound_ids = [sound_id];
        await request("DELETE", `/api/sounds/${sound_id}`);
        return { content: [{ type: "text" as const, text: `Deleted ${sound_id}` }] };
      }),
  );

  return mcp;
}

export async function main(): Promise<void> {
  await build().connect(new StdioServerTransport());
}

// Only when launched as the `konchi-mcp` binary, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
