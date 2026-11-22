# Calls (Mirli Live)

Real-time voice and video calls with characters, as part of the Mirli app.

| Part | Where | What |
|---|---|---|
| App | `app/src/routes/calls/`, `app/src/calls/` | The **Calls** area in the sidebar: the hub (`/calls`), video call (`/calls/video/:id`), voice call (`/calls/voice[/:id]`), create or edit a character (`/calls/new`, `/calls/characters/:id`). Talks to the back end only through `app/src/calls/live-client.ts`. |
| Server | `server/src/routes/calls.ts`, `server/src/calls/` | The Call API inside the Mirli server: calls, tokens, characters (Santa built in), avatar packs. |
| Workers | `spikes/realtime-voice/` (voice, 17650), `spikes/realtime-face/` (face: 17680 MuseTalk, else 17660) | Separate processes. They accept a signed call token, CORS for our origins, and route each call's audio and frames to that call only. |
| Avatar creator | `avatar-creator/` | ComfyUI pipeline that renders a character's pose stills and clips (an avatar pack). |
| Shared | `live/api/token.mjs`, `live/e2e/` | The token format the voice worker verifies, and the end-to-end tests. |

## Running it locally

1. Start the workers as before: `spikes/realtime-voice/restart.sh`, `spikes/realtime-face/restart.sh` (or the MuseTalk command in its README).
2. Run Mirli (`npm run dev`). Open **Calls** in the sidebar.

The Mirli server finds the workers at `MIRLI_CALL_VOICE_URL` (default `http://127.0.0.1:17650`) and `MIRLI_CALL_FACE_URL` (default `17680`, then `17660`). It shares a secret with them in `~/.mirli-live/call-secret` (made on first use; `MIRLI_CALL_SECRET` overrides). Workers started after the file exists require tokens; `MIRLI_CALL_AUTH=off` on a worker runs it open, as the spike did.

## Characters

- Stored per profile in `<data dir>/characters/<id>/`: `character.json` (name, persona, voice), `portrait.png|jpg`, and an optional `pack/`.
- **Santa** is built in: persona and portrait ship with the server (`server/src/calls/builtin/`). If you have a voice called "Santa", he uses it unless you pick another.
- **Create your own** at `/calls/new`: upload a portrait or have Mirli's image engine draw one (Settings > Artwork), write the persona, pick a voice. They can then be called by voice or video.

### Avatar packs

A pack is pose stills plus short clips between them (`manifest.json`, `stills/`, `clips/`, the format `app/src/calls/pose-player.ts` plays). In a video call the clips play around the live face; on the talk pose the live face is pasted into the talk still's `faceBox`.

- **Render on this machine:** the character page's *Render pack* runs `avatar-creator/build_avatar.py` against a ComfyUI server (default `http://127.0.0.1:8188`, `MIRLI_COMFY_URL`; Python from `MIRLI_AVATAR_PYTHON`). The models are listed in `avatar-creator/README.md` (about 70 GB with an uploaded portrait).
- **Render in Mirli Cloud:** stubbed; the server refuses with 501 and spends nothing.
- **Import:** a folder that already has a `manifest.json`. Santa's clips are not in git (33 MB); paste the spike's `spikes/realtime-voice/public/santa-clips` folder into *Import a pack* on Santa's page, or `POST /api/characters/santa/pack/import { "dir": "<that folder>" }`.

## The contract

Paths are relative to the API base: `/api` in the Mirli server, `/v1` on the cloud gateway. JSON; errors are `{ "error": { "code", "message" } }`. Mutating requests to the Mirli server carry `X-Soundbox: 1`.

| Method | Path | Returns |
|---|---|---|
| `POST` | `/calls` `{ mode: "video" \| "voice", character? }` | `201 { call_id, mode, character, ws_url, face_ws_url, token, expires, heartbeat_s, persona, voice_id }`. `409 busy` when a call is running (one per machine locally, one per account in the cloud). `503 no_face` for video without a face worker. A video call needs a character; a voice call without one is Mirli. |
| `POST` | `/calls/:id/heartbeat` | `{ expires, token }`, every `heartbeat_s`. No beat for 3 × `heartbeat_s` ends the call. The fresh token lets a dropped socket reconnect. |
| `POST` | `/calls/:id/character` `{ character }` | `{ character, name, persona, voice_id }`: switch face mid-call. |
| `DELETE` | `/calls/:id` | The ledger row `{ call, mode, character, seconds, reason }`. Both workers drop the call (`4001`). |
| `GET` | `/calls/status`, `/calls/voices`, `/calls/history`, `/calls/face-models` (+ `POST` to switch) | Workers up, voices, minutes used and recent calls, the face model. |
| `GET` `POST` | `/characters`, `/characters/:id` (`PATCH`, `DELETE`), `/characters/:id/portrait`, `/characters/:id/pack/<file>`, `POST /characters/:id/pack { provider, comfy_url? }`, `POST /characters/:id/pack/import { dir }` | Characters and packs. Portraits are sent as data URLs (`image`) or drawn from `prompt`. |

### Sockets and tokens

- Voice: `new WebSocket(ws_url, ["mirli.v1", "bearer." + token])`. Mic in (16 kHz s16le); JSON events (`hello`, `state`, `partial`, `final`, `reply_delta`, `flush`, `turn`, `error`) and the reply's PCM out.
- Face: `new WebSocket(face_ws_url, ["mirli.v1", "bearer." + token])`. Audio + JPEG frames per chunk. In a video call the page plays the face's audio, not the voice socket's, so lips and sound share a clock.
- Close codes: `4000` replaced by a newer socket for the same call, `4001` call ended, `4409` the face is on another call.
- Token: `base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload part))`, payload `{ v: 1, call, aud, iat, exp }`. Implemented in `server/src/calls/token.ts`, `live/api/token.mjs` and `spikes/realtime-face/call_token.py`, kept identical by cross-language tests.

## Per-call routing

The spike's face server sent every chunk to every socket and followed one shared tap: two tabs or two callers got doubled audio and each other's face. Now the voice worker keeps one conversation per call and a tap per call (`/tap?call=<id>`), and the face worker serves one active call: only its socket gets chunks, another call is refused with `4409`, and the face follows that call's tap only.

## Tests

```bash
cd server && npx vitest run test/calls.test.ts     # registry, tokens (Node <-> Python), characters, routes
cd live && npm install && npm test                 # token module
cd spikes/realtime-voice && node --test test/*.test.mjs
cd spikes/realtime-face && python -m unittest test_call_router
cd live && npm run test:e2e                        # Playwright, end to end
```

The end-to-end suite runs the real face server on its fake engine (`--engine fake`, no GPU), a fake voice worker that shares the real routing code (`spikes/realtime-voice/fake-server.mjs`), the real Mirli server on a scratch data dir and the app's Vite dev server, on spare ports (17750, 17760, 17795, 5180). It covers: Calls in the navigation, a video call with Santa, importing an avatar pack and the pose clips handing over to the live face, creating a character and calling it by voice and video, a voice call, and the routing (contract, tokens, busy, no cross-talk or doubled audio). `FACE_PYTHON` points at a Python with `aiohttp`, `opencv` and `scipy` (default: the face spike's venv); `ffmpeg` must be on the PATH.
