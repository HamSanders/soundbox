#!/usr/bin/env node
// Real inference smoke test against an existing Fish install, using a fresh
// SQLite library. No model downloads and no access to the user's database.
// Usage: node scripts/verify-fish-reference.mjs <models-dir> <cli.exe> <references.json>
// references.json: [{ "file": "C:/clips/a.wav", "reference_text": "Exact words." }, ...]
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [modelsDir, binary, manifestPath] = process.argv.slice(2);
if (!modelsDir || !binary || !manifestPath) {
  throw new Error("Usage: node scripts/verify-fish-reference.mjs <models-dir> <cli.exe> <references.json>");
}
const references = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
assert.equal(references.length, 2, "Supply two reference clips with their exact transcripts.");
for (const ref of references) {
  assert.ok(typeof ref.file === "string" && ref.reference_text?.trim(), "Each clip needs file and reference_text.");
}
process.env.SOUNDBOX_AUDIOCPP_BIN = resolve(binary);
const { buildApp } = await import("../server/dist/app.js");
const { Config } = await import("../server/dist/config.js");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parent = resolve(root, "build/fish-reference-validation");
await mkdir(parent, { recursive: true });
const dataDir = await mkdtemp(resolve(parent, "run-"));
const config = new Config(dataDir);
config.updateSettings({ audiocpp_mode: "external", audiocpp_models_dir: resolve(modelsDir),
  enabled_audiocpp_models: ["audiocpp-fish-audio"] });
const app = buildApp(config, { serveUi: false });
const model = "audiocpp-fish-audio";
const requests = [];
const runtime = app.soundbox.models.runtime;
const runTask = runtime.runTask.bind(runtime);
runtime.runTask = async (body, ...args) => {
  requests.push(body);
  return runTask(body, ...args);
};
const report = { dataDir, modelsDir: resolve(modelsDir), binary: resolve(binary), sounds: [], requests };

async function json(method, url, payload, headers) {
  const res = await app.inject({ method, url, payload, headers });
  assert.ok(res.statusCode < 300, `${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json();
}
async function wait(jobId) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const job = app.soundbox.jobs.get(jobId);
    if (job?.status === "error" || job?.status === "cancelled") throw new Error(job.error ?? job.status);
    if (job?.status === "done") {
      for (const id of job.result?.sounds ?? []) {
        const sound = app.soundbox.getSound(id);
        assert.ok(sound?.duration_s > 0);
        report.sounds.push({ id, duration_s: sound.duration_s,
          file: resolve(config.paths.sounds, sound.file.replace("/files/", "")) });
      }
      return;
    }
    await delay(500);
  }
  throw new Error("Inference timed out after 15 minutes.");
}
try {
  await app.ready();
  const voices = [];
  for (const [i, ref] of references.entries()) {
    const query = new URLSearchParams({ name: `Smoke ${i + 1}`, model_id: model,
      reference_text: ref.reference_text });
    voices.push(await json("POST", `/api/voices/upload?${query}`,
      await readFile(ref.file), { "content-type": "audio/wav" }));
  }
  voices[0] = await json("POST", `/api/voices/${voices[0].id}/samples?` +
    new URLSearchParams({ reference_text: references[1].reference_text }),
    await readFile(references[1].file), { "content-type": "audio/wav" });
  const firstText = references.map((r) => r.reference_text.trim()).join(" ");

  // A valid first voice followed by an incomplete one must fail before any run.
  const missing = await json("POST", "/api/voices/upload?name=Missing&model_id=" + model,
    await readFile(references[0].file), { "content-type": "audio/wav" });
  const refused = await app.inject({ method: "POST", url: "/api/speak", payload: {
    model, lines: [{ text: "Test", voice_id: voices[0].id }, { text: "Test", voice_id: missing.id }],
  } });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().detail, /Reference Transcript/);
  assert.equal(requests.length, 0);

  console.log("Speak: combined reference");
  await wait((await json("POST", "/api/speak", { model,
    lines: [{ text: "The reference transcript is now passed correctly.", voice_id: voices[0].id }],
  })).job_id);
  assert.equal(requests.at(-1)?.request_options?.reference_text, firstText);

  console.log("Speak: two saved voices");
  const beforeDialogue = requests.length;
  await wait((await json("POST", "/api/speak", { model, lines: [
    { text: "The first speaker is ready.", voice_id: voices[0].id },
    { text: "The second speaker is ready too.", voice_id: voices[1].id },
  ] })).job_id);
  assert.deepEqual(requests.slice(beforeDialogue).map((r) => r.request_options?.reference_text),
    [firstText, references[1].reference_text.trim()]);

  const story = await json("POST", "/api/stories", { title: "Fish reference smoke test" });
  for (const [i, voice] of voices.entries()) {
    console.log(`Script Builder: voice ${i + 1}`);
    const line = await json("POST", `/api/stories/${story.id}/segments`, {
      text: i ? "This is the second saved voice." : "This is the first saved voice.", voice_id: voice.id,
    });
    await wait((await json("POST", `/api/stories/${story.id}/segments/${line.id}/generate`, { model })).job_id);
    assert.equal(requests.at(-1)?.request_options?.reference_text,
      i ? references[1].reference_text.trim() : firstText);
  }
  for (const request of requests) {
    assert.ok(request.voice_ref);
    assert.equal(request.reference_text, undefined);
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await app.close();
  await writeFile(resolve(dataDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
