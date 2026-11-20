# Spike: real-time talking face

One portrait image plus a stream of speech audio in, a live video of that face talking out, shown in a
local browser page with the audio. Isolated from the shipping app: nothing here is imported by `server/`,
`app/` or `site/`, and the model code, weights and Python environment live outside the repo.

Status (2026-11-19, Windows 11, RTX 5080 16 GB): **works and is real time on its own; does not yet fit
beside the voice spike's stack; the fast variant is not licensed for shipping.** Details below.

![four frames from the WAV-driven run](results/wav_contact.jpg)

- Clip, WAV-driven, 8 s with audio: [results/clip_wav_driven.mp4](results/clip_wav_driven.mp4)
- The browser page while streaming: [results/browser_page.jpg](results/browser_page.jpg) (taken in a
  hidden pane, so its "display 5 fps" line is browser throttling, not the stream)

The portrait and speech in these are the upstream repo's own examples (`examples/girl.png`,
`examples/podcast_sichuan_16k.wav`, Mandarin). English speech and other portraits were not tried.

## Verdict

| Question | Answer |
| --- | --- |
| Model picked | SoulX-FlashHead **Lite** (1.3B DiT + LTX-Video 0.9 VAE + wav2vec2) |
| Real time on the 5080? | Yes. ~60 frames generated per second for a 25 fps stream (2.4x real time) |
| First audio to first frame | ~0.7 s to the chunk leaving the server, ~0.8 s on screen (TTS-speed audio, idle motion off) |
| A/V drift | None measurable over 3.5 min: +0.2 ms/min, frames ~11 ms behind the audio clock throughout |
| VRAM | ~6.4 GB on the card (5.4 GB reserved by torch) |
| Fits beside the voice loop? | **Not as measured.** The voice note leaves 4.5-5 GB; this needs ~6.4 GB |
| Licence for shipping in Mirli | **No for Lite** (its VAE is research-only). Pro is Apache-2.0 throughout but upstream claims only 10.8 FPS on a 4090; not measured here |

## Candidates

Read on 2026-11-19. "Not stated" means the page does not say; nothing here is inferred.

| Candidate | Code licence | Weights licence | Stated VRAM | Stated speed | Windows | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **SoulX-FlashHead Lite** | Apache-2.0 | DiT Apache-2.0, wav2vec2 Apache-2.0, **VAE (LTX-Video 0.9) RAIL-M** | not stated | "96 FPS, or 3-concurrent real-time (25+ FPS) streaming on single RTX4090" | not stated | Picked. 512x512, 25 fps |
| SoulX-FlashHead Pro | Apache-2.0 | all Apache-2.0 (Wan 2.1 VAE) | not stated | "10.8 FPS on single RTX4090, or real-time (25+ FPS) on two RTX5090" with SageAttention | not stated | Licence-clean, not real time on one consumer card by its own claim |
| MuseTalk 1.5 | MIT | MIT, "available for any purpose, even commercially"; dependencies (whisper, sd-vae-ft-mse, dwpose, S3FD, face-parse-bisent) carry their own licences, not stated on the page | not stated (a 4 GB laptop GPU ran the offline demo) | "30fps+ on an NVIDIA Tesla V100", 256x256 face region | yes, documented | Lip-region inpainting on a prepared avatar video, not a whole generated head |
| LiveTalking | Apache-2.0 | not stated | not stated | musetalk backend: 42 fps on 3080 Ti, 72 fps on 4090 | badge says yes, no install steps | A streaming shell (WebRTC/RTMP) around MuseTalk, Wav2Lip, ER-NeRF; has a separate paid commercial edition |
| OpenTalking | Apache-2.0 | not stated on the README | musetalk ">= 12 GB", wav2lip ">= 8 GB", quicktalk ~3.8 GiB on a 3090 | quicktalk ~35 fps at 720x900 on a 3090 | WSL2 only so far | Orchestration layer (LLM, STT, TTS, WebRTC) over model backends |
| Hallo-Live | MIT | not stated | not stated | 20.38 FPS on **two H200** | not stated | Text-driven: it generates the speech too, so it cannot follow our TTS. Out |
| Ditto | Apache-2.0 | same sentence as the code; card licence field empty | not stated | not stated ("realtime" in the title) | not stated; tested on CentOS with an A100 and TensorRT 8.6 | Audio + one image; built on LivePortrait, uses InsightFace detectors whose licences are not stated |
| SoulX-FlashTalk 14B | | | | | | Out before starting: data-centre hardware |

Why Lite: it is the only candidate that generates the whole head from one still (no avatar video to
prepare), claims a large margin over real time on one consumer card, is small (1.3B parameters, 3 GB in
bf16), and has a streaming mode in its own code. It ran on the first candidate tried, so no second model
was installed. MuseTalk is the fallback worth trying next: clearest licence and Windows support, lower
VRAM, but a different product (it re-renders the mouth of an existing video).

Sources:
- SoulX-FlashHead: <https://github.com/Soul-AILab/SoulX-FlashHead> (commit `9bc03de`),
  <https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B> ("Component Licenses" section), paper
  <https://arxiv.org/abs/2602.07449>
- LTX-Video 0.9 licence: <https://huggingface.co/Lightricks/LTX-Video/blob/main/ltx-video-2b-v0.9.license.txt>
- MuseTalk: <https://github.com/TMElyralab/MuseTalk>, <https://huggingface.co/TMElyralab/MuseTalk>
- LiveTalking: <https://github.com/lipku/LiveTalking>
- OpenTalking: <https://github.com/datascale-ai/opentalking>
- Hallo-Live: <https://arxiv.org/abs/2604.23632>, <https://github.com/fudan-generative-vision/Hallo-Live>
- Ditto: <https://github.com/antgroup/ditto-talkinghead>, <https://huggingface.co/digital-avatar/ditto-talkinghead>

## Licence verdict

- **Code** (SoulX-FlashHead): Apache-2.0. Fine.
- **Lite weights: not shippable.** The model card lists the Lite VAE as LTX-Video 0.9 under RAIL-M and says
  redistributors "MUST preserve the license of VAE_LTX". That licence's permitted purpose is "for academic
  or research purposes only, and explicitly excludes commercialization", and it carries a use-restriction
  list that must be passed on to every user. Mirli needs permissive, so Lite is a research tool only.
  (Later LTX-Video VAEs, 0.9.6 onward, are under a different licence that allows commercial use, but Lite
  was trained against the 0.9 VAE; swapping is not a drop-in.)
- **Pro weights**: DiT, Wan 2.1 VAE and wav2vec2 are all Apache-2.0, so "the whole workflow is under
  Apache-2.0". That is the shippable path, and by upstream's own numbers it is roughly 9x slower than Lite.
- The example portrait and audio used for the clip come from the Apache-2.0 repo; their own provenance is
  not stated there.

## Measured

All from real runs on this machine. Generation numbers are from the server's log; display numbers were
reported by the page itself running in headless Chrome (muted), which is not throttled the way a hidden
tab is. `torch.compile`, flash-attn and SageAttention were all **off** (plain PyTorch attention).

| | Value | Run |
| --- | --- | --- |
| Generation speed | 391-423 ms per 24-frame step, median **57-61 frames/s** (p95 step 447-489 ms) | all runs |
| Displayed frame rate | 25.0 fps, 0 frames skipped of 5174 | 3.5 min continuous |
| First audio byte to first chunk sent | **676 ms** median (627-905), audio arriving at 4x real time | idle motion off, 3 utterances |
| First audio byte to first frame on screen | **829 ms** median (777-1076) | same |
| Same, audio arriving at 1x real time | 1237 ms sent, 1391 ms on screen | 3.5 min continuous, 3 utterances |
| Same, idle motion on, 4x audio | 676 ms sent, 1479 ms on screen (1163-1796) | 52 s run, 4 utterances; summary file not kept |
| A/V drift | frame lateness against the audio clock 10.5 ms in the first 30 s, 12.7 ms in the last 30 s, slope **+0.22 ms/min**, worst single frame 21 ms | 3.5 min continuous |
| Audio underruns | 4 in 3.5 min at 1x pacing (the sender leaves a 0.5 s hole between its 60 s utterances) | 3.5 min continuous |
| Peak VRAM, whole card | **+6.4 to +6.5 GB** over the reading before start (1.55 -> 7.93 GB; 1.73 -> 8.24 GB) | nvidia-smi, 1 s samples |
| Peak VRAM, torch | 4.98 GB allocated, 5.39 GB reserved | WAV run |
| Model load | 6-10 s warm, 20 s once when the disk cache was cold | |
| JPEG encode | 34-40 ms per 24 frames | |

How to read these:

- **Latency floor.** The model works in fixed steps of 24 frames, so it cannot start until 0.96 s of
  audio exists. With a TTS that runs 4x faster than real time that takes 0.24 s, then ~0.4 s to generate.
  With audio paced at real time the wait is the full 0.96 s. A shorter first step is the obvious lever
  and was not tried.
- **Drift.** The page schedules each chunk's audio on the Web Audio clock and gives every frame a
  timestamp on that same clock, so the two cannot slide apart; the number above confirms the frames are
  drawn when due. It is not a camera or loopback measurement of sound against lips, and lip-sync quality
  of the model itself was only judged by eye on the clip.
- **VRAM.** Whole-card deltas include headless Chrome and anything else that moved, and Windows gives no
  per-process figure. The torch numbers are the model alone.
- The planned 5-minute conversation run (8 s utterances, 3 s pauses) has **no result**: see the next
  section.

## What blocked or surprised

1. **It does not fit next to the voice stack today.** The voice spike's note measures ~9 GB for
   STT + TTS + LLM and leaves 4.5-5 GB for the face. Lite needs ~6.4 GB. When the voice stack came up
   during my runs (card at 10.9 GB before I loaded anything), the face server died mid-run with step times
   up to 834 ms, and later could not start at all. To co-exist, something has to give: move the LLM off
   the GPU (frees 2.6 GB by the voice note), or shrink the face model (the DiT is 3 GB in bf16; an 8-bit
   quantisation was not tried).
2. **The machine ran out of committed memory, which is why some runs are missing.** By the end the
   system was at 123-126 GB committed of a 127 GB limit (72 `claude` processes 32 GB, 142 `node` 25 GB,
   three `audiocpp_server` 25 GB), and `import torch` failed with "The paging file is too small". That is
   this workstation's load on the day, not the model, but it stopped: the 5-minute conversation run, the
   Pro measurement (weights are downloaded), and the test of `--tap` against `fake_tap.py`.
3. **Upstream's loader crashes when memory is tight.** It reads the 6.1 GB fp32 checkpoint into RAM
   before casting to bf16; here that was an access violation inside safetensors with no Python error.
   `convert_bf16.py` rewrites the checkpoint as bf16 once (3 GB) and `engine.py` loads it straight to the
   GPU. Same weights after the cast the pipeline does anyway.
4. **Windows was a non-issue.** Upstream documents Linux only and asks for flash-attn, xformers, xfuser
   and mediapipe. None are needed for single-GPU Lite: attention falls back to PyTorch's own, and the two
   imports that would fail are satisfied by empty stand-ins in `shims/`. No upstream file was modified.
5. **60 fps without any of the accelerations.** Upstream's "96 FPS on a 4090" presumably uses
   `torch.compile` and flash-attn; neither was used here (compile needs a Triton build for Windows).
   There is headroom left if the speed is ever needed, for example to share the GPU with TTS.
6. **Idle motion costs latency.** Feeding silence between utterances keeps the face alive (it blinks and
   moves), but the simple scheduler queues speech behind 0.5-1 s of already-sent idle video. `--no-idle`
   removes that and freezes the face between utterances. Cutting into queued idle video is the fix.
7. **Hidden tabs lie.** In a hidden browser pane the page drew 1-5 fps and skipped the rest while audio
   played normally. Measure in a visible or headless browser.

To finish the missing runs once the GPU and memory are free (nothing else to install):

```bash
./measure.sh conv_16k_5min 16000 --speed 4 --utterance-s 8 --gap-s 3 --total-s 300   # 5-minute conversation
$PY convert_bf16.py pro && $PY run_wav.py --model pro --out results/pro.mp4          # Pro speed and VRAM
$PY fake_tap.py --port 17651 --flush-after 1 &                                       # then:
$PY server.py --input-rate 48000 --tap ws://127.0.0.1:17651/tap
```

Not done: WebRTC (WebSocket + JPEG was quicker and is fine on localhost), a live run against the voice
spike's server (it was not listening on 17650 when checked; `--tap` is written from its hand-over note
and untested), barge-in beyond a manual `/flush`, English audio, a second candidate.

## Run it

Everything heavy lives in `~/mirli-spike-face` (override with `MIRLI_FACE_HOME`): the upstream checkout,
the weights and the venv. Sizes on disk: Lite DiT 6.1 GB as downloaded plus 3.05 GB converted, LTX VAE
1.7 GB (copied once more beside the converted DiT), wav2vec2 0.38 GB, Pro DiT 6.0 GB and Wan VAE 0.5 GB
(only for `--model pro`), venv ~6 GB. About 26 GB in all; the fp32 originals can be deleted after
converting.

```bash
H=~/mirli-spike-face; mkdir -p $H/upstream $H/models && cd $H
git clone https://github.com/Soul-AILab/SoulX-FlashHead upstream/SoulX-FlashHead   # read it before running it
uv venv --python 3.12 venv
uv pip install --python venv/Scripts/python.exe torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python venv/Scripts/python.exe "diffusers>=0.34" transformers==4.57.3 accelerate einops loguru \
  librosa imageio imageio-ffmpeg pyyaml opencv-python-headless pillow safetensors pyloudnorm aiohttp
# weights: Model_Lite/ and VAE_LTX/ from huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B into
#   models/SoulX-FlashHead-1_3B/, and config + model.safetensors + the small json files from
#   huggingface.co/facebook/wav2vec2-base-960h into models/wav2vec2-base-960h/
```

Then, from this folder, with `PY=~/mirli-spike-face/venv/Scripts/python.exe`:

```bash
$PY convert_bf16.py                    # once
$PY run_wav.py --seconds 20            # portrait + WAV -> results/wav.mp4, prints timings
$PY server.py                          # then open http://127.0.0.1:17660/ and press Start
$PY send_pcm.py --speed 4              # in another shell: stream the example WAV into the socket
```

`server.py --image face.png` picks the portrait (any image; it is centre-cropped to 512x512).
`measure.sh` and `analyze.py` reproduce the table above.

## Audio input interface

**TCP `127.0.0.1:17661`: raw PCM, mono, signed 16-bit little-endian, at `--input-rate` (default 16000).**
No header, no framing; send chunks of any size. Closing the connection, or 250 ms without data, ends the
utterance and the last partial step is padded with silence.

- The model's own format is 16 kHz, and it consumes **15 360 samples (0.96 s) per step**, producing 24
  frames at 25 fps. Any input rate that gives a whole number of samples per 0.96 s works (16000, 24000,
  44100, 48000); it is resampled to 16 kHz per step for the model, and the browser plays the audio at the
  rate it arrived.
- For the voice spike (48 kHz, 7680-sample chunks): `server.py --input-rate 48000`, then either write its
  PCM to the socket, or let the face pull it with `--tap ws://127.0.0.1:17650/tap`, which also turns the
  tap's `flush` event into a barge-in. `--tap` is untested.
- Audio may arrive faster than real time. The server generates at most `--max-lead` (3 s) ahead of
  playback, so a barge-in throws little away.
- `POST http://127.0.0.1:17660/flush` drops everything queued in the server and the browser.
  `GET /stats` returns the running numbers.

Output: `ws://127.0.0.1:17660/ws`, one binary message per step: a 4-byte little-endian length, a JSON
header (`seq`, `kind` speech or idle, `rate`, `samples`, `frames` = JPEG sizes), the step's PCM, then 24
JPEGs. The page plays the PCM through Web Audio and draws each frame when the audio clock reaches it.

## Files

- `engine.py`: wrapper around upstream's pipeline; `step(pcm) -> frames`
- `server.py`, `web/index.html`: PCM socket in, WebSocket + page out
- `run_wav.py`: offline WAV to MP4; `convert_bf16.py`: one-off checkpoint conversion
- `send_pcm.py`: test sender; `fake_tap.py`: stand-in for the voice spike's tap (untested)
- `measure.sh`, `restart.sh`, `analyze.py`: measurement harness (Git Bash)
- `shims/`: empty stand-ins for `xfuser` and `mediapipe`
- `results/`: clip, screenshots, run summaries
