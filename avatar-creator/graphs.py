"""ComfyUI API-format graphs for the live avatar creator.

Three graphs, all core ComfyUI nodes (no custom nodes), wiring copied from the official Comfy
templates shipped in comfyui-workflow-templates 0.11.9 and checked against the local install:

- portrait(): text -> master portrait. Z-Image Turbo (template image_z_image_turbo.json:
  8 steps, cfg 1, res_multistep, ModelSamplingAuraFlow shift 3).
- pose_still(): master portrait + edit prompt -> one pose still with the same identity and set.
  Qwen-Image-Edit 2509 + 4-step Lightning LoRA (template image_qwen_image_edit_2509.json:
  4 steps, cfg 1, euler/simple, shift 3, CFGNorm 1).
- clip(): start still + end still + motion prompt -> one clip pinned at both ends.
  Wan 2.2 I2V-A14B with WanFirstLastFrameToVideo and the lightx2v 4-step LoRAs
  (template video_wan2_2_14B_flf2v.json, 4-step branch: shift 5, cfg 1, high noise steps 0-2,
  low noise 2-4).

A serverless handler or build_avatar.py fills in the per-call values and queues one graph per pose
or per clip: ComfyUI has no native loop, so the pose graph is walked by the caller.
"""

MODELS = {
    # Z-Image Turbo (Apache-2.0), Comfy-Org/z_image_turbo
    "zimage_unet": "z_image_turbo_bf16.safetensors",
    "zimage_clip": "qwen_3_4b.safetensors",
    "zimage_vae": "ae.safetensors",
    # Qwen-Image-Edit 2509 (Apache-2.0), Comfy-Org/Qwen-Image-Edit_ComfyUI
    "qedit_unet": "qwen_image_edit_2509_fp8_e4m3fn.safetensors",
    "qedit_lora": "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
    "qedit_clip": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    "qedit_vae": "qwen_image_vae.safetensors",
    # Wan 2.2 I2V-A14B (Apache-2.0) + lightx2v Lightning LoRAs (Apache-2.0), Comfy-Org/Wan_2.2_ComfyUI_Repackaged
    "wan_high": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
    "wan_low": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    "wan_lora_high": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
    "wan_lora_low": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
    "wan_clip": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "wan_vae": "wan_2.1_vae.safetensors",
}

CLIP_STYLE = ("locked-off static camera, no camera movement, same framing, subtle natural motion, "
              "realistic, consistent lighting")
CLIP_NEG = ("camera movement, zoom, pan, cut, scene change, flicker, colour shift, text, watermark, "
            "deformed hands, extra fingers, blurry face, morphing")
STILL_KEEP = ("Keep the same person, face, hair, clothing, background, lighting and camera framing. "
              "Only change the pose: ")


def _api(g: dict) -> dict:
    return {k: {"class_type": c, "inputs": i, "_meta": {"title": t}} for k, (c, t, i) in g.items()}


def portrait(prompt: str, width=896, height=1120, seed=1, prefix="avatar/master") -> dict:
    return _api({
        "1": ("UNETLoader", "Load Z-Image Turbo", {"unet_name": MODELS["zimage_unet"], "weight_dtype": "default"}),
        "2": ("CLIPLoader", "Load Qwen3-4B", {"clip_name": MODELS["zimage_clip"], "type": "lumina2", "device": "default"}),
        "3": ("VAELoader", "Load VAE", {"vae_name": MODELS["zimage_vae"]}),
        "4": ("ModelSamplingAuraFlow", "Shift 3", {"model": ["1", 0], "shift": 3}),
        "5": ("CLIPTextEncode", "Portrait prompt", {"clip": ["2", 0], "text": prompt}),
        "6": ("ConditioningZeroOut", "Empty negative", {"conditioning": ["5", 0]}),
        "7": ("EmptySD3LatentImage", "Canvas", {"width": width, "height": height, "batch_size": 1}),
        "8": ("KSampler", "Sample (8 steps)", {"model": ["4", 0], "seed": seed, "steps": 8, "cfg": 1,
              "sampler_name": "res_multistep", "scheduler": "simple", "positive": ["5", 0],
              "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1}),
        "9": ("VAEDecode", "Decode", {"samples": ["8", 0], "vae": ["3", 0]}),
        "10": ("SaveImage", "Save master", {"images": ["9", 0], "filename_prefix": prefix}),
    })


def pose_still(master: str, pose_prompt: str, seed=1, prefix="avatar/pose") -> dict:
    """master: a file name in ComfyUI's input folder (upload it first)."""
    return _api({
        "1": ("UNETLoader", "Load Qwen-Image-Edit 2509", {"unet_name": MODELS["qedit_unet"], "weight_dtype": "default"}),
        "2": ("LoraLoaderModelOnly", "Lightning 4-step LoRA", {"model": ["1", 0], "lora_name": MODELS["qedit_lora"], "strength_model": 1}),
        "3": ("ModelSamplingAuraFlow", "Shift 3", {"model": ["2", 0], "shift": 3}),
        "4": ("CFGNorm", "CFGNorm", {"model": ["3", 0], "strength": 1, "pre_cfg": False}),
        "5": ("CLIPLoader", "Load Qwen2.5-VL", {"clip_name": MODELS["qedit_clip"], "type": "qwen_image", "device": "default"}),
        "6": ("VAELoader", "Load Qwen VAE", {"vae_name": MODELS["qedit_vae"]}),
        "7": ("LoadImage", "Master portrait", {"image": master}),
        "8": ("FluxKontextImageScale", "Scale to model size", {"image": ["7", 0]}),
        "9": ("TextEncodeQwenImageEditPlus", "Pose edit prompt", {"clip": ["5", 0], "vae": ["6", 0],
              "image1": ["8", 0], "prompt": STILL_KEEP + pose_prompt}),
        "10": ("TextEncodeQwenImageEditPlus", "Negative", {"clip": ["5", 0], "vae": ["6", 0],
               "image1": ["8", 0], "prompt": ""}),
        "11": ("VAEEncode", "Encode master", {"pixels": ["8", 0], "vae": ["6", 0]}),
        "12": ("KSampler", "Sample (4 steps)", {"model": ["4", 0], "seed": seed, "steps": 4, "cfg": 1,
               "sampler_name": "euler", "scheduler": "simple", "positive": ["9", 0], "negative": ["10", 0],
               "latent_image": ["11", 0], "denoise": 1}),
        "13": ("VAEDecode", "Decode", {"samples": ["12", 0], "vae": ["6", 0]}),
        "14": ("ImageScale", "Back to canvas size", {"image": ["13", 0], "upscale_method": "lanczos",
               "width": ["15", 0], "height": ["15", 1], "crop": "center"}),
        "15": ("GetImageSize", "Master size", {"image": ["7", 0]}),
        "16": ("SaveImage", "Save pose still", {"images": ["14", 0], "filename_prefix": prefix}),
    })


def frames_for(seconds: float, fps=16) -> int:
    n = round(seconds * fps)
    return (n // 4) * 4 + 1  # Wan wants 4k+1 frames


def clip(start: str, end: str, prompt: str, length=81, width=896, height=1120, seed=1,
         fps=16, prefix="avatar/clip", fast=True) -> dict:
    """start/end: file names in ComfyUI's input folder. fast=True uses the 4-step LoRAs."""
    steps, split, cfg, shift = (4, 2, 1.0, 5.0) if fast else (20, 10, 3.5, 8.0)
    g = {
        "1": ("UNETLoader", "Wan 2.2 high noise", {"unet_name": MODELS["wan_high"], "weight_dtype": "default"}),
        "2": ("UNETLoader", "Wan 2.2 low noise", {"unet_name": MODELS["wan_low"], "weight_dtype": "default"}),
        "3": ("CLIPLoader", "umT5-XXL", {"clip_name": MODELS["wan_clip"], "type": "wan", "device": "default"}),
        "4": ("VAELoader", "Wan VAE", {"vae_name": MODELS["wan_vae"]}),
        "5": ("CLIPTextEncode", "Motion prompt", {"clip": ["3", 0], "text": f"{prompt}. {CLIP_STYLE}"}),
        "6": ("CLIPTextEncode", "Negative", {"clip": ["3", 0], "text": CLIP_NEG}),
        "7": ("LoadImage", "From pose still", {"image": start}),
        "8": ("LoadImage", "To pose still", {"image": end}),
        "9": ("WanFirstLastFrameToVideo", "Pin first and last frame", {"positive": ["5", 0], "negative": ["6", 0],
              "vae": ["4", 0], "width": width, "height": height, "length": length, "batch_size": 1,
              "start_image": ["7", 0], "end_image": ["8", 0]}),
        "10": ("ModelSamplingSD3", "Shift (high)", {"model": ["20", 0] if fast else ["1", 0], "shift": shift}),
        "11": ("ModelSamplingSD3", "Shift (low)", {"model": ["21", 0] if fast else ["2", 0], "shift": shift}),
        "12": ("KSamplerAdvanced", "High noise pass", {"model": ["10", 0], "add_noise": "enable", "noise_seed": seed,
               "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple",
               "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["9", 2],
               "start_at_step": 0, "end_at_step": split, "return_with_leftover_noise": "enable"}),
        "13": ("KSamplerAdvanced", "Low noise pass", {"model": ["11", 0], "add_noise": "disable", "noise_seed": seed,
               "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple",
               "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["12", 0],
               "start_at_step": split, "end_at_step": 10000, "return_with_leftover_noise": "disable"}),
        "14": ("VAEDecode", "Decode", {"samples": ["13", 0], "vae": ["4", 0]}),
        "15": ("SaveImage", "Save frames (for the seam check)", {"images": ["14", 0], "filename_prefix": prefix}),
        "16": ("CreateVideo", "Frames to video", {"images": ["14", 0], "fps": fps, "bit_depth": "auto", "color_space": "sRGB"}),
        "17": ("SaveVideo", "Save MP4", {"video": ["16", 0], "filename_prefix": prefix, "format": "mp4", "format.codec": "h264",
               "format.codec.encoding": "auto"}),
    }
    if fast:
        g["20"] = ("LoraLoaderModelOnly", "lightx2v 4-step (high)", {"model": ["1", 0], "lora_name": MODELS["wan_lora_high"], "strength_model": 1})
        g["21"] = ("LoraLoaderModelOnly", "lightx2v 4-step (low)", {"model": ["2", 0], "lora_name": MODELS["wan_lora_low"], "strength_model": 1})
    return _api(g)


def fit_to_server(g: dict, object_info: dict) -> dict:
    """Adapt a graph to the ComfyUI version it will run on.

    Newer ComfyUI (0.34+) gives SaveVideo dynamic-combo inputs, whose API keys are dotted
    ("format.codec"), and CreateVideo gained bit_depth/color_space. Older builds, such as
    ComfyUI 0.30.0 in RunPod's official template, take a flat "codec" and lack the extras.
    Dotted keys the server doesn't know fall back to their last part; other unknown inputs are dropped.
    """
    out = {}
    for nid, n in g.items():
        spec = object_info.get(n["class_type"], {}).get("input", {})
        known = {**spec.get("required", {}), **spec.get("optional", {})}
        if not known:
            out[nid] = n
            continue
        inputs = {}
        for k, v in n["inputs"].items():
            if k in known:
                inputs[k] = v
            elif "." in k and k.rsplit(".", 1)[1] in known and k.rsplit(".", 1)[1] not in n["inputs"]:
                inputs[k.rsplit(".", 1)[1]] = v
        out[nid] = {**n, "inputs": inputs}
    return out
