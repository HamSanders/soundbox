#!/usr/bin/env python3
"""
Levels the /sfx sample MP3s so they play back at one loudness without clipping.

The renders come out of the model at whatever level it chose: on the site that
spread ran from -33 to -6 dB RMS, so one row whispered and the next shouted,
and most MP3s decoded above 0 dBFS (MP3 encoding overshoots a WAV peaking at
full scale), which clips in the browser. This applies one gain per clip:

  gain = min(TARGET - active RMS, CEILING - true peak)

i.e. bring the clip to the target loudness, unless that would push its true
peak (4x oversampled) above the ceiling. Gain only: no compressor or limiter,
so the clip is still what the model made, just at a sensible level.

"Active RMS" ignores frames more than 30 dB under the loudest one, so a short
blip in a second of silence is judged by the blip, not by the silence.

Sources are the lossless WAVs in a Mirli library, matched by prompt and model
(closest duration wins when a prompt was rendered more than once). A clip with
no source in the given databases is levelled from its MP3 instead and reported,
which costs one extra lossy generation.

Usage:
  python scripts/level-sfx-samples.py --prompts=p.json --db=~/.soundbox/soundbox.db [--db=...] [category ...]
  python scripts/level-sfx-samples.py ... --dry-run     # print gains, write nothing

The --prompts file is what `npx tsx scripts/dump-sfx-prompts.ts --with-model` prints.
Re-running is safe: each run starts from the source WAV, so gains do not stack.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
SFX = ROOT / "site" / "public" / "sfx"
TARGET_DB = -18.0
CEILING_DBTP = -1.5


def decode(path: Path) -> tuple[np.ndarray, int]:
    """All channels, native rate, float32, shape (frames, channels)."""
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels",
         "-of", "json", str(path)], check=True, capture_output=True).stdout)["streams"][0]
    sr, ch = int(probe["sample_rate"]), int(probe["channels"])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch), sr


def active_rms_db(x: np.ndarray, sr: int) -> float:
    mono = x.mean(axis=1)
    n = max(1, int(sr * 0.05))
    frames = mono[: len(mono) // n * n].reshape(-1, n) if len(mono) >= n else mono[None, :]
    ms = (frames**2).mean(axis=1)
    keep = ms >= ms.max() * 1e-3
    return float(10 * np.log10(ms[keep].mean() + 1e-12))


def true_peak_db(x: np.ndarray) -> float:
    up = resample_poly(x, 4, 1, axis=0)
    return float(20 * np.log10(np.abs(up).max() + 1e-12))


def encode(src: Path, dst: Path, gain_db: float) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-map_metadata", "-1", "-af", f"volume={gain_db:.2f}dB",
         "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3", str(dst)],
        check=True,
    )


def find_source(
    dbs: list[tuple[sqlite3.Connection, Path]], prompt: str, model: str, duration: float, seed: int | None
) -> Path | None:
    # A pinned seed narrows it to that take; without one, the same prompt may
    # have been rendered several times and duration has to tell them apart.
    sql = "select filename, duration_s from sounds where prompt = ? and model = ?"
    args: tuple = (prompt, model)
    if seed is not None:
        sql += " and seed = ?"
        args += (seed,)
    best: tuple[float, Path] | None = None
    for conn, sounds in dbs:
        for filename, dur in conn.execute(sql, args):
            path = sounds / filename
            if path.exists():
                d = abs((dur or 0) - duration)
                if best is None or d < best[0]:
                    best = (d, path)
    # Anything more than 20 ms off is a different render of the same prompt.
    return best[1] if best and best[0] < 0.02 else None


def main() -> int:
    argv = sys.argv[1:]
    opt = lambda name: [a.split("=", 1)[1] for a in argv if a.startswith(f"--{name}=")]
    dry = "--dry-run" in argv
    only = {a for a in argv if not a.startswith("--")}
    prompts: dict[str, dict] = json.loads(Path(opt("prompts")[0]).read_text())
    dbs = []
    for db in opt("db"):
        p = Path(db).expanduser()
        dbs.append((sqlite3.connect(f"file:{p}?mode=ro", uri=True), p.parent / "sounds"))

    from_mp3 = []
    for d in sorted(x for x in SFX.iterdir() if (x / "manifest.json").exists()):
        if only and d.name not in only:
            continue
        manifest = json.loads((d / "manifest.json").read_text())
        for slug, entry in manifest.items():
            mp3 = d / f"{slug}.mp3"
            meta = prompts.get(f"{d.name}/{slug}")
            if not mp3.exists() or not meta:
                continue
            src = find_source(dbs, meta["prompt"], meta["model"], entry["durationS"], meta.get("seed"))
            x, sr = decode(src or mp3)
            gain = min(TARGET_DB - active_rms_db(x, sr), CEILING_DBTP - true_peak_db(x))
            print(f"{'wav' if src else 'MP3'} {d.name}/{slug:40s} gain {gain:+6.1f} dB")
            if src is None:
                from_mp3.append(f"{d.name}/{slug}")
            if dry:
                continue
            tmp = mp3.with_suffix(".tmp.mp3")
            encode(src or mp3, tmp, gain)
            # MP3 can still overshoot a little; take it back off if it did.
            over = true_peak_db(decode(tmp)[0]) - (CEILING_DBTP + 0.5)
            if over > 0:
                encode(src or mp3, tmp, gain - over)
            tmp.replace(mp3)
            entry["sizeBytes"] = mp3.stat().st_size
        if not dry:
            (d / "manifest.json").write_text(json.dumps(manifest))
    print(f"\n{len(from_mp3)} levelled from the MP3 (no source WAV found): {', '.join(from_mp3) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
