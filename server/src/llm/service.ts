/**
 * `LlmService` — the prompt-assistant façade `KonchiService` owns.
 *
 * Resolves `Settings.llm_mode` into a base URL + model name each call (managed
 * or external), keeps the one managed `llama-server` process alive across
 * calls via `LlmRuntime`, and turns the raw chat completion into parsed
 * prompt variations.
 */

import type { Config } from "../config.js";
import { ModelError } from "../errors.js";
import {
  LLM_MODELS,
  deleteWeights,
  downloadWeights,
  isDownloaded,
  llmModelSpec,
  weightsPath,
  type LlmModelSpec,
  type LlmProgressFn,
} from "../models/llmCatalog.js";
import * as llamaBinary from "../models/llamaServerBinary.js";
import { chatCompletion } from "./client.js";
import type { ChatMessage } from "./client.js";
import {
  buildBriefMessages,
  buildDraftMessages,
  buildRepairMessages,
  briefResponseFormat,
  parseBrief,
  promptViolations,
  promptSeverity,
  buildEnhanceMessages,
  buildLyricsMessages,
  enhanceResponseFormat,
  lyricsMaxTokens,
  maxTokensFor,
  parseEnhanceResponse,
  parseLyrics,
  temperatureFor,
  type EnhanceInput,
  type EnhanceResult,
  type LyricsInput,
} from "./enhance.js";
import {
  buildGenerateMessages,
  buildScriptMessages,
  buildIntentMessages,
  buildPanelMessages,
  buildStudioMessages,
  parseIntent,
  parseStudioPlan,
  type StudioContext,
  type StudioPlan,
} from "./studio.js";
import {
  MAX_HISTORY_TURNS,
  assistantResponseFormat,
  buildAssistantMessages,
  buildOpenerMessages,
  openerResponseFormat,
  parseAssistantReply,
  parseOpeners,
  type AssistantContext,
  type AssistantOpener,
  type AssistantReply,
  type AssistantTurn,
} from "./assistant.js";
import { probeAll, type DetectedEndpoint } from "./probe.js";
import { LlmRuntime } from "./runtime.js";

export interface LlmStatus {
  mode: "off" | "managed" | "external";
  engine: { installed: boolean; version: string | null; backend: string | null };
  model: (LlmModelSpec & { installed: boolean }) | null;
  catalog: (LlmModelSpec & { installed: boolean })[];
  external: { base_url: string; model: string; api_key_set: boolean };
  running: boolean;
  /** LLM servers found already running on this machine's well-known local
   *  ports (Ollama, LM Studio, a bare llama-server) — lets the UI offer
   *  "use this" instead of steering everyone at the managed install. */
  detected: DetectedEndpoint[];
}

export class LlmService {
  private readonly config: Config;
  private readonly runtime = new LlmRuntime();

  constructor(config: Config) {
    this.config = config;
  }

  private get settings() {
    return this.config.settings;
  }

  /* ------------------------------------------------------------- status */

  async status(): Promise<LlmStatus> {
    const [engine, detected] = await Promise.all([llamaBinary.status(), probeAll()]);
    const modelsDir = this.config.paths.models;
    const catalog = await Promise.all(
      LLM_MODELS.map(async (spec) => ({ ...spec, installed: await isDownloaded(modelsDir, spec) })),
    );
    const spec = llmModelSpec(this.settings.llm_model);
    const model = spec ? (catalog.find((c) => c.id === spec.id) ?? null) : null;
    return {
      mode: this.settings.llm_mode,
      engine: { installed: engine.installed, version: engine.version, backend: engine.backend },
      model,
      catalog,
      external: {
        base_url: this.settings.llm_external_base_url,
        model: this.settings.llm_external_model,
        api_key_set: Boolean(this.settings.llm_external_api_key),
      },
      running: this.runtime.isRunning,
      detected,
    };
  }

  /* ------------------------------------------------------------ enhance */

  async enhance(input: EnhanceInput): Promise<EnhanceResult> {
    const endpoint = await this.resolveEndpoint();

    // Music goes the long way round — see `enhanceMusic`. A null means that
    // path decided it had nothing better to offer, not that it failed, so the
    // one-shot rewrite below is the answer rather than a consolation.
    if (input.category === "music") {
      const planned = await this.enhanceMusic(endpoint, input);
      if (planned) {
        this.runtime.touch();
        return planned;
      }
    }

    const result = parseEnhanceResponse(
      await this.complete(endpoint, buildEnhanceMessages(input), {
        temperature: temperatureFor(input.n),
        maxTokens: maxTokensFor(input.n),
        responseFormat: enhanceResponseFormat(input.n),
      }),
      input.n,
    );
    if (!result.variations.length) {
      throw new ModelError("The prompt assistant returned an empty response. Try again.");
    }
    this.runtime.touch();
    return result;
  }

  /**
   * Turn an instruction about the timeline into edits the page can apply.
   *
   * One call, not the three `enhanceMusic` makes: there is nothing to plan
   * here, because the plan *is* the answer. The verification that the drafting
   * pipeline spends a round trip on happens in code instead —
   * `parseStudioPlan` drops any action naming a clip or track that is not in
   * the context it was given, so an invented id costs nothing.
   *
   * Temperature is as low as it goes. This is the one place the assistant is
   * asked to operate the application rather than write for it, and there is no
   * creative latitude in "mute tracks 1 and 3".
   */
  /**
   * One turn of the studio assistant.
   *
   * NOTE: reconstructed. This method was written in another session and was
   * removed by accident here while `studioCommand` above was being rewritten;
   * it had not been committed, so it could not be recovered from git. What
   * follows is rebuilt from `llm/assistant.ts`'s own API and the call site in
   * `service.ts`, and is behaviourally equivalent as far as those two
   * describe it — but if the original did anything further, that nuance is
   * gone and this should be reviewed against what was intended.
   */
  async assistantChat(turns: AssistantTurn[], ctx: AssistantContext): Promise<AssistantReply> {
    const endpoint = await this.resolveEndpoint();
    // Trimmed before it goes out: a small local model's context is finite and
    // the oldest turns of a prompt negotiation are the least useful, which is
    // what `MAX_HISTORY_TURNS` is for.
    const recent = turns.slice(-MAX_HISTORY_TURNS);
    const text = await this.complete(endpoint, buildAssistantMessages(recent, ctx), {
      temperature: 0.4,
      maxTokens: 900,
      responseFormat: assistantResponseFormat(),
    });
    const reply = parseAssistantReply(text, turns);
    this.runtime.touch();
    return reply;
  }

  /** Empty-thread chips. Warmer than chat: these are invitations, not answers. */
  async assistantOpeners(ctx: AssistantContext): Promise<AssistantOpener[]> {
    const endpoint = await this.resolveEndpoint();
    const text = await this.complete(endpoint, buildOpenerMessages(ctx), {
      temperature: 0.7,
      maxTokens: 400,
      responseFormat: openerResponseFormat(),
    });
    const openers = parseOpeners(text);
    this.runtime.touch();
    return openers;
  }

  async studioCommand(
    instruction: string,
    context: StudioContext,
  ): Promise<StudioPlan & { dropped: number }> {
    const endpoint = await this.resolveEndpoint();

    // Classify first, then plan with only that branch's rules.
    //
    // The single prompt that did both ran to sixty lines and this model could
    // not hold it: strengthening the generate section stopped "mute 1 and add
    // delay to vocals" emitting any actions, and strengthening the edit
    // section put the refusals back. Each of those instructions was fine on
    // its own, which is the tell — the problem was quantity, not wording, and
    // no amount of further rewriting was going to fix it.
    //
    // Two calls at ~1s each is a price worth paying for answers that do not
    // depend on which paragraph the model happened to weight.
    const intent = parseIntent(
      await this.complete(endpoint, buildIntentMessages(instruction), {
        temperature: 0,
        maxTokens: 40,
      }),
    );

    const messages =
      // "compose" and "generate_clip" both mean "make me some audio" — a whole
      // piece or one clip — and the generate planner already handles the
      // difference, putting an unplaced piece on a free track. They used to
      // part company here: compose short-circuited to an empty plan on the
      // reasoning that the page would route it to the prompt panel, and the
      // page did no such thing. An empty plan reads as "not an edit", the chat
      // hands the turn to the docs guide, and the guide's whole identity is
      // that it cannot make anything — so asking a studio for a piece of music
      // got you a paragraph telling you to go to a studio.
      intent === "generate_clip" || intent === "compose"
        ? buildGenerateMessages(instruction, context)
        : intent === "panel"
          ? buildPanelMessages(instruction)
          : intent === "script"
            ? buildScriptMessages(instruction, context)
            : buildStudioMessages(instruction, context);

    // No `response_format`, and that is measured rather than assumed. Under a
    // JSON-schema grammar this model filled in whatever properties the flat
    // action shape allowed — "add delay to vocals" came back as an `add_clip`
    // carrying an invented clip id — which validation then binned, leaving a
    // summary that claimed success with no edits behind it. Unconstrained it
    // answers correctly in its own spelling, which `normalizeAction` handles.
    // Writing is the one branch that runs warm, and needs the room to do it.
    // Resolving "the vocal" to a clip id has a right answer, so every other
    // planner is deterministic; a scene written at temperature 0 comes back
    // flat and says the same thing every time it is asked. The token ceiling
    // goes up with it because a script is many lines of prose rather than a
    // handful of field assignments.
    const writing = intent === "script";
    const plan = parseStudioPlan(
      await this.complete(endpoint, messages, {
        temperature: writing ? 0.7 : 0,
        maxTokens: writing ? 1600 : 800,
      }),
      context,
    );
    this.runtime.touch();
    // What it decided, alongside what it will do.
    //
    // The classifier's answer is the single most useful thing to show when a
    // request goes somewhere surprising: "write me a scene" landing on the
    // edit planner explains an empty plan far better than an empty plan
    // does. It costs nothing to return \u2014 the call already happened.
    return { ...plan, classified: intent };
  }

  /** One chat call with this service's standing options. Thinking is off on
   *  every one of them: the assistant's job here is to answer, and a model
   *  that reasons first spends the token budget before writing anything. */
  private async complete(
    endpoint: { baseUrl: string; apiKey: string | null; model: string },
    messages: ChatMessage[],
    opts: {
      temperature: number;
      maxTokens: number;
      responseFormat?: Record<string, unknown>;
    },
  ): Promise<string> {
    return await chatCompletion({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      responseFormat: opts.responseFormat,
      chatTemplateKwargs: { enable_thinking: false },
    });
  }

  /**
   * Music prompts, written the way a person writes them: decide, draft, check.
   *
   * A single rewrite call has to invent the musical facts and phrase them at
   * the same time, and a small local model asked to do both reliably does
   * neither — "sad song" comes back as a longer sentence about sadness rather
   * than as a description of a track someone could play. Splitting the work
   * makes each half easy: `buildBriefMessages` only has to name a genre and
   * some instruments, and `buildDraftMessages` only has to write down what
   * has already been decided.
   *
   * The measured win is what `n > 1` returns. Asked for two variations in one
   * pass, the model writes two unrelated songs — over five vague requests the
   * pair shared no content words at all, an acoustic ballad next to a lo-fi
   * bedroom track, which is a choice between briefs rather than between
   * descriptions. Drafting both from one brief made them share about a fifth
   * of their words: the same track, led with different details, which is what
   * "variations" was supposed to mean.
   *
   * The third pass is insurance rather than the point. Measured against
   * qwen3.5:9b none of sixteen drafts broke a stated rule, so `promptViolations`
   * usually finds nothing and costs nothing — no call is made when it is
   * clean. It earns its place on weaker models and unknown external endpoints,
   * where "the system prompt said not to" stops being a guarantee.
   *
   * This became affordable rather than clever when the assistant stopped
   * spending its whole context reasoning (see `llm/client.ts`): the round
   * trip went from ~30s to ~1s, and three of those is still faster than the
   * one call this replaces used to be.
   *
   * Returns null when the extra passes have not earned their place — an
   * undecidable brief, or a draft that came back empty. Every one of those is
   * a reason to let the plain rewrite answer, never a reason to fail: this is
   * a better path to the same feature, not a new feature that can break it.
   */
  private async enhanceMusic(
    endpoint: { baseUrl: string; apiKey: string | null; model: string },
    input: EnhanceInput,
  ): Promise<EnhanceResult | null> {
    try {
      const brief = parseBrief(
        await this.complete(endpoint, buildBriefMessages(input), {
          // Low: this pass is committing to facts, and the creative latitude
          // belongs in the drafting pass that reads them.
          temperature: 0.3,
          maxTokens: 400,
          responseFormat: briefResponseFormat(),
        }),
      );
      if (!brief) return null;

      const drafted = parseEnhanceResponse(
        await this.complete(endpoint, buildDraftMessages(input, brief), {
          temperature: temperatureFor(input.n),
          maxTokens: maxTokensFor(input.n),
          responseFormat: enhanceResponseFormat(input.n),
        }),
        input.n,
      );
      if (!drafted.variations.length) return null;

      return { ...drafted, variations: await this.repair(endpoint, input, drafted.variations) };
    } catch (exc) {
      // A failure here is not the user's problem: `enhance` still has a whole
      // working path left to try. Anything genuinely wrong with the endpoint
      // will resurface there with a proper message.
      if (exc instanceof ModelError) return null;
      throw exc;
    }
  }

  /** Send back only the drafts that broke a stated rule, and keep the repair
   *  only if it actually improved things — judged by `promptSeverity`, so a
   *  partial fix counts and a "fix" that trades one comma list for another
   *  does not. */
  private async repair(
    endpoint: { baseUrl: string; apiKey: string | null; model: string },
    input: EnhanceInput,
    variations: string[],
  ): Promise<string[]> {
    const faults = variations
      .map((text, index) => ({ index, text, problems: promptViolations(text, input) }))
      .filter((f) => f.problems.length > 0);
    if (faults.length === 0) return variations;

    const fixed = parseEnhanceResponse(
      await this.complete(endpoint, buildRepairMessages(input, faults), {
        temperature: 0.2,
        maxTokens: maxTokensFor(faults.length),
        responseFormat: enhanceResponseFormat(faults.length),
      }),
      faults.length,
    ).variations;

    const out = [...variations];
    faults.forEach((fault, i) => {
      const candidate = fixed[i]?.trim();
      if (!candidate) return;
      if (promptSeverity(candidate, input) < promptSeverity(fault.text, input)) {
        out[fault.index] = candidate;
      }
    });
    return out;
  }

  /** Writes a full lyric sheet (structure tags, syllable-balanced lines) from
   *  a theme or rough draft — a genuinely different skill from `enhance()`'s
   *  one-line caption rewrite, not the same prompt with `lyrics: true`. */
  async enhanceLyrics(input: LyricsInput): Promise<string> {
    const { baseUrl, apiKey, model } = await this.resolveEndpoint();
    const messages = buildLyricsMessages(input);
    const text = await chatCompletion({
      baseUrl,
      apiKey,
      model,
      messages,
      temperature: 0.8,
      maxTokens: lyricsMaxTokens(),
      chatTemplateKwargs: { enable_thinking: false },
    });
    const lyrics = parseLyrics(text);
    if (!lyrics) {
      throw new ModelError("The prompt assistant returned an empty response. Try again.");
    }
    this.runtime.touch();
    return lyrics;
  }

  private async resolveEndpoint(): Promise<{
    baseUrl: string;
    apiKey: string | null;
    model: string;
  }> {
    const mode = this.settings.llm_mode;
    if (mode === "off") {
      throw new ModelError(
        "Prompt enhancement is off. Turn it on in Settings → Prompt assistant.",
      );
    }
    if (mode === "external") {
      if (!this.settings.llm_external_base_url || !this.settings.llm_external_model) {
        throw new ModelError(
          "External prompt-assistant endpoint isn't configured. Set the base URL and " +
            "model name in Settings → Prompt assistant.",
        );
      }
      return {
        baseUrl: this.settings.llm_external_base_url,
        apiKey: this.settings.llm_external_api_key,
        model: this.settings.llm_external_model,
      };
    }

    // managed
    const spec = llmModelSpec(this.settings.llm_model);
    if (!spec) {
      throw new ModelError(`Unknown prompt-assistant model '${this.settings.llm_model}'.`);
    }
    const binaryPath = await llamaBinary.findBinary();
    if (!binaryPath) {
      throw new ModelError(
        "The prompt-assistant engine isn't installed. Install it from the Models page, " +
          "or run `konchi model install llm`.",
      );
    }
    const modelsDir = this.config.paths.models;
    if (!(await isDownloaded(modelsDir, spec))) {
      throw new ModelError(
        `${spec.name} isn't downloaded yet. Download it from the Models page, or run ` +
          `\`konchi model install llm --model ${spec.id}\`.`,
      );
    }
    const modelPath = weightsPath(modelsDir, spec);
    const { baseUrl } = await this.runtime.ensureRunning(binaryPath, modelPath);
    return { baseUrl, apiKey: null, model: spec.filename };
  }

  /* --------------------------------------------------------- install/dl */

  async installEngine(version: string | undefined, progress?: llamaBinary.InstallProgressFn) {
    return await llamaBinary.install(version, null, progress);
  }

  async downloadModel(modelId: string, progress?: LlmProgressFn): Promise<void> {
    const spec = llmModelSpec(modelId);
    if (!spec) throw new ModelError(`Unknown prompt-assistant model '${modelId}'.`);
    await downloadWeights(this.config.paths.models, spec, this.settings.effectiveHfToken(), progress);
  }

  async deleteModel(modelId: string): Promise<void> {
    const spec = llmModelSpec(modelId);
    if (!spec) throw new ModelError(`Unknown prompt-assistant model '${modelId}'.`);
    await deleteWeights(this.config.paths.models, spec);
  }

  /* -------------------------------------------------------- lifecycle */

  /** Called after a settings PATCH touches `llm_mode`/`llm_model` — stops the
   *  managed process so the next enhance call picks up the new choice rather
   *  than keep talking to a stale model. */
  reconfigure(): void {
    void this.runtime.stop();
  }

  async maybeAutoStop(idleMinutes: number): Promise<boolean> {
    return await this.runtime.maybeAutoStop(idleMinutes);
  }

  async close(): Promise<void> {
    await this.runtime.stop();
  }
}
