# Installing Konchi with a coding agent

This page is written for an agent such as Claude Code, Cursor or Codex that
has been asked to install Konchi on the machine it is running on. Paste
this into the agent to start:

```text
Install Konchi on this machine and confirm it works, following
https://github.com/HamSanders/soundbox/blob/main/docs/INSTALL-AGENT.md
```

Konchi runs entirely on the user's machine. The server listens on
`http://127.0.0.1:17494` and every step below can be checked against its
HTTP API, which is documented in full in [API.md](API.md).

## Rules

- **Say what each model costs before downloading it.** Every entry from
  `GET /api/models` carries `vram_estimate_mb`, `license.name` and
  `license.commercial` (`yes`, `conditional` or `no`). Tell the user the
  model's name, footprint and licence, then wait for a yes.
- **Never accept a licence on the user's behalf.** A model whose
  `license.commercial` is `no` or `conditional` is the user's decision. The
  app asks for a confirmation before such weights are used; leave that to
  them.
- **Check the hardware before choosing anything.** `GET /api/health` reports
  `device` (`cuda`, `metal` or `cpu`), `gpu_name`, `vram_total_mb` and
  `vram_free_mb`. Pick models that fit, and say so if the machine is CPU-only:
  generation works there, but takes minutes rather than seconds.
- **Reuse what exists.** Weights live under `~/.konchi/models` and are shared
  by every profile. If `GET /api/models` shows a model as `installed`, do not
  download it again.
- **Name what you could not do.** The first launch of an unsigned installer
  needs a click from the user (SmartScreen or Gatekeeper). Say so rather than
  skipping it.
- **Do not change network settings or firewall rules.** The server binds to
  loopback and needs nothing opened.

## Steps

1. **Inspect the machine.** Note the OS, the CPU architecture, the GPU and its
   VRAM (`nvidia-smi` on Windows and Linux, `system_profiler SPDisplaysDataType`
   on macOS), and free disk space on the home drive. Model weights are one to
   ten gigabytes each.

2. **Install.**
   - **Windows or macOS:** download the installer for this machine from
     [the latest release](https://github.com/HamSanders/soundbox/releases/latest)
     (`Konchi_<version>_x64-setup.exe`, or the `.dmg` for Apple silicon or
     Intel) and run it. The app carries its own Node and server. The builds are
     not signed yet, so the first launch asks the user to confirm; the exact
     clicks are in [DESKTOP.md](DESKTOP.md#installing). Ask the user to do
     that step.
   - **Linux, or from source:** needs Node 22.12 or later and `git`.

     ```bash
     git clone https://github.com/HamSanders/soundbox
     cd konchi
     npm install
     npm run build
     npx konchi model install audiocpp
     npx konchi
     ```

     `npx konchi` starts the server on port 17494 and serves the web app at
     the same address. [INSTALL.md](INSTALL.md) covers the CLI and environment
     variables.

3. **Confirm the server answers.**

   ```bash
   curl http://127.0.0.1:17494/api/health
   ```

   Report `version`, `device`, `gpu_name` and `vram_total_mb` to the user. If
   `device` is `cpu` on a machine with an NVIDIA GPU, the audio.cpp runtime was
   not matched to the driver; `npx konchi model status audiocpp` says which
   binary and backend resolved, and
   [AUDIOCPP.md](AUDIOCPP.md#choosing-a-backend) explains how to force one.

4. **Choose a model with the user.** `GET /api/models` lists every enabled
   model. The four verified ones are `audiocpp-stable-audio-3-sfx` (sound
   effects), `audiocpp-stable-audio-3-small-music` (instrumentals),
   `audiocpp-ace-step` (ACE-Step 1.5 Turbo: songs with lyrics, MIT) and
   `audiocpp-minimax-music3` (songs, about 10 GB of VRAM). For a first test on any GPU, propose the SFX
   model. State its size and licence, then wait.

5. **Download it.** `POST /api/models/{id}/download` returns a job. Poll
   `GET /api/jobs/{id}` until `status` is `done` (or follow
   `GET /api/jobs/{id}/events`, a server-sent event stream). Mutating requests
   need the header `X-Konchi: 1` when they carry no JSON body; see the
   request rules in [API.md](API.md#request-rules).

6. **Generate one sound.**

   ```bash
   curl -X POST http://127.0.0.1:17494/api/generate \
     -H 'Content-Type: application/json' \
     -d '{"model":"audiocpp-stable-audio-3-sfx","prompt":"heavy wooden door slamming in a stone corridor","duration_s":3}'
   ```

   Poll the job. When it is `done`, `result.sounds` holds one sound id;
   `GET /api/sounds/{id}` returns its `path` on disk and `duration_s`. Check
   the file exists and is not empty before calling it a success.

7. **Connect an MCP client if asked.** The server is also an MCP server at
   `http://127.0.0.1:17494/mcp`. For Claude Code:

   ```bash
   claude mcp add --transport http konchi http://127.0.0.1:17494/mcp
   ```

   Other clients and the three bundled skills are in [MCP.md](MCP.md).

8. **Report.** Tell the user: where Konchi is installed, what `GET
   /api/health` said about the GPU, which model was downloaded and under which
   licence, the path of the test WAV, and anything from the rules above that
   needed their hand.

## If something fails

- `GET /api/health` does not answer: on the desktop the app starts the server
  itself; wait a few seconds after launch. From source, check that nothing
  else owns port 17494.
- A model shows `needs_runtime`: run `npx konchi model install audiocpp`,
  or on the desktop open the Models page, which offers the install.
- A download fails with 401 or 403: the model is gated on Hugging Face. The
  user has to accept its terms on the model's page and add a token in
  Settings; do not ask them for the token in chat.
- Generation is far slower than expected: it is running on the CPU. See step 3.

Everything else is in [INSTALL.md](INSTALL.md#troubleshooting).
