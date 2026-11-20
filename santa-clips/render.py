"""Render Santa pose-graph clips with Wan 2.2 14B first-and-last-frame (FLF2V) in a local ComfyUI.

    python santa-clips/render.py --server http://127.0.0.1:8000 talk_idle_a talk_idle_b talk_to_list list_to_talk

For each clip in manifest.json it queues the graph below through ComfyUI's /prompt API, collects the
PNG frames, checks the first and last decoded frames against the stills, then writes an H.264 MP4
(yuv420p, +faststart) the player can use. Clips with "via" are two segments: from->via and via->to.

Graph (node names from ComfyUI's own docs, https://docs.comfy.org/tutorials/video/wan/wan2_2, and checked
against comfy_extras/nodes_wan.py in the local install): UNETLoader x2 (high/low noise), CLIPLoader (type
"wan"), VAELoader, CLIPTextEncode x2, LoadImage x2, WanFirstLastFrameToVideo, ModelSamplingSD3 x2,
KSamplerAdvanced x2 (high noise on the first half of the steps, low noise on the rest), VAEDecode, SaveImage.
"""
import argparse, json, shutil, subprocess, sys, time, uuid
from pathlib import Path

import numpy as np
import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
FPS = 16                    # Wan 2.x native frame rate
STEPS, SPLIT, CFG, SHIFT = 20, 10, 3.5, 8.0
MODELS = {
    "high": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
    "low": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    "clip": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae": "wan_2.1_vae.safetensors",
}
STYLE = ("locked-off static camera, no camera movement, same framing, cozy study, warm firelight, "
         "subtle natural motion, realistic, consistent lighting")
NEG = ("camera movement, zoom, pan, cut, scene change, flicker, colour shift, text, watermark, "
       "deformed hands, extra fingers, blurry face, morphing")
SEAM_MAX = 6.0              # mean absolute difference (0-255) allowed between a clip end and its still


def frames_for(seconds: float) -> int:
    n = round(seconds * FPS)
    return (n // 4) * 4 + 1  # Wan wants 4k+1 frames


def graph(start: str, end: str, prompt: str, length: int, w: int, h: int, seed: int, prefix: str) -> dict:
    g = {
        "1": ("UNETLoader", {"unet_name": MODELS["high"], "weight_dtype": "default"}),
        "2": ("UNETLoader", {"unet_name": MODELS["low"], "weight_dtype": "default"}),
        "3": ("CLIPLoader", {"clip_name": MODELS["clip"], "type": "wan", "device": "default"}),
        "4": ("VAELoader", {"vae_name": MODELS["vae"]}),
        "5": ("CLIPTextEncode", {"clip": ["3", 0], "text": f"{prompt}. {STYLE}"}),
        "6": ("CLIPTextEncode", {"clip": ["3", 0], "text": NEG}),
        "7": ("LoadImage", {"image": start}),
        "8": ("LoadImage", {"image": end}),
        "9": ("WanFirstLastFrameToVideo", {"positive": ["5", 0], "negative": ["6", 0], "vae": ["4", 0],
              "width": w, "height": h, "length": length, "batch_size": 1,
              "start_image": ["7", 0], "end_image": ["8", 0]}),
        "10": ("ModelSamplingSD3", {"model": ["1", 0], "shift": SHIFT}),
        "11": ("ModelSamplingSD3", {"model": ["2", 0], "shift": SHIFT}),
        "12": ("KSamplerAdvanced", {"model": ["10", 0], "add_noise": "enable", "noise_seed": seed,
               "steps": STEPS, "cfg": CFG, "sampler_name": "euler", "scheduler": "simple",
               "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["9", 2],
               "start_at_step": 0, "end_at_step": SPLIT, "return_with_leftover_noise": "enable"}),
        "13": ("KSamplerAdvanced", {"model": ["11", 0], "add_noise": "disable", "noise_seed": seed,
               "steps": STEPS, "cfg": CFG, "sampler_name": "euler", "scheduler": "simple",
               "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["12", 0],
               "start_at_step": SPLIT, "end_at_step": STEPS, "return_with_leftover_noise": "disable"}),
        "14": ("VAEDecode", {"samples": ["13", 0], "vae": ["4", 0]}),
        "15": ("SaveImage", {"images": ["14", 0], "filename_prefix": prefix}),
    }
    return {k: {"class_type": c, "inputs": i} for k, (c, i) in g.items()}


def upload(server: str, path: Path) -> str:
    r = requests.post(f"{server}/upload/image", files={"image": (path.name, path.read_bytes())},
                      data={"overwrite": "true", "subfolder": "santa"})
    r.raise_for_status()
    j = r.json()
    return f"{j['subfolder']}/{j['name']}" if j.get("subfolder") else j["name"]


def run(server: str, g: dict) -> list[Image.Image]:
    pid = requests.post(f"{server}/prompt", json={"prompt": g, "client_id": str(uuid.uuid4())}).json()
    if "prompt_id" not in pid:
        sys.exit(f"ComfyUI refused the graph: {json.dumps(pid)[:2000]}")
    pid = pid["prompt_id"]
    while True:
        h = requests.get(f"{server}/history/{pid}").json()
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                sys.exit(f"render failed: {json.dumps(st)[:2000]}")
            if st.get("completed"):
                break
        time.sleep(3)
    imgs = h[pid]["outputs"]["15"]["images"]
    out = []
    for im in imgs:
        r = requests.get(f"{server}/view", params=im)
        r.raise_for_status()
        from io import BytesIO
        out.append(Image.open(BytesIO(r.content)).convert("RGB"))
    return out


def mad(a: Image.Image, b: Image.Image) -> float:
    return float(np.abs(np.asarray(a, np.float32) - np.asarray(b.resize(a.size), np.float32)).mean())


def encode(frames: list[Image.Image], dst: Path):
    tmp = dst.with_suffix("")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    for i, f in enumerate(frames):
        f.save(tmp / f"{i:04d}.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "%04d.png"),
                    "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                    "-movflags", "+faststart", str(dst)], check=True)
    shutil.rmtree(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--server", default="http://127.0.0.1:8000")
    ap.add_argument("--seed", type=int, default=1225)
    a = ap.parse_args()
    m = json.loads((HERE / "manifest.json").read_text())
    stills = {k: HERE / v["still"] for k, v in m["poses"].items()}
    W, H = m["width"], m["height"]
    report = {}
    for c in m["clips"]:
        if a.ids and c["id"] not in a.ids:
            continue
        legs = [(stills[c["from"]], HERE / c["via"]), (HERE / c["via"], stills[c["to"]])] if c.get("via") \
            else [(stills[c["from"]], stills[c["to"]])]
        per = c["durationS"] / len(legs)
        prompt = c.get("prompt") or f"Santa moves naturally from one pose to the next ({c['id'].replace('_', ' ')})"
        frames: list[Image.Image] = []
        for i, (s, e) in enumerate(legs):
            g = graph(upload(a.server, s), upload(a.server, e), prompt, frames_for(per), W, H, a.seed + i,
                      f"santa/{c['id']}_{i}")
            leg = run(a.server, g)
            frames += leg[1:] if frames else leg  # drop the duplicated join frame
        first, last = mad(frames[0], Image.open(stills[c["from"]]).convert("RGB")), \
            mad(frames[-1], Image.open(stills[c["to"]]).convert("RGB"))
        report[c["id"]] = {"frames": len(frames), "firstMAD": round(first, 2), "lastMAD": round(last, 2),
                           "seamOK": first <= SEAM_MAX and last <= SEAM_MAX}
        encode(frames, HERE / c["src"])
        print(c["id"], report[c["id"]], flush=True)
    (HERE / "seam-report.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
