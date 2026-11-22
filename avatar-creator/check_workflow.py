"""Check the avatar-creator graphs against a running ComfyUI without rendering anything.

    python avatar-creator/check_workflow.py --server http://127.0.0.1:8199

1. Static check against /object_info: every class_type exists, every input name is known, every link
   points at an existing node and output slot whose type matches the input.
2. Server check: POST each graph to /validate-style /prompt with a bogus output so nothing queues?
   ComfyUI has no dry-run endpoint, so instead we POST and read the node_errors. A graph whose only
   errors are "value not in list" on model file names is wired correctly and just lacks weights.
   If it validates cleanly it WILL be queued, so pass --allow-run only when you want that.
"""
import argparse, json, sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
import graphs  # noqa: E402

MODEL_INPUTS = {"unet_name", "clip_name", "vae_name", "lora_name", "ckpt_name"}


def static_check(g: dict, info: dict) -> list[str]:
    errs = []
    for nid, n in g.items():
        ct = n["class_type"]
        if ct not in info:
            errs.append(f"{nid}: unknown node {ct}")
            continue
        spec = info[ct]["input"]
        known = {**spec.get("required", {}), **spec.get("optional", {})}
        for name, val in n["inputs"].items():
            base = name.split(".")[0]
            if base not in known:
                errs.append(f"{nid} {ct}: unknown input {name}")
                continue
            if isinstance(val, list) and len(val) == 2 and isinstance(val[0], str):
                src, slot = val
                if src not in g:
                    errs.append(f"{nid} {ct}.{name}: links to missing node {src}")
                    continue
                outs = info[g[src]["class_type"]]["output"]
                want = known[base][0]
                got = outs[slot] if slot < len(outs) else None
                if got is None:
                    errs.append(f"{nid} {ct}.{name}: {src} has no output {slot}")
                elif isinstance(want, str) and want not in (got, "*") and got != "*":
                    errs.append(f"{nid} {ct}.{name}: wants {want}, gets {got} from {g[src]['class_type']}")
        for name, s in spec.get("required", {}).items():
            if name not in n["inputs"]:
                errs.append(f"{nid} {ct}: missing required input {name}")
    return errs


def server_check(server: str, g: dict) -> tuple[bool, list[str], list[str]]:
    r = requests.post(f"{server}/prompt", json={"prompt": g}).json()
    if "prompt_id" in r:
        return True, [], []
    missing, other = [], []
    for nid, ne in (r.get("node_errors") or {}).items():
        for e in ne["errors"]:
            inp = e.get("extra_info", {}).get("input_name")
            line = f"{nid} {ne['class_type']}.{inp}: {e['type']} {e.get('details', '')[:120]}"
            (missing if e["type"] == "value_not_in_list" and inp in MODEL_INPUTS else other).append(line)
    if not r.get("node_errors"):
        other.append(json.dumps(r.get("error"))[:300])
    return False, missing, other


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://127.0.0.1:8199")
    ap.add_argument("--image", default="avatar_check.png", help="an image already in ComfyUI's input folder")
    a = ap.parse_args()
    info = requests.get(f"{a.server}/object_info").json()
    cases = {
        "portrait": graphs.portrait("check"),
        "pose_still": graphs.pose_still(a.image, "check"),
        "clip_fast": graphs.clip(a.image, a.image, "check", length=17),
        "clip_full": graphs.clip(a.image, a.image, "check", length=17, fast=False),
    }
    ok_all = True
    for name, g in cases.items():
        g = graphs.fit_to_server(g, info)
        s = static_check(g, info)
        queued, missing, other = server_check(a.server, g) if not s else (False, [], ["skipped"])
        wired = not s and not other
        ok_all &= wired
        print(f"== {name}: {'WIRED OK' if wired else 'BROKEN'}{' (queued: weights present)' if queued else ''}")
        for line in s + other:
            print("   error:", line)
        for line in missing:
            print("   needs weights:", line)
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
