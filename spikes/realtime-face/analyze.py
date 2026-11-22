"""Summarise a server --log file (JSON lines) into the numbers the README quotes."""
import json
import sys

import numpy as np

rows = [json.loads(l) for l in open(sys.argv[1])]
before = int(open(sys.argv[1].replace(".jsonl", ".vram_before.txt")).read().split()[0])
chunks = [r for r in rows if r["ev"] == "chunk"]
br = [r for r in rows if r["ev"] == "browser" and r["drawn"]]
vram = [r["mib"] for r in rows if r["ev"] == "vram"]
steps = np.array([c["step_ms"] for c in chunks])
first_send = [c["audio_to_send_ms"] for c in chunks if "audio_to_send_ms" in c]
first_seen = [x for r in br for x in r["first_frame_ms"]]
t = np.array([r["t"] for r in br]) - br[0]["t"]
late = np.array([r["late_ms_mean"] for r in br])
slope = np.polyfit(t, late, 1)[0] * 60  # ms per minute
med = lambda a: round(float(np.median(a)), 1) if len(a) else None
print(json.dumps({
    "run_s": round(float(t[-1])),
    "chunks": {"speech": sum(c["kind"] == "speech" for c in chunks), "idle": sum(c["kind"] == "idle" for c in chunks)},
    "step_ms": {"median": med(steps), "p95": round(float(np.percentile(steps, 95)), 1), "max": float(steps.max())},
    "gen_fps_median": round(24 / (float(np.median(steps)) / 1000), 1),
    "jpeg_ms_median": med([c["jpeg_ms"] for c in chunks]),
    "utterances": len(first_send),
    "first_audio_to_chunk_sent_ms": {"median": med(first_send), "min": min(first_send, default=None), "max": max(first_send, default=None)},
    "first_audio_to_frame_on_screen_ms": {"n": len(first_seen), "median": med(first_seen), "min": min(first_seen, default=None), "max": max(first_seen, default=None)},
    "display_fps_median": med([r["drawn"] for r in br]),
    "frames": {"drawn": sum(r["drawn"] for r in br), "skipped": sum(r["skipped"] for r in br)},
    "underruns": sum(r["underruns"] for r in br),
    "frame_lateness_ms": {"mean": round(float(late.mean()), 2), "first_30s": round(float(late[t < 30].mean()), 2),
                          "last_30s": round(float(late[t > t[-1] - 30].mean()), 2), "max": max(r["late_ms_max"] for r in br),
                          "slope_ms_per_min": round(float(slope), 3)},
    "queued_s": {"median": med([r["queued_s"] for r in br]), "max": max(r["queued_s"] for r in br)},
    "output_latency_ms": br[-1]["output_latency_ms"], "tab_hidden": any(r["hidden"] for r in br),
    "vram_mib": {"before_start": before, "peak": max(vram), "delta": max(vram) - before},
}, indent=1))
