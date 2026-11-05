/**
 * A minimal server-sent-events reader: the `data:` payloads of a byte stream,
 * one per event, in order.
 *
 * Only what audio.cpp's streaming routes emit is handled — `data:` lines,
 * possibly several per event (joined with "\n", as the spec says), comments
 * and other fields ignored. Line endings may be LF or CRLF, and a chunk
 * boundary can fall anywhere, including inside a multi-byte character, which
 * is why decoding goes through one streaming TextDecoder.
 */
export async function* sseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  const flushLine = function* (line: string): Generator<string> {
    if (line === "") {
      if (data.length) yield data.join("\n");
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    data.push(value);
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      yield* flushLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield* flushLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  // A stream that ends without the blank line still delivers its last event.
  yield* flushLine("");
}
