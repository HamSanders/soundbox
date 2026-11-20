"""Render pose-graph clips on fal with MiniMax H3 first/last-frame image-to-video.

    FAL_KEY=... python santa-clips/render_fal.py talk_idle_a talk_idle_b talk_to_list list_to_talk

Each clip is pinned to its `from` still (image_url) and `to` still (end_image_url). The result is
retimed to the manifest's durationS, scaled to the manifest size, and encoded as H.264 yuv420p
+faststart, so it matches every other clip. The seam check compares the first and last frames to the stills.
"""
import base64, io, json, os, subprocess, sys, time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
ENDPOINT = "minimax/h3/image-to-video"   # https://fal.ai/models/minimax/h3/image-to-video
RES = "768P"
STYLE = ("Locked-off static camera, no camera movement, same framing, same lighting and colour. "
         "Subtle natural motion only.")
SEAM_MAX = 8.0


def data_uri(p: Path) -> str:
    b = io.BytesIO()
    Image.open(p).convert("RGB").save(b, "JPEG", quality=95)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def fal(inp: dict) -> dict:
    h = {"Authorization": f"Key {os.environ['FAL_KEY']}", "Content-Type": "application/json"}
    sub = requests.post(f"https://queue.fal.run/{ENDPOINT}", headers=h, json=inp).json()
    if "status_url" not in sub:
        sys.exit(f"fal refused: {json.dumps(sub)[:1500]}")
    while True:
        st = requests.get(sub["status_url"], headers=h).json()
        if st.get("status") == "COMPLETED":
            return requests.get(sub["response_url"], headers=h).json()
        if st.get("status") not in ("IN_QUEUE", "IN_PROGRESS"):
            sys.exit(f"fal failed: {json.dumps(st)[:1500]}")
        time.sleep(5)


def frames(path: Path) -> tuple[np.ndarray, np.ndarray]:
    def grab(args):
        out = subprocess.run(["ffmpeg", "-loglevel", "error", *args, "-i", str(path), "-frames:v", "1",
                              "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
        return np.asarray(Image.open(io.BytesIO(out)).convert("RGB"), np.float32)
    return grab([]), grab(["-sseof", "-0.1"])


def mad(a: np.ndarray, still: Path) -> float:
    s = np.asarray(Image.open(still).convert("RGB").resize((a.shape[1], a.shape[0])), np.float32)
    return float(np.abs(a - s).mean())


def main():
    m = json.loads((HERE / "manifest.json").read_text())
    stills = {k: HERE / v["still"] for k, v in m["poses"].items()}
    W, H, FPS = m["width"], m["height"], m["fps"]
    report_p = HERE / "seam-report.json"
    report = json.loads(report_p.read_text()) if report_p.exists() else {}
    raw_dir = HERE / "raw"; raw_dir.mkdir(exist_ok=True)
    for c in m["clips"]:
        if c["id"] not in sys.argv[1:]:
            continue
        prompt = f"{c.get('prompt') or 'The man moves naturally from the first pose to the last pose'}. {STYLE}"
        res = fal({"prompt": prompt, "image_url": data_uri(stills[c["from"]]),
                   "end_image_url": data_uri(stills[c["to"]]), "resolution": RES,
                   "duration": max(int(round(c["durationS"])), int(os.environ.get("MIN_DUR", "0")))})
        print(json.dumps(res)[:800], flush=True)
        raw = raw_dir / f"{c["id"]}.mp4"
        raw.write_bytes(requests.get(res["video"]["url"]).content)
        src_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                        "csv=p=0", str(raw)], capture_output=True, text=True).stdout)
        speed = src_dur / c["durationS"]
        out = HERE / c["src"]; out.parent.mkdir(exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-an",
                        "-vf", f"setpts=PTS/{speed:.4f},fps={FPS},scale={W}:{H}:flags=lanczos,setsar=1",
                        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
                        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                        "-movflags", "+faststart", str(out)], check=True)
        f0, f1 = frames(out)
        r = {"model": ENDPOINT, "resolution": RES, "rawDurationS": round(src_dur, 2), "speedup": round(speed, 2),
             "firstMAD": round(mad(f0, stills[c["from"]]), 2), "lastMAD": round(mad(f1, stills[c["to"]]), 2)}
        r["seamOK"] = r["firstMAD"] <= SEAM_MAX and r["lastMAD"] <= SEAM_MAX
        report[c["id"]] = r
        print(c["id"], r, flush=True)
        report_p.write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
