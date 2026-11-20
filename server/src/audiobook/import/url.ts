/**
 * Fetch a web page for import: http(s) only, a timeout, a size cap, and a
 * content type check. The fetch function is injectable so tests never touch
 * the network.
 */

export const URL_TIMEOUT_MS = 20_000;
export const URL_MAX_BYTES = 20 * 1024 * 1024;

export interface FetchedDocument {
  bytes: Uint8Array;
  contentType: string;
  /** The final URL after redirects. */
  url: string;
  filename: string;
}

export class UrlImportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlImportError(422, "That isn't a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlImportError(422, "Only http and https addresses can be imported.");
  }
  if (url.username || url.password) {
    throw new UrlImportError(422, "Addresses with a user name or password can't be imported.");
  }
  return url;
}

/** Content types the importer understands, by the parser they go to. */
function filenameFor(url: URL, contentType: string): string {
  const base = decodeURIComponent(url.pathname.split("/").pop() || "page");
  if (/\.(?:epub|pdf|docx|txt|md|markdown|html?|xhtml)$/i.test(base)) return base;
  if (contentType.includes("epub")) return `${base}.epub`;
  if (contentType.includes("pdf")) return `${base}.pdf`;
  if (contentType.includes("wordprocessingml")) return `${base}.docx`;
  if (contentType.includes("markdown")) return `${base}.md`;
  if (contentType.startsWith("text/plain")) return `${base}.txt`;
  return `${base}.html`;
}

export async function fetchDocument(
  raw: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedDocument> {
  const url = checkUrl(raw);
  const doFetch = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? URL_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? URL_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/epub+zip,application/pdf,text/plain;q=0.9,*/*;q=0.5",
          "User-Agent": "Mirli-Importer/1.0",
        },
      });
    } catch (err) {
      if (controller.signal.aborted) throw new UrlImportError(504, "The page took too long to load.");
      throw new UrlImportError(502, `Could not load the page: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new UrlImportError(502, `The page answered with HTTP ${res.status}.`);
    const finalUrl = checkUrl(res.url || url.href);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new UrlImportError(413, "That page is too large to import.");
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (/^(?:image|audio|video|font)\//.test(contentType)) {
      throw new UrlImportError(415, "That address isn't a document or web page.");
    }
    // Read with a running total so a missing or lying Content-Length can't
    // stream past the cap.
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch {
          if (controller.signal.aborted) throw new UrlImportError(504, "The page took too long to load.");
          throw new UrlImportError(502, "The connection dropped while loading the page.");
        }
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new UrlImportError(413, "That page is too large to import.");
        }
        chunks.push(chunk.value);
      }
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    return { bytes, contentType, url: finalUrl.href, filename: filenameFor(finalUrl, contentType) };
  } finally {
    clearTimeout(timer);
  }
}
