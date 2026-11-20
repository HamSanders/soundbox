// Streaming TTS over audio.cpp's OpenAI-shaped `/v1/audio/speech` SSE route:
// the same route Mirli's own `AudioCppRuntime.streamSpeech` uses.

import { config } from "./config.mjs";

/** `data:` payloads of an SSE body, parsed, until `[DONE]`. */
export async function* sseJson(body) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {}
      }
    }
  }
}

/**
 * Speak one piece of text. Yields `{ pcm: Buffer }` (s16le mono at the model's
 * rate) as each chunk is made, then `{ done: true, modelTtftMs }`.
 */
export async function* speak(engine, text, signal) {
  const body = {
    model: engine.model,
    input: text,
    response_format: "pcm",
    stream_format: "sse",
    seed: config.tts.seed,
    // VoxCPM2 refuses to stream with its offline-only bad-case retry on.
    options: { retry_badcase: "false" },
  };
  if (config.tts.voiceRef) body.voice_ref = config.tts.voiceRef;
  const resp = await fetch(`${engine.baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  for await (const msg of sseJson(resp.body)) {
    if (msg.type === "speech.audio.delta" && typeof msg.audio === "string") {
      yield { pcm: Buffer.from(msg.audio, "base64") };
    } else if (msg.type === "speech.audio.done") {
      yield { done: true, modelTtftMs: msg.timing?.ttft_ms ?? null, raw: msg };
    } else if (msg.error) {
      throw new Error(`TTS stream failed: ${JSON.stringify(msg.error).slice(0, 300)}`);
    }
  }
}

/** The model's output rate, read from one offline-shaped WAV response. */
export async function probeSampleRate(engine) {
  const resp = await fetch(`${engine.baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: engine.model,
      input: "Hi.",
      response_format: "wav",
      seed: config.tts.seed,
      options: { retry_badcase: "false" },
    }),
  });
  if (!resp.ok) throw new Error(`TTS probe HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const wav = Buffer.from(await resp.arrayBuffer());
  if (wav.toString("ascii", 0, 4) !== "RIFF") throw new Error("TTS probe did not return a WAV");
  // fmt chunk: channels at +22, rate at +24 in the canonical header.
  const fmt = wav.indexOf("fmt ");
  return { channels: wav.readUInt16LE(fmt + 10), sampleRate: wav.readUInt32LE(fmt + 12), bits: wav.readUInt16LE(fmt + 22) };
}
