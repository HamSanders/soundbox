# Custom endpoints

A custom endpoint sends generation to a server you already run, instead of a
model Konchi downloads and runs itself. Use one when a machine on your
network already serves the model (LocalAI, an OpenAI-compatible speech server,
a gateway), or when the machine running Konchi can't download weights.

Each endpoint appears as one model in the pickers. Its id is
`endpoint:<id>`. Sounds made with it go into the library like any other, and
work in the editor, the studio and over MCP the same way.

## Adding one

Go to Settings → Endpoints → Add endpoint. Pick a preset or start blank, then
check four things:

| Field | What it is |
| --- | --- |
| **Used for** | Sound effects, Music or Speech. This decides which picker the endpoint appears in. |
| **URL** | The full URL to POST to, path included, e.g. `http://192.168.1.20:8080/v1/sound-generation`. |
| **API key** | Optional. Sent as `Authorization: Bearer <key>`. Once saved it is never shown or returned again. Leave the field blank when editing to keep the saved key. |
| **Body template** | The JSON request body, with `{{variables}}` for what Konchi fills in. |

Press **Test** before saving. It sends one short request with the form as it
stands and reports the length and format of the audio that came back, or the
server's error. Nothing is added to the library.

## Presets

| Preset | Endpoint | Notes |
| --- | --- | --- |
| LocalAI ACE-Step music | `POST /v1/sound-generation` | Sends `model_id`, `caption`, `lyrics`, `bpm`, `keyscale` and `duration_seconds`. LocalAI's ACE-Step example uses `model` instead. If your server rejects `model_id`, rename it. |
| LocalAI sound effects | `POST /v1/sound-generation` | ElevenLabs-shaped: `model_id`, `text`, `duration_seconds`. |
| OpenAI-compatible speech | `POST /v1/audio/speech` | Works with LocalAI, OpenAI-compatible servers and most proxies. Asks for `response_format: "wav"`, so ffmpeg is not needed. List your server's voices in **Voices**. |

Presets cover servers you run yourself. Any other server, including hosted
APIs, can be added by hand. Servers that expose the same path don't agree on
the body: two `/v1/audio/music` implementations take `prompt` and
`duration_seconds` and `input` and `duration` respectively. This is why the
body is a template and not a fixed format.

## Where requests go

Konchi is local-first, and an endpoint is the one setting that can send a
prompt somewhere else. If an endpoint's URL is not on this machine or your
local network, the form and the model's description say so, and the
endpoint is marked **Off-network** in the list. Prompts, lyrics and any voice
clip used with that endpoint are sent to that host.

"Local" is judged from the hostname: `localhost`, private IPv4 ranges
(`10.*`, `172.16–31.*`, `192.168.*`), IPv6 local addresses, names without a
dot (`homeserver`), and names ending in `.local`, `.lan`, `.home`, `.internal`
or `.home.arpa`. A public name that resolves to a LAN address counts as
off-network.

## Templates

The template is JSON with placeholders. Where a placeholder sits decides what
it becomes:

```json
{
  "model": "ace-step-turbo",
  "bpm": {{bpm}},
  "keyscale": "{{key}}",
  "caption": "lofi, {{prompt}}",
  "duration_seconds": {{duration}}
}
```

- A bare placeholder (`{{bpm}}`) becomes the JSON value: a number, `true` or
  `false`, or `null`.
- A placeholder that is the whole string (`"{{key}}"`) also becomes the
  value, so a template can stay valid JSON in an editor.
- A placeholder inside a longer string (`"lofi, {{prompt}}"`) is inserted as
  text.
- A field whose value comes out `null` is left out of the request. When a
  prompt names no key, `keyscale` is not sent, rather than sent as `null`.

Values are JSON-encoded when they are inserted, so a quote or brace in a
prompt cannot break the request.

| Variable | Value |
| --- | --- |
| `prompt` | The description from the composer. |
| `negative_prompt` | What to avoid, if the composer has one. |
| `lyrics` | Lyrics for a vocal track, or null. |
| `instrumental` | `true` when there are no lyrics. |
| `duration`, `duration_ms` | The requested length in seconds or milliseconds. |
| `bpm` | A tempo written in the prompt ("90 BPM"), or null. |
| `key` | A key written in the prompt ("A minor", "Ebm", "F# maj"), normalised to "Eb minor" form, or null. The note letter must be upper case. |
| `seed`, `steps`, `cfg` | Sampler settings, when set. |
| `text` | The line to speak (speech). |
| `voice` | The chosen voice, or the first in the endpoint's list (speech). |
| `voice_ref_b64` | A cloned voice's reference clip as base64 WAV (speech), or null. |
| `language` | A language code, if one was chosen (speech). |

An unknown variable is rejected when you save, with the list of valid names.

The composer shows only the controls the template uses. If the template has
no `{{seed}}`, there is no seed control for that endpoint. If it uses
`{{lyrics}}`, the lyrics box appears.

## What comes back

Konchi expects the response body to be the audio:

- **WAV** is decoded directly, detected by its header, whatever the
  `Content-Type` says.
- **`audio/pcm`** is read as 16-bit mono at the endpoint's PCM sample rate
  (24 kHz by default), since raw PCM has no header.
- **Anything else** (MP3, FLAC, Opus, AAC) is decoded with ffmpeg, if it is
  on your `PATH`. If it isn't, the error says so. Install ffmpeg, or ask for
  WAV in the template if the server offers it.

If a server wraps the audio in JSON, set **Response path** to where the base64
string is, e.g. `data.0.b64_json` or `audio`. A `data:audio/...;base64,`
prefix is stripped.

Requests time out after 10 minutes. A long music render on a busy GPU can
take several minutes, and an early timeout would discard a track the server
already made. Cancelling the job aborts the request.

## Limits

- An endpoint can't extend, cover or repaint an existing sound, split stems,
  or convert a voice. Those still need a local model.
- There is no streaming progress. The job shows "Waiting for <name>" until
  the response arrives.
- Endpoints are per profile. They are stored in that profile's
  `settings.json`, under `audio_endpoints`.

## API

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/endpoints` | Returns `{ endpoints, presets, variables }`. Keys appear only as `api_key_set`. |
| `PUT` | `/api/endpoints/:id` | Creates or replaces one endpoint. `api_key` omitted keeps the saved key, `""` clears it. |
| `DELETE` | `/api/endpoints/:id` | Removes it. Sounds made with it stay in the library. |
| `POST` | `/api/endpoints/test` | Same body as `PUT`, plus optional `id` (a saved endpoint whose key to use) and `prompt`. Returns `{ duration_s, sample_rate, channels }`. |

Ids are lower-case letters, digits and hyphens, up to 48 characters.
