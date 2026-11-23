#!/usr/bin/env node
/**
 * Re-shoot the product screenshots in `site/public/product/`.
 *
 *   node scripts/capture-media.mjs              # every shot
 *   node scripts/capture-media.mjs studio sfx   # only these
 *   node scripts/capture-media.mjs --out tmp/   # somewhere else
 *
 * It starts the app on its in-browser mock backend (no server, no GPU, no data
 * directory) with the demo fixture in `app/src/lib/mock-demo.ts`, drives it
 * with Playwright at one fixed viewport, and writes each shot as WebP beside
 * `manifest.json`, which records the commit and the day they were taken.
 *
 * The screenshots went stale once because taking them was manual. To change
 * what a shot shows, edit the fixture or the `SHOTS` table below and run this
 * again; do not hand-edit the images.
 *
 * First run on a machine: `npx playwright install chromium`.
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** CSS pixels. Shots are written at twice this (2400x1500). */
const VIEWPORT = { width: 1200, height: 750 };
const SCALE = 2;
const WEBP_QUALITY = 0.9;

/** The demo studio project's id, fixed in the fixture so it has a URL. */
const STUDIO = "#/studio/script/story-demo-trailer";

/* ------------------------------------------------------------- staging */

/** Start a sound in the bottom player, so the shot has a player with a real
 *  length in it, then hold it still: a clock that reads differently on every
 *  run would make every re-shoot a diff. */
async function play(page, name) {
  await page.getByRole("button", { name: `Play ${name}`, exact: true }).first().click();
  await page.getByRole("button", { name: "Pause", exact: true }).first().waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause", exact: true }).first().click();
}

/** The Studio, framed so the whole arrangement is in the picture. */
async function frameStudio(page) {
  // Give the timeline the height its five lanes need: drag the divider
  // between it and the script up.
  const divider = page.getByRole("separator", { name: "Resize Script and Timeline" });
  const box = await divider.boundingBox();
  if (!box) throw new Error("The Script/Timeline divider is not on the page");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 4 });
  await page.mouse.move(x, y - 72, { steps: 4 });
  await page.mouse.up();

  // Two steps out: the half-minute trailer fits the lane width.
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  await zoomOut.click();
  await zoomOut.click();

  // The script lists every clip, and the first two are the music bed and the
  // rain. Scroll to the first spoken line: the words are the point of it.
  await page.getByText("They sealed the vault a hundred years ago.").first().evaluate((line) => {
    let scroller = line.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
    if (!scroller) return;
    const row = line.closest("li, [data-segment-id]") ?? line;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 4;
  });
  await page.mouse.move(4, 4);
}

/**
 * One row per image. `route` is the app's hash route; `theme` defaults to the
 * app's default (dark); `prepare` runs once the page has settled and gets the
 * page to the state worth photographing.
 *
 * @type {{ name: string, route: string, theme?: "light" | "dark", jpeg?: boolean, prepare?: (page: import("playwright").Page) => Promise<void> }[]}
 */
const SHOTS = [
  { name: "app-dashboard", route: "#/dashboard" },
  { name: "app-dashboard-light", route: "#/dashboard", theme: "light" },
  // Also as a JPEG: link previews and search engines read the Studio shot
  // (og:image, schema.org `screenshot`), and not all of them read WebP.
  { name: "app-studio", route: STUDIO, prepare: frameStudio, jpeg: true },
  { name: "app-sfx", route: "#/library/sfx" },
  { name: "app-music", route: "#/library/music", prepare: (page) => play(page, "Ember Run (main theme)") },
  { name: "app-library", route: "#/library", prepare: (page) => play(page, "Low Tide") },
  {
    name: "app-details",
    route: "#/library",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Details for Rain on tin roof", exact: true }).first().click();
      await page.waitForTimeout(400);
      await play(page, "Rain on tin roof");
    },
  },
  { name: "app-voice-lab", route: "#/voice/lab" },
  {
    name: "app-models",
    route: "#/models",
    prepare: (page) => page.getByRole("button", { name: "Show packs", exact: true }).click(),
  },
  { name: "app-agents", route: "#/agents" },
  { name: "app-voice-new", route: "#/voice/new" },
  { name: "app-voice-clone", route: "#/voice/new/clone" },
];

/* ------------------------------------------------------------------ args */

const args = process.argv.slice(2);
let outDir = path.join(ROOT, "site", "public", "product");
const only = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = path.resolve(args[++i]);
  else only.push(args[i].replace(/^app-/, ""));
}
const shots = only.length
  ? SHOTS.filter((s) => only.includes(s.name.replace(/^app-/, "")))
  : SHOTS;
if (shots.length === 0) {
  console.error(`No shot named ${only.join(", ")}. Known: ${SHOTS.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

/* ------------------------------------------------------------ dev server */

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite did not answer at ${url} within ${ms / 1000}s`);
}

function startVite(port) {
  // Vite's own entry point, run by this Node: no shell, so there is exactly
  // one process to stop afterwards on every platform.
  const vite = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  return spawn(
    process.execPath,
    [vite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: path.join(ROOT, "app"),
      env: { ...process.env, VITE_MOCK: "1", VITE_MOCK_FIXTURE: "demo" },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
}

/* --------------------------------------------------------------- capture */

/** Let the page finish: queries answered, lazy route loaded, fonts in,
 *  waveforms drawn. The mock answers in tens of milliseconds, so a short
 *  quiet period is enough and a fixed sleep is the honest way to say it. */
async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // The mock renders every seed sound's audio before it answers the first
  // list, which on a cold start outlasts any sleep worth having. A loading
  // placeholder still on the page means the shot is not ready.
  await page.waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'), null, {
    timeout: 60_000,
  });
  await page.waitForTimeout(ms);
}

/** PNG in, WebP out, encoded by the browser so the script needs no image
 *  library of its own. */
async function toWebp(encoder, png) {
  const dataUrl = await encoder.evaluate(
    async ({ b64, quality }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return canvas.toDataURL("image/webp", quality);
    },
    { b64: png.toString("base64"), quality: WEBP_QUALITY },
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function git(...a) {
  try {
    return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const port = await freePort();
const base = `http://127.0.0.1:${port}/`;
const vite = startVite(port);
let browser;
try {
  await waitFor(base);
  browser = await chromium.launch();
  mkdirSync(outDir, { recursive: true });

  const encoder = await (await browser.newContext()).newPage();
  await encoder.goto("about:blank");

  const written = [];
  for (const shot of shots) {
    // A context per shot: the mock keeps its state in the page, so every shot
    // starts from the same fixture whatever the one before it clicked.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      colorScheme: shot.theme ?? "dark",
      reducedMotion: "reduce",
    });
    // next-themes reads this key before first paint.
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem("theme", theme);
      } catch {
        /* storage blocked: the default theme is the dark one anyway */
      }
    }, shot.theme ?? "dark");
    const page = await context.newPage();
    page.on("pageerror", (err) => console.warn(`  [${shot.name}] page error: ${err.message}`));
    await page.goto(base + shot.route);
    await settle(page);
    if (shot.prepare) {
      await shot.prepare(page);
      await settle(page, 600);
    }
    const file = `${shot.name}.webp`;
    writeFileSync(path.join(outDir, file), await toWebp(encoder, await page.screenshot({ type: "png" })));
    written.push({ file, route: shot.route, theme: shot.theme ?? "dark" });
    console.log(`  ${file}`);
    if (shot.jpeg) {
      // At CSS size (1200x750): a preview card never shows more than that.
      const jpeg = `${shot.name}.jpg`;
      writeFileSync(
        path.join(outDir, jpeg),
        await page.screenshot({ type: "jpeg", quality: 88, scale: "css" }),
      );
      written.push({ file: jpeg, route: shot.route, theme: shot.theme ?? "dark" });
      console.log(`  ${jpeg}`);
    }
    await context.close();
  }

  // Only a full run describes the folder; a partial one would leave a
  // manifest that names a commit most of the images were not taken at.
  if (!only.length) {
    const manifest = {
      generated_by: "scripts/capture-media.mjs",
      captured_on: new Date().toISOString().slice(0, 10),
      // The commit the app was at. Pull requests here are squash-merged, so
      // on main this names the pull request's own commit, not one in history.
      commit: git("rev-parse", "HEAD"),
      // True when the working tree had changes the commit does not record:
      // normal for the run that is about to be committed with its fixture.
      uncommitted_changes: Boolean(git("status", "--porcelain", "--", "app", "scripts")),
      backend: "in-browser mock (VITE_MOCK=1) with the demo fixture, app/src/lib/mock-demo.ts",
      viewport: { ...VIEWPORT, device_scale_factor: SCALE },
      browser: `chromium ${browser.version()}`,
      shots: written,
    };
    writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log("  manifest.json");
  }
} finally {
  await browser?.close();
  vite.kill();
}
