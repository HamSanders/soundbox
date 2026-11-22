/**
 * Acts on what scam-detect.mjs finds in a new or edited issue or comment.
 * Run by .github/workflows/scam-guard.yml with the event GitHub delivered.
 *
 *   "label"  add the `possible-scam` label and stop. Nothing is changed and
 *            nobody is told off; a maintainer looks when they next triage.
 *   "hide"   also take the instruction out of view: a comment is minimised
 *            as spam (anyone can still expand it, a maintainer can unhide
 *            it), an issue has the offending lines replaced (the original
 *            stays in the issue's edit history). Then one comment explains
 *            what happened and where Mirli's real downloads are.
 *
 * Text from people who can already push to the repository is never checked,
 * and neither are bots. The script only ever reads the event as data: it does
 * not check out, build or run anything the author of the text controls.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { detect, redact } from "./scam-detect.mjs";

export const LABEL = "possible-scam";
const LABEL_COLOR = "b60205";
const LABEL_DESCRIPTION = "Flagged by the scam guard: may tell readers to download and run something";

/** GitHub's own names for "can push here" (the event's author_association). */
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const RANK = { clean: 0, label: 1, hide: 2 };
const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);

const DOWNLOADS = "https://mirli.app/download/";
const RELEASES = "https://github.com/HamSanders/soundbox/releases";

export function explanation(kind) {
  const what =
    kind === "comment"
      ? "A comment on this thread was hidden by an automatic check"
      : "Part of this issue's text was removed by an automatic check";
  const undo =
    kind === "comment"
      ? "A maintainer can unhide the comment."
      : "The original text is in the issue's edit history, and a maintainer can restore it.";
  return [
    `**${what}**, because it tells readers to download and run something from a place that is not Mirli's.`,
    "",
    "Please don't run it. A pasted one-line command, or an installer from a link in a reply, runs with full access to your account on your computer, and posts like that are a common way to steal passwords and saved logins.",
    "",
    `Mirli's installers come from two places only: ${DOWNLOADS} and ${RELEASES}. Each release lists SHA-256 checksums in \`SHA256SUMS.txt\`.`,
    "",
    `If the check got this wrong, sorry. Nothing else happens automatically: the \`${LABEL}\` label asks a maintainer to look. ${undo}`,
  ].join("\n");
}

/**
 * What the event asks us to look at, or why to skip it.
 * @returns {{ skip: string } | { kind: "issue"|"comment", number: number, author: string,
 *            labelled: boolean, title?: string, body: string, nodeId?: string }}
 */
export function subject(event) {
  const issue = event.issue;
  if (!issue) return { skip: "not an issue or comment event" };
  const item = event.comment ?? issue;
  if (!["opened", "created", "edited"].includes(event.action)) return { skip: `action ${event.action}` };
  if (TRUSTED.has(item.author_association)) return { skip: `author is ${item.author_association}` };
  if (item.user?.type === "Bot") return { skip: "author is a bot" };
  const labelled = (issue.labels ?? []).some((l) => (l.name ?? l) === LABEL);
  const common = { number: issue.number, author: item.user?.login ?? "unknown", labelled, body: item.body ?? "" };
  return event.comment
    ? { kind: "comment", nodeId: event.comment.node_id, ...common }
    : { kind: "issue", title: issue.title ?? "", ...common };
}

/**
 * @param {object} event  the webhook payload
 * @param {object} api    see githubApi() for the shape
 * @returns the verdict and the names of the steps taken, for the log and tests
 */
export async function run(event, api, log = console.log) {
  const s = subject(event);
  if (s.skip) {
    log(`Skipped: ${s.skip}.`);
    return { verdict: "skipped", actions: [] };
  }

  const body = detect(s.body);
  const title = s.kind === "issue" ? detect(s.title) : { verdict: "clean", findings: [] };
  const verdict = worse(body.verdict, title.verdict);
  for (const f of [...title.findings, ...body.findings]) log(`${f.verdict}: ${f.rule}: ${f.why}`);
  if (verdict === "clean") {
    log("Nothing found.");
    return { verdict, actions: [] };
  }

  const actions = [];
  const failures = [];
  const attempt = async (name, fn) => {
    try {
      await fn();
      actions.push(name);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      log(`::warning::${name} failed: ${err.message}`);
    }
  };

  if (!s.labelled) {
    await attempt("label", async () => {
      await api.ensureLabel(LABEL, LABEL_COLOR, LABEL_DESCRIPTION);
      await api.addLabel(s.number, LABEL);
    });
  }

  if (verdict === "hide") {
    if (s.kind === "comment") {
      await attempt("minimise", () => api.minimiseComment(s.nodeId));
    } else {
      const patch = {};
      if (body.verdict === "hide") patch.body = redact(s.body, body.findings);
      if (title.verdict === "hide") patch.title = "[Title removed by the scam guard]";
      await attempt("redact", () => api.updateIssue(s.number, patch));
    }
    // One explanation per thread: a second hidden reply under an issue that
    // already carries the label would only repeat it.
    if (!s.labelled) await attempt("explain", () => api.comment(s.number, explanation(s.kind)));
  }

  log(`Verdict ${verdict} on ${s.kind} by ${s.author} in #${s.number}: ${actions.join(", ") || "nothing done"}.`);
  return { verdict, actions, failures };
}

/** The few GitHub calls the guard makes, with the workflow's own token. */
export function githubApi({ token, repository, apiUrl, graphqlUrl }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "mirli-scam-guard",
  };
  const call = async (method, url, payload, okStatuses = []) => {
    const resp = await fetch(url, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
    if (!resp.ok && !okStatuses.includes(resp.status)) {
      throw new Error(`${method} ${new URL(url).pathname} answered ${resp.status}`);
    }
    return resp;
  };
  const repo = `${apiUrl}/repos/${repository}`;
  return {
    // 422 means the label already exists.
    ensureLabel: (name, color, description) => call("POST", `${repo}/labels`, { name, color, description }, [422]),
    addLabel: (number, name) => call("POST", `${repo}/issues/${number}/labels`, { labels: [name] }),
    updateIssue: (number, patch) => call("PATCH", `${repo}/issues/${number}`, patch),
    comment: (number, body) => call("POST", `${repo}/issues/${number}/comments`, { body }),
    minimiseComment: async (nodeId) => {
      const query =
        "mutation($id: ID!) { minimizeComment(input: { subjectId: $id, classifier: SPAM }) { minimizedComment { isMinimized } } }";
      const resp = await call("POST", graphqlUrl, { query, variables: { id: nodeId } });
      const result = await resp.json();
      if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const api = githubApi({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
    graphqlUrl: process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql",
  });
  const result = await run(event, api);
  if (result.failures?.length) process.exit(1);
}
