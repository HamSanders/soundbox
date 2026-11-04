/**
 * A minimal OpenAI-compatible chat client.
 *
 * The one thing both the managed llama-server process and an external
 * endpoint (Ollama, LM Studio, any `/v1/chat/completions` server) share, so
 * `llm/service.ts` doesn't need two code paths — only two ways of picking a
 * `baseUrl`.
 */

import { apiUrl, NOT_FOUND_HINT } from "../apiUrl.js";
import { ModelError } from "../errors.js";
import { getLogger } from "../logging.js";

const log = getLogger("konchi.llm");

const REQUEST_TIMEOUT_MS = 60_000;

export interface ChatMessage {
  /** "assistant" carries the model's own earlier turns back to it — the
   *  multi-turn chat in `assistant.ts` is the only caller that needs it. */
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** JSON-schema response format — llama-server compiles this to a grammar.
   *  Not every external endpoint honours it; callers must still be able to
   *  parse free text as a fallback. */
  responseFormat?: Record<string, unknown>;
  /** Qwen3's thinking-mode switch. Harmless to send to endpoints that ignore
   *  unknown chat-template kwargs. */
  chatTemplateKwargs?: Record<string, unknown>;
}

/** Fetch injected so tests never touch the network. */
export type FetchFn = typeof fetch;

interface RawChoice {
  finish_reason?: string;
  message?: { content?: string; reasoning?: string; reasoning_content?: string };
}

/** "Don't reason, just answer" has two spellings in the wild, and a server that
 *  understands one usually ignores the other silently, so we send both.
 *
 *  `chat_template_kwargs.enable_thinking` is llama.cpp's; Ollama only reads it
 *  on its native `/api/chat`, not on the OpenAI-compat route this client uses.
 *  `reasoning_effort` is the OpenAI-standard one Ollama does honour there.
 *  Getting this wrong is not a slow answer but no answer at all: an unmuzzled
 *  Qwen3 spends its entire context window thinking, gets cut off by `num_ctx`
 *  before writing a single character of the reply, and returns empty `content`
 *  with `finish_reason: "length"`. */
function thinkingDisabled(opts: ChatCompletionOptions): boolean {
  return opts.chatTemplateKwargs?.enable_thinking === false;
}

/** Ceiling for the one retry below. Big enough to cover a short reasoning pass
 *  plus the answer; small enough that failing still fails fast. */
const THINKING_RETRY_MAX_TOKENS = 2048;

async function postChatCompletion(
  opts: ChatCompletionOptions,
  maxTokens: number,
  fetchImpl: FetchFn,
): Promise<RawChoice | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = apiUrl(opts.baseUrl, "/v1/chat/completions");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    stream: false,
  };
  body.max_tokens = maxTokens;
  if (opts.responseFormat) body.response_format = opts.responseFormat;
  if (opts.chatTemplateKwargs) body.chat_template_kwargs = opts.chatTemplateKwargs;
  if (thinkingDisabled(opts)) body.reasoning_effort = "none";

  let resp: Response;
  const started = Date.now();
  // URL, model and outcome only. Never the key, and never the messages: they
  // are the user's prompts.
  log.debug(`POST ${url} model=${opts.model || "(none)"} max_tokens=${maxTokens}`);
  try {
    resp = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (exc) {
    const aborted = exc instanceof Error && exc.name === "AbortError";
    log.debug(`POST ${url} failed after ${Date.now() - started}ms: ${aborted ? "timeout" : String(exc)}`);
    throw new ModelError(
      aborted
        ? `The prompt-assistant endpoint at ${url} did not respond in time.`
        : `Could not reach the prompt-assistant endpoint at ${url}: ${String(exc)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  log.debug(`POST ${url} -> HTTP ${resp.status} in ${Date.now() - started}ms`);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ModelError(
      `Prompt-assistant endpoint ${url} returned HTTP ${resp.status}` +
        `${text ? `: ${text.slice(0, 500)}` : ""}` +
        (resp.status === 404 ? `\n\n${NOT_FOUND_HINT}` : ""),
    );
  }

  const data = (await resp.json()) as { choices?: RawChoice[] };
  return data.choices?.[0];
}

export async function chatCompletion(
  opts: ChatCompletionOptions,
  fetchImpl: FetchFn = fetch,
): Promise<string> {
  const requestedTokens = opts.maxTokens ?? 256;
  let choice = await postChatCompletion(opts, requestedTokens, fetchImpl);
  let content = choice?.message?.content;

  // A server that honoured neither thinking switch above reasons anyway, and
  // the trace comes back out-of-band in `reasoning` rather than as inline
  // `<think>` tags `parseEnhanceResponse` could strip — so `content` is empty
  // through no fault of the prompt. One more attempt with room for the
  // reasoning *and* an answer is worth it, but the ceiling stays finite on
  // purpose: lifting it entirely just lets the model think until `num_ctx`
  // cuts it off, which spends the whole request timeout to arrive at the same
  // empty string.
  const reasoning = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
  if (!content && reasoning && requestedTokens < THINKING_RETRY_MAX_TOKENS) {
    choice = await postChatCompletion(opts, THINKING_RETRY_MAX_TOKENS, fetchImpl);
    content = choice?.message?.content;
  }

  if (typeof content !== "string") {
    throw new ModelError("Prompt-assistant endpoint returned an unexpected response shape.");
  }
  if (!content && choice?.finish_reason === "length") {
    throw new ModelError(
      `The prompt assistant at ${opts.baseUrl} used its whole context reasoning and never ` +
        `wrote an answer. Turn off the model's thinking mode, or pick a non-reasoning model.`,
    );
  }
  return content;
}
