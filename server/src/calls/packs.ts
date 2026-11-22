/**
 * Avatar packs: pose stills and the clips between them, rendered by the
 * avatar creator (`avatar-creator/build_avatar.py`, a ComfyUI pipeline:
 * Qwen-Image-Edit for the stills, Wan 2.2 first+last frame for the clips) and
 * played around the live face during a video call.
 *
 * Two ways to render:
 *  - local: a ComfyUI server the user runs (default http://127.0.0.1:8188), with
 *    the weights the avatar creator's README lists (about 70 GB with an
 *    uploaded portrait).
 *  - cloud: Mirli Cloud renders it. Not available yet; `CloudPackRenderer` is
 *    the seam, and it refuses without spending anything.
 *
 * A pack can also be imported from a folder that already has a manifest.json
 * (that is how Santa's clips get in: they are not in git).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Character, CharacterStore } from "./characters.js";

export interface PackSettings {
  /** build_avatar.py; found next to the repo's server/ in a checkout. */
  script: string | null;
  python: string;
  comfyUrl: string;
}

export function packSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): PackSettings {
  const here = dirname(fileURLToPath(import.meta.url));
  const guess = resolve(here, "..", "..", "..", "avatar-creator", "build_avatar.py");
  return {
    script: env.MIRLI_AVATAR_CREATOR || (existsSync(guess) ? guess : null),
    python: env.MIRLI_AVATAR_PYTHON || "python",
    comfyUrl: (env.MIRLI_COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, ""),
  };
}

export class PackError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The spec the avatar creator renders: a generic set of poses and moves that
 * suits any person facing the camera, built from the character's portrait and
 * persona. Same format as avatar-creator/character.example.json.
 */
export function packSpec(c: Character, portraitFile: string) {
  const clip = (id: string, from: string, to: string, kind: string, prompt: string, extra: Record<string, unknown> = {}) =>
    ({ id, from, to, kind, durationS: kind === "reaction" ? 4 : 3, prompt, ...extra });
  return {
    id: c.id,
    name: c.name,
    width: 896,
    height: 1120,
    fps: 16,
    portrait: { image: portraitFile, prompt: null, seed: 7 },
    talkPose: "talk",
    restPose: "rest",
    startPose: "talk",
    faceBox: { x: 192, y: 96, size: 512 },
    poses: {
      talk: { label: "Facing camera (master; live lip-sync pose)", edit: null },
      lean: { label: "Leaning in to listen", edit: "the person leans forward a little towards the camera, attentive, still looking at the camera" },
      rest: { label: "Looking away, thinking", edit: "the person looks slightly away to the side, relaxed and thoughtful" },
    },
    clips: [
      clip("talk_to_lean", "talk", "lean", "transition", "the person leans forward to listen"),
      clip("lean_to_talk", "lean", "talk", "transition", "the person sits back and looks at the camera"),
      clip("talk_to_rest", "talk", "rest", "transition", "the person looks away to the side, thinking"),
      clip("rest_to_talk", "rest", "talk", "transition", "the person turns back to the camera and smiles"),
      clip("rest_idle", "rest", "rest", "idle", "the person breathes and blinks, looking away calmly"),
      clip("laugh", "talk", "talk", "reaction", "the person laughs warmly, then settles back facing the camera", { tags: ["laugh"] }),
      clip("think", "talk", "talk", "reaction", "the person looks up thoughtfully, then back at the camera", { tags: ["thinking"] }),
    ],
    persona: c.persona,
  };
}

/** Mirli Cloud rendering: the seam for later. Never spends: it refuses. */
export class CloudPackRenderer {
  async render(_c: Character): Promise<never> {
    throw new PackError(501, "Rendering avatar packs in Mirli Cloud isn't available yet. Use a local ComfyUI server for now.");
  }
}

export class PackRenderer {
  #running = new Map<string, ReturnType<typeof spawn>>();
  constructor(private store: CharacterStore, private settings: PackSettings, private fetchImpl: typeof fetch = fetch) {}

  isRendering(id: string) { return this.#running.has(id); }

  /** Starts a local render. Returns at once; status is on the character (`pack`). */
  async renderLocal(id: string, comfyUrl = this.settings.comfyUrl): Promise<Character> {
    const c = await this.store.get(id);
    if (this.#running.has(id)) throw new PackError(409, "This character's pack is already rendering.");
    if (!this.settings.script) throw new PackError(503, "The avatar creator (avatar-creator/build_avatar.py) isn't installed with this copy of Mirli.");
    try {
      const r = await this.fetchImpl(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error();
    } catch {
      throw new PackError(503, `No ComfyUI server answers at ${comfyUrl}. Start ComfyUI with the avatar creator's models, then try again.`);
    }
    const folder = this.store.folder(id);
    const portrait = basename(this.store.portraitPath(id));
    const specPath = join(folder, "pack-spec.json");
    await writeFile(specPath, JSON.stringify(packSpec(c, portrait), null, 2));
    await mkdir(join(folder, "pack"), { recursive: true });
    const proc = spawn(this.settings.python, [this.settings.script, specPath, "--server", comfyUrl, "--out", join(folder, "pack")], {
      cwd: folder, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    this.#running.set(id, proc);
    const log: string[] = [];
    const onLine = (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/).filter(Boolean)) {
        log.push(line);
        const m = line.match(/^(master|still|clip|manifest)\b\s*(\S*)/);
        if (m) void this.store.setPack(id, { progress: m[1] === "manifest" ? "writing manifest" : `${m[1]} ${basename(m[2] ?? "")}`.trim() });
      }
    };
    proc.stdout?.on("data", onLine);
    proc.stderr?.on("data", onLine);
    proc.on("close", async (code) => {
      this.#running.delete(id);
      await writeFile(join(folder, "render.log"), log.join("\n")).catch(() => {});
      const manifest = await this.store.packManifest(id);
      if (code === 0 && manifest) {
        await this.store.setPack(id, { status: "ready", provider: "local", clips: manifest.clips.length, error: null, progress: null });
      } else {
        await this.store.setPack(id, { status: "failed", provider: "local", error: log.slice(-3).join(" ").slice(0, 400) || `exit ${code}`, progress: null });
      }
    });
    proc.on("error", async (e) => {
      this.#running.delete(id);
      await this.store.setPack(id, { status: "failed", provider: "local", error: e.message, progress: null });
    });
    return this.store.setPack(id, { status: "rendering", provider: "local", error: null, progress: "starting" });
  }

  /** Copy a finished pack (a folder with manifest.json) into the character. */
  async importFolder(id: string, from: string): Promise<Character> {
    await this.store.get(id);
    if (!existsSync(join(from, "manifest.json"))) throw new PackError(400, `No manifest.json in ${from}.`);
    const dst = join(this.store.folder(id), "pack");
    await cp(from, dst, { recursive: true, force: true });
    const manifest = await this.store.packManifest(id);
    return this.store.setPack(id, { status: "ready", provider: "import", clips: manifest?.clips.length ?? 0, error: null, progress: null });
  }

  stopAll() {
    for (const p of this.#running.values()) p.kill();
  }
}
