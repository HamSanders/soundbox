# New models, October 2026

This is a catalog refresh against audio.cpp 0.9.2. All 19 additions are opt-in
(`catalog_extra`): switch them on from the Models page. Three of them were run
end to end. The rest are marked unverified.

## What changed upstream

Konchi's managed install had been audio.cpp 0.6.1, which registers 50
loaders. 0.9.2 (released 2026-10-15) registers 124. The current "latest" tag,
`v0.9.2-drama3-base-small` (2026-10-18), registers 127; it adds Fish Audio
Drama 3, Plapre and openWakeWord. The full loader and package lists were read
out of the binaries (`--list-loaders`, plus the model specs embedded in
`audiocpp_server`), not taken from the README.

Every package id the catalog already used still exists in 0.9.2, with the same
family and target folder.

### The binary bump

Konchi installs `latest` by default, so there is no version pin to bump.
Before this change, however, the installer could not install 0.9.x correctly:

- On Windows with CUDA, it never fetched the `cudart-…` runtime package. It
  only recognised 0.6.x's `…-runtime` name, so a CUDA install had no CUDA DLLs.
- It did not tell CUDA 12.4 and 13.3 builds apart. Which one it picked came
  down to asset order.
- On Linux, it matched nothing: the assets are named `ubuntu-x64-…`, not
  `linux`.
- The `lib-…` packages (C API libraries), `server-config-examples` and the
  Linux Colab CUDA build contain no `audiocpp_cli`, but could still score as
  candidates.

All four are fixed in `server/src/models/audiocppBinary.ts`, with tests in
`server/test/audiocppBinary.test.ts`. Verified by a real install into a
scratch data dir: on this machine (RTX 5080, driver 616.92, CUDA 13.4) it
picked `audio-v0.9.2-drama3-base-small-bin-windows-x64-cuda13.3.zip`, fetched
the matching `cudart-…-cuda13.3.zip`, and the binary reports
`backends: cpu,cuda` and loads the CUDA backend.

### A request-option change that needed code

0.9.x rejects any request option a family does not declare. Konchi sends
every `gen` request `duration_seconds`, `num_inference_steps` and
`guidance_scale`. The four verified families accept all three. MiDashengLM-Gen
rejects `duration_seconds` and `num_inference_steps`; ControlFoley also names
its length `duration_sec`. Adding these could not be a JSON-only change, so the
catalog gained one field, `duration_option`. In addition, a `gen` entry with
`supports.steps` / `supports.cfg` set to `false` is no longer sent a step count
or guidance scale. See `docs/AUDIOCPP.md`.

## Existing verified models on 0.9.2

All run through a scratch Konchi server (port 17621, `KONCHI_DATA_DIR` set
to a scratch folder, the shared `~/.konchi/models/audiocpp` weights) with
`KONCHI_AUDIOCPP_BIN` pointed at the 0.9.2 install. Hardware: RTX 5080 16 GB,
CUDA backend. The VRAM figures are the rise in `nvidia-smi` memory while the
job ran.

| Model | Request | Result | Time | VRAM |
|---|---|---|---|---|
| Stable Audio 3.0 SFX | door slam, 5 s | 44.1 kHz stereo, clear transient | 11.8 s cold, 1.3 s warm | +1.5 GB |
| Stable Audio 3.0 Small Music | lofi beat, 10 s | 44.1 kHz stereo | 8.0 s | +1.4 GB |
| ACE-Step 1.5 Turbo | lyrics, 15 s | 48 kHz stereo | 151 s first load, 15 s warm | +13 GB |
| ACE-Step 1.5 Turbo | extend 15.7 → 25 s, and cover | both complete | 24 s, 9 s | |
| MiniMax Music 3 | orchestral, 15 s | 44.1 kHz stereo, 15.0 s | 42 s | +7 GB |

Stable Audio honours `duration_seconds` exactly on 0.9.2: a raw request for
10 s and for 3 s returned 10.00 s and 3.00 s. ACE-Step's Konchi outputs came
back shorter than asked. Raw CLI runs of 0.6.1 and 0.9.2 both return exactly
20.00 s for a 20 s request, so the shortfall is Konchi's trim-silence
setting, not the binary.

## Added

All unverified entries carry the measured download size where known, and
licences researched on 2026-10-23 from the upstream model cards and licence
files. Following the project rule, anything unclear is treated as
non-commercial.

| Entry | Family | Kind | Licence | Commercial | Verified |
|---|---|---|---|---|---|
| MiDashengLM-Gen | `midashenglm_gen` | SFX / general audio | Apache-2.0 (+ use restrictions: no military use) | yes | **yes** |
| ControlFoley Large | `controlfoley` | SFX (text; built for video) | CC-BY-NC-4.0 weights | no | no |
| ACE-Step 1.5 XL Turbo | `ace_step` | music, lyrics, edits | MIT | yes | no |
| ACE-Step 1.5 XL SFT | `ace_step` | music, lyrics, edits | MIT | yes | no |
| HTDemucs 6-stem | `htdemucs_6stems` | stem separation | MIT code / research-only weights | no | **yes** |
| Chatterbox Turbo | `chatterbox_turbo` | TTS, one built-in voice | MIT (output watermarked) | yes | **yes** |
| Kokoro 82M | `kokoro_tts` | TTS, 54 voices | Apache-2.0 | yes | no (needs eSpeak-ng) |
| Fun-CosyVoice3 0.5B | `cosyvoice3` | TTS + cloning | Apache-2.0 | yes | no |
| Maya1 | `maya1` | TTS, voice from a description | Apache-2.0 | yes | no |
| BreezeTTS 2 | `breeze_tts` | TTS + cloning | BreezeBlue Research & Non-Commercial v1.1 | no | no |
| FireRedTTS3 Base | `fireredtts3` | cloning | Apache-2.0 | yes | no |
| FireRedTTS3 Instruct | `fireredtts3` | TTS, design, cloning | Apache-2.0 | yes | no |
| VoxCPM 0.5B | `voxcpm1` | TTS + cloning, 16 kHz | Apache-2.0 | yes | no |
| KittenTTS Mini 0.8 | `kitten_tts` | TTS, 8 voices | Apache-2.0 | yes | no (needs eSpeak-ng) |
| MagpieTTS Multilingual 357M | `magpie_tts` | TTS, 5 voices | NVIDIA Open Model License | conditional | no |
| KugelAudio 0 Open | `kugelaudio` | TTS, 4 voices | MIT (output watermarked) | yes | no |
| Irodori-TTS v4.1 Anime | `irodori_tts` | Japanese TTS + cloning | MIT + ethical-use terms; training data undocumented | conditional | no |
| MeanVC2 | `meanvc2` | voice conversion | Apache-2.0 | yes | no |
| Soprano 1.1 80M | `soprano_tts` | TTS, one voice | Apache-2.0 | yes | no |

Two licence findings disagree with audio.cpp's own table
(`docs/model_licenses.md` upstream). Konchi follows the upstream rights
holder, restrictively:

- **HTDemucs 6-stem.** audio.cpp's table and the GGUF repo list it as MIT and
  commercial. Demucs' maintainer has said the pretrained weights are not
  covered by the MIT licence and are for scientific use only (facebookresearch/demucs#327).
  That is the same position the catalog already takes for 4-stem HTDemucs.
- **ZipVoice** (not added). Its model card says CC-BY-NC because of the
  Emilia training data. The GGUF repo tags it Apache-2.0.

### How the three were verified

Each was downloaded through Konchi (which delegates to audio.cpp's package
manager into the shared `~/.konchi/models/audiocpp`), then generated through
the scratch server's HTTP API. I checked the output WAV header and a ten-slice
RMS envelope, which is CONTRIBUTING's "look at the envelope" check. Nobody
listened to the output.

- **MiDashengLM-Gen** (3.4 GB). A door slam, rain on a tin roof and a dog
  barking: 16 kHz mono, envelopes with clear onsets and decays. 5.5 s cold,
  about 3.6 s warm, about 3.4 GB VRAM. The model ends a clip itself, so the
  requested length is a rough target: 6 s gave 7.6 s, 5 s gave 9.8 s, 10 s
  gave 9.8 s.
- **HTDemucs 6-stem** (42 MB). It split an 8.3 s ACE-Step song into drums,
  bass, other, vocals, guitar and piano in 18.8 s, using about 1 GB VRAM. The
  drums, vocals and guitar stems match the existing 4-stem model's drums,
  vocals and other, to within about 0.01 RMS per slice. Bass, other and piano came
  out flat and loud (RMS ~0.4). The 4-stem model does the same to its bass
  stem on this clip. It looks like Konchi's loudness normalisation lifting
  the noise floor of a stem the mix does not contain, not something specific
  to 6-stem. Listed under follow-ups.
- **Chatterbox Turbo** (699 MB). Two English sentences: 24 kHz mono, 3.5 s and
  3.7 s long, with a silent gap where "Good evening." ends. 5.5 s cold,
  1.4 s warm, about 1.8 GB VRAM.

## Tried and not verified

- **Kokoro 82M** downloaded fine (190 MB), but every request fails with
  "Could not load eSpeak-ng; install the shared library or provide its path".
  audio.cpp phonemises through an external eSpeak-ng library that its Windows
  release does not include. KittenTTS uses the same frontend. Both entries say
  so, and remain unverified. I did not install eSpeak-ng on this machine.

## Skipped, and why

- **YuE2 3B** (`yue2`). The weights are CC-BY-NC-4.0. Its loader also requires
  a `style` field, which Konchi's `gen` request has no slot for. Worth adding
  if lyrics-to-song with a separate style prompt gets wired up.
- **Fish Audio Drama 3** (`fish_drama3`, latest tag only). It is a 35B MoE
  model. Its licence metadata names a "research license" whose file does not
  exist, while the LICENSE file is a Community License with a USD 500k revenue
  cap and a hosted-service ban. Under the "unclear means non-commercial" rule
  it adds little over S2 Pro.
- **VibeVoice 7B.** The only weights are a third-party mirror of the model
  Microsoft withdrew; the card says research purposes only.
- **Echo-TTS** and **ZipVoice**: non-commercial weights on community GGUF
  repos. ZipVoice's loader also requires the reference clip's transcript,
  which Konchi's speak path does not send.
- **Kitten TTS 2**, **Audio8 TTS**, **Sopro**, **sanoTTS**, **VieNeu**,
  **OuteTTS**, **GLM-TTS**: community conversions hosted outside the audio-cpp
  org, often with bundled third-party files. Kitten TTS 2 is also
  revenue-capped. They can be added the same way once someone runs them.
- **Piper (lessac)**: the voice is trained on a research-only dataset.
- **Plapre 3**: Danish only. It is CC-BY-4.0 and could be added.
- **SAM Audio, AudioSR, UniverSR, Apollo, Sidon, RE-USE**: audio-to-audio
  (`s2s`) tasks. Konchi has no route for them yet.
- **MossFormer2 / TF-GridNet**: speech separation at 16 kHz / 8 kHz. The Split
  action and its stem names assume a music mix.
- **AuK, FireRedAudio, LFM2.5-Audio, PersonaPlex, LiveAvatar**: speech editing,
  speech-to-speech or video. They don't fit an existing Konchi task.
- **ASR, VAD, diarisation, wake-word, classification and MIDI families**: not
  generation.

## Sample rates and VRAM of unverified entries

These come from the model cards where stated (Maya1, BreezeTTS 2, MagpieTTS,
KugelAudio and Soprano state a rate). Otherwise they are the family's usual
codec rate, and should be read as estimates until someone runs the model.
Konchi reads the real rate from the output WAV, so a wrong value here only
affects resampling of a source clip and what the model card displays.

## Follow-ups (not done here)

1. **Stale resident model after an audio.cpp server restart.** Changing the
   models folder in Settings while a model was loading killed the server
   mid-request ("fetch failed"). After that, every request failed with
   "unknown model id" until the model was unloaded by hand, because Konchi
   still believed the model was resident in a server that had restarted.
2. **Normalising an empty stem.** A stem the mix does not contain is
   normalised to -16 LUFS and comes out as loud, flat noise. This happens
   with both the 4-stem and 6-stem models.
3. **App `/models` page.** `app/src/content/models/models.ts` carries
   hand-written pages for catalog ids. The 19 new entries have none.
4. **eSpeak-ng.** Kokoro, KittenTTS, Piper and others need it, and the
   desktop app could ship it, or point audio.cpp at it, with
   `espeak_library_path`.
5. **No minimum binary version per entry.** An install still on 0.6.1 shows
   the new entries but fails with an unknown-family error. The descriptions
   say "needs audio.cpp 0.9.2 or newer", but nothing enforces it.
