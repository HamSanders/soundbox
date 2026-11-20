/**
 * Audiobooks: dialogue-only casting inside a paragraph.
 *
 * A paragraph cast to a character often mixes dialogue with narration:
 *
 *   "The oil delivery was late," she said. "Blame the boat, not me."
 *
 * The character should read only the quoted words; "she said" belongs to the
 * narrator, as it would with a human cast. ElevenLabs Studio does the same
 * thing with a voice per text selection inside one paragraph (see
 * docs/audiobooks/research-elevenlabs.md, "Per-selection voice").
 *
 * `dialogueParts` splits such a paragraph into ordered narration and dialogue
 * pieces. The renderer voices each piece separately and the service joins
 * them into one clip, with a pause chosen by `partGapS`, so the paragraph
 * keeps one clip, one take and one read-along entry.
 */

import { splitDialogue } from "../llm/characters.js";

/** One piece of a paragraph, spoken by one voice on one model. */
export interface SpokenPart {
  text: string;
  voice_id: string | null;
  model: string;
}

export interface DialoguePiece {
  text: string;
  /** true = inside quotes (the character's line), false = narration. */
  quote: boolean;
}

/** Quote marks the splitter recognises, stripped before speaking. */
const OPEN = /^["“‘]/u;
const CLOSE = /["”’]$/u;
/** Joining punctuation an attribution starts with after a quote (", she said"). */
const LEADING_GLUE = /^[\s,;:—–-]+/u;

/**
 * Split a paragraph into narration and dialogue pieces, or null when it is
 * all one or the other (nothing to split). Quote marks are removed from the
 * dialogue, and the comma or dash that glues an attribution to its quote is
 * removed from the narration, so neither voice reads stray punctuation.
 */
export function dialogueParts(text: string): DialoguePiece[] | null {
  const raw = splitDialogue(text);
  if (!raw.some((p) => p.quote) || !raw.some((p) => !p.quote)) return null;
  const out: DialoguePiece[] = [];
  for (const p of raw) {
    const t = p.quote ? p.text.replace(OPEN, "").replace(CLOSE, "").trim() : p.text.replace(LEADING_GLUE, "").trim();
    // A narration piece of punctuation only (a lone "." after a quote) adds nothing to read.
    if (!/[\p{L}\p{N}]/u.test(t)) continue;
    out.push({ text: t, quote: p.quote });
  }
  return out.some((p) => !p.quote) && out.some((p) => p.quote) ? out : null;
}

/**
 * Pause after a piece, by how it ends. A comma or dash is a breath inside a
 * sentence; a full stop, question or exclamation ends one. The figures are
 * our own choice for gapless joins, not from a published standard.
 */
export function partGapS(prev: string): number {
  const end = prev.trim().replace(/["”’)\]]+$/u, "");
  if (/[.!?…]$/u.test(end)) return 0.32;
  if (/[,;:—–-]$/u.test(end)) return 0.14;
  return 0.18;
}
