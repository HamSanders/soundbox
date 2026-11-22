// End-to-end tests for Calls in the Mirli app, against the local back end,
// with stand-in workers so they run without GPUs: the REAL face server on its
// fake engine, a fake voice worker that shares the real routing code, the
// REAL Mirli server (server/src/routes/calls.ts) on a scratch data dir, and
// the app's Vite dev server. All on spare ports: the live servers
// (17650-17653, 17680) and a running Mirli (17494) are never touched.
//
//   cd live && npm run test:e2e

import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import { seed } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
export const PORTS = { voice: 17750, face: 17760, facePcm: 17761, mirli: 17795, web: 5180 };
export const SECRET = "e2e-call-secret";
export const FIXTURES = join(tmpdir(), "mirli-calls-e2e");
const FACE_PY = process.env.FACE_PYTHON || join(homedir(), "mirli-spike-face", "venv", "Scripts", "python.exe");
const WEB = `http://127.0.0.1:${PORTS.web}`;
const common = { MIRLI_CALL_SECRET: SECRET, MIRLI_CALL_SECRET_FILE: join(FIXTURES, "unused-secret") };

// Once, in the runner process (test workers load this file too and inherit the flag).
if (!process.env.MIRLI_E2E_SEEDED) {
  seed(FIXTURES, FACE_PY);
  process.env.MIRLI_E2E_SEEDED = "1";
}

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.mjs/,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
    permissions: ["microphone"],
  },
  webServer: [
    {
      command: "node fake-server.mjs",
      cwd: join(root, "spikes", "realtime-voice"),
      url: `http://127.0.0.1:${PORTS.voice}/readyz`,
      env: { ...common, SPIKE_PORT: String(PORTS.voice) },
      reuseExistingServer: false,
    },
    {
      command: `"${FACE_PY}" -u server.py --engine fake --input-rate 48000 --http-port ${PORTS.face} --pcm-port ${PORTS.facePcm} --tap ws://127.0.0.1:${PORTS.voice}/tap --image "${join(FIXTURES, "face", "seed", "girl.png")}"`,
      cwd: join(root, "spikes", "realtime-face"),
      url: `http://127.0.0.1:${PORTS.face}/readyz`,
      env: { ...common, MIRLI_FACE_HOME: join(FIXTURES, "face") },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx tsx src/cli.ts --port ${PORTS.mirli} --data-dir "${join(FIXTURES, "data")}" --no-ui`,
      cwd: join(root, "server"),
      url: `http://127.0.0.1:${PORTS.mirli}/api/calls/history`,
      env: {
        ...common,
        MIRLI_CALL_VOICE_URL: `http://127.0.0.1:${PORTS.voice}`,
        MIRLI_CALL_FACE_URL: `http://127.0.0.1:${PORTS.face}`,
        MIRLI_CALL_HEARTBEAT_S: "2",
      },
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: `npx vite --port ${PORTS.web} --strictPort --host 127.0.0.1`,
      cwd: join(root, "app"),
      url: WEB,
      env: { SOUNDBOX_PORT: String(PORTS.mirli) },
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
