/**
 * Dialogue punctuation, made consistent for text-to-speech.
 *
 * Books mark speech in several ways, and TTS models read curly double
 * quotes most reliably (they hear a quotation, not a pause or a stray
 * symbol). So:
 *  - « French » and » German « guillemets, „German“ / „Polish” low-high
 *    quotes and ‹ › / › ‹ / ‚ ‘ single forms become “ ” and ‘ ’;
 *  - em-dash dialogue (Spanish, Russian, French, Italian, Polish…), where a
 *    paragraph opens with a dash and further dashes switch between speech
 *    and narration, becomes quoted speech:
 *      — Ты пришёл? — спросила она.        → “Ты пришёл?” спросила она.
 *      —¿Vienes? —preguntó ella—. Hoy no.  → “¿Vienes?” preguntó ella. “Hoy no.”
 * Paragraphs that don't open with a dash keep their dashes (asides,
 * interruptions). Nothing else in the text changes.
 */

const DASH = "[—―]|(?:^|\\s)–(?=\\s)";
const OPENS_WITH_DASH = /^\s*(?:[—―]|–(?=\s))\s*/u;

/** Guillemet direction for a batch of paragraphs: French « … » or German » … «. */
function guillemetStyle(paragraphs: string[]): "fr" | "de" {
  let fr = 0;
  let de = 0;
  for (const p of paragraphs) {
    const open = p.search(/[«»]/u);
    if (open < 0) continue;
    if (p[open] === "«") fr++;
    else de++;
  }
  return de > fr ? "de" : "fr";
}

/** Quote marks only; dashes untouched. */
export function normaliseQuotes(text: string, style: "fr" | "de" = "fr"): string {
  let s = text;
  if (style === "fr") {
    s = s.replace(/«[\s  ]*/gu, "“").replace(/[\s  ]*»/gu, "”");
    s = s.replace(/‹[\s  ]*/gu, "‘").replace(/[\s  ]*›/gu, "’");
  } else {
    s = s.replace(/»/gu, "“").replace(/«/gu, "”").replace(/›/gu, "‘").replace(/‹/gu, "’");
  }
  // „…“ (German) and „…” (Polish, Dutch): the closing mark after „ is a close.
  s = s.replace(/„([^„“”]*)[“”]/gu, "“$1”").replace(/„/gu, "“");
  s = s.replace(/‚([^‚‘’]*)[‘’]/gu, "‘$1’");
  return s;
}

/** A paragraph of em-dash dialogue as quoted speech; others unchanged. */
export function dashDialogueToQuotes(text: string): string {
  if (!OPENS_WITH_DASH.test(text)) return text;
  const body = text.replace(OPENS_WITH_DASH, "");
  const parts = body.split(new RegExp(`\\s*(?:${DASH})\\s*`, "u"));
  // "— Jane Austen, Persuasion": an attribution, not speech.
  if (parts.length === 1 && !/[.!?…»”"]$/u.test(body.trim())) return text;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]!.trim();
    if (!part) continue;
    const speech = i % 2 === 0;
    if (speech && i > 0) {
      // "—preguntó ella—. Hoy no.": the punctuation after the closing dash
      // ends the narration, not the speech.
      const lead = /^[.,;:]+\s*/u.exec(part);
      if (lead && out.length) {
        out[out.length - 1] += lead[0].trim();
        part = part.slice(lead[0].length).trim();
      }
      if (!part) continue;
    }
    out.push(speech ? `“${part}”` : part);
  }
  return out.join(" ").replace(/\s+([,.;:!?])/gu, "$1");
}

/** Apply both to a batch of paragraphs (one section or book). */
export function normaliseDialogue(paragraphs: string[]): string[] {
  const style = guillemetStyle(paragraphs);
  return paragraphs.map((p) => dashDialogueToQuotes(normaliseQuotes(p, style)));
}
