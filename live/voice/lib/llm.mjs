// The reply, token by token, from any OpenAI-compatible chat endpoint:
// the local llama-server by default, or whatever LLM_BASE_URL points at.

import { config } from "./config.mjs";
import { sseJson } from "./tts.mjs";

/** Yields text deltas. `history` is [{role, content}] without the system turn. */
export async function* chat(llm, history, signal, system = config.llm.system) {
  const headers = { "content-type": "application/json" };
  if (llm.apiKey) headers.authorization = `Bearer ${llm.apiKey}`;
  const body = {
    model: llm.model,
    stream: true,
    temperature: 0.6,
    max_tokens: config.llm.maxTokens,
    messages: [{ role: "system", content: system }, ...history],
  };
  // Qwen3 thinks by default, which would put seconds before the first word.
  // llama.cpp reads this; hosted endpoints don't know it, so local only.
  // A remote llama-server (e.g. on a second PC) needs it too: set
  // LLM_NO_THINK=1 with LLM_PROVIDER=openai.
  if (llm.local || process.env.LLM_NO_THINK === "1") body.chat_template_kwargs = { enable_thinking: false };
  const resp = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  for await (const msg of sseJson(resp.body)) {
    const delta = msg.choices?.[0]?.delta?.content;
    // Emoji can't be spoken, and small models add them anyway.
    const clean = typeof delta === "string" ? delta.replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍]/gu, "") : "";
    if (clean) yield clean;
  }
}

const SENTENCE_END = /[.!?…]+["')\]]*\s/;
const CLAUSE_END = /[,;:—–]\s/;

/**
 * Cuts a token stream into speakable pieces: whole sentences, except that the
 * very first piece may stop at a clause boundary so speech starts sooner.
 */
export class SentenceChunker {
  #buf = "";
  #first = true;

  /** @returns {string[]} pieces completed by this delta */
  push(delta) {
    this.#buf += delta;
    const out = [];
    for (;;) {
      let m = SENTENCE_END.exec(this.#buf);
      if (this.#first && config.firstClauseWords > 0) {
        const c = CLAUSE_END.exec(this.#buf);
        if (c && (!m || c.index < m.index)) {
          const words = this.#buf.slice(0, c.index).trim().split(/\s+/).length;
          if (words >= config.firstClauseWords) m = c;
        }
      }
      if (!m) break;
      const end = m.index + m[0].length;
      const piece = this.#buf.slice(0, end).trim();
      this.#buf = this.#buf.slice(end);
      if (piece) {
        out.push(piece);
        this.#first = false;
      }
    }
    return out;
  }

  flush() {
    const rest = this.#buf.trim();
    this.#buf = "";
    return rest ? [rest] : [];
  }
}
