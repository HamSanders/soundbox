"""Experiment: how fast can Ditto show the FIRST lip-synced frame if we stop wasting work on it?

Hypothesis (from engine.py's structure, see docs novel-face.md): the 0.36 s first frame is
  0.20 s waiting for a 5-frame audio step (only 0.05 s when the TTS runs 4x real time)
+ ~0.16 s compute = HuBERT ~23 ms + 10 diffusion steps ~39 ms + rendering 3 motion frames
  ~72 ms + rendering the still portrait ~24 ms (done lazily after every reset()).
The face is compute-bound, not information-bound. Fast path:
  1. render the still once in set_image, never in reset();
  2. render the first emitted frame alone and hand it out before rendering the rest;
  3. time each stage with cuda.synchronize so the breakdown is measured, not inferred.

  python fast_first.py --image face.png --wav speech.wav [--speed 4] [--trials 5]

Prints JSON: per-stage ms for the first block, first-frame time for baseline vs fast path.
"""
import argparse, json, time

import numpy as np
import torch

import engine as E

ap = argparse.ArgumentParser()
ap.add_argument("--image", required=True)
ap.add_argument("--wav", required=True)
ap.add_argument("--speed", type=float, default=4.0)
ap.add_argument("--trials", type=int, default=5)
args = ap.parse_args()


def sync():
    torch.cuda.synchronize()
    return time.perf_counter()


class Timed(E.FaceEngine):
    """FaceEngine with stage timing and an optional fast first frame."""
    fast = False

    def set_image(self, path, seed=42):
        super().set_image(path, seed)
        self._still_cache = self._still()           # baseline also keeps paying it in reset()

    def reset(self):
        super().reset()
        if self.fast:
            self._hold = self._still_cache           # fix 1
        self.t_first = None
        self.stages = {}

    def _render(self, x_d_infos):
        if not (self.fast and self.t_first is None):
            return super()._render(x_d_infos)
        first = super()._render(x_d_infos[:1])      # fix 2: first frame alone, then the rest
        self.t_first = sync()
        return first + super()._render(x_d_infos[1:])


def run(fast, audio):
    eng.fast = fast
    eng.reset()
    t0 = time.perf_counter()
    first = None
    n = 0
    for i in range(0, len(audio), E.CHUNK_SAMPLES):
        d = t0 + (i + E.CHUNK_SAMPLES) / E.SAMPLE_RATE / args.speed - time.perf_counter()
        if d > 0:
            time.sleep(d)
        f = eng.step(audio[i:i + E.CHUNK_SAMPLES])
        n += len(f)
        if first is None and n > E.DELAY_FRAMES:
            # frame index DELAY_FRAMES is the one showing audio frame 0
            first = (eng.t_first if (fast and eng.t_first) else sync()) - t0
            break
    return first


class _Timer:
    """Wraps an upstream callable; accumulates synced wall time per call."""
    def __init__(self, inner):
        self.inner, self.ms = inner, []
    def __call__(self, *a, **k):
        t = sync(); r = self.inner(*a, **k); self.ms.append((sync() - t) * 1000); return r
    def __getattr__(self, name):
        return getattr(self.inner, name)


def stage_profile(audio):
    """Per-stage cost of steady-state blocks (HuBERT, motion diffusion, render), measured with syncs."""
    sdk = eng.sdk
    hub, a2m = _Timer(sdk.wav2feat), _Timer(sdk.audio2motion)
    sdk.wav2feat, sdk.audio2motion = hub, a2m
    orig = eng._render_kp
    ren = []
    def render_kp(xs, xd, batch=4):
        t = sync(); r = orig(xs, xd, batch); ren.append(((sync() - t) * 1000, len(xs))); return r
    eng._render_kp = render_kp
    eng.fast = False; eng.reset()
    blocks = []
    for i in range(0, len(audio) - E.CHUNK_SAMPLES, E.CHUNK_SAMPLES):
        t = sync(); eng.step(audio[i:i + E.CHUNK_SAMPLES]); blocks.append((sync() - t) * 1000)
    sdk.wav2feat, sdk.audio2motion = hub.inner, a2m.inner
    del eng._render_kp
    per_frame = [ms / n for ms, n in ren[2:] if n]
    eng._hold = None; t = sync(); eng._still(); still = (sync() - t) * 1000
    med = lambda x: round(float(np.median(x)), 1)
    return dict(block_ms=med(blocks[2:]), first_block_ms=round(blocks[0], 1), hubert_ms=med(hub.ms[2:]),
                diffusion_ms=med(a2m.ms[2:]), render_ms_per_frame=med(per_frame), still_portrait_ms=round(still, 1))


import librosa
eng = Timed()
eng.set_image(args.image)
for _ in range(3):
    eng.step(np.zeros(E.CHUNK_SAMPLES, np.float32))
audio, _ = librosa.load(args.wav, sr=E.SAMPLE_RATE)
audio = audio[: 4 * E.SAMPLE_RATE]

out = dict(speed=args.speed, clip=E.CLIP, fuse=E.FUSE, steps=E.STEPS, stages=stage_profile(audio))
for name, fast in (("baseline", False), ("fast_first", True)):
    ts = [run(fast, audio) for _ in range(args.trials)]
    out[name + "_first_frame_s"] = dict(median=round(float(np.median(ts)), 3), all=[round(t, 3) for t in ts])
print(json.dumps(out, indent=1))
