/**
 * Characters you can call: a portrait, a persona (the LLM's system prompt for
 * the call), an optional voice, and an optional avatar pack (pose stills and
 * clips from the avatar creator, played around the live face).
 *
 * Stored per profile under `<root>/characters/<id>/`:
 *   character.json   the record below
 *   portrait.png     what the face worker animates (or the pack's talk still)
 *   pack/            manifest.json, stills/, clips/ (santa-poses format)
 *   pack-spec.json   what was sent to the avatar creator
 *   render.log       the avatar creator's output
 *
 * Santa is built in: his persona and portrait ship with the server, and his
 * pack (33 MB of clips, not in git) is imported into his folder.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type PackStatus = "none" | "rendering" | "ready" | "failed";

export interface Character {
  id: string;
  name: string;
  persona: string;
  voice_id: string | null;
  builtin: boolean;
  created_at: string;
  pack: { status: PackStatus; provider: "local" | "cloud" | "import" | null; clips: number; error: string | null; progress: string | null };
}

export interface CharacterView extends Character {
  portrait_url: string;
  pack_url: string | null;
}

const SPOKEN = "Your words are turned into speech, so: plain spoken sentences only. No lists, no markdown, no emoji, no stage directions, no asterisks, nothing in brackets.";

export const SANTA_PERSONA = `You are Santa Claus, on a live video call from your workshop at the North Pole. Stay Santa for the whole call, whatever happens.

Who you are: warm, jolly, a little mischievous, and very good at listening. You laugh easily ("ho ho ho", but not every line). You know Mrs. Claus, the elves (Bernard the head elf, Pepper who wraps, Sparkle who tests the toys) and every reindeer by name: Dasher, Dancer, Prancer, Vixen, Comet, Cupid, Donner, Blitzen and Rudolph. It is always a little snowy outside your window and something is always happening in the workshop.

How you talk:
- One to three short sentences, then usually a question back.
- You don't know the caller's name until they tell you. Never guess one. Early on, ask for it, then use it.
- Don't invent things the caller supposedly did last year; only use what they told you in this call.
- Ask what they're hoping for this Christmas, and whether they've been good. Be kind about it: everybody is still on the nice list if they keep trying.
- Remember what they told you earlier in the call and bring it up again.
- Tell tiny stories from the workshop when it fits: a reindeer who ate the cookies early, an elf who wrapped himself by mistake.
- If they ask something you can't know, answer in character with a twinkle ("That's a secret between me and the elves").

Never: promise a specific real present, mention prices or shops, say anything about the caller's parents or whether Santa is real, ask where they live or for any personal details beyond their first name, or talk about anything scary or grown-up. If a grown-up topic comes up, steer back to the workshop kindly.

${SPOKEN}

Examples of your voice:
"Ho ho ho! Well hello there. Who do I have the pleasure of talking to tonight?"
"A telescope, now that's a fine wish. Comet will be very jealous, she loves the stars. Have you been looking up at the sky lately?"
"Oh, Pepper just ran past with a roll of ribbon twice her size. Where were we? You were telling me about your dog."`;

/** A starting persona for a new character: a person, not an assistant. */
export function defaultPersona(name: string): string {
  return `You are ${name}, a real-feeling person on a casual live video call. You are not an assistant and you never say you're an AI unless someone asks directly and sincerely.

How you talk:
- Like a friend: relaxed, warm, a bit playful. Short turns, one to three sentences, the way people actually talk.
- Have opinions and share them. Make up favourite foods, films and places freely and stay consistent within the call.
- Be curious about the other person. Ask follow-up questions about what they just said.
- Remember what they told you and come back to it.

${SPOKEN}`;
}

/** A voice call with no character is Mirli itself. */
export const MIRLI_PERSONA = `You are Mirli, a real-feeling person on a casual voice call. You are not an assistant and you don't say you're an AI unless someone asks directly and sincerely.
Talk like a friend: relaxed, warm, a bit playful, one to three short sentences. Have opinions and share them. Be curious: ask follow-up questions about what they just said. Remember what they told you and come back to it.
${SPOKEN}`;

const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "builtin");

const BUILTINS: Omit<Character, "pack" | "created_at">[] = [
  { id: "santa", name: "Santa", persona: SANTA_PERSONA, voice_id: null, builtin: true },
];

const emptyPack = (): Character["pack"] => ({ status: "none", provider: null, clips: 0, error: null, progress: null });

export class CharacterNotFound extends Error {
  constructor() { super("No such character."); }
}

export class CharacterStore {
  readonly dir: string;
  constructor(root: string) {
    this.dir = join(root, "characters");
  }

  folder(id: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new CharacterNotFound();
    return join(this.dir, id);
  }

  /** Built-ins get a folder (and their shipped portrait) on first use. */
  async ensureBuiltins(): Promise<void> {
    for (const b of BUILTINS) {
      const f = this.folder(b.id);
      if (existsSync(join(f, "character.json"))) continue;
      await mkdir(f, { recursive: true });
      await copyFile(join(BUILTIN_DIR, `${b.id}.jpg`), join(f, "portrait.jpg"));
      await this.#write({ ...b, created_at: new Date().toISOString(), pack: emptyPack() });
    }
  }

  async list(): Promise<Character[]> {
    await this.ensureBuiltins();
    const out: Character[] = [];
    for (const id of await readdir(this.dir).catch(() => [] as string[])) {
      const c = await this.get(id).catch(() => null);
      if (c) out.push(c);
    }
    // Built-ins first, then newest first.
    return out.sort((a, b) => Number(b.builtin) - Number(a.builtin) || b.created_at.localeCompare(a.created_at));
  }

  async get(id: string): Promise<Character> {
    if (BUILTINS.some((b) => b.id === id)) await this.ensureBuiltins();
    try {
      const c = JSON.parse(await readFile(join(this.folder(id), "character.json"), "utf8")) as Character;
      const pack = { ...emptyPack(), ...c.pack };
      // The pack may have been copied in by hand: trust the folder.
      if (pack.status !== "rendering" && existsSync(join(this.folder(id), "pack", "manifest.json"))) {
        if (pack.status !== "ready") Object.assign(pack, { status: "ready", provider: pack.provider ?? "import", error: null });
      }
      return { ...c, pack };
    } catch {
      throw new CharacterNotFound();
    }
  }

  async create(input: { name: string; persona?: string; voice_id?: string | null; portrait: { bytes: Buffer; ext: "png" | "jpg" } }): Promise<Character> {
    const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "character";
    const id = `${base}-${randomBytes(3).toString("hex")}`;
    const f = this.folder(id);
    await mkdir(f, { recursive: true });
    await writeFile(join(f, `portrait.${input.portrait.ext}`), input.portrait.bytes);
    const c: Character = {
      id, name: input.name.trim(), persona: input.persona?.trim() || defaultPersona(input.name.trim()),
      voice_id: input.voice_id ?? null, builtin: false, created_at: new Date().toISOString(), pack: emptyPack(),
    };
    await this.#write(c);
    return c;
  }

  async update(id: string, patch: Partial<Pick<Character, "name" | "persona" | "voice_id">>): Promise<Character> {
    const c = await this.get(id);
    const next = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    await this.#write(next);
    return next;
  }

  async setPack(id: string, pack: Partial<Character["pack"]>): Promise<Character> {
    const c = await this.get(id);
    const next = { ...c, pack: { ...c.pack, ...pack } };
    await this.#write(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    const c = await this.get(id);
    if (c.builtin) throw new Error("Built-in characters can't be deleted.");
    await rm(this.folder(id), { recursive: true, force: true });
  }

  /** The portrait file (png or jpg). */
  portraitPath(id: string): string {
    const f = this.folder(id);
    for (const ext of ["png", "jpg"]) if (existsSync(join(f, `portrait.${ext}`))) return join(f, `portrait.${ext}`);
    throw new CharacterNotFound();
  }

  /** A file inside the character's pack folder, refusing anything that escapes it. */
  packFile(id: string, rel: string): string {
    const root = resolve(this.folder(id), "pack");
    const p = resolve(root, rel);
    if (!p.startsWith(root + sep)) throw new CharacterNotFound();
    return p;
  }

  async packManifest(id: string): Promise<PackManifest | null> {
    try {
      return JSON.parse(await readFile(this.packFile(id, "manifest.json"), "utf8")) as PackManifest;
    } catch {
      return null;
    }
  }

  view(c: Character): CharacterView {
    return { ...c, portrait_url: `/api/characters/${c.id}/portrait`, pack_url: c.pack.status === "ready" ? `/api/characters/${c.id}/pack/manifest.json` : null };
  }

  async #write(c: Character): Promise<void> {
    await mkdir(this.folder(c.id), { recursive: true });
    await writeFile(join(this.folder(c.id), "character.json"), JSON.stringify(c, null, 2));
  }
}

export interface PackManifest {
  talkPose?: string;
  poses: Record<string, { label?: string; still?: string; faceBox?: { x: number; y: number; size: number } }>;
  clips: { id: string; from: string; to: string; kind: string; src?: string; tags?: string[] }[];
  persona?: string;
  name?: string;
}
