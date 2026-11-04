/**
 * The guide: a conversation that explains Konchi and points you at it.
 *
 * This used to be the assistant that built a prompt with you and handed back
 * a request to run. It is not any more, and the split is the point. Doing
 * things is `studio.ts` — one planner per kind of change, each validating
 * every id it emits against a real timeline. Explaining things is here, and
 * it does no CRUD at all: it creates nothing, edits nothing, deletes nothing
 * and proposes no work. Two jobs that were fighting for one prompt.
 *
 * What it gained instead is the manual. Konchi ships a README and eleven
 * files in `docs/`, and every question people actually asked the old
 * assistant — which model can I ship, what is a stem, how do I connect an
 * agent, where is the licence — is answered in there in prose someone wrote
 * on purpose. `docs.ts` finds the handful of sections a question matches and
 * this file hands them over, so the answer is quoted from the documentation
 * rather than remembered from pre-training.
 *
 * Two rules survive from before, and one is new:
 *
 * - **Grounded, not general.** It answers from the sections it was given and
 *   the model cards it was shown. Where the docs are silent it says so.
 * - **It never runs anything.** Now literally: there is no action in its
 *   vocabulary. The worst it can do is send you to the wrong page.
 * - **It knows where things are.** Every answer can carry links into the app,
 *   checked against the real route table below, because "that is on the\n *   Models page" is only half an answer when the other half is a click.
 *
 * Pure and side-effect-free so the prompt and the parsing are testable without
 * a model running — see `server/test/assistant.test.ts`.
 */

import type { ChatMessage } from "./client.js";
import { familyGuidance } from "./enhance.js";
import { findSections, formatSections } from "./docs.js";

/**
 * Where things are, as the guide may cite them.
 *
 * Mirrored from `app/src/App.tsx`'s route table rather than derived from it —
 * the server cannot see the client's router — so a route added there and not
 * here is a place the guide will not send anyone, which is the safe way for
 * this list to be wrong. `parseAssistantReply` drops any link that is not on
 * it, so the failure mode is a missing button rather than a dead one.
 */
export const SITE_MAP: { to: string; label: string; what: string }[] = [
  { to: "/dashboard", label: "Dashboard", what: "recent sounds, projects, quick actions" },
  {
    to: "/studio",
    label: "Studio",
    what:
      "the shelf both builders share — the Script Builder for words you voice, " +
      "the Music Builder for prompts you arrange",
  },
  { to: "/voice/lab", label: "Voice Lab", what: "clone a voice, record a reference, audition" },
  { to: "/library", label: "Library", what: "everything generated, searchable and taggable" },
  { to: "/library/sfx", label: "SFX Library", what: "sound effects you have made" },
  { to: "/library/music", label: "Music", what: "tracks you have made" },
  { to: "/library/speech", label: "Text to Speech", what: "spoken reads" },
  { to: "/projects", label: "Projects", what: "folders that outlive a session" },
  { to: "/models", label: "Models", what: "install, download and inspect models and licences" },
  {
    to: "/agents",
    label: "Agents",
    what:
      "MCP clients, the connection details to paste into one, the call log, " +
      "and bundled skills",
  },
  { to: "/activity", label: "Activity", what: "jobs and logs" },
  { to: "/settings", label: "Settings", what: "audio, prompt assistant, artwork, storage, telemetry" },
  { to: "/console", label: "Console", what: "the hardware-style front panel" },
];

/** A link the guide offered, once it has been checked against `SITE_MAP`. */
export interface AssistantLink {
  to: string;
  label: string;
}

/** One generation model, as the assistant needs to understand it. A strict
 *  subset of `ModelInfo`: only what bears on "which model, and how do I talk\n *  to it" — licence included, because "can I ship this?" is the question a
 *  person asks first and the assistant must be able to answer. */
export interface AssistantModelCard {
  id: string;
  name: string;
  vendor: string;
  category: "sfx" | "music" | "voice" | "utility";
  family: string;
  license: { name: string; commercial: "yes" | "no" | "conditional" };
  max_duration_s: number;
  /** The composer's notion of ready: weights present and runtime importable. */
  ready: boolean;
  supports: {
    lyrics: boolean;
    negative_prompt: boolean;
    extend: boolean;
    cover: boolean;
  };
  defaults: { duration_s: number; steps?: number | null; cfg?: number | null };
  description: string;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

/** What the conversation has produced so far, in the shape the composer
 *  takes. Every field is optional because a proposal is allowed to be
 *  partial — "here is the prompt, tell me the length" is a real turn. */
export interface AssistantProposal {
  model: string;
  prompt: string;
  negative_prompt?: string | null;
  lyrics?: string | null;
  track_name?: string | null;
  duration_s?: number | null;
  tags?: string[];
}

/**
 * The timeline open beside the chat, when there is one.
 *
 * Deliberately the same shape the studio planner is given (`llm/studio.ts`'s
 * `StudioContext`), because it is literally the same snapshot — the page
 * sends one context and both halves read it. Without this the assistant is
 * asked things like "how many tracks do I have?" about an arrangement it
 * cannot see, and an answer about missing context is the worst possible
 * response to a question whose answer is sitting on screen.
 */
export interface AssistantStudio {
  tracks: { track_index: number; name: string | null; muted: boolean; soloed: boolean }[];
  clips: { id: string; track_index: number; start_s: number; duration_s: number; label: string }[];
  playhead_s: number;
  selected_ids: string[];
}

export interface AssistantContext {
  models: AssistantModelCard[];
  /** The composer's current contents, so "make it longer" and "same but\n   *  darker" refer to something. Null on a fresh conversation. */
  draft?: AssistantProposal | null;
  /** The studio open beside the chat, or null when none is. */
  studio?: AssistantStudio | null;
}

export interface AssistantReply {
  /** The guide's own words for the thread. Markdown-light: plain
   *  paragraphs, the odd list. */
  reply: string;
  /** Places in the app this answer points at, checked against `SITE_MAP`.
   *  Empty when the answer is self-contained. */
  links: AssistantLink[];
  /** Which documentation sections the answer was drawn from, so the reader
   *  can go and read the whole thing. */
  sources: string[];
}

/** One empty-thread chip: `label` is the pill, `text` is the message it sends. */
export interface AssistantOpener {
  label: string;
  text: string;
}

/** What the empty chat shows when the LLM is off, unreachable, or unhelpful. */
export const FALLBACK_OPENERS: AssistantOpener[] = [
  { label: "Which model?", text: "Which of my models should I use, and which can I ship commercially?" },
  { label: "Horror door", text: "I need a door slam for a horror game" },
  { label: "Lo-fi loop", text: "Write me a 20 second lo-fi beat to loop under a menu" },
  {
    label: "Theme song",
    text: "Help me make a short theme song with vocals for an indie game about a lighthouse keeper",
  },
];

/** Conversations are trimmed to this many turns before they reach the model.
 *  A small local model's context is finite, and the oldest turns of a prompt
 *  negotiation are the least useful — what matters is the draft, which rides
 *  along in the context every time. */
export const MAX_HISTORY_TURNS = 20;

export function assistantResponseFormat(): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "assistant_reply",
      schema: {
        type: "object",
        properties: {
          reply: { type: "string" },
          links: {
            type: "array",
            items: {
              type: "object",
              properties: { to: { type: "string" }, label: { type: "string" } },
              required: ["to"],
            },
          },
        },
        required: ["reply"],
      },
    },
  };
}

export function openerResponseFormat(): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "assistant_openers",
      schema: {
        type: "object",
        properties: {
          openers: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, text: { type: "string" } },
              required: ["label", "text"],
            },
          },
        },
        required: ["openers"],
      },
    },
  };
}

function describeCard(card: AssistantModelCard): string {
  const licence =
    card.license.commercial === "yes"
      ? "commercial use OK"
      : card.license.commercial === "no"
        ? "NON-COMMERCIAL only"
        : "commercial use conditional";
  const can = [
    card.supports.lyrics ? "sings lyrics" : null,
    card.supports.negative_prompt ? "negative prompt" : null,
    card.supports.extend ? "extend" : null,
    card.supports.cover ? "cover" : null,
  ].filter(Boolean);
  const lines = [
    `- ${card.id} — ${card.name} by ${card.vendor} [${card.category}]` +
      `${card.ready ? "" : " (NOT INSTALLED — do not propose it)"}`,
    `    licence: ${card.license.name}, ${licence}`,
    `    up to ${card.max_duration_s}s per render, default ${card.defaults.duration_s}s` +
      `${can.length ? `; ${can.join(", ")}` : ""}`,
    `    ${card.description.trim()}`,
  ];
  const guidance = familyGuidance(card.family);
  if (guidance) lines.push(`    how to prompt it: ${guidance}`);
  return lines.join("\n");
}

function describeDraft(draft: AssistantProposal): string {
  const parts = [`model: ${draft.model}`, `prompt: ${draft.prompt || "(empty)"}`];
  if (draft.negative_prompt) parts.push(`negative prompt: ${draft.negative_prompt}`);
  if (draft.lyrics) parts.push(`lyrics:\n${draft.lyrics}`);
  if (draft.track_name) parts.push(`track name: ${draft.track_name}`);
  if (draft.duration_s != null) parts.push(`duration: ${draft.duration_s}s`);
  if (draft.tags?.length) parts.push(`tags: ${draft.tags.join(", ")}`);
  return parts.join("\n");
}

/**
 * The timeline in plain lines, the way `studio.ts` writes it — a numbered
 * list, because what gets asked of it is counting and reference-resolving
 * ("how many tracks", "the vocal", "1 and 3"), and a list is the form that
 * makes both legible.
 */
function describeStudio(s: AssistantStudio): string {
  const tracks = s.tracks.length
    ? s.tracks
        .map(
          (t) =>
            `  track ${t.track_index}: ${t.name ?? "(unnamed)"}` +
            `${t.muted ? " [muted]" : ""}${t.soloed ? " [soloed]" : ""}`,
        )
        .join("\n")
    : "  (none yet — this timeline is empty)";
  const clips = s.clips.length
    ? s.clips
        .map(
          (c) =>
            `  track ${c.track_index}, ${c.start_s.toFixed(2)}s–` +
            `${(c.start_s + c.duration_s).toFixed(2)}s: ${c.label || "(empty)"}`,
        )
        .join("\n")
    : "  (none yet)";
  return (
    `The studio open beside this chat has ${s.tracks.length} ` +
    `track${s.tracks.length === 1 ? "" : "s"} and ${s.clips.length} ` +
    `clip${s.clips.length === 1 ? "" : "s"}.\n` +
    `Tracks:\n${tracks}\n` +
    `Clips:\n${clips}\n` +
    `Playhead: ${s.playhead_s.toFixed(2)}s. ` +
    `Selected: ${s.selected_ids.length || "nothing"}.\n` +
    "Answer questions about this arrangement from these lines. The work " +
    "itself — edits (mute, rename, move, delete, effects) and new audio " +
    "(music, sound effects, speech) alike — is handled elsewhere and never " +
    "by you. Generation used to be missing from that sentence, which left " +
    "it to the blanket 'you make nothing' rule above and turned every " +
    "'write me a bassline' into a refusal. So: if they ask for work, say it " +
    "is on its way rather than refusing, and keep your answer to a " +
    "sentence — or to a single sharpening question when the brief is too " +
    "thin to make anything from."
  );
}

/**
 * The same snapshot as `describeStudio`, without the "you never edit"
 * paragraph — openers *may* be edits, because the chat box routes those to
 * the studio planner rather than to the guide.
 */
function describeStudioForOpeners(s: AssistantStudio): string {
  const tracks = s.tracks.length
    ? s.tracks
        .map(
          (t) =>
            `  track ${t.track_index}: ${t.name ?? "(unnamed)"}` +
            `${t.muted ? " [muted]" : ""}${t.soloed ? " [soloed]" : ""}`,
        )
        .join("\n")
    : "  (none yet — this timeline is empty)";
  const clips = s.clips.length
    ? s.clips
        .map(
          (c) =>
            `  track ${c.track_index}, ${c.start_s.toFixed(2)}s–` +
            `${(c.start_s + c.duration_s).toFixed(2)}s: ${c.label || "(empty)"}`,
        )
        .join("\n")
    : "  (none yet)";
  return (
    `THIS ARRANGEMENT (only names that appear here are real — do not invent others)\n` +
    `${s.tracks.length} track${s.tracks.length === 1 ? "" : "s"}, ` +
    `${s.clips.length} clip${s.clips.length === 1 ? "" : "s"}.\n` +
    `Tracks:\n${tracks}\n` +
    `Clips:\n${clips}`
  );
}

/**
 * The whole conversation, with the catalogue and the draft in front of it.
 *
 * The cards are the system prompt rather than a tool the model could call:
 * a small local model is far more reliable reading facts it was handed than
 * deciding to go and fetch them, and the catalogue is short enough to fit.
 */
export function buildAssistantMessages(
  turns: AssistantTurn[],
  ctx: AssistantContext,
): ChatMessage[] {
  const cards = ctx.models.length ? ctx.models.map(describeCard).join("\n") : "  (none installed)";

  // The question is the last thing they said: that is what the docs are
  // searched against. Searching the whole thread would drag every earlier
  // subject into the results and bury the one being asked about now.
  const question = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const found = findSections(question);
  const routes = SITE_MAP.map((r) => `  ${r.to} — ${r.label}: ${r.what}`).join("\n");

  const system =
    "You are the guide inside Konchi, a local app that makes sound effects, " +
    "music and speech with open-weight models that run on this machine. You " +
    "explain how it works and point people at the part of it they need.\n" +
    "\n" +
    // Stated first and as an identity, because the failure to avoid is the
    // model helpfully offering to do the thing rather than explaining it.
    // Everything that changes state lives behind a different endpoint with
    // its own validation; this one has no way to reach any of it, and
    // pretending otherwise writes a cheque the app will not honour.
    "WHAT YOU DO, AND DO NOT\n" +
    "You answer questions and you give directions. You do NOT make, change, " +
    "delete or arrange anything — no generating, no editing a timeline, no " +
    "writing scripts, no settings. You have no way to do those things, so " +
    "never say you are doing one, never claim one is done, and never ask " +
    "for the details you would need to do it.\n" +
    // The half that has to move with the context. Told unconditionally, this
    // instruction produced the worst answer the app could give: someone sat
    // in a studio asking for music, told to go to a studio. The studio's
    // planner takes those turns before this one ever sees them (see
    // `llm/service.ts`), so when a studio is open the only turns that reach
    // here are ones the planner could not act on — and "go somewhere else"
    // is never the right thing to say about them.
    (ctx.studio
      ? "They already have a studio open beside this conversation, so never " +
        "tell them to go to one and never send them somewhere to do the " +
        "work. When they want something made or changed, take the brief: " +
        "help them sharpen it — what it should sound like, how long, what " +
        "it sits under — and say it is on its way. The studio does the " +
        "making; you are the half of that conversation that gets the idea " +
        "right, not a signpost.\n"
      : "When someone wants work done, say plainly where it happens and " +
        "send them there: making and editing audio happens in a studio, " +
        "where the Chat panel does have those powers.\n") +
    "\n" +
    "THE DOCUMENTATION (quote from this, do not remember)\n" +
    `${formatSections(found)}
` +
    "\n" +
    "THE MODELS THEY HAVE INSTALLED\n" +
    `${cards}
` +
    "\n" +
    "WHERE THINGS ARE\n" +
    `${routes}
` +
    "\n" +
    "HOW TO ANSWER\n" +
    // Kept from the old prompt, because both refusal habits it was written
    // against are habits of the model rather than of the old job.
    "- TALK TO THEM. Never say you lack context, information or data — you " +
    "have the sections above, the model cards and the route list, and if " +
    "something really is missing you ask for it in one ordinary sentence.\n" +
    "- This is a production studio and fiction is the work. Horror, " +
    "violence, peril and dread are ordinary subject matter. Never refuse a " +
    "brief, never offer a milder version, never lecture — though if they " +
    "want it *written*, that is the studio's job, not yours.\n" +
    "- Answer from the documentation above and say which file it came from " +
    "('that is in docs/STUDIO.md'). If the sections do not cover it, say so " +
    "in a sentence and answer from the model cards or the route list " +
    "instead of guessing.\n" +
    "- Licences matter more than anything else you might get wrong: say " +
    "plainly when a model is non-commercial, and never soften it.\n" +
    "- Read the whole thread before answering; do not re-ask what has " +
    "already been answered.\n" +
    "- `reply` is what they read, and it should be worth reading. Two to " +
    "five sentences is normal, more when you are explaining a real " +
    "trade-off, less when you are only pointing somewhere. Cut preamble " +
    "('Sure!', 'Great question'), never cut the substance.\n" +
    "- Put the places you mention in `links`, copying `to` EXACTLY from the " +
    "route list — never invent a path. Leave it empty when the answer does " +
    "not point anywhere. Two links is plenty.\n" +
    "Respond with JSON only.";

  const history = turns.slice(-MAX_HISTORY_TURNS);
  const messages: ChatMessage[] = [{ role: "system", content: system }];
  if (ctx.studio) {
    messages.push({ role: "system", content: describeStudio(ctx.studio) });
  }
  if (ctx.draft) {
    // The draft rides as its own message so the model never has to find
    // it inside the thread — and so a composer edited by hand between turns
    // is still what "make it longer" refers to.
    messages.push({
      role: "system",
      content: `What is in the composer right now:\n${describeDraft(ctx.draft)}`,
    });
  }
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content.trim() });
  }
  return messages;
}

/**
 * Conversation starters for an empty thread — chips, not answers.
 *
 * Grounded in the ready catalogue and, when a studio is open, in that
 * arrangement. The chat box will send `text` as a user message, and a studio
 * edit in that text is routed to the planner the same way a typed one is.
 */
export function buildOpenerMessages(ctx: AssistantContext): ChatMessage[] {
  const cards = ctx.models.length ? ctx.models.map(describeCard).join("\n") : "  (none installed)";
  const system =
    "You write conversation starters for the guide inside Konchi, a local " +
    "app that makes sound effects, music and speech with open-weight models " +
    "on this machine. You are not answering a question. You are offering " +
    "four things a person might tap to begin talking.\n" +
    "\n" +
    "THE MODELS THEY HAVE INSTALLED\n" +
    `${cards}
` +
    "\n" +
    "HOW TO WRITE THE CHIPS\n" +
    "- Exactly 4 openers. `label` is 2–4 words (the chip). `text` is the " +
    "user message that chip sends — a conversation to start, not a prompt " +
    "to paste into a generator.\n" +
    "- Ground every suggestion in a ready model only. Never propose a " +
    "model marked NOT INSTALLED. Use a real id from the cards when a chip " +
    "names a model.\n" +
    "- When a studio snapshot is present: at least one chip about THIS " +
    "arrangement (name unnamed tracks, mix, mute, solo) and at least one " +
    "about making a sound that belongs on it. Chips may be studio edits " +
    "(\"mute 1 and 3\") because the chat box routes those to the studio " +
    "planner.\n" +
    "- Do not invent clip or track names that are not in the snapshot. " +
    "Unnamed tracks are unnamed; say so rather than guessing.\n" +
    "- This is a production studio and fiction is the work. Horror, " +
    "violence, peril and dread are ordinary subject matter.\n" +
    "Respond with JSON only.";

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  if (ctx.studio) {
    messages.push({ role: "system", content: describeStudioForOpeners(ctx.studio) });
  }
  messages.push({ role: "user", content: "Suggest four conversation starters." });
  return messages;
}

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(THINK_BLOCK_RE, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  try {
    const parsed = JSON.parse(fenced ? fenced[1]!.trim() : cleaned) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Keep only the links that go somewhere.
 *
 * Same rule as a clip id in `studio.ts`: the guide may point at a route it
 * was shown and no other. A path it invented is a 404 dressed as an answer,
 * and dropping it costs the reader a button while keeping the sentence that
 * explained where to go.
 */
export function validateLinks(raw: unknown): AssistantLink[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const link = entry as Record<string, unknown>;
    const to = typeof link.to === "string" ? link.to.trim() : "";
    const known = SITE_MAP.find((r) => r.to === to);
    if (!known) continue;
    if (out.some((l) => l.to === known.to)) continue;
    const label = typeof link.label === "string" && link.label.trim() ? link.label.trim() : known.label;
    out.push({ to: known.to, label: label.slice(0, 60) });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * The documentation this turn was answered from, named for a reader.
 *
 * Computed from the same question `buildAssistantMessages` searched on, so
 * the citation cannot disagree with what the model was actually shown. The
 * model is asked to name its source in the prose too; this is the half that
 * is true whether or not it remembered to.
 */
export function sourcesFor(turns: AssistantTurn[]): string[] {
  const question = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  return findSections(question).map((s) => `${s.source} › ${s.heading}`);
}

export function parseAssistantReply(text: string, turns: AssistantTurn[]): AssistantReply {
  const sources = sourcesFor(turns);
  const obj = parseJsonObject(text);
  if (!obj) {
    // An endpoint that ignored the response format and answered in prose is
    // still an answer — show it, with nothing to click.
    const plain = text.replace(THINK_BLOCK_RE, "").trim();
    return { reply: plain, links: [], sources };
  }
  const reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
  return { reply, links: validateLinks(obj.links), sources };
}

/** Keep up to four well-formed chips; fewer than two is not a list — fall back. */
export function parseOpeners(text: string): AssistantOpener[] {
  const obj = parseJsonObject(text);
  const raw = obj && Array.isArray(obj.openers) ? obj.openers : [];
  const out: AssistantOpener[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const body = typeof row.text === "string" ? row.text.trim() : "";
    if (!label || !body) continue;
    out.push({ label: label.slice(0, 40), text: body.slice(0, 800) });
    if (out.length === 4) break;
  }
  return out.length >= 2 ? out : FALLBACK_OPENERS;
}
