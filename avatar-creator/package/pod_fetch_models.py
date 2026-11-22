"""Pull the avatar-creator weights onto a pod running RunPod's official ComfyUI template.

    python avatar-creator/package/pod_fetch_models.py <podId> <jupyter_password>

The template (console "ComfyUI", id cw3nka7d08, image runpod/comfyui) keeps ComfyUI at
/workspace/runpod-slim/ComfyUI (from the image's start.sh) and runs JupyterLab on port 8888.
This script opens a Jupyter kernel over the RunPod proxy and runs the downloads there, inside
RunPod's network, with huggingface_hub + hf_transfer. Nothing is built or uploaded from this machine.
With a network volume mounted at /workspace the files persist, so this runs once per volume.
"""
import argparse, json, sys, time, uuid

import requests
import websocket

MODELS = "/workspace/runpod-slim/ComfyUI/models"
W, Q = "Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "Comfy-Org/Qwen-Image_ComfyUI"
FILES = [  # (repo, path in repo, models subfolder)
    ("Comfy-Org/Qwen-Image-Edit_ComfyUI", "split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors", "diffusion_models"),
    ("lightx2v/Qwen-Image-Lightning", "Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors", "loras"),
    (Q, "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors", "text_encoders"),
    (Q, "split_files/vae/qwen_image_vae.safetensors", "vae"),
    (W, "split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "diffusion_models"),
    (W, "split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "diffusion_models"),
    (W, "split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", "loras"),
    (W, "split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", "loras"),
    (W, "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", "text_encoders"),
    (W, "split_files/vae/wan_2.1_vae.safetensors", "vae"),
    ("Comfy-Org/z_image_turbo", "split_files/diffusion_models/z_image_turbo_bf16.safetensors", "diffusion_models"),
    ("Comfy-Org/z_image_turbo", "split_files/text_encoders/qwen_3_4b.safetensors", "text_encoders"),
    ("Comfy-Org/z_image_turbo", "split_files/vae/ae.safetensors", "vae"),
]

CODE = r'''
import os, subprocess, sys, shutil
from concurrent.futures import ThreadPoolExecutor
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub[hf_transfer]"], check=True)
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
from huggingface_hub import hf_hub_download
FILES = %s
def get(f):
    repo, path, sub = f
    dst = os.path.join("%s", sub, os.path.basename(path))
    if os.path.exists(dst): return "have " + dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    p = hf_hub_download(repo, path, local_dir="/workspace/hf")
    shutil.move(p, dst); return "got " + dst
with ThreadPoolExecutor(6) as ex:
    for r in ex.map(get, FILES): print(r, flush=True)
print("ALL_DONE", flush=True)
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pod"); ap.add_argument("token")
    a = ap.parse_args()
    base = f"https://{a.pod}-8888.proxy.runpod.net"
    h = {"Authorization": f"token {a.token}"}
    k = requests.post(f"{base}/api/kernels", headers=h, json={"name": "python3"}, timeout=60)
    k.raise_for_status()
    kid = k.json()["id"]
    ws = websocket.create_connection(f"wss://{a.pod}-8888.proxy.runpod.net/api/kernels/{kid}/channels",
                                     header=[f"Authorization: token {a.token}"], timeout=3600)
    msg_id = uuid.uuid4().hex
    ws.send(json.dumps({"header": {"msg_id": msg_id, "username": "x", "session": uuid.uuid4().hex,
                                   "msg_type": "execute_request", "version": "5.3"},
                        "parent_header": {}, "metadata": {}, "channel": "shell",
                        "content": {"code": CODE % (repr(FILES), MODELS), "silent": False}}))
    t0 = time.time()
    while True:
        m = json.loads(ws.recv())
        if m.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        t, c = m["msg_type"], m["content"]
        if t == "stream":
            print(c["text"], end="", flush=True)
        elif t == "error":
            sys.exit("\n".join(c["traceback"])[-3000:])
        elif t == "status" and c["execution_state"] == "idle":
            break
    print(f"[{round(time.time() - t0)} s]")


if __name__ == "__main__":
    main()
