#!/usr/bin/env -S npx tsx
/**
 * Renders the real audio behind the /sfx landing pages' sample grids.
 *
 * This script deliberately has no prompt list of its own. It imports
 * `app/src/content/sfx/categories.ts` and renders exactly the prompts written
 * there, which is what makes the pages honest: the prompt printed under a clip
 * is by construction the prompt that produced it. The predecessor kept a
 * parallel copy of every prompt in this file, and the two drifted.
 *
 * Usage:
 *   npx tsx scripts/gen-sfx-samples.ts                 # everything missing
 *   npx tsx scripts/gen-sfx-samples.ts whoosh glass    # just these categories
 *   npx tsx scripts/gen-sfx-samples.ts --all           # re-render, ignore manifest
 *   npx tsx scripts/gen-sfx-samples.ts --list          # what would run, no calls
 *
 * For each sample: POST /api/generate, poll the job, GET /api/sounds/{id} for
 * the peaks and duration the backend already computed, download the WAV,
 * encode it to site/public/sfx/<category>/<sample>.mp3 (the site ships MP3;
 * needs ffmpeg on PATH), and merge into that folder's manifest.json. Resumable by design — a crashed run picks up where it left
 * off because the manifest is written after every clip, not at the end.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { wavToMp3 } from "./encode-mp3.mjs";

import { SFX_CATEGORIES } from "../app/src/content/sfx/categories.ts";
import { isPublished, type SfxSample } from "../app/src/content/sfx/types.ts";

/** `KONCHI_<name>`, or its pre-rename spelling `SOUNDBOX_<name>`. */
const env = (name: string) => process.env[`KONCHI_${name}`] ?? process.env[`SOUNDBOX_${name}`];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const API = env("API") ?? "http://127.0.0.1:17494";

/** What a sample renders on when it doesn't name a model of its own. */
const DEFAULT_MODEL = "audiocpp-stable-audio-3-sfx";
const DEFAULT_DURATION_S = 4;

/**
 * Sampler settings. Every sample renders on an audio.cpp GGUF model, and those
 * are all few-step distilled: they want cfg 1 and around 8 steps, and collapse
 * into noise at the cfg 4 / 100 steps an undistilled model would use. Getting
 * this wrong is not a subtle quality difference — it is the difference between
 * a sound and static.
 */
const SAMPLER = { steps: 8, cfg: 1 };

/**
 * One Project per category, named after it, so every clip that ships on the
 * site is also browsable in the app's own Library. Looked up by name first so
 * re-runs reuse the project instead of piling up duplicates.
 */
const projectCache = new Map<string, string>();
async function ensureProject(name: string): Promise<string> {
  const cached = projectCache.get(name);
  if (cached) return cached;
  const list = (await (await fetch(`${API}/api/projects`)).json()) as { id: string; name: string }[];
  const existing = list.find((p) => p.name === name);
  if (existing) {
    projectCache.set(name, existing.id);
    return existing.id;
  }
  const res = await fetch(`${API}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create project ${res.status}: ${await res.text()}`);
  const project = (await res.json()) as { id: string };
  projectCache.set(name, project.id);
  return project.id;
}

async function generate(sample: SfxSample, projectId: string): Promise<string> {
  const model = sample.model ?? DEFAULT_MODEL;
  const { steps, cfg } = SAMPLER;
  const submit = await fetch(`${API}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: sample.prompt,
      duration_s: sample.durationS ?? DEFAULT_DURATION_S,
      steps,
      cfg,
      project_id: projectId,
    }),
  });
  if (!submit.ok) throw new Error(`generate ${submit.status}: ${await submit.text()}`);
  const { job_id } = (await submit.json()) as { job_id: string };

  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${API}/api/jobs/${job_id}`);
    if (!res.ok) throw new Error(`job poll ${res.status}: ${await res.text()}`);
    const job = (await res.json()) as {
      status: string;
      error?: string;
      result?: { sounds: string[] };
    };
    if (job.status === "done") return job.result!.sounds[0];
    if (job.status === "error" || job.status === "cancelled") {
      throw new Error(`job ${job.status}: ${job.error ?? "unknown"}`);
    }
  }
}

interface ManifestEntry {
  durationS: number;
  sampleRate: number;
  sizeBytes: number;
  peaks: number[];
}

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const listOnly = argv.includes("--list");
  const only = new Set(argv.filter((a) => !a.startsWith("--")));

  const categories = SFX_CATEGORIES.filter(isPublished).filter(
    (c) => only.size === 0 || only.has(c.slug),
  );
  if (only.size > 0) {
    for (const slug of only) {
      if (!categories.some((c) => c.slug === slug)) console.error(`Unknown category: ${slug}`);
    }
  }

  // Count the work up front. A run this long is much easier to sit through
  // when you know at minute one whether it is twenty clips or five hundred.
  const plan: { slug: string; samples: SfxSample[]; outDir: string; manifest: Record<string, ManifestEntry> }[] = [];
  for (const category of categories) {
    const outDir = join(root, "site", "public", "sfx", category.slug);
    const manifestPath = join(outDir, "manifest.json");
    const manifest: Record<string, ManifestEntry> = existsSync(manifestPath)
      ? JSON.parse(await readFile(manifestPath, "utf8"))
      : {};
    const todo = all
      ? category.content.samples
      : category.content.samples.filter(
          (s) => !(s.slug in manifest) || !existsSync(join(outDir, `${s.slug}.mp3`)),
        );
    if (todo.length > 0) plan.push({ slug: category.slug, samples: todo, outDir, manifest });
  }

  const total = plan.reduce((n, p) => n + p.samples.length, 0);
  const seconds = plan.reduce(
    (n, p) => n + p.samples.reduce((m, s) => m + (s.durationS ?? DEFAULT_DURATION_S), 0),
    0,
  );
  console.log(
    `${total} clip(s) to render across ${plan.length} categor(ies), ${Math.round(seconds)}s of audio.`,
  );
  if (listOnly) {
    for (const p of plan) console.log(`  ${p.slug}: ${p.samples.map((s) => s.slug).join(", ")}`);
    return;
  }
  if (total === 0) return;

  const started = Date.now();
  let done = 0;
  for (const { slug, samples, outDir, manifest } of plan) {
    await mkdir(outDir, { recursive: true });
    const projectName = `SFX: ${slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
    const projectId = await ensureProject(projectName);
    console.log(`\n=== ${slug} (${samples.length}) -> "${projectName}" ===`);

    for (const sample of samples) {
      const label = `${slug}/${sample.slug}`;
      try {
        const soundId = await generate(sample, projectId);
        const info = (await (await fetch(`${API}/api/sounds/${soundId}`)).json()) as {
          file: string;
          duration_s: number;
          sample_rate: number;
          peaks: number[];
        };
        const wav = Buffer.from(await (await fetch(`${API}${info.file}`)).arrayBuffer());
        const buf = await wavToMp3(wav);
        await writeFile(join(outDir, `${sample.slug}.mp3`), buf);
        manifest[sample.slug] = {
          durationS: info.duration_s,
          sampleRate: info.sample_rate,
          sizeBytes: buf.length,
          peaks: info.peaks,
        };
        // Written every clip, not once per category: a run of this length
        // will get interrupted, and losing an hour of GPU time to a crash on
        // the last sample is not a trade worth making for fewer writes.
        await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest));
        done += 1;
        const rate = (Date.now() - started) / done / 1000;
        const eta = Math.round((rate * (total - done)) / 60);
        console.log(
          `  [${done}/${total}] ${label} — ${info.duration_s}s, ${(buf.length / 1024).toFixed(0)} KB (~${eta}m left)`,
        );
      } catch (err) {
        // One bad prompt should not end a five-hundred-clip run. It stays out
        // of the manifest, so the next invocation retries it automatically.
        done += 1;
        console.error(`  [${done}/${total}] ${label} FAILED: ${(err as Error).message}`);
      }
    }
  }

  console.log(`\nDone in ${Math.round((Date.now() - started) / 60000)}m.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
