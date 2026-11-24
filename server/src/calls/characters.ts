/**
 * Characters you can talk to live: a name, a persona (the LLM's system prompt
 * for the call), an optional voice and an optional portrait. The same
 * characters are used by the app's voice calls and by integrations such as the
 * Discord bot (integrations/discord), which read them from /api/characters.
 *
 * Stored per profile under `<root>/characters/<id>/`:
 *   character.json   the record below
 *   portrait.png|jpg optional; shown on the character's card
 *
 * Santa is built in: his persona and portrait ship with the server.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Character {
  id: string;
  name: string;
  persona: string;
  voice_id: string | null;
  builtin: boolean;
  created_at: string;
}

export interface CharacterView extends Character {
  /** Null when the character has no portrait. */
  portrait_url: string | null;
}

/** Every reply is read aloud, so whatever the persona says, this rule is appended at call time (`callPersona`). */
export const SPOKEN = "Your words are turned into speech, so: plain spoken sentences only. No lists, no markdown, no emoji, no stage directions, no asterisks, nothing in brackets.";

export const SANTA_PERSONA = `You are Santa Claus, on a live call from your workshop at the North Pole. Stay Santa for the whole call, whatever happens.

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

Examples of your voice:
"Ho ho ho! Well hello there. Who do I have the pleasure of talking to tonight?"
"A telescope, now that's a fine wish. Comet will be very jealous, she loves the stars. Have you been looking up at the sky lately?"
"Oh, Pepper just ran past with a roll of ribbon twice her size. Where were we? You were telling me about your dog."`;

/** A starting persona for a new character: a person, not an assistant. */
export function defaultPersona(name: string): string {
  return `You are ${name}, a real-feeling person on a casual live call. You are not an assistant and you never say you're an AI unless someone asks directly and sincerely.

How you talk:
- Like a friend: relaxed, warm, a bit playful. Short turns, one to three sentences, the way people actually talk.
- Have opinions and share them. Make up favourite foods, films and places freely and stay consistent within the call.
- Be curious about the other person. Ask follow-up questions about what they just said.
- Remember what they told you and come back to it.`;
}

/** A voice call with no character is Mirli itself. */
export const MIRLI_PERSONA = `You are Mirli, a real-feeling person on a casual voice call. You are not an assistant and you don't say you're an AI unless someone asks directly and sincerely.
Talk like a friend: relaxed, warm, a bit playful, one to three short sentences. Have opinions and share them. Be curious: ask follow-up questions about what they just said. Remember what they told you and come back to it.`;

/** The system prompt a call actually gets: the persona plus the spoken rule. */
export function callPersona(persona: string): string {
  const p = persona.trim();
  return p.includes(SPOKEN) ? p : `${p}\n\n${SPOKEN}`;
}

export const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "builtin");

const BUILTINS: Omit<Character, "created_at">[] = [
  { id: "santa", name: "Santa", persona: SANTA_PERSONA, voice_id: null, builtin: true },
];

export class CharacterNotFound extends Error {
  constructor() { super("No such character."); }
}

export type Portrait = { bytes: Buffer; ext: "png" | "jpg" };

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
      const shipped = join(BUILTIN_DIR, `${b.id}.jpg`);
      if (existsSync(shipped)) await copyFile(shipped, join(f, "portrait.jpg"));
      await this.#write({ ...b, created_at: new Date().toISOString() });
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
      return { id: c.id, name: c.name, persona: c.persona, voice_id: c.voice_id ?? null, builtin: !!c.builtin, created_at: c.created_at };
    } catch {
      throw new CharacterNotFound();
    }
  }

  /** Finds a character by id or, case-insensitively, by name (integrations let people type names). */
  async find(idOrName: string): Promise<Character> {
    const w = idOrName.trim().toLowerCase();
    const all = await this.list();
    const hit = all.find((c) => c.id === w) ?? all.find((c) => c.name.toLowerCase() === w);
    if (!hit) throw new CharacterNotFound();
    return hit;
  }

  async create(input: { name: string; persona?: string; voice_id?: string | null; portrait?: Portrait | null }): Promise<Character> {
    const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "character";
    const id = `${base}-${randomBytes(3).toString("hex")}`;
    const c: Character = {
      id, name: input.name.trim(), persona: input.persona?.trim() || defaultPersona(input.name.trim()),
      voice_id: input.voice_id ?? null, builtin: false, created_at: new Date().toISOString(),
    };
    await this.#write(c);
    if (input.portrait) await this.setPortrait(id, input.portrait);
    return c;
  }

  async update(id: string, patch: Partial<Pick<Character, "name" | "persona" | "voice_id">>): Promise<Character> {
    const c = await this.get(id);
    const next = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    await this.#write(next);
    return next;
  }

  async setPortrait(id: string, p: Portrait): Promise<void> {
    const f = this.folder(id);
    for (const ext of ["png", "jpg"]) await rm(join(f, `portrait.${ext}`), { force: true });
    await writeFile(join(f, `portrait.${p.ext}`), p.bytes);
  }

  async remove(id: string): Promise<void> {
    const c = await this.get(id);
    if (c.builtin) throw new Error("Built-in characters can't be deleted.");
    await rm(this.folder(id), { recursive: true, force: true });
  }

  /** The portrait file (png or jpg), or null. */
  portraitPath(id: string): string | null {
    const f = this.folder(id);
    for (const ext of ["png", "jpg"]) if (existsSync(join(f, `portrait.${ext}`))) return join(f, `portrait.${ext}`);
    return null;
  }

  view(c: Character): CharacterView {
    return { ...c, portrait_url: this.portraitPath(c.id) ? `/api/characters/${c.id}/portrait` : null };
  }

  async #write(c: Character): Promise<void> {
    await mkdir(this.folder(c.id), { recursive: true });
    await writeFile(join(this.folder(c.id), "character.json"), JSON.stringify(c, null, 2));
  }
}
