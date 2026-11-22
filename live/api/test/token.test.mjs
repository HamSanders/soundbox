import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { originAllowed, sign, tokenFromRequest, verify } from "../token.mjs";

const S = "unit-test-secret";
const here = dirname(fileURLToPath(import.meta.url));
const FACE_DIR = join(here, "..", "..", "..", "spikes", "realtime-face");
const PY = process.env.PYTHON || "python";

test("a signed token verifies and carries its claims", () => {
  const t = sign({ call: "c_1", aud: ["voice", "face"], mode: "video" }, S, 60);
  const p = verify(t, S, { aud: "face" });
  assert.equal(p.call, "c_1");
  assert.equal(p.mode, "video");
  assert.equal(p.exp - p.iat, 60);
});

test("a tampered payload or signature is refused", () => {
  const t = sign({ call: "c_1", aud: ["voice"] }, S);
  const [head, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(head, "base64url")), call: "c_2" })).toString("base64url");
  assert.throws(() => verify(`${forged}.${sig}`, S), /bad signature/);
  assert.throws(() => verify(`${head}.${sig.slice(0, -2)}AA`, S), /bad signature/);
  assert.throws(() => verify(t, "another-secret"), /bad signature/);
});

test("expiry is enforced, with a small leeway", () => {
  const t = sign({ call: "c_1", aud: ["voice"] }, S, 10, 1000);
  assert.equal(verify(t, S, { now: 1012 }).call, "c_1"); // within 5 s leeway
  assert.throws(() => verify(t, S, { now: 1016 }), /expired/);
});

test("the audience must match", () => {
  const t = sign({ call: "c_1", aud: ["voice"] }, S);
  assert.throws(() => verify(t, S, { aud: "face" }), /wrong audience/);
});

test("garbage is refused as malformed", () => {
  for (const bad of ["", "abc", "a.b.c", ".", null]) assert.throws(() => verify(bad, S));
});

test("the token is read from the WebSocket subprotocol or a Bearer header", () => {
  assert.equal(tokenFromRequest({ headers: { "sec-websocket-protocol": "mirli.v1, bearer.abc.def" } }), "abc.def");
  assert.equal(tokenFromRequest({ headers: { authorization: "Bearer xyz.1" } }), "xyz.1");
  assert.equal(tokenFromRequest({ headers: {} }), null);
});

test("origin allow-list: empty means any, otherwise exact match", () => {
  assert.equal(originAllowed("http://evil", []), true);
  assert.equal(originAllowed("http://evil", ["https://live.mirli.ai"]), false);
  assert.equal(originAllowed(undefined, ["https://live.mirli.ai"]), false);
  assert.equal(originAllowed("https://live.mirli.ai", ["https://live.mirli.ai"]), true);
});

test("Node and Python agree on the format (sign in one, verify in the other)", () => {
  const t = sign({ call: "c_x", aud: ["face"] }, S, 60);
  const py = `import sys; sys.path.insert(0, ${JSON.stringify(FACE_DIR)}); import call_token as c
p = c.verify(${JSON.stringify(t)}, ${JSON.stringify(S)}, aud="face"); print(p["call"])
print(c.sign({"call": "c_py", "aud": ["voice"]}, ${JSON.stringify(S)}, 60))`;
  const [call, pyToken] = execFileSync(PY, ["-c", py], { encoding: "utf8" }).trim().split(/\r?\n/);
  assert.equal(call, "c_x");
  assert.equal(verify(pyToken, S, { aud: "voice" }).call, "c_py");
});
