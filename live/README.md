# Mirli Live

Real-time voice and video calls with AI characters. Three parts:

| Part | Where | What |
|---|---|---|
| Web app | `app/live.html`, `app/src/live/` | The front end, in the Mirli app's stack and design system (React, Tailwind tokens from `app/src/index.css`, `@/components/ui`). Talks to the back end only through `app/src/live/lib/live-client.ts`. |
| Call API (local) | `live/api/` | `POST /v1/calls` and friends, in front of the workers on this machine. The cloud gateway serves the same contract. |
| Workers | `spikes/realtime-voice/` (voice, 17650), `spikes/realtime-face/` (face, 17680 MuseTalk or 17660) | Accept a signed call token, CORS for our origins, and route each call's audio and frames to that call only. |

## Running it locally

```bash
node live/api/server.mjs          # Call API on 127.0.0.1:17690
cd app && npx vite --port 5191    # then open http://127.0.0.1:5191/live.html
```

The voice and face servers run as before (`spikes/realtime-voice/restart.sh`, `spikes/realtime-face/restart.sh`). The first start of the Call API writes a secret to `~/.mirli-live/call-secret`; workers started after that read it and require tokens. Set `MIRLI_CALL_AUTH=off` on a worker to run it open, as the spike did (the old spike pages need that).

`?api=<url>` on the page, or `VITE_LIVE_API` at build time, points the app at another Call API.

## The contract

All JSON. Errors are `{ "error": { "code", "message" } }`.

| Method | Path | Returns |
|---|---|---|
| `POST` | `/v1/calls` `{ mode: "video" \| "voice", character? }` | `201 { call_id, mode, character, ws_url, face_ws_url, token, expires, heartbeat_s, persona }`. `409 busy` when a call is already running (one per machine locally, one per account in the cloud). `503 no_face` for a video call without a face worker. |
| `POST` | `/v1/calls/:id/heartbeat` | `{ expires, token }`: send every `heartbeat_s`. A call with no beat for 3 × `heartbeat_s` is ended. The fresh token lets a dropped socket reconnect. |
| `POST` | `/v1/calls/:id/character` `{ character }` | `{ character, name, persona }`: switch face mid-call (video only). |
| `DELETE` | `/v1/calls/:id` | The ledger row: `{ seconds, reason, ... }`. Both workers drop the call (`4001`). |
| `GET` | `/v1/characters`, `/v1/characters/:id/portrait`, `POST /v1/characters` (raw image, `X-Name`) | Characters (portrait + persona). |
| `GET` | `/v1/voices`, `/v1/face-models`, `POST /v1/face-models {name}` | Voices; the face model (local only: restarts the face worker, about 20 s). |
| `GET` | `/v1/account`, `/v1/health` | Minutes used and recent calls; whether the workers answer. |

### Sockets

- Voice: `new WebSocket(ws_url, ["mirli.v1", "bearer." + token])`. Mic in as 16 kHz s16le frames; JSON events and the reply's PCM out (same messages as the spike: `hello`, `state`, `partial`, `final`, `reply_delta`, `flush`, `turn`, `error`).
- Face: `new WebSocket(face_ws_url, ["mirli.v1", "bearer." + token])`. Chunks of audio + JPEG frames. In a video call the page plays the face's audio (lips and sound on one clock), not the voice socket's.
- Close codes: `4000` replaced by a newer socket for the same call, `4001` call ended, `4409` the face is on another call.

### Tokens

`base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload part))`, payload `{ v: 1, call, aud, iat, exp }`. Implemented three times, kept identical by a cross-language test: `live/api/token.mjs`, `spikes/realtime-face/call_token.py`, and the cloud gateway. Audiences: `voice`, `face`, `tap` (the face worker following a call's speech), `admin` (the API ending calls, switching portraits).

## Per-call routing (the doubled-audio fix)

The spike's face server sent every chunk to every connected socket, and followed the voice server's one shared tap. Two tabs, a reload that left a socket open, or a second caller all got the same audio and face. Now:

- **Voice worker** (`spikes/realtime-voice/lib/calls.mjs`): one conversation per call (a second socket replaces the first); each call has its own PCM tap at `/tap?call=<id>`.
- **Face worker** (`spikes/realtime-face/call_router.py`): one active call; its socket is the only one that gets chunks; another call is refused with `4409`; the face follows that call's tap only, and flushes when the call changes.

## Tests

```bash
cd live && npm install && npm test          # token + registry unit tests (Node)
cd spikes/realtime-voice && node --test test/*.test.mjs
cd spikes/realtime-face && python -m unittest test_call_router
cd live && npm run test:e2e                 # Playwright: the app and the routing, end to end
```

The end-to-end suite runs the real face server on its fake engine (`--engine fake`, no GPU), a fake voice worker that shares the real routing code (`spikes/realtime-voice/fake-server.mjs`), the real Call API and the Vite dev server, all on spare ports (17750, 17760, 17790, 5180). It never touches the live servers. `FACE_PYTHON` points at a Python with `aiohttp`, `opencv` and `scipy` (default: the face spike's venv).
