/**
 * Request-body templates for custom audio endpoints.
 *
 * There is no standard body for "make me some music". LocalAI's
 * `/v1/sound-generation` wants `caption`/`lyrics`/`bpm`/`keyscale`, Inference
 * Gateway's `/v1/audio/music` wants `prompt` + `duration_seconds`, and
 * Privateer's endpoint of the same path wants `input` + `duration`. So the body
 * is the user's to write, as JSON with `{{variable}}` placeholders, and this
 * module fills them in.
 *
 * Three placements, decided by where the placeholder sits:
 *
 *   "bpm": {{bpm}}          bare        → the JSON value (number, bool, null)
 *   "bpm": "{{bpm}}"        whole string → also the JSON value, so a template
 *                                          can stay valid JSON in an editor
 *   "caption": "a {{key}} loop"  inside a string → the value as text
 *
 * A field whose value comes out `null` is dropped from the body, recursively.
 * That is what makes optional variables usable: `{{bpm}}` is null when the
 * prompt names no tempo, and a server is far more likely to accept a missing
 * field than a `null` it did not ask for.
 *
 * The template is substituted as text and only then parsed, which is how the
 * bare form can work at all. Every value is JSON-encoded on the way in, so a
 * prompt with a quote or a brace in it cannot break out of its string.
 */

import { ModelError } from "../errors.js";

export type TemplateValue = string | number | boolean | null;
export type TemplateVars = Record<string, TemplateValue>;

/** Every variable Konchi can fill, with what it means. The settings page
 *  lists these, and `validateTemplate` rejects any name not here — a typo'd
 *  `{{promt}}` should fail at save time, not as a 400 from someone's server. */
export const TEMPLATE_VARIABLES: Record<string, string> = {
  prompt: "The description from the composer (sound effects and music).",
  negative_prompt: "What to avoid, when the composer has one. Null otherwise.",
  lyrics: "Lyrics for a vocal track. Null when there are none.",
  instrumental: "true when there are no lyrics.",
  duration: "Requested length in seconds.",
  duration_ms: "Requested length in milliseconds.",
  bpm: "A tempo named in the prompt (\"90 BPM\"). Null when there is none.",
  key: "A key named in the prompt (\"A minor\", \"Ebm\"). Null when there is none.",
  seed: "The seed for this render.",
  steps: "Sampler steps, when set. Null otherwise.",
  cfg: "Guidance scale, when set. Null otherwise.",
  text: "The line to speak (speech endpoints).",
  voice: "The chosen voice name, or the endpoint's default voice (speech).",
  voice_ref_b64: "The reference clip of a cloned voice, base64 WAV (speech). Null otherwise.",
  language: "A language code when one was chosen (speech). Null otherwise.",
};

const PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

/** The variable names a template uses, in order of first appearance. */
export function templateVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) seen.add(m[1]!);
  return [...seen];
}

/**
 * Fill a template and return the parsed body.
 *
 * Throws a `ModelError` naming the problem when the result is not JSON, which
 * after substitution can only mean the template itself was broken.
 */
export function renderTemplate(template: string, vars: TemplateVars): unknown {
  const text = substitute(template, vars);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (exc) {
    throw new ModelError(
      `The endpoint's body template is not valid JSON once filled in ` +
        `(${exc instanceof Error ? exc.message : String(exc)}). Check its quotes and commas.`,
    );
  }
  return dropNulls(body);
}

/**
 * Check a template before it is saved: known variables only, and valid JSON
 * when filled with sample values of every type a variable can take.
 */
export function validateTemplate(template: string): void {
  const unknown = templateVariables(template).filter((v) => !(v in TEMPLATE_VARIABLES));
  if (unknown.length) {
    throw new ModelError(
      `Unknown template variable${unknown.length > 1 ? "s" : ""}: ` +
        `${unknown.map((v) => `{{${v}}}`).join(", ")}. ` +
        `Available: ${Object.keys(TEMPLATE_VARIABLES).join(", ")}.`,
    );
  }
  // Nulls and strings are the two that can break a template that a number
  // would not (a bare placeholder as an object key, say), so try both.
  const asNull: TemplateVars = Object.fromEntries(Object.keys(TEMPLATE_VARIABLES).map((k) => [k, null]));
  const asText: TemplateVars = Object.fromEntries(Object.keys(TEMPLATE_VARIABLES).map((k) => [k, 'a "b"']));
  const body = renderTemplate(template, asText);
  renderTemplate(template, asNull);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ModelError("The body template must be a JSON object ({ ... }).");
  }
}

/**
 * Text substitution that knows whether it is inside a JSON string.
 *
 * A small scanner rather than a regex replace, because the same placeholder
 * needs a different encoding depending on whether it is bare, a whole string,
 * or part of one — and only tracking the quotes (and their escapes) can tell.
 */
function substitute(template: string, vars: TemplateVars): string {
  const value = (name: string): TemplateValue => (name in vars ? vars[name]! : null);
  let out = "";
  let i = 0;
  let inString = false;
  while (i < template.length) {
    const ch = template[i]!;
    if (inString && ch === "\\") {
      out += template.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"') {
      // A string that is exactly one placeholder becomes that value, typed.
      if (!inString) {
        const whole = /^"\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}"/.exec(template.slice(i));
        if (whole) {
          out += JSON.stringify(value(whole[1]!));
          i += whole[0].length;
          continue;
        }
      }
      inString = !inString;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "{" && template[i + 1] === "{") {
      const m = /^\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/.exec(template.slice(i));
      if (m) {
        const v = value(m[1]!);
        // Inside a string: the text of the value, escaped, with null as "".
        // Bare: the JSON value itself.
        out += inString ? JSON.stringify(v === null ? "" : String(v)).slice(1, -1) : JSON.stringify(v);
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = dropNulls(v);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------- reading the prompt */

/** "90 BPM", "120bpm", "92.5 bpm". */
const BPM = /(\d{2,3}(?:\.\d+)?)\s*bpm\b/i;

/**
 * "A minor", "Eb major", "F# min", "Am", "C#m".
 *
 * The note letter must be upper case. Case-insensitive matching turns
 * "a major hit" and "a minimal beat" into keys, and nobody writing a key into
 * a prompt writes the note in lower case.
 */
const KEY = /(?<![A-Za-z])([A-G])(#|b|♯|♭)?\s?(major|minor|maj|min|m)(?![a-z])/;

/** The tempo the prompt names, if it names one. */
export function bpmFromPrompt(prompt: string): number | null {
  const m = BPM.exec(prompt);
  if (!m) return null;
  const bpm = Number(m[1]);
  return bpm >= 20 && bpm <= 400 ? bpm : null;
}

/** The key the prompt names, normalised to "Eb minor" form, if it names one. */
export function keyFromPrompt(prompt: string): string | null {
  const m = KEY.exec(prompt);
  if (!m) return null;
  const accidental = m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : (m[2] ?? "");
  const quality = m[3]!.startsWith("maj") ? "major" : "minor";
  return `${m[1]}${accidental} ${quality}`;
}
