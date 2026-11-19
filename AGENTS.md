# AGENTS.md

Instructions for coding agents working on this repository. People should
start with [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this
file restates the parts an agent needs, and adds nothing they don't say.

To *use* Mirli (install it, connect its MCP server, call its HTTP API), read
<https://mirli.app/developers/> or its Markdown version,
<https://mirli.app/developers/index.md>, instead.

## What this is

Mirli generates sound effects, music and speech locally from open-weight
models. The product was called Soundbox, and many identifiers keep that
name on purpose: the `soundbox` CLI and npm workspace names, the
`soundbox.*` MCP tools, the `X-Soundbox` header, `soundbox.db` and the
`ghcr.io/hamsanders/soundbox` image. Do not rename them; agents and scripts
out in the world type them. Environment variables are `MIRLI_*`, and the
server still accepts the old `SOUNDBOX_*` names (`server/src/env.ts`); the
data directory is `~/.mirli`, or an existing `~/.soundbox` from before the
rename (`config.defaultDataDir()`). Keep both fallbacks.

## Layout

- `server/`: the TypeScript server (Fastify on Node 22). It holds the HTTP
  API (`src/routes/`), the MCP server (`src/mcp/server.ts`) and the job queue.
  Every model runs through the audio.cpp binary (`src/models/audiocpp.ts`),
  with the catalogue in `src/models/audiocpp_models_catalog.json`.
- `app/`: the React UI (Vite, Tailwind v4, shadcn/ui).
- `site/`: the public website at mirli.app (vite-react-ssg). It borrows
  components from `app/src` through the `@/` alias.
- `src-tauri/`: the desktop shell (Tauri 2).
- `docs/`: Markdown docs, also published as pages under `/docs/`.
- `api/`: the Vercel function behind the update check.

## Commands

```bash
npm install
npm run dev          # server on 17494 + Vite on 5174
npm run dev:mock     # UI only, against an in-browser fake: no server, no GPU
npm test             # server tests (vitest)
npm run typecheck    # app + server, strict
npm run lint         # oxlint over the app
npm run build        # app + server into server/dist
npm run site:build   # the website into site/dist
node scripts/version.mjs check
```

CI runs all of these. Run the ones your change touches before you call it
done.

## Rules

- Tests must not download models or need a GPU or the network. Use the fake
  sine-wave input or mocked subprocess output that the existing tests use.
- Every model catalogue entry needs an accurate `license.commercial`
  (`yes`, `conditional` or `no`), citing the licence you read. If the licence
  is unknown, record `no` and explain why in `note`. Never use `conditional`
  as a placeholder.
- Frontend: use the existing CSS variables, never inline hex colours. Every
  screen must work in light and dark. `tsc --noEmit` must be clean, and
  type-only imports need `import type`.
- The MCP tool table (`MCP_TOOLS` in `server/src/mcp/server.ts`) and the
  `registerTool` calls must agree; the site build fails if they don't
  (`site/plugins/developer-facts.ts`).
- Leave version numbers alone. They change only in a release PR, through
  `node scripts/version.mjs bump`.
- If users will notice a change, add a line under `## [Unreleased]` in
  `CHANGELOG.md`.

## Pull requests

Keep them small and focused. Say what changed and how you verified it. PRs
are squash-merged into `main` once CI passes. Contributions are MIT-licensed.
