---
name: Bug report
about: Something in Konchi doesn't work
title: ""
labels: bug
---

**What happened**
What you did, what you expected, what you got instead.

**Environment**
Paste the output of `GET /api/health`, which includes the version, device and VRAM:

```bash
curl http://127.0.0.1:17494/api/health
```

Your OS, GPU (and driver), and Node version (`node --version`).

**Model**
Which model, and its status on the Models screen (not installed / installed /
loaded / error). If it shows an error, paste the message.

**Server log**
The server's console output around the failure (the terminal running
`npm run dev` or `npx konchi`), or the same lines from its log file:
`~/.konchi/konchi-<port>.log`, e.g. `konchi-17494.log` (the server prints
the exact path at startup). Redact your HF token if
it appears anywhere. It should not appear in the log; if it does, report that
as a bug too.
