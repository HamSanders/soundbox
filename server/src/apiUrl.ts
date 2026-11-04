/**
 * Join a user-entered base URL and an API path without doubling the path.
 *
 * The prompt assistant and artwork settings take a *base* URL and add the API
 * path themselves (`/v1/chat/completions`, `/v1/images/generations`,
 * `/sdapi/v1/txt2img`). But most servers' own docs give the base URL with
 * `/v1` already on it (LocalAI, LM Studio, OpenAI-compatible gateways), and a
 * straight concatenation then asks for `/v1/v1/chat/completions`, a 404 from a
 * server that is otherwise reachable. That was issue #22.
 *
 * So the join drops whatever the base already ends with from the front of the
 * path, at segment boundaries:
 *
 *   https://ai.lan          + /v1/chat/completions → https://ai.lan/v1/chat/completions
 *   https://ai.lan/v1       + /v1/chat/completions → https://ai.lan/v1/chat/completions
 *   https://ai.lan/v1/chat/completions (pasted whole) → unchanged
 *   http://sd:7860/sdapi/v1 + /sdapi/v1/txt2img     → http://sd:7860/sdapi/v1/txt2img
 *
 * A base that merely *contains* the path somewhere in the middle is left
 * alone. Only a suffix of the base that matches a prefix of the path counts.
 */
/** Added to an HTTP 404 from one of these endpoints. After `apiUrl`, a doubled
 *  path can't be the cause, so what's left is the wrong host or port, or a
 *  server that doesn't offer this API at all. */
export const NOT_FOUND_HINT =
  "The server answered, but has nothing at that path. Check that the base URL is the " +
  "server's root or its /v1 address (Konchi adds the rest of the path itself), and " +
  "that this server offers this API.";

export function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  // Longest overlap first, so a full endpoint pasted as the base wins over a
  // bare `/v1`.
  for (let k = segments.length; k > 0; k--) {
    const overlap = `/${segments.slice(0, k).join("/")}`;
    if (base.toLowerCase().endsWith(overlap.toLowerCase())) {
      const rest = segments.slice(k).join("/");
      return rest ? `${base}/${rest}` : base;
    }
  }
  return `${base}/${segments.join("/")}`;
}
