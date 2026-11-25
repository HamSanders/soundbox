/**
 * The app's own MCP client: the in-app assistant reaches Mirli through the
 * same tools an outside agent does.
 *
 * One toolkit rather than two. Anything an agent connected over `/mcp` can
 * do, the assistant beside a book can propose, with the same names, the same
 * argument checks and the same results, and a tool added to `server.ts`
 * reaches both without a second vocabulary to keep in step.
 *
 * In-process over the SDK's in-memory transport (the tests use the same
 * pair), so there is no network hop and no port to know. The client names
 * itself "Mirli assistant", which is what the MCP activity log shows as the
 * caller of anything it runs.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { VERSION } from "../config.js";
import type { MirliService } from "../service.js";
import { buildMcp } from "./server.js";

export const ASSISTANT_CLIENT = "Mirli assistant";

/** A tool as the planner sees it: its name, what it does, and its arguments
 *  as JSON Schema (straight from the tool's zod input). */
export interface LocalTool {
  name: string;
  title: string | null;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

/** What a tool call answered: its text (JSON for every Mirli tool), parsed
 *  when it parses, and whether the tool reported an error. */
export interface LocalToolResult {
  isError: boolean;
  text: string;
  data: unknown;
}

const clients = new WeakMap<MirliService, Promise<Client>>();

function connect(svc: MirliService): Promise<Client> {
  let pending = clients.get(svc);
  if (!pending) {
    pending = (async () => {
      const server = buildMcp(() => svc);
      const client = new Client({ name: ASSISTANT_CLIENT, version: VERSION });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
      return client;
    })();
    // A failed connect is not cached: the next call tries again.
    pending.catch(() => clients.delete(svc));
    clients.set(svc, pending);
  }
  return pending;
}

/** Every tool the MCP server offers. */
export async function localTools(svc: MirliService): Promise<LocalTool[]> {
  const client = await connect(svc);
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    title: t.title ?? null,
    description: t.description ?? "",
    inputSchema: t.inputSchema as LocalTool["inputSchema"],
  }));
}

/** Run one tool. Throws only when the call could not be made at all; a tool
 *  that refuses comes back with `isError` and its own message. */
export async function callLocalTool(
  svc: MirliService,
  name: string,
  args: Record<string, unknown>,
): Promise<LocalToolResult> {
  const client = await connect(svc);
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = (res.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { isError: res.isError === true, text, data };
}
