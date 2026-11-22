// The call registry: who is on a call, until when, and how many seconds each
// call used. Pure logic (no network) so it can be tested on its own; server.mjs
// wires it to the workers.

import { randomBytes } from "node:crypto";

export class BusyError extends Error {
  constructor(active) { super("busy"); this.code = "busy"; this.active = active; }
}
export class NotFoundError extends Error {
  constructor() { super("no such call"); this.code = "not_found"; }
}

export const newCallId = () => "c_" + randomBytes(9).toString("base64url");

export class CallRegistry {
  #calls = new Map();
  #ledger = [];
  /**
   * @param {{ maxCalls?: number, heartbeatTimeoutS?: number, maxCallS?: number, now?: () => number }} opts
   *   now() returns seconds; injectable for tests.
   */
  constructor({ maxCalls = 1, heartbeatTimeoutS = 30, maxCallS = 3600, now = () => Date.now() / 1000 } = {}) {
    Object.assign(this, { maxCalls, heartbeatTimeoutS, maxCallS, now });
  }

  /** Throws BusyError when every slot is taken by a call that is still alive. */
  create({ mode = "video", character = null, owner = "local" } = {}) {
    if (mode !== "video" && mode !== "voice") throw new TypeError("mode must be video or voice");
    this.reap();
    if (this.#calls.size >= this.maxCalls) throw new BusyError([...this.#calls.values()].map((c) => c.id));
    const t = this.now();
    const call = { id: newCallId(), mode, character, owner, started: t, lastBeat: t };
    this.#calls.set(call.id, call);
    return { ...call };
  }

  get(id) {
    const c = this.#calls.get(id);
    if (!c) throw new NotFoundError();
    return { ...c };
  }

  /** Keeps the call alive; returns when it will lapse without another beat. */
  heartbeat(id) {
    const c = this.#calls.get(id);
    if (!c) throw new NotFoundError();
    c.lastBeat = this.now();
    return { expires: this.expiresAt(c) };
  }

  setCharacter(id, character) {
    const c = this.#calls.get(id);
    if (!c) throw new NotFoundError();
    c.character = character;
  }

  expiresAt(c) {
    return Math.min(c.lastBeat + this.heartbeatTimeoutS, c.started + this.maxCallS);
  }

  /** Ends a call and books its seconds. Returns the ledger row. */
  end(id, reason = "hangup") {
    const c = this.#calls.get(id);
    if (!c) throw new NotFoundError();
    this.#calls.delete(id);
    // A lapsed call is billed up to its last sign of life, not to when we noticed.
    const endedAt = reason === "lapsed" ? Math.min(this.now(), this.expiresAt(c)) : this.now();
    const row = { call: c.id, mode: c.mode, owner: c.owner, started: c.started, ended: endedAt,
                  seconds: Math.max(0, Math.round(endedAt - c.started)), reason };
    this.#ledger.push(row);
    return row;
  }

  /** Ends calls whose heartbeat lapsed or that ran past the cap. Returns their ledger rows. */
  reap() {
    const t = this.now(), out = [];
    for (const c of [...this.#calls.values()]) if (t > this.expiresAt(c)) out.push(this.end(c.id, "lapsed"));
    return out;
  }

  active() { return [...this.#calls.values()].map((c) => ({ ...c })); }
  ledger(owner) { return this.#ledger.filter((r) => !owner || r.owner === owner); }
  secondsUsed(owner) { return this.ledger(owner).reduce((s, r) => s + r.seconds, 0); }
}
