# Custom endpoints

A custom endpoint sends generation to a server you already run, or to a
hosted provider with your own key, instead of a model Soundbox downloads and
runs itself. Use one when a machine on your network already serves the model
(LocalAI, an OpenAI-compatible speech server, a gateway), when the machine
running Soundbox can't download weights, or when it has no GPU and you would
rather pay a provider such as ElevenLabs or fal for each render.

Each endpoint appears as one model in the pickers. Its id is
`endpoint:<id>`. Sounds made with it go into the library like any other, and
work in the editor, the studio and over MCP the same way.

## Adding one

Go to Settings → Endpoints → Add endpoint. Pick a preset or start blank, then
check four things:

| Field | What it is |
| --- | --- |
| **Used for** | Sound effects, Music or Speech. This decides which picker the endpoint appears in. |
| **URL** | The full URL to POST to, path included, e.g. `http://192.168.1.20:8080/v1/sound-generation`. It may contain `{{voice}}` or `{{language}}`, filled URL-encoded. |
| **API key** | Optional. Sent as `Authorization: Bearer <key>` unless you change **Key header** and **Before the key**: ElevenLabs takes `xi-api-key` with nothing before the key, fal takes `Authorization` with `Key ` before it. Once saved the key is never shown or returned again. Leave the field blank when editing to keep the saved key. |
| **Body template** | The JSON request body, with `{{variables}}` for what Soundbox fills in. |

Press **Test** before saving. It sends one short request with the form as it
stands and reports the length and format of the audio that came back, or the
server's error. Nothing is added to the library.

## Presets

| Preset | Endpoint | Notes |
| --- | --- | --- |
| LocalAI ACE-Step music | `POST /v1/sound-generation` | Sends `model_id`, `caption`, `lyrics`, `bpm`, `keyscale` and `duration_seconds`. LocalAI's ACE-Step example uses `model` instead. If your server rejects `model_id`, rename it. |
| LocalAI sound effects | `POST /v1/sound-generation` | ElevenLabs-shaped: `model_id`, `text`, `duration_seconds`. |
| OpenAI-compatible speech | `POST /v1/audio/speech` | Works with LocalAI, OpenAI-compatible servers and most proxies. Asks for `response_format: "wav"`, so ffmpeg is not needed. List your server's voices in **Voices**. |

### Hosted providers, with your own key

These presets use your own account with the provider. The provider bills you
for every render, including **Test**. Soundbox does not resell the service,
takes no cut and never sees the bill. Each preset links to the provider's
price page.

| Preset | Endpoint | Notes |
| --- | --- | --- |
| ElevenLabs sound effects | `POST https://api.elevenlabs.io/v1/sound-generation` | Up to 30 seconds. Answers in MP3, so ffmpeg is needed. On a plan that allows it, change `output_format` in the URL to `wav_44100`. |
| ElevenLabs music | `POST https://api.elevenlabs.io/v1/music` | 3 seconds to 10 minutes. MP3, so ffmpeg is needed. Sends no lyrics; describe vocals in the prompt. |
| ElevenLabs speech | `POST https://api.elevenlabs.io/v1/text-to-speech/{{voice}}` | Voices are ElevenLabs voice IDs, which go in the URL. The preset holds the ID from ElevenLabs' own example; replace it with IDs from your Voices page. MP3, so ffmpeg is needed. |
| fal ACE-Step music | `POST https://fal.run/fal-ai/ace-step/prompt-to-audio` | fal answers with JSON holding a link to a WAV. The response path `audio.url` points at it and Soundbox downloads it. fal writes the tags and lyrics from the prompt. |

These were written from each provider's API reference in November 2026. A
provider can rename a model or a field, and **Test** is the quickest way to
see that.

Any other server can be added by hand. Servers that expose the same path don't
agree on the body: two `/v1/audio/music` implementations take `prompt` and
`duration_seconds` and `input` and `duration` respectively. This is why the
body is a template and not a fixed format.

## Where requests go

Soundbox is local-first, and an endpoint is the one setting that can send a
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
Only `{{voice}}` and `{{language}}` may go in the URL. A prompt or a voice clip
in a URL would end up in every proxy's access log, so those stay in the body.

The composer shows only the controls the template uses. If the template has
no `{{seed}}`, there is no seed control for that endpoint. If it uses
`{{lyrics}}`, the lyrics box appears.

## What comes back

Soundbox expects the response body to be the audio:

- **WAV** is decoded directly, detected by its header, whatever the
  `Content-Type` says.
- **`audio/pcm`** is read as 16-bit mono at the endpoint's PCM sample rate
  (24 kHz by default), since raw PCM has no header.
- **Anything else** (MP3, FLAC, Opus, AAC) is decoded with ffmpeg, if it is
  on your `PATH`. If it isn't, the error says so. Install ffmpeg, or ask for
  WAV in the template if the server offers it.

If a server wraps the audio in JSON, set **Response path** to where it is,
e.g. `data.0.b64_json` or `audio`. What is there can be:

- **base64 audio.** A `data:audio/...;base64,` prefix is stripped.
- **A link to the audio file**, as fal and Replicate answer. Soundbox
  downloads it and decodes it as above. The download carries no key, because
  the link is usually on a CDN rather than the host the key is for.
- **An object with a `url`**, such as fal's `{ "url": ..., "content_type": ... }`,
  read as a link.

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
