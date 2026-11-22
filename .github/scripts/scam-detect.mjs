/**
 * Finds "download this and run it" instructions in issue and comment text.
 *
 * A common scam on project trackers is a reply that looks like help: paste
 * this one line into PowerShell, or grab this fixed installer from a link.
 * The line downloads a program and runs it. This module reads text and says
 * how sure it is that the text is one of those, so .github/scripts/scam-guard.mjs
 * can hide it, or only label it for a maintainer to look at.
 *
 * It has no dependencies and touches no network: text in, verdict out.
 *
 *   verdict "clean"  nothing found
 *   verdict "label"  something worth a maintainer's eyes; leave the text alone
 *   verdict "hide"   a download-and-run command that points somewhere other
 *                    than Mirli's own hosts
 *
 * The rule of thumb throughout: hide only when the text names a host we can
 * see and that host is not ours. Anything less certain is "label".
 */

/** Hosts where every path is Mirli's. */
const OWN_HOSTS = ["mirli.app"];

/** GitHub hosts where only paths under these accounts are Mirli's. */
const GITHUB_HOSTS = new Set(["github.com", "raw.githubusercontent.com"]);
const OWN_GITHUB_ACCOUNTS = new Set(["hamsanders"]);

/**
 * Paths under a repository that hold files any visitor can upload: an issue
 * attachment used to live at github.com/<owner>/<repo>/files/<id>/<name>.
 * Being under our account does not make those ours.
 */
const UPLOAD_SEGMENTS = new Set(["files", "assets"]);

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** A link whose path ends in one of these is a program, or installs one. */
const EXECUTABLE_EXT =
  /\.(exe|msi|msix|appx|bat|cmd|ps1|vbs|scr|hta|jar|lnk|iso|dmg|pkg|appimage|deb|rpm|sh)$/;
const ARCHIVE_EXT = /\.(zip|rar|7z)$/;

/**
 * Last labels that make a dotted word a file or a .NET name rather than a
 * host: `install.ps1`, `Net.WebClient`. Used only for words with no scheme
 * and no path; `example.sh/setup` is still read as a host.
 */
const NOT_A_TLD = new Set([
  "ps1", "psm1", "exe", "msi", "bat", "cmd", "sh", "bash", "zsh", "py", "js", "mjs", "ts",
  "json", "txt", "log", "md", "dll", "so", "zip", "gz", "tar", "tgz", "rar", "wav", "mp3",
  "flac", "gguf", "webclient", "downloadstring", "downloadfile", "downloaddata", "text",
  "content", "encoding", "utf8", "tool", "yml", "yaml", "toml", "lock", "html", "css",
]);

const TARGET =
  /((?:https?|hxxps?):\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]|\d{1,3}(?:\.\d{1,3}){3}|localhost|\[::1\])(:\d+)?(\/[^\s"'<>|;)\]]*)?/gi;

const SCHEME_URL = /\b(?:https?|hxxps?):\/\/[^\s"'<>|)\]]+/gi;

/** Programs that fetch something from the network. */
const DOWNLOADER =
  /(?<![\w.-])(irm|iwr|invoke-restmethod|invoke-webrequest|curl(?:\.exe)?|wget(?:\.exe)?|start-bitstransfer|bitsadmin(?:\.exe)?)(?![\w-])|downloadstring|downloadfile|downloaddata|net\.webclient|net\.http\.httpclient/;

/** PowerShell's "run this string as code". */
const PS_RUN = /(?<![\w.-])(iex|invoke-expression)(?![\w-])/;

const SHELL = "(?:ba|z|da|k|fi)?sh";
/** An interpreter reading a script from the pipe, not `python -m json.tool`. */
const INTERPRETER = "(?:python[0-9.]*|perl|ruby|node|pwsh|powershell(?:\\.exe)?)\\s*(?:-\\s*)?(?:$|[;&)])";

const PIPE_TO_SHELL = new RegExp(
  `(?<![\\w.-])(?:curl|wget)(?:\\.exe)?(?![\\w-])[^|]*\\|\\s*(?:sudo\\s+(?:-\\S+\\s+)*)?(?:${SHELL}(?![\\w.-])|${INTERPRETER})`,
);
const SHELL_SUBSTITUTION = new RegExp(
  `(?:(?<![\\w.-])(?:${SHELL}|source|eval|\\.)\\s+(?:-\\w+\\s+)*["']?(?:<\\(|\\$\\()\\s*(?:curl|wget))`,
);

/** Windows programs that can fetch and run a remote file on their own. */
const REMOTE_RUNNER = /(?<![\w.-])(mshta|regsvr32|rundll32|msiexec|certutil)(?:\.exe)?(?![\w-])/;

const PS_ENCODED =
  /(?<![\w.-])(?:powershell|pwsh)(?:\.exe)?(?![\w-]).*\s-e(?:c|nc|ncodedcommand)?\s+["']?[a-z0-9+/=]{40,}/;

const PASSWORD_BAIT = /\bpass(?:word|code)?\b\s*(?:is\b|[:=-])\s*\S+/;

const RANK = { clean: 0, label: 1, hide: 2 };

/** Unicode and markup tricks that split a keyword without changing how it reads. */
function normalise(line) {
  return line
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[`^]/g, "")
    .toLowerCase();
}

/** Is this URL, or scheme-less `host/path`, one of Mirli's own? */
export function isOwnTarget(raw) {
  const text = raw.replace(/^hxxp/i, "http");
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (LOOPBACK.has(host)) return true;
  if (OWN_HOSTS.some((own) => host === own || host.endsWith(`.${own}`))) return true;
  if (GITHUB_HOSTS.has(host)) {
    const [account, , third] = url.pathname.toLowerCase().split("/").filter(Boolean);
    if (!OWN_GITHUB_ACCOUNTS.has(account)) return false;
    return !(host === "github.com" && UPLOAD_SEGMENTS.has(third));
  }
  return false;
}

/** Every host-like thing a command line points at. */
function targetsIn(line) {
  const found = [];
  for (const m of line.matchAll(TARGET)) {
    const [whole, scheme, host, port, path] = m;
    if (!scheme && !path && !port) {
      const last = host.split(".").pop();
      if (NOT_A_TLD.has(last)) continue;
    }
    found.push(whole);
  }
  return found;
}

function commandRule(line) {
  if (PS_ENCODED.test(line)) return "powershell-encoded";
  if (DOWNLOADER.test(line) && PS_RUN.test(line)) return "powershell-download-run";
  if (PIPE_TO_SHELL.test(line) || SHELL_SUBSTITUTION.test(line)) return "pipe-to-shell";
  if (REMOTE_RUNNER.test(line) && /(?:https?|hxxps?):\/\/|\\\\[a-z0-9.-]+\\/.test(line)) {
    // certutil is also how people hash a file; only its download mode counts.
    if (/certutil/.test(line) && !/urlcache|verifyctl/.test(line)) return null;
    return "remote-runner";
  }
  return null;
}

/**
 * @param {string} text  an issue title, issue body or comment body
 * @returns {{ verdict: "clean"|"label"|"hide",
 *             findings: { rule: string, verdict: "label"|"hide", line: number, why: string }[] }}
 */
export function detect(text) {
  const findings = [];
  const lines = String(text ?? "").split(/\r?\n/);
  const passwordBait = PASSWORD_BAIT.test(normalise(String(text ?? "")));

  lines.forEach((raw, index) => {
    const line = normalise(raw);
    // Someone quoting a scam to warn about it should not have the warning hidden.
    const quoted = /^\s*>/.test(raw);
    const add = (rule, verdict, why) =>
      findings.push({ rule, verdict: quoted && verdict === "hide" ? "label" : verdict, line: index, why });

    const rule = commandRule(line);
    if (rule) {
      const targets = targetsIn(line);
      const foreign = targets.filter((t) => !isOwnTarget(t));
      if (rule === "powershell-encoded") {
        add(rule, "hide", "PowerShell is given an encoded command, which hides what it runs");
      } else if (foreign.length > 0) {
        add(rule, "hide", `downloads and runs code from ${foreign[0]}`);
      } else if (targets.length === 0) {
        add(rule, "label", "downloads and runs code, from a host this check could not read");
      }
      // Every target is ours: this is our own install or health-check line.
    }

    for (const m of raw.matchAll(SCHEME_URL)) {
      const link = m[0].replace(/[.,!?:]+$/, "");
      if (isOwnTarget(link)) continue;
      let path;
      try {
        path = new URL(link.replace(/^hxxp/i, "http")).pathname.toLowerCase();
      } catch {
        continue;
      }
      const program = EXECUTABLE_EXT.test(path);
      if (!program && !ARCHIVE_EXT.test(path)) continue;
      if (passwordBait) {
        add("download-with-password", "hide", `links to a download at ${link} and gives a password for it`);
      } else if (program && !rule) {
        add("executable-link", "label", `links to a program on a host that is not Mirli's: ${link}`);
      }
    }
  });

  const verdict = findings.reduce((worst, f) => (RANK[f.verdict] > RANK[worst] ? f.verdict : worst), "clean");
  return { verdict, findings };
}

export const REDACTED_LINE = "*[Removed by the scam guard: a download-and-run instruction.]*";

/** The text with every line that earned "hide" replaced by a placeholder. */
export function redact(text, findings) {
  const drop = new Set(findings.filter((f) => f.verdict === "hide").map((f) => f.line));
  if (drop.size === 0) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text
    .split(/\r?\n/)
    .map((line, i) => (drop.has(i) ? REDACTED_LINE : line))
    .join(eol);
}
