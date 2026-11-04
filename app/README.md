# Konchi web app

The React front end for [Konchi](../README.md). It is one npm workspace of
the monorepo; run it from the repository root, not from here.

```bash
npm run dev        # server on 127.0.0.1:17494 + this UI on http://localhost:5174
npm run dev:mock   # this UI alone, against an in-browser fake backend
```

The same route components are reused by the public site in `../site`, which is
why `src/routes/` contains pages the app itself never mounts. The map of what
lives where is in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

To typecheck, run `npx tsc -p tsconfig.app.json` from this directory.
`tsc -p .` checks nothing.
