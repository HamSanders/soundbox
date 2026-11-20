# Spike: Ditto as the call's face model

Ditto ([antgroup/ditto-talkinghead](https://github.com/antgroup/ditto-talkinghead), commit `c3e47ee`,
weights [digital-avatar/ditto-talkinghead](https://huggingface.co/digital-avatar/ditto-talkinghead)) tried
on 2026-11-19 as a replacement for SoulX-FlashHead Lite in `spikes/realtime-face/`. Windows 11, RTX 5080,
PyTorch weights (no TensorRT). It shared the GPU with the voice server throughout.

## Verdict

| | Ditto (this spike) | FlashHead Lite |
| --- | --- | --- |
| Runs on Windows | Yes, PyTorch path, one shim (see below) | Yes |
| Generation speed | 167-172 ms per 0.2 s step, **~29-30 frames/s** (real time, ~1.2x margin) | 42-61 frames/s |
| First audio to first lip-synced frame | **0.36 s** at 1x audio, 0.34 s at 4x (engine only, no JPEG/WebSocket) | 0.7-1.4 s to screen |
| Chunk size | 0.2 s (5 frames); video trails audio by 0.16 s, which the server must add to audio | 0.96 s |
| VRAM, whole card | **+4.25 GB** (torch 2.2 GB reserved, rest is onnxruntime HuBERT) | ~6.4 GB |
| Mouth | Sharp teeth and lips, clear shapes (see below) | Soft, smeared teeth band |
| Ship in Mirli? | **No, not as published**: InsightFace weights are non-commercial, and two more are unclear | No (VAE research-only) |

Upstream's own code with upstream's online settings is **not** real time in PyTorch on this card: 14 fps
overall, 1.3 s to first frame, falling 9 s behind over 12 s of audio (`results/sofia_online_rt.summary.json`).
`engine.py` gets it to real time (see "What it took").

## Licences

Read on 2026-11-19. These are readings of the published terms, not legal advice.

| Part | File(s) | Licence | Commercial? |
| --- | --- | --- | --- |
| Ditto code | repo | Apache-2.0 ([LICENSE](https://github.com/antgroup/ditto-talkinghead/blob/main/LICENSE)) | Yes |
| Ditto weights (LMDM motion diffusion) | `lmdm_v0.4_hubert.pth` | Apache-2.0 ([HF LICENSE](https://huggingface.co/digital-avatar/ditto-talkinghead/blob/main/LICENSE)); card has no licence metadata | Yes |
| LivePortrait parts | appearance/motion extractor, warp, decoder, stitch | MIT ([LivePortrait LICENSE](https://github.com/KlingAIResearch/LivePortrait/blob/main/LICENSE)), which also says InsightFace models are non-commercial and commercial users should replace them | Yes |
| InsightFace face detector + 106 landmarks | `det_10g.onnx`, `2d106det.onnx` (buffalo_l) | "non-commercial research purposes only" ([insightface README](https://github.com/deepinsight/insightface), [model_zoo](https://github.com/deepinsight/insightface/tree/master/model_zoo)); commercial licence by contacting InsightFace | **No** |
| 203-point landmarks | `landmark203.onnx` | Provenance unknown. Maintainer says the ONNX files "are from the LivePortrait" ([#84](https://github.com/antgroup/ditto-talkinghead/issues/84)); open questions [#97](https://github.com/antgroup/ditto-talkinghead/issues/97), [#98](https://github.com/antgroup/ditto-talkinghead/issues/98) unanswered | Unclear |
| Audio encoder | `hubert_streaming_fix_kv.onnx` | Checkpoint not named by paper or card. Candidates are permissive (chinese-hubert-large MIT, hubert-large-ls960-ft Apache-2.0) but unconfirmed ([#97](https://github.com/antgroup/ditto-talkinghead/issues/97)) | Unclear |
| MediaPipe face landmarker | `face_landmarker.task` | No licence text found on the [solution page](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker); model cards are PDFs not read | Unclear |

**Plain answer: we could not ship Ditto's published bundle in a commercial product today.** The InsightFace
detector/landmark models are explicitly non-commercial. They are only used once per portrait (in
`set_image`, to find and crop the face), so replacing them with a permissive detector is a contained job,
but it is a code change plus a quality check, not a drop-in. landmark203 and HuBERT would still need their
provenance confirmed. The real-time path (motion diffusion + LivePortrait renderer) is Apache-2.0 / MIT.

## Measured

All from real runs, 12 s of `podcast_sichuan_16k.wav` (Mandarin), audio fed in real time unless noted.
Summaries are the `results/*.summary.json` files.

| Run | Step (median / p95) | Gen fps | First frame | VRAM delta (card) |
| --- | --- | --- | --- | --- |
| Sofia, engine, clip 5 / fuse 2 | 172 / 179 ms | 29.1 | 0.359 s | +4.25 GB (+4.9 before the ORT arena fix) |
| Marcus, engine, clip 5 / fuse 2 | 171 / 175 ms | 29.2 | 0.355 s | +4.9 GB (before the fix) |
| Sofia, engine, audio at 4x | 170 / 320 ms | 29.4 | 0.344 s | +5.1 GB (before the fix) |
| Sofia, engine, clip 10 / fuse 10 (upstream's online timing) | 345 / 542 ms | 29.0 | 1.101 s | +5.3 GB |
| Sofia, upstream pipeline, PyTorch, online cfg | n/a | 14.4 overall | 1.312 s | +4.5 GB |
| Sofia, FlashHead Lite `run_wav.py` (same audio) | 519 ms per 24 frames | 46.3 | (needs 0.96 s of audio first) | torch 5.39 GB reserved |

Per-stage costs (single frame, from `profile_stages.py` and benchmarks): motion diffusion step 27 ms eager
-> 3.9 ms as a CUDA graph (10 steps per call); warp 8.5 ms + decoder 15.9 ms per frame in fp16; HuBERT
~23 ms per 5 frames. **The renderer (warp + decoder, ~24 ms/frame) is now the ceiling**: ~41 fps on its
own, ~30 fps with everything else. TensorRT (upstream's path) would likely help most here; not tried.

Latency breakdown at the defaults: 0.2 s to collect a step of audio, + ~0.16 s compute for the first frame;
then the server must also delay the audio by `delay_s` = 0.16 s (2 frames HuBERT look-ahead + 2 frames held
for cross-fade) so lips line up. Expect roughly 0.4-0.5 s from first audio to lip-synced picture on screen,
against FlashHead's 0.8-1.4 s. Not measured through `server.py` and a browser.

## Mouth quality

- `results/mouth_sbs_sofia.jpg`: top row Ditto, bottom row FlashHead Lite, same portrait, same audio, same
  frame numbers (every 4th frame from 48). Ditto's teeth and lip edges are sharp and every frame is a
  plausible distinct mouth shape. FlashHead's teeth are a blurred band and lips smear between shapes. Caveat:
  Ditto renders a tight face crop, FlashHead the whole portrait, so FlashHead's mouth has ~0.6x the pixels.
- `results/mouth_marcus.jpg`: Ditto on a portrait that is already smiling with teeth: still articulates
  (open vowels, closed lips) but drifts back toward the source smile.
- Ditto's weaknesses seen: the output is a 512x512 crop around the face (on Marcus the crop runs past the
  top of the photo: a black band at the top of every frame); upstream's paste-back into the full portrait
  costs ~13 ms/frame on the CPU (`putback=True`). Head motion is mild and natural; eyes blink.
- clip 5 / fuse 2 vs upstream's clip 10 / fuse 10: no jitter visible in the contact sheets, but only
  compared by eye on stills, not frame-by-frame in motion.

## What it took (engine.py)

- **Cython blend**: upstream's paste-back compiles a `.pyx` with pyximport (needs MSVC). `ditto_common.py`
  substitutes the same blend in numpy. That is the only Windows issue hit; no upstream file was edited.
- **Pickled config**: upstream loads `ditto_cfg/*.pkl` with plain `pickle`. Inspected with `pickletools`
  (only numpy arrays inside) and loaded through an unpickler that allows only numpy.
- **Speed**: one synchronous loop instead of upstream's six threads; the motion diffusion step captured in a
  CUDA graph; warp + decoder in fp16 kept on the GPU (upstream copies an 8 MB feature volume to numpy and
  back between them); onnxruntime HuBERT session reopened with `kSameAsRequested` arena (-0.65 GB).
- **Latency**: 5-frame diffusion calls (overlap 75 of the 80-frame window) and 2 cross-fade frames instead
  of upstream's 10 and 10. `DITTO_CLIP`, `DITTO_FUSE`, `DITTO_STEPS` override.

`engine.FaceEngine` has `set_image(path)`, `reset()`, `step(pcm) -> uint8 [n, 512, 512, 3]` and module
constants `SAMPLE_RATE`, `FPS`, `SIZE`, `CHUNK_SAMPLES` like the FlashHead engine. Differences a server must
handle: `CHUNK_SAMPLES` is 3200 (0.2 s), and frames trail the audio by `eng.delay_s`. `server.py` was not
changed or run against it.

## Run it

```bash
H=~/mirli-spike-ditto; mkdir -p $H && cd $H
git clone https://github.com/antgroup/ditto-talkinghead upstream          # read before running
uv venv --python 3.10 venv
uv pip install --python venv/Scripts/python.exe torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python venv/Scripts/python.exe onnxruntime-gpu librosa tqdm filetype imageio imageio-ffmpeg \
  opencv-python-headless scikit-image cython mediapipe einops "numpy<2.1"
# weights: ditto_cfg/v0.4_hubert_cfg_pytorch.pkl and ditto_pytorch/** from the HF repo into $H/checkpoints/
```

Sizes: PyTorch weights + cfg 2.2 GB (HuBERT ONNX is 1.4 GB of it; TensorRT/ONNX folders not downloaded),
venv 6.6 GB. Then from this folder with `PY=~/mirli-spike-ditto/venv/Scripts/python.exe`:

```bash
$PY run_engine.py --image face.png --wav speech.wav --seconds 12 --out results/x.mp4 [--speed 1]
$PY run_wav.py --image face.png --wav speech.wav --out results/y.mp4   # upstream's own pipeline
$PY profile_stages.py face.png speech.wav                             # per-stage timings
```

## Files

- `engine.py`: FaceEngine for Ditto; `ditto_common.py`: paths, shims, safe cfg loader
- `run_engine.py`: paced streaming run with timings and VRAM; `run_wav.py`: upstream pipeline run
- `profile_stages.py`: per-stage timing of upstream's pipeline
- `results/`: clips (`*_engine_c5f2.mp4` are the engine at defaults), summaries, mouth crops, contact sheets,
  `sofia_flashhead_lite.mp4` for comparison

## Not done

TensorRT; a run through `server.py` and a browser; English speech; replacing InsightFace; long-run drift
(12 s runs only, lateness stayed flat at 0.46-0.56 s over them).
