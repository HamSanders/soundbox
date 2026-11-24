# Live voice (Calls)

Talk out loud with a character, in real time: you speak, it answers in one of
your Mirli voices, and you can interrupt it. Use it from the **Calls** page in
Mirli, or bring a character into a Discord voice channel.

Video calls (a talking face) are not part of this yet.

| Part | Where | What |
|---|---|---|
| App | `app/src/routes/calls/`, `app/src/calls/` | **Calls** in the sidebar: the hub (`/calls`), a voice call (`/calls/voice[/:id]`), make or edit a character (`/calls/new`, `/calls/characters/:id`). Talks to the server only through `app/src/calls/live-client.ts`. |
| Server | `server/src/routes/calls.ts`, `server/src/calls/` | The Call API inside the Mirli server: characters (Santa built in), call grants, tokens, heartbeats. |
| Worker | `live/voice/` | The process that holds the conversation: VAD, speech-to-text, the LLM, streaming TTS. See [voice/README.md](voice/README.md). |
| Discord | `integrations/discord/` | A bot that joins your voice channel as one of your characters. See [its README](../integrations/discord/README.md). |

## Running it

1. Start Mirli (`npm run dev`, or the desktop app). The first start writes the
   call secret the worker checks tokens with.
2. Start the worker: `cd live/voice`, then `npm install`, `npm run setup` once,
   and `npm start`. To answer with your own Claude instead of the local model:
   `LLM_PROVIDER=claude npm start` (see the worker's README).
3. Open **Calls** in Mirli. Pick a character, or **Talk to Mirli**. Use
   headphones: with speakers it can hear itself and interrupt itself.

The Mirli server finds the worker at `MIRLI_CALL_VOICE_URL` (default
`http://127.0.0.1:17650`). It shares a secret with it in
`~/.mirli-live/call-secret` (`MIRLI_CALL_SECRET` overrides). One call runs at a
time on a machine: the app or Discord, not both.

## Characters

A character is a name, a persona, a voice and, if you like, a portrait.

- **Persona:** the LLM's instructions: who they are, how they talk, what they
  ask about. Every reply is read aloud, so Mirli adds a rule asking for plain
  spoken sentences (no lists, emoji or brackets) to whatever you write.
- **Voice:** one of your saved Mirli voices. With none picked, a character uses
  a voice with the same name if you have one (a voice called "Santa" for
  Santa), else the worker's default. The worker clones every voice from its
  clip; to use a preset voice, **Make a call voice from a preset** in the
  editor reads a script in that preset and saves the take as a clone voice.
- **Portrait:** optional. Upload a picture or have Mirli's image engine draw one
  (Settings > Artwork). Characters without one show their initial.
- **Santa** is built in and can't be deleted.

They are stored per profile in `<data dir>/characters/<id>/` (`character.json`,
and `portrait.png|jpg` if there is one). The app and Discord see the same list.

## The Call API

Served by the Mirli server under `/api`. JSON; errors are
`{ "error": { "code", "message" } }`. Mutating requests carry `X-Soundbox: 1`.
Where a `character` is taken, an id or a name works.

| Method | Path | Returns |
|---|---|---|
| `POST` | `/calls` `{ character? }` | `201 { call_id, mode: "voice", character, name, ws_url, token, expires, heartbeat_s, persona, voice_id }`. No character is Mirli. `409 busy` when a call is running, `404` for an unknown character. |
| `POST` | `/calls/:id/heartbeat` | `{ expires, token }`, every `heartbeat_s`. No beat for 3 × `heartbeat_s` ends the call. |
| `POST` | `/calls/:id/character` `{ character }` | `{ character, name, persona, voice_id }`: switch character mid-call. The client then sends the persona and voice on its socket. |
| `DELETE` | `/calls/:id` | The ledger row `{ call, mode, character, seconds, reason }`. The worker drops the socket (`4001`). |
| `GET` | `/calls/status`, `/calls/voices`, `/calls/history` | Whether the worker answers, its voices, recent calls. |
| `GET` `POST` | `/characters`; `GET` `PATCH` `DELETE` `/characters/:id`; `GET /characters/:id/portrait` | Characters. `POST`/`PATCH` take `name`, `persona`, `voice_id`, and a portrait as `image` (data URL) or `prompt` (drawn). |

A client then opens `new WebSocket(ws_url, ["mirli.v1", "bearer." + token])`,
sends `{type:"persona", text: persona}` and, if there is one,
`{type:"voice", id: voice_id}`, and streams the microphone. The socket protocol
is in the worker's README.

The token is `base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload part))`,
payload `{ v: 1, call, aud: ["voice"], iat, exp }`, valid for two minutes;
`server/src/calls/token.ts` signs it and `live/voice/lib/call-token.mjs`
verifies it (a test keeps the two identical).

## Tests

```bash
cd server && npx vitest run test/calls.test.ts   # registry, tokens, characters, routes
cd live/voice && npm test                        # per-call routing, tokens, the Claude brain
cd integrations/discord && npm test              # audio conversion, the floor, the Call API client
```
