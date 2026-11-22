"""A stand-in face engine: no model, no GPU. `server.py --engine fake`.

It draws the portrait with a bar whose height follows the audio level, at the
real engines' pace (24 frames per 0.96 s step), so the server, its routing and
the web app can be tested end to end on any machine.
"""
import time
from pathlib import Path

import cv2
import numpy as np

SAMPLE_RATE = 16000
FPS = 25
CHUNK_FRAMES = 24
CHUNK_SAMPLES = CHUNK_FRAMES * SAMPLE_RATE // FPS
SIZE = 256


class FaceEngine:
    def __init__(self, compile_model=False, compile_vae=False, model_type="fake"):
        t0 = time.perf_counter()
        self.img = np.full((SIZE, SIZE, 3), 200, np.uint8)
        self.load_s = time.perf_counter() - t0

    def set_image(self, path):
        img = cv2.imread(str(path))
        if img is not None:
            self.img = cv2.cvtColor(cv2.resize(img, (SIZE, SIZE)), cv2.COLOR_BGR2RGB)

    def reset(self):
        pass

    def step(self, pcm, early=None):
        assert len(pcm) == CHUNK_SAMPLES, len(pcm)
        per = CHUNK_SAMPLES // CHUNK_FRAMES
        out = np.repeat(self.img[None], CHUNK_FRAMES, axis=0)
        for k in range(CHUNK_FRAMES):
            level = float(np.abs(pcm[k * per:(k + 1) * per]).max(initial=0))
            h = int(min(1.0, level * 3) * 60)
            out[k, SIZE - 20 - h:SIZE - 20, SIZE // 2 - 30:SIZE // 2 + 30] = (240, 90, 40)
        time.sleep(0.05)  # a little work, far under real time
        return list(out)
