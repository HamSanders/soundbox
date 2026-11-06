# Security Policy

## Supported versions

Only the latest release receives security fixes. Before the first tagged
release, that means the current `main` branch.

| Version | Supported |
| --- | --- |
| Latest release (or `main` before the first release) | Yes |
| Anything older | No |

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's private
vulnerability reporting: open the repository's **Security** tab and click
**Report a vulnerability**, or go straight to
<https://github.com/HamSanders/soundbox/security/advisories/new>.
Do not open a public issue, pull request or discussion for a suspected
vulnerability.

Include what you can: the affected version or commit, your OS, steps to
reproduce, and what an attacker gains. You will get an acknowledgement in the
advisory thread, and the fix and any credit are coordinated there before
anything is disclosed publicly.

## Threat model

Soundbox is a single-user, local application. Its security rests on the
following assumptions. Please report any way to break one of them.

- **The server binds to loopback** (`127.0.0.1`) by default. It is meant to be
  reached only from the same machine.
- **There is no authentication unless an access token is set.** Without
  `SOUNDBOX_API_TOKEN`, anything that can send HTTP to the server can use its
  whole API: generate audio, read and delete the library, change settings.
  Binding it to a non-loopback interface with `--host` exposes all of that to
  the network, and the server warns when you do without a token. With a token,
  the API, `/mcp` and served files need it as a bearer header or a session
  cookie (`server/src/auth.ts`); `GET /api/health` stays open. The token
  travels in the clear over plain HTTP, so serve it over HTTPS.
- **Host-header allowlist.** Requests whose `Host` header is not a loopback
  name (`localhost`, `127.0.0.1`, `::1`, any port) are rejected with 403,
  which defends against DNS rebinding from web pages in your browser. Two
  things widen it, both opt-in: names listed in `SOUNDBOX_ALLOWED_HOSTS` (a
  bare `host` on any port, `host:port` on that port only — what a reverse
  proxy forwards), and `--host`: a specific address adds that name, and a
  wildcard bind (`0.0.0.0`, `::`) turns the check off. The MCP endpoint keeps
  its own check, which accepts loopback and `SOUNDBOX_ALLOWED_HOSTS` only,
  even under a wildcard bind.
- **Origin allowlist.** Only trusted browser origins get CORS headers (so only
  they can read responses), and the MCP endpoint refuses any other `Origin`
  outright. The trusted set is the server's own origin (an `Origin` naming
  the same host and port as the request's `Host`), the Vite dev server on
  port 5174 (or `PORT`) under `npm run dev`, and hosts listed in
  `SOUNDBOX_ALLOWED_HOSTS` (comma-separated `host` or `host:port`).
- **CSRF rule.** A mutating `/api` request (POST, PUT, PATCH, DELETE) must
  carry either a non-simple `Content-Type` (`application/json` or an audio
  upload type) or an `X-Soundbox` header. A cross-site form or `no-cors`
  fetch can send neither without a CORS preflight, which an untrusted origin
  fails. Scripts and tools calling the API can send `X-Soundbox: 1`.
- **Native binaries are verified.** `audiocpp_cli`, `llama-server` and
  `sd-server` are downloaded from their projects' GitHub releases and checked
  against a published SHA-256 (the release's checksum manifest or GitHub's
  asset digest) before they are installed. A mismatch is refused, and so is an
  archive with no published checksum unless you set
  `SOUNDBOX_ALLOW_UNVERIFIED_BINARIES=1`. Download URLs must point at the
  expected repository's release downloads.

Also in scope: path traversal through file routes, command injection into the
native binaries Soundbox spawns, and tampering with the binary/model download
path. Out of scope: the licences or behaviour of third-party model weights,
and attacks that already require local code execution as your user.
