# Live avatar creator (ComfyUI spike)

Turns a picture (or a text prompt) into a character pack that's ready for a live call: a master portrait,
a few pose stills that keep the same identity, the clips between them (transitions, idles, reactions), and a
`manifest.json` in the pose-graph format that `spikes/realtime-voice/public/santa-poses.js` plays. This is
the Santa pipeline (`santa-clips/`) generalised and moved onto ComfyUI so it can run on a rented GPU.

```
portrait (upload, or Z-Image Turbo) ──► pose stills (Qwen-Image-Edit 2509, one edit of the master per pose)
                                         │
                                         ▼
               clips (Wan 2.2 I2V-A14B, WanFirstLastFrameToVideo: first frame = from-pose still,
               last frame = to-pose still, so every clip that meets on a pose cuts invisibly)
                                         │
                                         ▼
               seam check (first/last frame vs still) ──► manifest.json + stills/ + clips/
```

All nodes are **core ComfyUI**. No custom nodes. The wiring copies the official templates in
`comfyui-workflow-templates` 0.11.9 (`image_z_image_turbo`, `image_qwen_image_edit_2509`,
`video_wan2_2_14B_flf2v`, 4-step branch).

## Files

| File | What |
|---|---|
| `graphs.py` | The three graphs as Python functions (the source of truth) |
| `workflows/*.api.json` | API format, for `/prompt`, RunPod `worker-comfyui`, Comfy Cloud API |
| `workflows/*.ui.json` | UI format: drag into ComfyUI to edit |
| `workflows/*.app.json` | UI format with App Mode inputs set (`extra.linearData`); opens as a simple form |
| `character.example.json` | A character spec: portrait prompt, poses (with edit prompts), clip edges |
| `build_avatar.py` | Walks a spec against any ComfyUI server and writes the pack; resumes on rerun |
| `check_workflow.py` | Validates the graphs against a running ComfyUI without rendering |
| `export_workflows.py` | Rewrites `workflows/*.api.json` from `graphs.py` |
| `package/Dockerfile`, `package/handler.py` | RunPod serverless sketch (not built) |

## Run

```
python avatar-creator/check_workflow.py --server http://127.0.0.1:8188
python avatar-creator/build_avatar.py avatar-creator/character.example.json --server http://127.0.0.1:8188 --out packs/barista
```

## Checked on 2026-11-21 (ComfyUI 0.34.1, frontend 1.45.21, CPU mode)

- All four graphs (portrait, pose still, clip 4-step, clip 20-step) pass `/object_info` type checks and
  `/prompt` validation; the only errors are the missing Wan and Qwen-Edit weights. The portrait graph
  validates completely (its weights are installed).
- UI round trip: each API file loaded with `app.loadApiJson`, saved, reloaded with `loadGraphData`,
  and converted back with `graphToPrompt` gives the same nodes, links and widget values. The frontend
  also writes a redundant legacy `codec` key on SaveVideo.
- `SaveVideo` with `format: mp4`, `format.codec: h264` really writes H.264 (tested on a 17-frame clip).
  Note: dynamic-combo inputs are dotted keys in API format. A plain `codec` key is silently ignored.
- App Mode file opens as a form with the two images, the prompt and the length.
- **Not run:** no image, still or clip was generated. A CPU render of the portrait crashed ComfyUI
  (exit 139), and the GPU had about 2 GB free next to the live voice and face servers.

## Weights (about 90 GB in total, sizes from Hugging Face `X-Linked-Size`)

| File | Folder | GB | Licence |
|---|---|---|---|
| z_image_turbo_bf16 | diffusion_models | 12.3 | Apache-2.0 |
| qwen_3_4b | text_encoders | 8.0 | Apache-2.0 |
| ae | vae | 0.34 | Apache-2.0 (FLUX.1 schnell AE) |
| qwen_image_edit_2509_fp8_e4m3fn | diffusion_models | 20.4 | Apache-2.0 |
| Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16 | loras | 0.85 | Apache-2.0 |
| qwen_2.5_vl_7b_fp8_scaled | text_encoders | 9.4 | Apache-2.0 |
| qwen_image_vae | vae | 0.25 | Apache-2.0 |
| wan2.2_i2v_high_noise_14B_fp8_scaled / low_noise | diffusion_models | 14.3 × 2 | Apache-2.0 |
| wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise / low_noise | loras | 1.23 × 2 | Apache-2.0 |
| umt5_xxl_fp8_e4m3fn_scaled | text_encoders | 6.7 | Apache-2.0 |
| wan_2.1_vae | vae | 0.25 | Apache-2.0 |

With an uploaded portrait, Z-Image can be dropped (−20.6 GB).

## Proof render on RunPod (2026-11-21)

`proof/` is the example spec rendered end to end on one RunPod L40S (ComfyUI 0.46.0), with no changes to the
scripts. The pod was ready 260 s after creation, with all weights pulled.

- Portrait: 5.8 s. Pose stills: about 6 s each.
- Clips: about 100 s per 3 s clip, about 156 s per 4 s clip (4-step).
- Seams: 1.7–4.5/255 at both ends, all passing.
- Identity and set hold across everything (`stills_sheet.jpg`, `clips_sheet.jpg`).

Known faults:
- The `lean` edit moves the camera.
- The cup pops into `talk_to_cup`.
- `think` reads as a yawn.
