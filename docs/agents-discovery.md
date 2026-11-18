# Making Mirli legible to AI agents

What the standards and conventions for agent and answer-engine discovery
looked like in November 2026, what each one says, and what Mirli does about
it. Every claim links to its source. Proposals are marked as proposals.

The short version: no single standard covers this. The pieces that are
real are **llms.txt** (a community convention), **Markdown versions of
pages**, **AGENTS.md** (a Linux Foundation project), the **MCP Registry's
`server.json`** (official, still in preview), **schema.org JSON-LD**, and
**robots.txt** (RFC 9309). Most of the `.well-known` paths people talk about
are proposals, or they describe hosted servers, which Mirli is not.

## What Mirli adopted

| Standard | Status | Adopted? | Where |
|---|---|---|---|
| llms.txt | De-facto convention (v2) | Yes, curated | `/llms.txt`, written by `site/plugins/crawlers.ts` |
| llms-full.txt | Vendor convention (Mintlify) | Yes | `/llms-full.txt` |
| Markdown versions of pages | Part of the llms.txt proposal | Yes, for the pages written in Markdown | `/developers/index.md`, `/docs/<slug>/index.md` |
| `rel="alternate" type="text/markdown"` and `rel="describedby"` | Part of llms.txt v2 | Yes, on those pages | `<head>` |
| AGENTS.md | De-facto convention (AAIF / Linux Foundation) | Yes | `AGENTS.md` at the repo root |
| MCP Registry `server.json` | Official, registry in preview | Yes, not yet published | `server.json` at the repo root, `LABEL` in `Dockerfile` |
| MCP Server Cards (SEP-2127) | Final SEP, for remote servers | No | Mirli's server is local-only |
| `/.well-known/mcp*` | Proposals | No | |
| A2A Agent Card | Adopted (A2A 1.0) | No | Mirli is a tool server, not an agent |
| `/.well-known/ai-plugin.json` | Deprecated | No | |
| OpenAPI and RFC 9727 `api-catalog` | RFC 9727 is a Proposed Standard | Not yet | No OpenAPI document exists to publish |
| schema.org `SoftwareApplication` | Adopted | Yes | JSON-LD on `/developers/` |
| robots.txt AI user agents | RFC 9309 plus vendor tokens | Kept as is | `User-agent: *` / `Allow: /` already covers them |
| Content Signals, IETF AIPREF | Vendor policy; IETF drafts | No | |
| `Accept: text/markdown` negotiation | Vendor feature (Cloudflare) | No | The site is on Vercel; the `.md` files serve the same need |

## llms.txt

**Status:** de-facto convention. llmstxt.org is a community proposal, now at
"v2". It is not a standards-body spec.
([llmstxt.org](https://llmstxt.org/),
[changes](https://llmstxt.org/changes.html))

The format, in order:

1. An H1 with the name of the project or site. This is "the only required
   section".
2. A blockquote with a short summary holding the key context.
3. Optional paragraphs or lists on how to read the rest.
4. Optional H2 sections of "file lists", each entry `- [name](url)`,
   optionally followed by `: notes`.

By convention an H2 called **Optional** holds secondary links an agent can
skip when it needs a shorter context. v2 dropped the `llms_txt2ctx` expansion
tool, so the heading no longer has a mechanical meaning.
([changes](https://llmstxt.org/changes.html))

A file can live at the site root or under a path. It covers the pages under
its path, and agents use the most specific file.
([changes](https://llmstxt.org/changes.html))

**Who reads it.** Google Search does not use llms.txt. Its guidance is that
special AI text files are not needed, and that keeping them for other
services "will neither harm nor help" visibility in Search.
([Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide))
llmstxt.org says Chrome Lighthouse checks for one in its agentic-browsing
audits, and that OpenAI, Anthropic and Google publish llms.txt files for
their own developer docs. We found no primary statement from OpenAI or
Anthropic that their crawlers or agents read it. Its real reader is an agent
that has been told a URL and fetches it.

**What Mirli does.** The old `llms.txt` was a dump of every page, generated
from the built HTML. Most of those entries were search landing pages and
category pages that tell an agent nothing about running Mirli. The new file
is curated. It has the H1, a summary blockquote, a paragraph naming the
identifiers that kept the old name, and sections in this order: Start here
(the developers page and its Markdown version), Docs, Product, and an
**Optional** section listing the generated catalogue pages (sound effect
categories, music, models, blog).

## llms-full.txt

**Status:** vendor convention, not part of llmstxt.org. Mintlify says it
created llms-full.txt with Anthropic.
([Mintlify blog](https://www.mintlify.com/blog/the-value-of-llms-txt-hype-or-real),
[Mintlify docs](https://mintlify.com/docs/ai/llmstxt))
It is the whole of the documentation in one file, for an agent that wants
everything in a single fetch.

**What Mirli does.** `/llms-full.txt` is the developers page as Markdown,
followed by the MCP, HTTP API, install, agent-install and streaming docs. They
are separated by `---` and keep their own headings, with relative links made
absolute.

## Markdown versions of pages

**Status:** part of the llms.txt proposal.
([llmstxt.org](https://llmstxt.org/),
[changes](https://llmstxt.org/changes.html))

- v1 appended `.md` to the page's URL (`page.html.md`). v2 also accepts
  replacing the extension (`page.md`).
- For a URL with no filename, the proposal uses `index.html.md` or
  `index.md`. Mirli's pages are served at trailing-slash URLs
  (`/developers/`), so each Markdown version is `index.md` in that
  directory: `/developers/index.md`.
- v2 adds discovery: `<link rel="alternate" type="text/markdown">` points at
  the Markdown version, and `<link rel="describedby">` points at the
  llms.txt that covers the page. Both work as HTML `<link>` elements or as
  HTTP `Link:` headers.

**What Mirli does.** It writes Markdown versions for the pages whose source
is Markdown or structured data:

- `/developers/index.md`, rendered from the same module as the page
  (`site/src/developers/content.ts`)
- `/docs/<slug>/index.md` for every doc page, from the `docs/*.md` file with
  its links made absolute

Each of those pages carries both `<link>` elements. The React marketing
pages (home, `/sfx`, `/music`) get no Markdown version. Turning their
components into Markdown would be a second copy of the copy, and there is
nothing on them an agent needs to run Mirli.

## AGENTS.md

**Status:** de-facto convention, stewarded by the Agentic AI Foundation
(AAIF) under the Linux Foundation. The AAIF was formed on 2025-12-09 with
AGENTS.md, MCP and goose as its founding projects.
([agents.md](https://agents.md/),
[Linux Foundation announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation),
[OpenAI](https://openai.com/index/agentic-ai-foundation/))

It is plain Markdown with no required fields: a README for coding agents.
The suggested contents are a project overview, build and test commands, code
style, testing instructions, security considerations, and PR and commit
guidelines. The nearest AGENTS.md wins, and an explicit user prompt overrides
all of them. agents.md lists Codex, Jules, Gemini CLI, Aider, goose, Zed,
Warp, VS Code, Devin, Windsurf, Cursor, GitHub Copilot's coding agent and
others as readers. Claude Code is not on that list. It reads `CLAUDE.md`.
([agents.md](https://agents.md/))

**What Mirli does.** It adds an `AGENTS.md` at the repo root with the commands
and rules from `CONTRIBUTING.md`, and adds nothing new. It covers *working on*
Mirli. *Using* Mirli is the developers page's job.

## The MCP Registry and `server.json`

**Status:** official, but the registry is still in **preview**. It launched
in preview on 2025-09-08, "breaking changes or data resets may occur", and
the API froze at v0.1 on 2025-10-24. No general-availability date has been
published.
([registry README](https://github.com/modelcontextprotocol/registry))

Schema: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
([quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx),
[schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)).

- **Required:** `name`, `description` and `version`.
- `name` matches `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`. A GitHub login must
  publish under `io.github.<username>/`.
- `description` is 1 to 100 characters.
- **Optional:** `title`, `websiteUrl`, `repository`, `packages[]`,
  `remotes[]` and `_meta`.
- `packages[]` entries need `registryType`, `identifier` and `transport`.
  For Docker the type is `oci`, with the tag inside the identifier
  (`ghcr.io/owner/image:tag`). `ghcr.io` is a supported registry.
- **OCI ownership** is proven by an image label,
  `LABEL io.modelcontextprotocol.server.name="<name>"`, whose value matches
  `name`.
  ([package types](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx))
- `remotes[]` is for publicly hosted endpoints. A server that runs on the
  user's machine is a package whose `transport` is `streamable-http`, with a
  localhost URL.
  ([generic server.json](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md))

Publishing ([quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)):
install `mcp-publisher`, then run `mcp-publisher login github` (a device
flow) and `mcp-publisher publish`. To check the result, query
`https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>`.

**What Mirli does.**

- **`server.json`:** added at the repo root. It declares one `oci` package,
  `ghcr.io/hamsanders/soundbox:v<version>`, whose transport is
  `streamable-http` at `http://localhost:17494/mcp`.
- **`Dockerfile`:** now carries the matching `LABEL`.
- **Version:** `scripts/version.mjs` keeps `server.json`'s version and image
  tag in step with the release.
- **Not published.** That step is the owner's: it needs the owner's GitHub
  login, and an image built with the label must be on ghcr.io first.

The desktop app has no registry type. The registry covers npm, PyPI, NuGet,
OCI and MCPB packages, and an installer that the user runs, with the server
inside the app, fits none of them. So the Docker image is the entry.

## `.well-known` discovery

- **MCP Server Cards (SEP-2127).** **Final** as of the merge on 2026-10-06.
  The card's recommended location is `<streamable-http-url>/server-card`, and
  site-wide discovery goes through an AI Catalog at
  `/.well-known/ai-catalog.json`. Cards describe *remote* connectivity only.
  The SEP points locally installed servers at the registry's `server.json`,
  and the discovery document in the extension repo is still marked draft.
  ([SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards.md),
  [PR #2127](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127),
  [discovery draft](https://github.com/modelcontextprotocol/experimental-ext-server-card/blob/main/docs/discovery.md),
  [AI Catalog](https://github.com/Agent-Card/ai-catalog))
  **Not adopted.** mirli.app hosts no MCP server, and the one on the user's
  machine is at `127.0.0.1`, which a catalog on a public site cannot point
  to usefully. A follow-up could have the local server answer
  `/mcp/server-card` itself.
- **`/.well-known/mcp`, `/.well-known/mcp.json` and
  `/.well-known/mcp/server-card.json`.** **Proposals only.** They come from
  an earlier MCP issue and individual IETF drafts such as
  [draft-serra-mcp-discovery-uri](https://datatracker.ietf.org/doc/draft-serra-mcp-discovery-uri/),
  and none was adopted. Not adopted here.
- **A2A Agent Card**, `/.well-known/agent-card.json`. **Adopted** in A2A
  1.0, now an AAIF project.
  ([A2A spec §8.2](https://a2a-protocol.org/latest/specification/))
  Not applicable: it describes an agent that takes tasks, and Mirli is a
  tool server an agent calls.
- **`/.well-known/ai-plugin.json`.** **Deprecated.** ChatGPT plugins wound
  down in 2024, and the docs now redirect to GPT Actions.
  ([OpenAI Actions](https://developers.openai.com/api/docs/actions))

## OpenAPI

**Status:** there is no standard path for an OpenAPI file. `/openapi.json`
is a framework default (FastAPI's, for example), not a standard. The standard
way to *discover* one is RFC 9727, a Proposed Standard from June 2025: a GET
to `/.well-known/api-catalog` returns a linkset whose `service-desc` link
points at the machine-readable description.
([RFC 9727](https://www.rfc-editor.org/rfc/rfc9727.html))

**What Mirli does:** nothing yet. The server has no OpenAPI document. Its
routes are validated by zod schemas (`server/src/schemas.ts`) and documented
by hand in `docs/API.md`. Writing an OpenAPI document by hand would be a third
copy that drifts, so it should be generated from the zod schemas. Once it
exists, publish a static copy on the site, with `servers` set to
`http://127.0.0.1:17494`, and link it from llms.txt and an `api-catalog`.
Agents on the user's machine can call the live API, and cloud crawlers can
read the copy. That is a follow-up.

## schema.org `SoftwareApplication`

**Status:** adopted. Google's software-app rich result
([docs](https://developers.google.com/search/docs/appearance/structured-data/software-app))
requires `name`, `offers.price`, and either `aggregateRating` or `review`,
and recommends `applicationCategory` and `operatingSystem`.
`MultimediaApplication` is on Google's list of categories.

**What Mirli does.** `/developers/` carries a `SoftwareApplication` with:

- **identity:** `name: "Mirli"` and `alternateName: "Soundbox"`, so the old
  name resolves to the same entity
- **facts:** the real version, the operating systems, `offers` at price 0,
  `downloadUrl`, `license` and `softwareHelp`
- a linked `SoftwareSourceCode` for the repository

It has no rating, because there are no ratings to cite. So it is not eligible
for the rich result, but the markup is still valid. The existing
`softwareAppJsonLd()` on the home page is copy owned elsewhere, and this
change does not touch it.

## AI crawlers in robots.txt

**Status:** robots.txt is RFC 9309. The user-agent tokens are vendor
conventions, each documented by its vendor:

| Token | What it is for | Source |
|---|---|---|
| GPTBot | OpenAI training | [OpenAI bots](https://developers.openai.com/api/docs/bots) |
| OAI-SearchBot | ChatGPT search | [OpenAI bots](https://developers.openai.com/api/docs/bots) |
| ChatGPT-User | Fetches a user asked for; "robots.txt rules may not apply" | [OpenAI bots](https://developers.openai.com/api/docs/bots) |
| ClaudeBot | Anthropic training | [Anthropic](https://support.claude.com/en/articles/8896518) |
| Claude-SearchBot | Claude search | [Anthropic](https://support.claude.com/en/articles/8896518) |
| Claude-User | Fetches a user asked for | [Anthropic](https://support.claude.com/en/articles/8896518) |
| PerplexityBot | Perplexity search | [Perplexity](https://docs.perplexity.ai/guides/bots) |
| Perplexity-User | Fetches a user asked for | [Perplexity](https://docs.perplexity.ai/guides/bots) |
| Google-Extended | Gemini training and grounding; no effect on Search | [Google crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) |
| Applebot-Extended | Apple training control | [Apple](https://support.apple.com/en-us/119829) |
| CCBot | Common Crawl | [Common Crawl](https://commoncrawl.org/ccbot) |

Under RFC 9309, a crawler with no group of its own follows the `*` group.
So `User-agent: *` with `Allow: /` admits every crawler above, and there is
nothing to add. Mirli wants to be found and cited.

- **[IETF AIPREF](https://datatracker.ietf.org/wg/aipref/documents/):**
  working-group drafts (`draft-ietf-aipref-vocab`, `draft-ietf-aipref-attach`),
  not RFCs.
- **[Content Signals](https://blog.cloudflare.com/content-signals-policy/):**
  a Cloudflare policy.

Neither is adopted here. Both express restrictions, and Mirli has none to
express.

## Other things that exist

- **`Accept: text/markdown`.** Cloudflare's "Markdown for Agents" returns a
  Markdown version of a page when asked with that header.
  ([Cloudflare](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/))
  It is a vendor feature and the site is on Vercel. The static `.md` files and
  `rel="alternate"` links serve the same need.
- **NLWeb** (Microsoft, MIT) is experimental, with no tagged releases.
  ([GitHub](https://github.com/nlweb-ai/NLWeb)) Not adopted.
- **MCP install links.** Cursor's
  `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64>`
  ([Cursor](https://cursor.com/docs/context/mcp/install-links)) and VS
  Code's `vscode:mcp/install?<url-encoded JSON>`
  ([VS Code](https://code.visualstudio.com/api/extension-guides/ai/mcp)) are
  both documented. Both are on the developers page as buttons.

## MCP client syntax used on the developers page

Each line comes from the client's own documentation:

- **Claude Code:** `claude mcp add --transport http <name> <url>`, with
  `--scope user` and `--header`.
  ([docs](https://code.claude.com/docs/en/mcp))
- **Cursor:** `.cursor/mcp.json` or `~/.cursor/mcp.json`, as
  `{"mcpServers":{"x":{"url":"…"}}}`.
  ([docs](https://cursor.com/docs/context/mcp))
- **VS Code:** `code --add-mcp '{"name":…,"type":"http","url":…}'`, or a
  `servers` entry with `type: "http"`.
  ([docs](https://code.visualstudio.com/docs/agents/reference/mcp-configuration))
- **Codex CLI:** `codex mcp add <name> --url <url>`, or `[mcp_servers.x]` with
  `url = …` in `~/.codex/config.toml`.
  ([docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli))
- **Gemini CLI:** `gemini mcp add --transport http <name> <url>`, or
  `httpUrl` in `settings.json`. `url` there means SSE.
  ([docs](https://geminicli.com/docs/tools/mcp-server/))
- **Zed:** `"context_servers": {"x": {"url": "…"}}`.
  ([docs](https://zed.dev/docs/ai/mcp))
- **Claude Desktop:** `claude_desktop_config.json` is documented only with
  stdio `command`/`args` entries.
  ([docs](https://modelcontextprotocol.io/docs/develop/connect-local-servers))
  Custom connectors connect from Anthropic's cloud, so they cannot reach
  localhost. ([docs](https://support.claude.com/en/articles/11175166))
  Mirli's stdio bridge (`server/dist/mcp/stdio.js`) is the documented route.
- **Windsurf** is left out. Its old docs URL now redirects to Devin's, and
  we could not verify the current config key.

## Owner steps not done here

1. Build and push an image with the new `LABEL` (the next release does this).
   Then install `mcp-publisher`, run `mcp-publisher login github` as the repo
   owner, and run `mcp-publisher publish` from the repo root. The name used
   here is `io.github.HamSanders/mirli`. The registry grants the pattern
   `io.github.<login>/*` using the login exactly as GitHub returns it
   ([github_at.go](https://github.com/modelcontextprotocol/registry/blob/main/internal/api/handlers/v0/auth/github_at.go)),
   and we found no case folding. If the publish is refused for the
   namespace, change `server.json`'s `name` and the `Dockerfile` label
   together, and match them to the namespace the error names.
2. Optional: generate an OpenAPI document from the zod schemas and publish
   it, as described above.
3. Optional: serve an MCP Server Card from the local server at
   `/mcp/server-card`.
