# Privacy: what leaves your machine

Mirli runs on your computer. Your prompts, lyrics, voices, sounds and
projects stay in the data directory, and generation never uploads them. This
page lists every request the app makes on its own, so you can check it.

## The daily update check

Once a day, at most, a running Mirli asks whether a newer version exists.

- **What is sent.** One `GET` to `https://mirli.app/api/update` with two query
  values: the version you run (`v=0.4.1`) and your platform (`p=win32-x64`).
  No body, no cookie, no account, no install ID, nothing about your sounds,
  prompts, files, hardware or usage.
- **What the project keeps.** A counter per day, per version and platform, such
  as "0.4.1 on win32-x64: 412 on 2026-11-17". That is how we learn roughly how
  many copies are running and which versions people are on. The request cannot
  be tied to you: there is nothing in it that identifies an install. As with any
  web request, the host can see your IP address. The endpoint's code
  ([`api/update.ts`](../api/update.ts)) neither reads nor stores it.
- **How often.** The time of the last answer is saved in your data directory,
  so restarting the app does not send another request the same day.
- **What comes back.** The newest release number and its GitHub release page.
  Mirli shows "an update is available" and links to the page. It does not
  download or install anything by itself.
- **Turning it off.** Settings → Updates → **Check for updates**, or set
  `SOUNDBOX_UPDATE_CHECK=0` in the server's environment (Docker, services; the
  variable wins over the setting). Off means no request at all. `npm run dev`
  starts with it off.
- **A fork or your own host.** `SOUNDBOX_UPDATE_URL` points the check somewhere
  else.

The desktop app also has its own installer prompt. It reads the newest GitHub
release directly (GitHub sees that request, as for any download) and is skipped
when the check above is turned off.

## Things you ask for

- **Model downloads** come from Hugging Face or GitHub when you press Download.
  Mirli asks them for the files and sends your Hugging Face token only if you
  saved one for gated models.
- **Custom endpoints and hosted providers** receive the prompt and text you
  send through them. You add these yourself in Settings, and they are off until
  you do.
- **OpenTelemetry export** sends MCP call traces to the collector you name. Off
  until you set one.

Nothing else is sent. If you see a request that is not on this page, please
open an issue.
