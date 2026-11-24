// Per-call routing for the voice worker.
//
// - Every WebSocket must carry a token signed by the Call API (subprotocol
//   "bearer.<token>"), whose `call` claim says which call it belongs to.
// - One live conversation per call: a second socket for the same call (a
//   reload, a duplicate tab) replaces the first instead of talking over it.
// - Each call has its own PCM tap (/tap?call=<id>), so the face worker follows
//   that call's speech and nobody else's. The server-wide /tap still carries
//   everything, for the old spike pages and tools, but needs an admin token
//   once auth is on.
//
// Auth is on when a secret exists (MIRLI_CALL_SECRET, or the file the local
// Call API writes on first start) and MIRLI_CALL_AUTH is not "off".

import { allowedOrigins, localSecret, originAllowed, tokenFromRequest, verify, WS_PROTOCOL } from "./call-token.mjs";
import { PcmTap } from "./tap.mjs";

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class CallGate {
  #anon = 0;
  constructor({ secret = process.env.MIRLI_CALL_AUTH === "off" ? null : localSecret(), origins = allowedOrigins() } = {}) {
    this.secret = secret;
    this.origins = origins;
  }
  get secured() { return !!this.secret; }

  /**
   * Who is this request? Returns { call, mode, admin }. Throws AuthError.
   * Without a secret (dev / old spike pages) every socket is its own call.
   */
  check(req, aud) {
    if (!originAllowed(req.headers.origin, this.origins)) throw new AuthError(403, "origin not allowed");
    const q = new URL(req.url, "http://x").searchParams;
    if (!this.secured) return { call: q.get("call") || `anon-${++this.#anon}`, mode: null, admin: true };
    const tok = tokenFromRequest(req);
    if (!tok) throw new AuthError(401, "token required");
    let p;
    try { p = verify(tok, this.secret); } catch (e) { throw new AuthError(401, e.message); }
    const auds = Array.isArray(p.aud) ? p.aud : [p.aud];
    const admin = auds.includes("admin");
    if (!admin && !auds.includes(aud)) throw new AuthError(403, "wrong audience");
    return { call: p.call, mode: p.mode ?? null, admin };
  }

  /** ws `handleProtocols`: accept our protocol when the client offers it. */
  static pickProtocol(protocols) {
    return protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false;
  }

  /** CORS headers for a plain HTTP response. */
  cors(req) {
    const o = req.headers.origin;
    if (!o || !originAllowed(o, this.origins)) return {};
    return { "Access-Control-Allow-Origin": this.origins.length ? o : "*", Vary: "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
  }
}

/** Live conversations and taps, keyed by call id. */
export class CallRoutes {
  #sockets = new Map(); // call -> ws
  #taps = new Map();    // call -> PcmTap
  constructor(rootTap) { this.root = rootTap; }

  /** Register `ws` as the call's only conversation. Returns the socket it replaced, if any (already closed). */
  attach(call, ws) {
    const old = this.#sockets.get(call);
    this.#sockets.set(call, ws);
    ws.once("close", () => { if (this.#sockets.get(call) === ws) { this.#sockets.delete(call); this.#gc(call); } });
    if (old && old !== ws) {
      try { old.close(4000, "replaced by a newer connection for this call"); } catch {}
      return old;
    }
    return null;
  }

  socket(call) { return this.#sockets.get(call) ?? null; }
  get calls() { return [...this.#sockets.keys()]; }

  /** The call's own tap (created on first use, by whichever side comes first). */
  tap(call) {
    let t = this.#taps.get(call);
    if (!t) { t = new PcmTap(this.root); this.#taps.set(call, t); }
    return t;
  }

  /** A tap subscriber for one call. */
  subscribe(call, ws) {
    const t = this.tap(call);
    t.addWs(ws);
    ws.once("close", () => setTimeout(() => this.#gc(call), 0));
  }

  /** Hang up: close the call's conversation. Returns whether there was one. */
  end(call, reason = "call ended") {
    const ws = this.#sockets.get(call);
    if (ws) try { ws.close(4001, reason); } catch {}
    this.#sockets.delete(call);
    this.#gc(call);
    return !!ws;
  }

  #gc(call) {
    const t = this.#taps.get(call);
    if (t && !this.#sockets.has(call) && t.subscribers === 0) this.#taps.delete(call);
  }
  hasTap(call) { return this.#taps.has(call); }
}
