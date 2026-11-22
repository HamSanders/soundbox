"""RunPod serverless handler sketch: one job = one avatar pack. Not deployed.

Input:  {"spec": <character spec, see character.example.json>, "portrait_b64": optional PNG,
         "upload_url": optional presigned PUT URL for the zipped pack}
Output: {"manifest": {...}, "seams": {...}, "timings": {...}, "pack_url" | "pack_b64"}

The stock worker-comfyui handler takes one API graph per job. A pack is ~15 graphs (1 portrait,
3-5 stills, 8-20 clips), and the job must keep the models warm between them, so this handler starts
ComfyUI once, then runs build_avatar.py's steps against it in-process. Splitting one job per clip
instead (fan out across workers) is faster wall-clock but loads 30+ GB of weights per worker.
"""
import base64, json, subprocess, sys, tempfile, time, zipfile
from pathlib import Path

import requests
import runpod

COMFY = "http://127.0.0.1:8188"
proc = subprocess.Popen([sys.executable, "/comfyui/main.py", "--listen", "127.0.0.1", "--port", "8188"])
for _ in range(300):
    try:
        requests.get(COMFY, timeout=1); break
    except Exception:
        time.sleep(1)


def handler(job):
    inp = job["input"]
    work = Path(tempfile.mkdtemp())
    spec = inp["spec"]
    if inp.get("portrait_b64"):
        (work / "portrait.png").write_bytes(base64.b64decode(inp["portrait_b64"]))
        spec["portrait"]["image"] = "portrait.png"
    (work / "spec.json").write_text(json.dumps(spec))
    out = work / "pack"
    t0 = time.time()
    r = subprocess.run([sys.executable, "/avatar/build_avatar.py", str(work / "spec.json"), "--server", COMFY,
                        "--out", str(out)], capture_output=True, text=True)
    if r.returncode:
        return {"error": r.stdout[-2000:] + r.stderr[-2000:]}
    zpath = work / "pack.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        for p in out.rglob("*"):
            z.write(p, p.relative_to(out))
    res = {"manifest": json.loads((out / "manifest.json").read_text()),
           "seams": json.loads((out / "seam-report.json").read_text()),
           "seconds": round(time.time() - t0, 1)}
    if inp.get("upload_url"):
        requests.put(inp["upload_url"], data=zpath.read_bytes()).raise_for_status()
        res["pack_url"] = inp["upload_url"].split("?")[0]
    else:  # RunPod caps /run responses (~10 MB per the worker README), so this only works for tiny packs
        res["pack_b64"] = base64.b64encode(zpath.read_bytes()).decode()
    return res


runpod.serverless.start({"handler": handler})
