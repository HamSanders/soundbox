// The live socket holds one conversation, so only one Discord user can be "the caller" at a time.
// The first person to speak takes the floor and keeps it until they have been quiet for `holdMs`.
// Everyone else is ignored meanwhile. Because the floor is free while the character talks, anyone who
// speaks over it takes the floor and the socket's own barge-in does the rest.

export class Floor {
  #holder = null;
  #lastHeard = 0;
  constructor({ holdMs = 1200, allow = null, now = () => Date.now() } = {}) {
    this.holdMs = holdMs;
    this.allow = allow; // Set of user ids, or null for everyone in the channel
    this.now = now;
  }
  get holder() { this.#expire(); return this.#holder; }
  /** A packet arrived from `userId`. True when it should be fed to the character. */
  hear(userId) {
    if (this.allow && !this.allow.has(userId)) return false;
    this.#expire();
    if (this.#holder === null) { this.#holder = userId; }
    if (this.#holder !== userId) return false;
    this.#lastHeard = this.now();
    return true;
  }
  /** Releases the floor if its holder has been quiet long enough. Returns the user who just lost it, else null. */
  #expire() {
    if (this.#holder !== null && this.now() - this.#lastHeard >= this.holdMs) { this.#holder = null; return true; }
    return false;
  }
  tick() { const had = this.#holder; this.#expire(); return had !== null && this.#holder === null ? had : null; }
  release() { this.#holder = null; }
}
