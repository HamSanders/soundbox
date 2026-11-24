// LLM_PROVIDER=claude: replies come from your own signed-in Claude Code (`claude`), kept open with stream-json,
// behind an OpenAI-shaped endpoint on 127.0.0.1 that the rest of the worker uses like any other LLM. No API key:
// it runs on your Claude subscription, on your machine, for you. See live/voice/README.md before sharing a call.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

import { createBrain } from "./brain.mjs";
import { findClaude, openClaude } from "./claude-proc.mjs";

export async function startClaudeBrain({ port, model = "haiku", effort = "low", bin = process.env.CLAUDE_BIN || findClaude() } = {}) {
  if (!bin) throw new Error("LLM_PROVIDER=claude needs Claude Code installed and signed in (or CLAUDE_BIN pointing at claude)");
  const t0 = Date.now();
  const key = randomBytes(18).toString("base64url"); // only this process knows it
  const brain = createBrain({
    key,
    open: ({ systemPrompt }) => openClaude({ bin, model, effort, systemPrompt }),
    log: (m) => console.log(`claude: ${m}`),
  });
  const server = createServer(brain.handler);
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  console.log(`claude brain: ${bin}, model ${model}, effort ${effort}`);
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "claude",
    apiKey: key,
    local: false,
    startMs: Date.now() - t0,
    close() { brain.close(); server.close(); },
  };
}
