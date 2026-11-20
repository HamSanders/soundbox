# Santa pose-graph clips

Stills and clips for the animated Santa in the Call Santa video call. The format follows the player's manifest
(`spikes/realtime-voice/public/santa-poses.js` on `claude/priceless-grothendieck-e3b9bb`).

- Lookbook: https://claude.ai/artifact/4EyGD3BPSZt8cQxA95hEnS (private)
- `stills/`: the 4:5 keyframes (896 × 1120) that the clips use. `stills/src/` holds the 896 × 1200 originals.
  `stills/talk.png` is the master. It must also be the face server's Santa portrait, or the hand-off to
  lip-sync will jump.
- `manifest.json`: every pose and clip, as `{id, from, to, kind, src}`, plus `durationS`, `prompt`, `tags`,
  and `via` (a midpoint still: these clips render in two FLF segments, from→via→to).
- `render.py`: queues each clip in a local ComfyUI (Wan 2.2 14B FLF2V), checks the seams, and writes the MP4s.
  Run it like this:
  `python santa-clips/render.py --server http://127.0.0.1:8000 talk_idle_a talk_idle_b talk_to_list list_to_talk`

## Status (2026-11-20)

| Item | State |
|---|---|
| Master and 9 stills | Done. All are Nano Banana edits of the master, so identity and set match. |
| Elf gag, hat prop | Not made. The Antigravity image quota is used up until 2026-11-21 02:03 UTC. |
| Wink | Came out as a finger-to-lips "shh". Kept as the `shh` reaction. |
| Reindeer gag | Needs review: the glowing red nose evokes Rudolph, a trademarked character. |
| Clip plan | 21 clips in `manifest.json`: 6 idle, 8 transitions, 5 reactions, 2 gags. All 2–4 s. |
| Proof render | Not run yet. ComfyUI Desktop is installed, but no Wan weights are, and the download (~35.6 GB) needs approval. |

## ComfyUI check

- Comfy Desktop is installed at `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI` (commit 7597a5a0, 2026-08-26).
  Its `comfy_extras/nodes_wan.py` has `WanFirstLastFrameToVideo`. The inputs are positive, negative, vae,
  width/height (step 16), length (step 4, so 4k+1 frames), and optional start_image/end_image/clip_vision.
- The models it has: SDXL, Z-Image Turbo, MiniMax H3 (FL2VA and Ref2VA), Qwen3 text encoders. **No Wan models.**
- Workflow: the official Comfy Wan 2.2 docs (https://docs.comfy.org/tutorials/video/wan/wan2_2) say the 14B FLF2V
  workflow "uses the same model locations as the I2V section". Downloads needed, from
  https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files:

| File | Folder | Size |
|---|---|---|
| `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models` | 14.3 GB |
| `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models` | 14.3 GB |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders` | 6.74 GB |
| `wan_2.1_vae.safetensors` | `models/vae` | 0.25 GB |

  The total is about 35.6 GB. The disk has 197 GB free. The fp8 files are needed because the GPU is an RTX 5080
  with 16 GB; the fp16 pair is 57 GB and would not fit.
  The docs' file list names the fp16 files. Using fp8 here is my choice, not something the docs state for FLF.

## Seamless cuts

- Every clip is pinned to its stills at both ends by `WanFirstLastFrameToVideo`. `render.py` measures the mean
  absolute difference between the first and last decoded frames and the stills, and writes it to `seam-report.json`.
  It fails a clip at more than 6/255.
- Every clip uses the same size (896 × 1120), the same frame rate (16 fps), the same encode (H.264 yuv420p,
  BT.709 tags, CRF 16) and the same style prompt. That way the talk idles and the live lip-sync canvas don't pop
  when they switch. If the VAE round trip shifts colour, the next step is to replace frame 0 and frame N with
  the exact still and cross-fade 2 frames.

## Licences

| Model | Used for | Licence | Commercial use | Source |
|---|---|---|---|---|
| Nano Banana (Gemini image model, via the Antigravity CLI) | All stills | Google terms of service for the Antigravity / Gemini product | Not verified. Google's generative AI terms generally do not claim ownership of output, but the terms for the Antigravity login this was made under were not read. **Check them before the paid site ships.** US copyright protection for AI output is doubtful (*Thaler v. Perlmutter*, D.C. Cir. 2025). | https://antigravity.google, https://policies.google.com/terms/generative-ai |
| Wan 2.2 I2V-A14B (high and low noise) | Clips (planned) | Apache 2.0 | Yes. The Comfy docs say the Wan 2.2 series supports commercial use; the licence section also bars harmful content. | https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B, https://docs.comfy.org/tutorials/video/wan/wan2_2 |
| umt5-xxl fp8 and the Wan 2.1 VAE (Comfy-Org repack) | Clips (planned) | Comes from Wan-AI, Apache 2.0 | Yes, by the upstream licence. The repack card's own licence field was not checked. | https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged |

Character design: original. No hat in the master, round gold spectacles, a plain belt buckle, no logos. The
prompts reference no film or brand.

## Proof clips on fal (decided 2026-11-20: use fal, don't download Wan locally)

fal endpoints that take a first and a last frame, as of 2026-11-20:

| Endpoint | Start / end params | Price (fal page) | Notes |
|---|---|---|---|
| `minimax/h3/image-to-video` (**picked**) | `image_url` / `end_image_url` | $0.05/s 480p, $0.06/s 768p, $0.13/s 2K | Output canvas follows the input image, so 4:5 works. Marked "Commercial use". https://fal.ai/models/minimax/h3/image-to-video |
| `fal-ai/wan/v2.2-a14b/image-to-video` | `image_url` / `end_image_url` | $0.04–0.08/s | Aspect options are auto, 16:9, 9:16 and 1:1, so 4:5 would be cropped. Removed from fal on 2027-01-04. https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video |
| `fal-ai/kling-video/o3/standard/image-to-video` | `image_url` / `end_image_url` | $0.084/s | 3–15 s. https://fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video |
| `kling/v4/image-to-video` | `start_image_url` / `end_image_url` | $0.157/s at 720p | 3–30 s; the input aspect can be 0.4 to 2.5. https://fal.ai/models/kling/v4/image-to-video |
| `fal-ai/vidu/start-end-to-video` | `start_image_url` / `end_image_url` | $0.20 per 4 s | No size or duration control. https://fal.ai/models/fal-ai/vidu/start-end-to-video |
| `fal-ai/veo3.1/first-last-frame-to-video` | `first_frame_url` / `last_frame_url` | $0.20/s | Only 16:9 or 9:16. https://fal.ai/models/fal-ai/veo3.1/first-last-frame-to-video |

**MiniMax H3 licence:** this is a closed partner model run through fal. fal's model page marks it "Commercial use", and use falls
under fal's terms (https://fal.ai/terms). No weights are downloaded, and there is no separate open licence. The valid duration range
isn't stated (the default is 5 s), so the 2 s idles may come back at 5 s and need retiming or trimming.
