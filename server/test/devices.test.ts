/**
 * The server's device table is a copy of the app's, and must stay one.
 *
 * `app/src/lib/devices.ts` builds the rack; `src/devices.ts` is what the
 * server clamps stored chains against. If they disagree, an agent can set a
 * knob the rack has never heard of, or the server clamps a value the dial can
 * reach. This loads the app's table directly (vitest.config.ts maps the app's
 * `@/` alias) and compares the two kind by kind, knob by knob.
 */

import { describe, expect, it } from "vitest";

import {
  DEVICES as APP_DEVICES,
  DEVICE_ORDER as APP_ORDER,
  clampDeviceParams as appClamp,
  createDevice as appCreate,
} from "@/lib/devices";
import {
  DEVICE_KINDS,
  DEVICE_TABLE,
  MAX_DEVICES_PER_TRACK,
  clampParams,
  defaultParams,
  normalizeChain,
} from "../src/devices.js";

describe("device table parity with the app", () => {
  it("has the same kinds", () => {
    expect([...DEVICE_KINDS].sort()).toEqual([...APP_ORDER].sort());
    expect(Object.keys(DEVICE_TABLE).sort()).toEqual(Object.keys(APP_DEVICES).sort());
  });

  for (const kind of DEVICE_KINDS) {
    it(`${kind}: same knobs, ranges and defaults`, () => {
      const app = APP_DEVICES[kind];
      const ours = DEVICE_TABLE[kind];
      expect(ours.name).toBe(app.name);
      expect(ours.params.map((p) => p.key)).toEqual(app.params.map((p) => p.key));
      for (const p of ours.params) {
        const a = app.params.find((q) => q.key === p.key)!;
        expect([p.key, p.min, p.max, p.unit]).toEqual([a.key, a.min, a.max, a.unit]);
        if (a.displayValues) expect(p.labels).toEqual(a.displayValues);
      }
      expect(defaultParams(kind)).toEqual(appCreate(kind).params);
    });
  }

  it("clamps the way the app does", () => {
    const asked = { wet: 3, decay: -1, preDelay: 0.1, nonsense: 4 };
    expect(clampParams("reverb", asked).params).toEqual(appClamp("reverb", asked));
  });
});

describe("clampParams", () => {
  it("lands an over-reach at the end of the range and says so", () => {
    const r = clampParams("reverb", { wet: 1.4, decay: 2 });
    expect(r.params).toEqual({ wet: 1, decay: 2 });
    expect(r.clamped).toEqual([{ key: "wet", asked: 1.4, set: 1 }]);
    expect(r.unknown).toEqual([]);
  });

  it("reports knobs the device does not have", () => {
    expect(clampParams("eq", { treble: 3 }).unknown).toEqual(["treble"]);
  });

  it("rounds a label knob to a real label", () => {
    expect(clampParams("autotune", { tuneKey: 4.6 }).params).toEqual({ tuneKey: 5 });
  });

  it("ignores non-finite values", () => {
    expect(clampParams("gate", { threshold: Number.NaN }).params).toEqual({});
  });
});

describe("normalizeChain", () => {
  it("fills missing knobs with defaults and keeps order", () => {
    const chain = normalizeChain([
      { kind: "eq", params: { high: -6 } },
      { kind: "compressor" },
    ]);
    expect(chain.map((d) => d.kind)).toEqual(["eq", "compressor"]);
    expect(chain[0].params).toEqual({ ...defaultParams("eq"), high: -6 });
    expect(chain[1].params).toEqual(defaultParams("compressor"));
    expect(chain.every((d) => d.bypassed === false && d.id.length > 0)).toBe(true);
  });

  it("drops unknown kinds and junk, and clamps", () => {
    const chain = normalizeChain([
      { kind: "flanger" },
      null,
      "eq",
      { kind: "limiter", params: { threshold: 5 } },
    ]);
    expect(chain).toHaveLength(1);
    expect(chain[0].params.threshold).toBe(0);
  });

  it("keeps ids, and replaces a duplicate", () => {
    const chain = normalizeChain([
      { id: "a", kind: "gate" },
      { id: "a", kind: "gate" },
    ]);
    expect(chain[0].id).toBe("a");
    expect(chain[1].id).not.toBe("a");
  });

  it("caps the chain length", () => {
    const many = Array.from({ length: MAX_DEVICES_PER_TRACK + 4 }, () => ({ kind: "eq" }));
    expect(normalizeChain(many)).toHaveLength(MAX_DEVICES_PER_TRACK);
  });

  it("is idempotent", () => {
    const once = normalizeChain([{ kind: "delay", bypassed: true, params: { wet: 0.5 } }]);
    expect(normalizeChain(once)).toEqual(once);
  });
});
