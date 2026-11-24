#!/usr/bin/env python3
"""
Flags /sfx samples whose prompt asks for a tone but whose audio is noise.

The few-step SFX models sometimes answer a prompt like "square wave ping" with
broadband hiss. On a page that says "this is what that prompt makes", one of
those clips is worse than no clip. This scores each MP3 under site/public/sfx
and lists the ones that look wrong for what the prompt asked. The scores are
energy-weighted spectral flatness (0 = a pure tone, 1 = white noise), the
share of energy below 250 Hz (reported, not judged: bass is allowed) and RMS
level. It reads a mono 22 kHz downmix, so it reports no peak; for peaks see
scripts/level-sfx-samples.py, which measures true peak at the native rate.

Flatness alone can't judge a sample: rain and explosions are supposed to be
noise. So a clip is flagged only when its prompt names something pitched
(square wave, chime, beep...) and its flatness is above the threshold.

Usage:
  python scripts/check-sfx-noise.py              # every category, flagged only
  python scripts/check-sfx-noise.py retro-game   # just these categories
  python scripts/check-sfx-noise.py --all        # print every clip's scores

Needs ffmpeg on PATH and numpy. Pass --prompts=<file> with the output of
`npx tsx scripts/dump-sfx-prompts.ts`; without it every clip is scored but
none can be flagged.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SFX = ROOT / "site" / "public" / "sfx"
SR = 22050

# Words that promise a pitched sound. Checked against the prompt.
# Kept to synth and UI vocabulary on purpose: "tone", "note" and "bell" also
# turn up in prompts for footsteps, ambiences and real bells, which are meant
# to carry noise.
TONAL = (
    "square wave", "pulse wave", "triangle wave", "sine wave", "chiptune", "8-bit", "8 bit",
    "chime", "beep", "blip", "ping", "chirp", "jingle", "arpeggio",
)
FLAT_LIMIT = 0.08


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def score(x: np.ndarray) -> dict:
    """Energy-weighted spectral flatness over 100 Hz-10 kHz, plus levels.

    Weighting by energy matters: a jingle has silent gaps between notes, and
    silence is "flat". An unweighted mean would rate a clean jingle noisier
    than a hiss that never stops.
    """
    n, hop = 1024, 256
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(n, 1 / SR)
    band = power[:, (freqs >= 100) & (freqs <= 10000)] + 1e-12
    flat = np.exp(np.mean(np.log(band), axis=1)) / np.mean(band, axis=1)
    energy = band.sum(axis=1)
    loud = energy > energy.max() * 1e-3  # within 30 dB of the loudest frame
    weighted = float(np.average(flat[loud], weights=energy[loud]))
    total = power.sum()
    low = float(power[:, freqs < 250].sum() / (total + 1e-12))
    rms = float(np.sqrt(np.mean(x**2)))
    return {
        "flatness": round(weighted, 3),
        "lowShare": round(low, 2),
        "rmsDb": round(20 * np.log10(rms + 1e-12), 1),
    }


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_all = "--all" in sys.argv
    prompts_file = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--prompts=")), None)
    prompts: dict[str, dict] = json.loads(Path(prompts_file).read_text()) if prompts_file else {}

    dirs = sorted(d for d in SFX.iterdir() if d.is_dir() and (d / "manifest.json").exists())
    if args:
        dirs = [d for d in dirs if d.name in args]

    flagged = 0
    for d in dirs:
        for mp3 in sorted(d.glob("*.mp3")):
            key = f"{d.name}/{mp3.stem}"
            s = score(decode(mp3))
            prompt = prompts.get(key, {}).get("prompt", "").lower()
            # Whole words: a bare substring test reads "ping" in "flapping".
            tonal = any(re.search(r"\b" + re.escape(w) + r"\b", prompt) for w in TONAL)
            bad = tonal and s["flatness"] > FLAT_LIMIT
            flagged += bad
            if bad or show_all:
                mark = "NOISY" if bad else "     "
                print(f"{mark} {key:48s} flat={s['flatness']:.3f} low={s['lowShare']:.2f} rms={s['rmsDb']:6.1f}")
    print(f"\n{flagged} flagged (synth/UI prompt, flatness > {FLAT_LIMIT}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
