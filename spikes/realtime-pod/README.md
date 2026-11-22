# Real-time call pod (spike)

One Mirli voice + talking-face call in one container, made for a GPU pod (RunPod Pods first). One call per
pod for now. A router outside the pod picks a free pod for each caller.

```
browser ─HTTPS/WSS─ provider proxy ─ :8080 pod.mjs ─┬─ page, /ws, /voices ─ voice server :17650 (Node)
                                                    │                         ├─ audiocpp_server :17652  Nemotron 3.5 ASR q8
                                                    │                         ├─ audiocpp_server :17651  VoxCPM2 q8 (streaming)
                                                    │                         └─ LLM: external, OpenAI-compatible (LLM_BASE_URL)
                                                    └─ /facesrv/*  ────────── face server :17660 (Python, MuseTalk 1.5)
                                                                                └─ subscribes to the voice server's PCM tap
```

Only port 8080 leaves the container. Everything else listens on 127.0.0.1.

Why MuseTalk: its code and weights are MIT, and the face box comes from OpenCV's YuNet (MIT). Ditto's
InsightFace parts are non-commercial and FlashHead Lite's VAE is research-only, so neither can be the hosted
default. The Dockerfile only installs MuseTalk.

## Files

| File | What |
|---|---|
| `Dockerfile` | The image. Build context is `spikes/`. Weights are baked in and every version is pinned (see the header). |
| `Dockerfile.dockerignore` | Sends only what the Dockerfile copies (the build context would otherwise include `node_modules`, run logs and results). |
| `entrypoint.sh` | Starts the voice server, the face server and `pod.mjs`. If one of them exits, the container exits so the provider restarts it. |
| `pod.mjs` | The front door: proxy, one call at a time, busy/free state, health, readiness, call tokens and a record of each call. Standard library only. |
| `smoke.mjs` | 29 checks of `pod.mjs` against stub engines. No GPU needed: `node smoke.mjs` (after `npm ci` in `../realtime-voice`). |
| `start.sh` | Sets up a stock RunPod PyTorch pod and starts the call (see above). |
| `build.sh` | Copies the portraits into `faces/` (gitignored) and builds the image. For CI, not the dev PC. |

## Run on RunPod (no local build)

The pod runs RunPod's stock `runpod/pytorch:2.2.0-rc.229-cu1290-torch290-ubuntu2404` image with `start.sh`
passed base64-encoded in `START`, and docker args
`bash -c 'echo $START | base64 -d > /start.sh; bash /start.sh > /workspace/start.log 2>&1'`. `start.sh`
installs Node and audio.cpp, pip-installs the pinned packages, clones this repo at `CODE_REF` (so the branch
must be pushed), pulls the weights into `/workspace` (use a network volume to keep them) and runs
`entrypoint.sh`. Portraits come from `FACES_URL` (a tarball of PNGs) or `/workspace/faces`. Expose `8080/http`.

## Build an image (later, in CI)

```bash
./build.sh                      # tag mirli-call-pod:dev
docker run --gpus all -p 8080:8080 \
  -e LLM_BASE_URL=https://api.groq.com/openai/v1 -e LLM_MODEL=openai/gpt-oss-20b -e LLM_API_KEY=... \
  -e POD_SECRET=... -e POD_ADMIN_TOKEN=... \
  mirli-call-pod:dev
```

`FACE=0` gives a voice-only pod. `FACE_IMAGE=/opt/faces/<id>.png` picks the starting portrait.
Leaving `POD_SECRET` unset is dev mode: every request is let in, and the log says so.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | required | Any OpenAI-compatible endpoint. The voice server sends one "Say hi." at start-up to check it. |
| `POD_SECRET` | unset (dev mode) | HMAC key for call tokens. The router sets a different one on each pod when it creates it. |
| `POD_ADMIN_TOKEN` | unset | Bearer token for `/state`, `/claim`, `/release`, `/drain`. |
| `POD_CLAIM_TTL_S` | 90 | A claimed pod nobody joins goes back to free after this long. |
| `POD_RECONNECT_GRACE_S` | 15 | A caller whose socket drops can rejoin the same call within this window. |
| `POD_MAX_CALL_S` | 3600 | Hard cap on one call. |
| `POD_LEDGER` | `/tmp/mirli-calls.jsonl` | One JSON line per finished call. |
| `FACE`, `FACE_IMAGE`, `FACE_ARGS` | `1`, first portrait, none | Face on or off, starting portrait, extra `server.py` flags (for example `--no-idle`). |
| `VAD_*`, `STT_*`, `LLM_*`, `FIRST_CLAUSE_WORDS` | see `../realtime-voice/lib/config.mjs` | Passed through to the voice server unchanged. |

## Endpoints on :8080

States: `starting` (engines loading) → `free` → `reserved` (router claimed it) → `busy` (caller's `/ws` is
open, including the reconnect grace) → `free`. `draining` = finish the current call, then take no more.

| Path | Who | Returns |
|---|---|---|
| `GET /healthz` | provider, router | 200 while the process is up. It doesn't depend on the engines, so a slow model load doesn't trigger a restart loop. |
| `GET /readyz` | router | 200 only when the pod is `free`, otherwise 503. Body: `state`, `uptime_s`, `engines_ready_s`, `idle_s`, `call {id, connected, connected_s}`. |
| `GET /state` | router (admin token) | The same plus engine detail (VRAM, face fps), `calls_served`, `last_call`, `pod_id`. |
| `POST /claim {call_id}` | router (admin token) | Reserves a free pod for that call. A retry with the same id returns 200; any other claim gets 409. |
| `POST /release {call_id?, reason?}` | router (admin token) | Ends the call now (closes the sockets, flushes the face) and returns the call record. |
| `POST /drain {draining: true\|false}` | router (admin token) | Stops new callers before the router stops the pod. |
| `GET /?t=<token>` | caller | The call page. Sets an HttpOnly cookie, so the page's own requests and WebSockets carry the token. |
| `WS /ws` | caller | The conversation (mic in, TTS out, events). One per call. |
| `WS /facesrv/ws`, `/facesrv/faces`, `/facesrv/face`, `/facesrv/stats`, `/facesrv/flush` | caller | The face server's video socket and portrait picker. Engine switching is not offered. |

The call token is `v1.<call_id>.<exp unix s>.<base64url HMAC-SHA256(POD_SECRET, "mirli-call:<call_id>:<exp>")>`.
The router mints it; the pod never calls home. A valid token for a free pod also binds the pod to that call
(direct join without `/claim`).

## WebSockets through the provider proxy

RunPod's HTTP proxy (`https://<pod>-8080.proxy.runpod.net`) goes through Cloudflare. RunPod's docs say
"Cloudflare enforces a maximum connection time of 100 seconds", and they don't say whether WebSockets are
supported (https://docs.runpod.io/pods/configuration/expose-ports, read 2026-11-21). Cloudflare itself
proxies WebSockets, and its 100 s limit applies to a connection with no traffic. During a call both sockets
carry data many times a second (mic frames about every 32 ms in, face frames at 25 fps out), so neither
should sit idle. **This is untested on a real pod.** If it fails, the fallback is a TCP port (symmetric port
70000+, `RUNPOD_TCP_PORT_70000`). That port has no TLS, so an HTTPS page can't open `ws://` to it: the pod
would need its own certificate, or the router would relay the sockets.

## What has been run

- `node smoke.mjs`: 29/29 pass on Windows (Node 24) against stub engines.
- `docker build` in WSL: all 19 steps finished, but the export was cut off when WSL shut down. Local builds
  are off now (they starved the dev box), so the image is for a CI build later.
