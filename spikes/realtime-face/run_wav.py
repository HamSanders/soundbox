"""Offline check: portrait + WAV -> MP4, with per-chunk timings and peak VRAM."""
import argparse
import json
import subprocess
import time
from pathlib import Path

import imageio
import imageio_ffmpeg
import librosa
import numpy as np
import torch

import sys
if "musetalk" in sys.argv:
    import musetalk_engine as E
else:
    import engine as E

ap = argparse.ArgumentParser()
ap.add_argument("--image", default=str(Path.home() / "mirli-spike-face" / "upstream" / "SoulX-FlashHead" / "examples" / "girl.png"))
ap.add_argument("--audio", default=str(Path.home() / "mirli-spike-face" / "upstream" / "SoulX-FlashHead" / "examples" / "podcast_sichuan_16k.wav"))
ap.add_argument("--out", default="results/wav.mp4")
ap.add_argument("--seconds", type=float, default=20)
ap.add_argument("--compile", action="store_true")
ap.add_argument("--model", default="lite", choices=["lite", "pro", "musetalk"])
args = ap.parse_args()

eng = E.FaceEngine(compile_model=args.compile, compile_vae=args.compile, model_type=args.model)
N = eng.chunk_samples
eng.set_image(args.image)
pcm, _ = librosa.load(args.audio, sr=E.SAMPLE_RATE, mono=True, duration=args.seconds)
pcm = pcm[: len(pcm) // N * N]

times, chunks = [], []
for i in range(0, len(pcm), N):
    t = time.perf_counter()
    chunks.append(eng.step(pcm[i : i + N]))
    times.append(time.perf_counter() - t)
    print(f"chunk {len(times) - 1}: {times[-1] * 1000:.0f} ms", flush=True)

tmp = args.out.replace(".mp4", "_silent.mp4")
with imageio.get_writer(tmp, format="mp4", mode="I", fps=E.FPS, codec="h264", ffmpeg_params=["-bf", "0"]) as w:
    for c in chunks:
        for f in c:
            w.append_data(f)
wav = args.out.replace(".mp4", ".wav")
import soundfile as sf
sf.write(wav, pcm, E.SAMPLE_RATE)
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", tmp, "-i", wav,
                "-c:v", "copy", "-c:a", "aac", args.out], check=True)

steady = times[3:] or times
print(json.dumps({
    "load_s": round(eng.load_s, 1),
    "first_chunk_ms": round(times[0] * 1000),
    "steady_chunk_ms_median": round(float(np.median(steady)) * 1000),
    "steady_chunk_ms_max": round(max(steady) * 1000),
    "steady_fps": round(eng.chunk_frames / float(np.median(steady)), 1),
    "model": args.model,
    "torch_peak_alloc_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
    "torch_peak_reserved_gb": round(torch.cuda.max_memory_reserved() / 2**30, 2),
    "compile": args.compile,
}))
