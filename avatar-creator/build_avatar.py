"""Build a call-ready avatar pack from a character spec with a ComfyUI server (local or a rented pod).

    python avatar-creator/build_avatar.py avatar-creator/character.example.json --server http://127.0.0.1:8188 --out packs/barista
    python avatar-creator/build_avatar.py spec.json --only portrait      # just the master portrait
    python avatar-creator/build_avatar.py spec.json --only stills        # master + pose stills
    python avatar-creator/build_avatar.py spec.json --only clips c1 c2   # (re)render some clips

Steps: master portrait (uploaded image, or Z-Image Turbo from portrait.prompt) -> one Qwen-Image-Edit
still per pose -> one Wan 2.2 FLF clip per edge, pinned to the two stills -> seam check -> an
`manifest.json` in the pose-graph format that spikes/realtime-voice/public/santa-poses.js plays.
Every step is skipped if its output already exists, so a failed run resumes.
"""
import argparse, json, sys, time, uuid, zlib
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import graphs  # noqa: E402

SEAM_MAX = 8.0  # mean abs difference (0-255) between a clip's end frame and its still; fal MiniMax runs gave 6.1-6.8


class Comfy:
    def __init__(self, server: str):
        self.s = server.rstrip("/")

    def upload(self, path: Path, sub="avatar") -> str:
        r = requests.post(f"{self.s}/upload/image", files={"image": (path.name, path.read_bytes())},
                          data={"overwrite": "true", "subfolder": sub})
        r.raise_for_status()
        j = r.json()
        return f"{j['subfolder']}/{j['name']}" if j.get("subfolder") else j["name"]

    def run(self, g: dict) -> dict:
        r = requests.post(f"{self.s}/prompt", json={"prompt": g, "client_id": str(uuid.uuid4())}).json()
        if "prompt_id" not in r:
            sys.exit(f"ComfyUI refused the graph: {json.dumps(r)[:2000]}")
        pid, t0 = r["prompt_id"], time.time()
        while True:
            h = requests.get(f"{self.s}/history/{pid}").json()
            if pid in h:
                st = h[pid].get("status", {})
                if st.get("status_str") == "error":
                    sys.exit(f"render failed: {json.dumps(st)[:2000]}")
                if st.get("completed"):
                    h[pid]["seconds"] = round(time.time() - t0, 1)
                    return h[pid]
            time.sleep(2)

    def fetch(self, item: dict) -> bytes:
        r = requests.get(f"{self.s}/view", params=item)
        r.raise_for_status()
        return r.content

    def images(self, hist: dict, node: str) -> list[Image.Image]:
        return [Image.open(BytesIO(self.fetch(i))).convert("RGB") for i in hist["outputs"][node]["images"]]


def mad(a: Image.Image, b: Image.Image) -> float:
    return float(np.abs(np.asarray(a, np.float32) - np.asarray(b.resize(a.size), np.float32)).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("ids", nargs="*", help="clip ids to render (default: all)")
    ap.add_argument("--server", default="http://127.0.0.1:8188")
    ap.add_argument("--out", default=None)
    ap.add_argument("--only", choices=["portrait", "stills", "clips"], default=None)
    ap.add_argument("--full-steps", action="store_true", help="20-step Wan instead of the 4-step LoRA")
    a = ap.parse_args()

    spec = json.loads(Path(a.spec).read_text(encoding="utf8"))
    out = Path(a.out or Path(a.spec).with_suffix(""))
    (out / "stills").mkdir(parents=True, exist_ok=True)
    (out / "clips").mkdir(exist_ok=True)
    c = Comfy(a.server)
    W, H, FPS = spec["width"], spec["height"], spec.get("fps", 16)
    timings = {}

    # 1. master portrait
    master = out / "stills" / f"{spec['talkPose']}.png"
    if not master.exists():
        p = spec["portrait"]
        if p.get("image"):
            Image.open(Path(a.spec).parent / p["image"]).convert("RGB").resize((W, H), Image.LANCZOS).save(master)
        else:
            h = c.run(graphs.portrait(p["prompt"], W, H, p.get("seed", 1), f"avatar/{spec['id']}_master"))
            c.images(h, "10")[0].save(master)
            timings["portrait"] = h["seconds"]
        print("master", master, timings.get("portrait", "given"), flush=True)
    if a.only == "portrait":
        return

    # 2. pose stills, all edits of the master so identity and set match
    if a.only in (None, "stills"):
        up = c.upload(master)
        for pid, pose in spec["poses"].items():
            dst = out / "stills" / f"{pid}.png"
            if dst.exists() or not pose.get("edit"):
                continue
            h = c.run(graphs.pose_still(up, pose["edit"], seed=spec["portrait"].get("seed", 1),
                                        prefix=f"avatar/{spec['id']}_{pid}"))
            c.images(h, "16")[0].save(dst)
            timings[f"still:{pid}"] = h["seconds"]
            print("still", pid, h["seconds"], flush=True)
        if a.only == "stills":
            return

    # 3. clips, one per edge, pinned to the two stills
    uploads = {pid: c.upload(out / "stills" / f"{pid}.png") for pid in spec["poses"]}
    seams = {}
    for clip in spec["clips"]:
        if a.ids and clip["id"] not in a.ids:
            continue
        dst = out / "clips" / f"{clip['id']}.mp4"
        if dst.exists() and not a.ids:
            continue
        g = graphs.clip(uploads[clip["from"]], uploads[clip["to"]], clip["prompt"],
                        graphs.frames_for(clip["durationS"], FPS), W, H, seed=zlib.crc32(clip["id"].encode()),
                        fps=FPS, prefix=f"avatar/{spec['id']}_{clip['id']}", fast=not a.full_steps)
        h = c.run(g)
        frames = c.images(h, "15")
        dst.write_bytes(c.fetch(h["outputs"]["17"]["images"][0]))
        first = mad(frames[0], Image.open(out / "stills" / f"{clip['from']}.png").convert("RGB"))
        last = mad(frames[-1], Image.open(out / "stills" / f"{clip['to']}.png").convert("RGB"))
        seams[clip["id"]] = {"frames": len(frames), "firstMAD": round(first, 2), "lastMAD": round(last, 2),
                             "seamOK": max(first, last) <= SEAM_MAX, "seconds": h["seconds"]}
        print("clip", clip["id"], seams[clip["id"]], flush=True)

    # 4. manifest in the santa-poses.js format
    have = {p.stem for p in (out / "clips").glob("*.mp4")}
    manifest = {
        "version": 1, "id": spec["id"], "name": spec.get("name"),
        "talkPose": spec["talkPose"], "restPose": spec.get("restPose"), "startPose": spec.get("startPose", spec["talkPose"]),
        "width": W, "height": H, "fps": FPS,
        "poses": {pid: {"label": p.get("label", pid), "still": f"stills/{pid}.png",
                        **({"faceBox": spec["faceBox"]} if pid == spec["talkPose"] and spec.get("faceBox") else {})}
                  for pid, p in spec["poses"].items()},
        "clips": [{k: v for k, v in {"id": cl["id"], "from": cl["from"], "to": cl["to"], "kind": cl["kind"],
                                     "src": f"clips/{cl['id']}.mp4", "durationS": cl["durationS"],
                                     "weight": cl.get("weight", 1), "tags": cl.get("tags"),
                                     "prompt": cl["prompt"]}.items() if v is not None}
                  for cl in spec["clips"] if cl["id"] in have],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf8")
    old = json.loads((out / "seam-report.json").read_text()) if (out / "seam-report.json").exists() else {}
    (out / "seam-report.json").write_text(json.dumps({**old, **seams}, indent=1))
    print("manifest", out / "manifest.json", len(manifest["clips"]), "clips", flush=True)


if __name__ == "__main__":
    main()
