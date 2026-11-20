/**
 * The review screen's section list as an edit model over the preview.
 *
 * A working section never copies text: it lists the parts of the preview's
 * sections it is made of (`{section, start, end}` paragraph ranges). Merging
 * concatenates two sections' parts; splitting cuts the parts at a paragraph.
 * The server rebuilds the text from the same parts on commit, so what the
 * review screen shows is exactly what the book gets.
 */

import type { ChapterKind } from "@/lib/audiobook-types";

import type { ImportEdits, ImportSection, SectionPart } from "./api";

export interface WorkingSection {
  key: string;
  title: string;
  kind: ChapterKind;
  included: boolean;
  parts: Required<SectionPart>[];
}

let keySeq = 0;
const nextKey = () => `s${++keySeq}`;

export const KIND_LABEL: Record<ChapterKind, string> = {
  chapter: "Chapter",
  front_matter: "Front matter",
  back_matter: "Back matter",
  opening_credits: "Opening credits",
  closing_credits: "Closing credits",
  retail_sample: "Retail sample",
};

export function initialSections(sections: ImportSection[]): WorkingSection[] {
  return sections.map((s, i) => ({
    key: nextKey(),
    title: s.title,
    kind: s.kind,
    included: s.included,
    parts: [{ section: i, start: 0, end: s.paragraphs.length }],
  }));
}

/** The paragraphs a list of parts stands for. */
export function paragraphsFor(parts: SectionPart[], source: ImportSection[]): string[] {
  return parts.flatMap((p) => {
    const from = source[p.section];
    if (!from) return [];
    return from.paragraphs.slice(p.start ?? 0, p.end ?? from.paragraphs.length);
  });
}

/**
 * Where scene breaks fall in a list of parts: the same rule the server's
 * `remapBreaks` applies on commit. A break exactly at a part's start is kept
 * only when the part continues earlier text, so splitting at a scene break
 * drops it and merging back restores it.
 */
export function breaksFor(parts: SectionPart[], source: ImportSection[]): Set<number> {
  const out = new Set<number>();
  let offset = 0;
  for (const p of parts) {
    const from = source[p.section];
    if (!from) continue;
    const start = p.start ?? 0;
    const end = Math.min(p.end ?? from.paragraphs.length, from.paragraphs.length);
    for (const b of from.breaks ?? []) {
      if (b < end && (b > start || (b === start && b > 0 && offset > 0))) out.add(offset + (b - start));
    }
    offset += Math.max(0, end - start);
  }
  return out;
}

export function countParagraphs(s: WorkingSection): number {
  return s.parts.reduce((n, p) => n + (p.end - p.start), 0);
}

/** Merge section `index` with the one after it; the first keeps its title. */
export function mergeWithNext(list: WorkingSection[], index: number): WorkingSection[] {
  const a = list[index];
  const b = list[index + 1];
  if (!a || !b) return list;
  const parts = [...a.parts];
  for (const p of b.parts) {
    const last = parts[parts.length - 1];
    // Adjacent ranges of the same source section join back into one.
    if (last && last.section === p.section && last.end === p.start) parts[parts.length - 1] = { ...last, end: p.end };
    else parts.push(p);
  }
  const merged: WorkingSection = { ...a, parts, included: a.included || b.included };
  return [...list.slice(0, index), merged, ...list.slice(index + 2)];
}

/** Split section `index` so paragraph `at` (0-based within it) starts a new section. */
export function splitAt(list: WorkingSection[], index: number, at: number, title?: string): WorkingSection[] {
  const s = list[index];
  if (!s || at <= 0 || at >= countParagraphs(s)) return list;
  const head: Required<SectionPart>[] = [];
  const tail: Required<SectionPart>[] = [];
  let offset = 0;
  for (const p of s.parts) {
    const len = p.end - p.start;
    if (offset + len <= at) head.push(p);
    else if (offset >= at) tail.push(p);
    else {
      const cut = p.start + (at - offset);
      head.push({ ...p, end: cut });
      tail.push({ ...p, start: cut });
    }
    offset += len;
  }
  const second: WorkingSection = { ...s, key: nextKey(), title: title ?? `${s.title} (continued)`, parts: tail };
  return [...list.slice(0, index), { ...s, parts: head }, second, ...list.slice(index + 1)];
}

export function updateSection(list: WorkingSection[], key: string, patch: Partial<WorkingSection>): WorkingSection[] {
  return list.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

export function moveSection(list: WorkingSection[], index: number, delta: -1 | 1): WorkingSection[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

export function toEditSections(list: WorkingSection[]): NonNullable<ImportEdits["sections"]> {
  return list.map((s) => ({ title: s.title.trim(), kind: s.kind, included: s.included, parts: s.parts }));
}
