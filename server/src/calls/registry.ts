/**
 * Who is on a call, until when, and how many seconds each call used. Pure
 * logic with an injectable clock; the routes wire it to the workers.
 */

import { randomBytes } from "node:crypto";

export type CallMode = "video" | "voice";

export interface Call {
  id: string;
  mode: CallMode;
  character: string | null;
  started: number;
  lastBeat: number;
}

export interface LedgerRow {
  call: string;
  mode: CallMode;
  character: string | null;
  started: number;
  ended: number;
  seconds: number;
  reason: string;
}

export class CallBusyError extends Error {
  constructor() { super("A call is already running on this machine. End it first."); }
}
export class CallNotFoundError extends Error {
  constructor() { super("No such call."); }
}

export class CallRegistry {
  #calls = new Map<string, Call>();
  #ledger: LedgerRow[] = [];
  readonly maxCalls: number;
  readonly heartbeatTimeoutS: number;
  readonly maxCallS: number;
  readonly now: () => number;

  constructor(opts: { maxCalls?: number; heartbeatTimeoutS?: number; maxCallS?: number; now?: () => number } = {}) {
    this.maxCalls = opts.maxCalls ?? 1;
    this.heartbeatTimeoutS = opts.heartbeatTimeoutS ?? 30;
    this.maxCallS = opts.maxCallS ?? 3600;
    this.now = opts.now ?? (() => Date.now() / 1000);
  }

  create(mode: CallMode, character: string | null): Call {
    this.reap();
    if (this.#calls.size >= this.maxCalls) throw new CallBusyError();
    const t = this.now();
    const call: Call = { id: "c_" + randomBytes(9).toString("base64url"), mode, character, started: t, lastBeat: t };
    this.#calls.set(call.id, call);
    return { ...call };
  }

  get(id: string): Call {
    const c = this.#calls.get(id);
    if (!c) throw new CallNotFoundError();
    return { ...c };
  }

  heartbeat(id: string): number {
    const c = this.#calls.get(id);
    if (!c) throw new CallNotFoundError();
    c.lastBeat = this.now();
    return this.expiresAt(c);
  }

  setCharacter(id: string, character: string): void {
    const c = this.#calls.get(id);
    if (!c) throw new CallNotFoundError();
    c.character = character;
  }

  expiresAt(c: Call): number {
    return Math.min(c.lastBeat + this.heartbeatTimeoutS, c.started + this.maxCallS);
  }

  end(id: string, reason = "hangup"): LedgerRow {
    const c = this.#calls.get(id);
    if (!c) throw new CallNotFoundError();
    this.#calls.delete(id);
    // A lapsed call is counted up to its last sign of life, not to when it was noticed.
    const ended = reason === "lapsed" ? Math.min(this.now(), this.expiresAt(c)) : this.now();
    const row: LedgerRow = { call: c.id, mode: c.mode, character: c.character, started: c.started, ended,
      seconds: Math.max(0, Math.round(ended - c.started)), reason };
    this.#ledger.push(row);
    return row;
  }

  reap(): LedgerRow[] {
    const t = this.now();
    return [...this.#calls.values()].filter((c) => t > this.expiresAt(c)).map((c) => this.end(c.id, "lapsed"));
  }

  active(): Call[] { return [...this.#calls.values()].map((c) => ({ ...c })); }
  ledger(): LedgerRow[] { return [...this.#ledger]; }
  secondsUsed(): number { return this.#ledger.reduce((s, r) => s + r.seconds, 0); }
}
