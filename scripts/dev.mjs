#!/usr/bin/env node
// Start the server and the Vite dev server together, and stop both together.
//
// Without this, `npm run dev` only started Vite, and the server had to be
// launched by hand — which is how "the UI shows no models" happens: Vite is
// up, its proxy target on 17494 is not, and every /api call 502s.
//
// Usage:
//   npm run dev                 # server on 17494 + Vite on 5174
//   KONCHI_DATA_DIR=... npm run dev
//   KONCHI_AUDIOCPP_BACKEND=cpu npm run dev   # force a backend if auto-detect guesses wrong
//   KONCHI_DEV_HOST=0.0.0.0 npm run dev       # serve the dev UI beyond localhost (no auth!)
//   KONCHI_ALLOWED_HOSTS=konchi.example.lan npm run dev   # names a proxy or other machine uses
//   KONCHI_LOG_LEVEL=debug npm run dev        # more detail in the console and the log file
//
// The server itself stays on 127.0.0.1 either way; Vite proxies to it.
// app/vite.config.ts reads both variables, which Vite inherits from here.

import { spawn } from "node:child_process";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** `KONCHI_<name>`, or its pre-rename spelling `SOUNDBOX_<name>`. */
const env = (name) => process.env[`KONCHI_${name}`] ?? process.env[`SOUNDBOX_${name}`];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(root, "server");
const isWin = process.platform === "win32";

const port = env("PORT") || "17494";

const children = [];
function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: isWin && cmd.endsWith(".cmd"),
    ...opts,
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev] ${name} exited (${signal ?? code}); stopping the other.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// The server reads KONCHI_LOG_LEVEL itself (it inherits this environment),
// so the level isn't passed as a flag here: one place decides it.
const logLevel = (env("LOG_LEVEL") ?? "").trim();
console.log(
  `[dev] server: tsx watch src/cli.ts --port ${port}` +
    (logLevel ? ` (KONCHI_LOG_LEVEL=${logLevel})` : ""),
);
run(
  "server",
  isWin ? "npx.cmd" : "npx",
  ["tsx", "watch", "src/cli.ts", "--port", port],
  { cwd: serverDir },
);

const devHost = (env("DEV_HOST") ?? "").trim();
if (devHost && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(devHost)) {
  console.warn(
    `[dev] KONCHI_DEV_HOST=${devHost} exposes the dev UI, and the whole API behind its proxy, ` +
      "beyond this machine. There is no authentication.",
  );
}

console.log(`[dev] frontend: vite${devHost ? ` --host ${devHost}` : ""}`);
run("frontend", isWin ? "npm.cmd" : "npm", ["--prefix", join(root, "app"), "run", "dev"], {
  cwd: root,
});
