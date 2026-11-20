/**
 * In-browser stand-in for the voice routes under `VITE_MOCK=1`. Reads books,
 * chapters and paragraphs from core's mock and keeps rules, takes and render
 * runs in memory (reset on reload). Audio borrows the mock library's sounds.
 */

import type { Job } from "@/lib/api";
import { mockApi } from "@/lib/mock";
import { mockAudiobookApi, mockCharacters, mockEmit, mockMarkStale } from "@/lib/audiobook-mock";
import type { Character, PronunciationRule } from "@/lib/audiobook-types";

import type { Estimate, RenderRunView, TakeRow, TermSuggestion, VoiceApi } from "./voice-api";

let seq = 0;
const nid = (p: string) => `${p}-vmock-${++seq}`;
const now = () => new Date().toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rules: PronunciationRule[] = [];
const takes = new Map<string, TakeRow[]>();
const runs: RenderRunView[] = [];
/** The take put back on a paragraph; core's mock keeps its own sound id. */
const chosen = new Map<string, string>();
const MOCK_SOUNDS = Array.from({ length: 12 }, (_, i) => `snd-${String(i + 1).padStart(3, "0")}`);

function doneJob(kind: Job["kind"], soundId: string): Job {
  return {
    id: nid("job"), kind, status: "done", phase: "done", progress: 1, message: "Complete", error: null,
    request: null, result: { sounds: [soundId] }, created_at: now(), started_at: now(), finished_at: now(),
  };
}

async function allParagraphs(bookId: string) {
  const book = await mockAudiobookApi.getBook(bookId);
  const out = [];
  for (const c of book.chapters) out.push(...(await mockAudiobookApi.listParagraphs(bookId, c.id)).map((p) => ({ ...p, chapter: c })));
  return out;
}

function seedTakes(segmentId: string, soundId: string | null | undefined, text: string): TakeRow[] {
  let list = takes.get(segmentId);
  if (!list) {
    list = [];
    if (soundId) {
      const older = MOCK_SOUNDS[(MOCK_SOUNDS.indexOf(soundId) + 5) % MOCK_SOUNDS.length]!;
      const mk = (sound: string, minutesAgo: number, origin: TakeRow["origin"]): TakeRow => ({
        id: nid("take"), segment_id: segmentId, sound_id: sound, spoken_text: text, source_text: text,
        voice_id: null, model_id: "audiocpp-kokoro", request_options: {}, seed: 1000 + seq, selected: false,
        created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), origin, gen_ms: 2100, audio_s: 6,
      });
      list.push(mk(soundId, 5, "render"), mk(older, 42, "generate"));
    }
    takes.set(segmentId, list);
  }
  return list;
}

const ODD = /q(?!u)|[^aeiouy\s'’-]{4,}|aa|ii|uu/i;

export const mockVoiceApi: VoiceApi = {
  async listCharacters(bookId) {
    return mockCharacters().filter((c) => c.book_id === bookId);
  },
  async createCharacter(bookId, fields) {
    const c: Character = {
      id: nid("char"), book_id: bookId, aliases: [], description: null, voice_id: null, model_id: null,
      request_options: {}, color: mockCharacters().length + 1, ...fields,
    };
    mockCharacters().push(c);
    mockEmit(bookId, { type: "characters" });
    return c;
  },
  async updateCharacter(bookId, id, fields) {
    const c = mockCharacters().find((x) => x.id === id);
    if (!c) throw new Error("Character not found");
    Object.assign(c, fields);
    mockEmit(bookId, { type: "characters" });
    return c;
  },
  async deleteCharacter(bookId, id) {
    const list = mockCharacters();
    const i = list.findIndex((c) => c.id === id);
    if (i !== -1) list.splice(i, 1);
    mockEmit(bookId, { type: "characters" });
  },
  async detect(bookId) {
    await wait(700);
    const found = new Map<string, number>();
    for (const p of await allParagraphs(bookId)) {
      for (const m of p.text.matchAll(/(?:said|asked|replied|whispered)\s+([A-Z][a-z]+)/g)) found.set(m[1]!, (found.get(m[1]!) ?? 0) + 1);
    }
    let created = 0;
    for (const name of found.keys()) {
      if (mockCharacters().some((c) => c.book_id === bookId && c.name === name)) continue;
      await mockVoiceApi.createCharacter(bookId, { name, description: "adult" });
      created++;
    }
    return {
      source: "heuristic", characters: await mockVoiceApi.listCharacters(bookId), created, cast: created, split: 0,
      notes: ["The prompt assistant is off, so speakers were found from \"said X\" tags only."], voices_applied: 0,
    };
  },
  async merge(bookId, keepId, mergeIds) {
    const keep = mockCharacters().find((c) => c.id === keepId)!;
    for (const id of mergeIds) {
      const c = mockCharacters().find((x) => x.id === id);
      if (!c) continue;
      keep.aliases = [...new Set([...keep.aliases, c.name, ...c.aliases])];
      await mockVoiceApi.deleteCharacter(bookId, id);
    }
    return keep;
  },
  async suggestVoices(bookId) {
    const chars = await mockVoiceApi.listCharacters(bookId);
    return { suggestions: chars.map((c) => ({ character: c.name, voice_id: c.voice_id, score: 3, shared: false, alternatives: [] })), applied: 0 };
  },
  async preview(_bookId, _characterId) {
    await wait(400);
    return { job: doneJob("speak", MOCK_SOUNDS[seq % MOCK_SOUNDS.length]!), text: "A line from the book." };
  },
  async replaceVoice(bookId, from, to) {
    let n = 0;
    for (const c of mockCharacters()) {
      if (c.book_id === bookId && c.voice_id === from) {
        c.voice_id = to;
        n++;
      }
    }
    mockEmit(bookId, { type: "characters" });
    return { characters: n, narrator: false };
  },

  async listRules(bookId) {
    return rules.filter((r) => r.book_id === bookId).sort((a, b) => a.position - b.position);
  },
  async createRule(bookId, r) {
    const rule: PronunciationRule = {
      id: nid("rule"), book_id: bookId, kind: "alias", case_sensitive: true, whole_word: true,
      position: rules.filter((x) => x.book_id === bookId).length, ...r,
    };
    rules.push(rule);
    return { rule, stale: await markStale(bookId, rule.term) };
  },
  async updateRule(bookId, id, r) {
    const rule = rules.find((x) => x.id === id)!;
    Object.assign(rule, r);
    return { rule, stale: await markStale(bookId, rule.term) };
  },
  async deleteRule(bookId, id) {
    const i = rules.findIndex((x) => x.id === id);
    const [rule] = rules.splice(i, 1);
    return { stale: rule ? await markStale(bookId, rule.term) : 0 };
  },
  async reorderRules(bookId, ids) {
    ids.forEach((id, i) => {
      const r = rules.find((x) => x.id === id);
      if (r) r.position = i;
    });
    return mockVoiceApi.listRules(bookId);
  },
  async importRules(bookId, file) {
    const text = await file.text();
    let added = 0;
    for (const m of text.matchAll(/<grapheme>([^<]+)<\/grapheme>\s*<(alias|phoneme)>([^<]+)</g)) {
      await mockVoiceApi.createRule(bookId, { term: m[1]!, kind: m[2] === "alias" ? "alias" : "ipa", replacement: m[3]! });
      added++;
    }
    for (const line of text.split("\n")) {
      const m = /^([^#=][^=]*?)\s*=\s*(.+)$/.exec(line.trim());
      if (m) {
        await mockVoiceApi.createRule(bookId, { term: m[1]!, replacement: m[2]! });
        added++;
      }
    }
    return { added, updated: 0, warnings: [], stale: 0 };
  },
  exportUrl: () => "data:text/plain,mock",
  async suggestTerms(bookId) {
    const counts = new Map<string, TermSuggestion>();
    for (const p of await allParagraphs(bookId)) {
      for (const m of p.text.matchAll(/(?<=[a-z,;] )[A-Z][a-z]{2,}|\b[a-z]*(?:q(?!u)|aa|ii)[a-z]*\b/g)) {
        const t = m[0];
        const prev = counts.get(t);
        if (prev) prev.count++;
        else counts.set(t, { term: t, count: 1, reason: ODD.test(t) ? "invented" : "name", example: p.text.slice(0, 160) });
      }
    }
    const known = new Set(rules.filter((r) => r.book_id === bookId).map((r) => r.term));
    return [...counts.values()].filter((s) => !known.has(s.term) && (s.count > 1 || s.reason === "invented")).sort((a, b) => b.count - a.count);
  },
  async playTerm(_bookId, o) {
    await wait(300);
    return { job: doneJob("speak", MOCK_SOUNDS[3]!), text: o.draft?.term ?? "term", spoken: o.draft?.replacement, warnings: [] };
  },

  async generateParagraph(bookId, segmentId) {
    const p = (await allParagraphs(bookId)).find((x) => x.id === segmentId);
    if (!p) throw new Error("Paragraph not found");
    return mockApi.generateSegment(p.story_id, segmentId, { model: "audiocpp-kokoro", load_options: {} });
  },
  async listTakes(bookId, segmentId) {
    const p = (await allParagraphs(bookId)).find((x) => x.id === segmentId);
    const list = seedTakes(segmentId, p?.sound_id, p?.text ?? "");
    const current = chosen.get(segmentId) ?? p?.sound_id;
    return list.map((t) => ({ ...t, selected: t.sound_id === current }));
  },
  async selectTake(bookId, segmentId, takeId) {
    const t = takes.get(segmentId)?.find((x) => x.id === takeId);
    if (!t) throw new Error("Take not found");
    const p = (await allParagraphs(bookId)).find((x) => x.id === segmentId);
    chosen.set(segmentId, t.sound_id);
    mockEmit(bookId, { type: "paragraphs", chapter_id: p?.chapter.id ?? "", segment_ids: [segmentId] });
    return { ...t, selected: true };
  },
  async deleteTake(_bookId, segmentId, takeId) {
    const list = takes.get(segmentId) ?? [];
    const i = list.findIndex((t) => t.id === takeId);
    if (i !== -1) list.splice(i, 1);
  },
  async regenerateSelection(bookId, segmentId, range) {
    await wait(900);
    const list = seedTakes(segmentId, null, "");
    const take: TakeRow = {
      id: nid("take"), segment_id: segmentId, sound_id: MOCK_SOUNDS[seq % 12]!, spoken_text: "", source_text: "",
      voice_id: null, model_id: "audiocpp-kokoro", request_options: {}, seed: null, selected: true, created_at: now(),
      origin: "selection", gen_ms: 900, audio_s: 6,
    };
    list.unshift(take);
    chosen.set(segmentId, take.sound_id);
    mockEmit(bookId, { type: "takes", segment_id: segmentId });
    return {
      plan: { mode: "sentence", start: range.start, end: range.end, cut_start_s: 1.2, cut_end_s: 3.4, reason: "The selection's edges fall mid-sentence with no pause to cut at, so the whole sentence was regenerated." },
      take,
    };
  },

  async startRender(bookId, req) {
    const all = (await allParagraphs(bookId)).filter((p) =>
      req.scope.kind === "chapter" ? p.chapter.id === req.scope.chapter_id : req.scope.kind === "book" ? p.chapter.included : req.scope.segment_ids.includes(p.id));
    const run: RenderRunView = {
      id: nid("run"), book_id: bookId, scope: req.scope, overwrite: Boolean(req.overwrite), status: "running",
      total: all.length, done: 0, failed: 0, skipped: 0, current_segment_id: all[0]?.id ?? null, error: null, log: [],
      options: { max_retries: 2, asr_model: req.asr_check ? "audiocpp-qwen3-asr" : null }, created_at: now(), updated_at: now(),
    };
    runs.unshift(run);
    const tick = () => {
      if (run.status !== "running") return;
      const p = all[run.done + run.failed + run.skipped];
      if (!p) {
        run.status = "done";
        run.current_segment_id = null;
      } else if (p.locked || (p.sound_id && !run.overwrite && p.status !== "stale")) run.skipped++;
      else if ((run.done + run.failed) % 7 === 3 && run.log.length < 2) {
        run.log.push({ segment_id: p.id, attempt: 1, outcome: "retry", checks: ["length"], message: "11.2 s where about 4.1 s was expected", at: now() });
        run.done++;
      } else run.done++;
      run.current_segment_id = all[run.done + run.failed + run.skipped]?.id ?? null;
      run.updated_at = now();
      mockEmit(bookId, { type: "render", run: { ...run } });
      if (run.status === "running") setTimeout(tick, 350);
    };
    setTimeout(tick, 350);
    return { ...run };
  },
  async listRenders(bookId) {
    return runs.filter((r) => r.book_id === bookId).map((r) => ({ ...r }));
  },
  async renderAction(bookId, runId, action) {
    const run = runs.find((r) => r.id === runId)!;
    if (action === "pause" && run.status === "running") run.status = "paused";
    if (action === "cancel") run.status = "cancelled";
    if (action === "resume" && run.status === "paused") {
      run.status = "running";
      // Restart the simulated progress from where it stopped.
      void mockVoiceApi.startRender(bookId, { scope: run.scope, overwrite: run.overwrite }).then((r) => {
        runs.splice(runs.findIndex((x) => x.id === r.id), 1);
      });
    }
    mockEmit(bookId, { type: "render", run: { ...run } });
    return { ...run };
  },
  async estimate(bookId, chapterId) {
    const book = await mockAudiobookApi.getBook(bookId);
    const chapters = book.chapters.filter((c) => (chapterId ? c.id === chapterId : c.included));
    const rows = await Promise.all(chapters.map(async (c) => {
      const ps = await mockAudiobookApi.listParagraphs(bookId, c.id);
      const chars = ps.reduce((n, p) => n + p.text.length, 0);
      const toVoice = ps.filter((p) => !p.sound_id && !p.locked && p.kind === "line").length;
      const left = ps.filter((p) => !p.sound_id && !p.locked).reduce((n, p) => n + p.text.length, 0);
      return { chapter_id: c.id, title: c.title, paragraphs: ps.length, to_voice: toVoice, characters: chars, audio_s: Math.round(chars / 14), render_s: Math.round((left / 14) * 0.6) };
    }));
    const total = rows.reduce((t, r) => ({ paragraphs: t.paragraphs + r.paragraphs, to_voice: t.to_voice + r.to_voice, characters: t.characters + r.characters, audio_s: t.audio_s + r.audio_s, render_s: t.render_s + r.render_s }), { paragraphs: 0, to_voice: 0, characters: 0, audio_s: 0, render_s: 0 });
    const e: Estimate = { chapters: rows, total, basis: [{ model_id: "audiocpp-kokoro", rtf: 0.6, chars_per_s: 14, measured: true, samples: 48 }], asr_model: null };
    return e;
  },
  soundUrl: () => "",
};

async function markStale(bookId: string | null, term: string): Promise<number> {
  if (!bookId) return 0;
  const ids = (await allParagraphs(bookId)).filter((p) => p.sound_id && p.text.includes(term)).map((p) => p.id);
  mockMarkStale(ids);
  if (ids.length) mockEmit(bookId, { type: "chapters" });
  return ids.length;
}
