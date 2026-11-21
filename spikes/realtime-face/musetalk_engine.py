"""MuseTalk 1.5 behind the same interface as engine.FaceEngine: a 512 portrait (or a looping clip of one)
plus audio chunks in, frames out. Only the mouth region is regenerated (256x256, one UNet pass per frame,
no diffusion loop); the rest of each frame is the avatar's own pixels.

Upstream: https://github.com/TMElyralab/MuseTalk (MIT code, MIT weights). Imported from a checkout outside
this repo (PositionalEncoding and the UNet config only); the streaming audio windowing below is ours.

Licence-relevant choices: no InsightFace, no DWPose/mmpose, no face-parsing net. The face box comes from
OpenCV's YuNet (MIT, opencv_zoo) and the blend mask is a fixed feathered ellipse.
"""
import json
import math
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

HOME = Path(os.environ.get("MIRLI_MUSETALK_HOME", Path.home() / "mirli-spike-musetalk"))
UPSTREAM = HOME / "upstream"
MODELS = HOME / "models"

SAMPLE_RATE = 16000
FPS = 25
# Frames per step. MuseTalk has no temporal window of its own, so this is only a batching choice:
# smaller = lower latency, larger = better GPU use. 8 frames = 0.32 s.
CHUNK_FRAMES = int(os.environ.get("MUSE_CHUNK", 8))
CHUNK_SAMPLES = CHUNK_FRAMES * SAMPLE_RATE // FPS
SIZE = 512
# Whisper features are 50/s; each video frame looks at 10 of them: 2 frames back, itself, 2 frames ahead
# (upstream's audio_padding_length_left/right = 2). The look-ahead is 6 features = 120 ms, so frames lag
# the newest audio by that much; the server delays the audio it sends by the same amount.
LOOKAHEAD_S = 0.12
HISTORY_S = 4.0
LOOP = os.environ.get("MUSE_LOOP")        # optional mp4 whose faceBox crop is the avatar (head motion)
LOOP_BOX = os.environ.get("MUSE_LOOP_BOX", "214,104,512")  # x,y,size of the crop in the loop's frames


class FaceEngine:
    chunk_frames = CHUNK_FRAMES
    chunk_samples = CHUNK_SAMPLES
    delay_s = LOOKAHEAD_S

    def __init__(self, compile_model=False, compile_vae=False, model_type="musetalk"):
        sys.path.insert(0, str(UPSTREAM))
        from diffusers import AutoencoderKL, UNet2DConditionModel
        from transformers import AutoFeatureExtractor, WhisperModel
        from musetalk.models.unet import PositionalEncoding

        t0 = time.perf_counter()
        dev, dt = "cuda", torch.float16
        cfg = json.load(open(MODELS / "musetalkV15" / "musetalk.json"))
        self.unet = UNet2DConditionModel(**cfg)
        sd = torch.load(MODELS / "musetalkV15" / "unet.pth", map_location="cpu", weights_only=True)
        self.unet.load_state_dict(sd)
        self.unet = self.unet.to(dev, dt).eval()
        self.vae = AutoencoderKL.from_pretrained(str(MODELS / "sd-vae")).to(dev, dt).eval()
        self.pe = PositionalEncoding(d_model=384).to(dev, dt)
        self.fe = AutoFeatureExtractor.from_pretrained(str(MODELS / "whisper"))
        self.whisper = WhisperModel.from_pretrained(str(MODELS / "whisper")).to(dev, dt).eval()
        if compile_model:
            self.unet = torch.compile(self.unet)
        self.t = torch.tensor([0], device=dev)
        self.dev, self.dt = dev, dt
        self.det = cv2.FaceDetectorYN.create(str(MODELS / "yunet" / "face_detection_yunet_2023mar.onnx"), "", (SIZE, SIZE), 0.5)
        self.load_s = time.perf_counter() - t0
        self._hist = int(HISTORY_S * SAMPLE_RATE)
        self.reset()

    # ---- avatar ----
    def _box(self, img):
        """Square mouth-centred crop box in a 512 frame, from the YuNet face box."""
        _, f = self.det.detect(img)
        if f is None:
            return self._last_box
        x, y, w, h = f[0, :4]
        # YuNet's box ends at the mouth line. MuseTalk regenerates the lower half of its crop, so put the
        # crop's centre at the nose tip (landmark 3) and make it reach well below the mouth.
        nx, ny = f[0, 8], f[0, 9]
        s = int(h * 1.15)
        cx, cy = int(x + w / 2), int(ny)
        b = [max(cx - s // 2, 0), max(cy - s // 2, 0), min(cx + s // 2, SIZE), min(cy + s // 2, SIZE)]
        self._last_box = b
        return b

    @torch.no_grad()
    def _encode(self, img_bgr):
        x = torch.from_numpy(img_bgr[..., ::-1].copy()).to(self.dev).permute(2, 0, 1)[None].to(self.dt) / 127.5 - 1
        return self.vae.encode(x).latent_dist.mode() * self.vae.config.scaling_factor

    @torch.no_grad()
    def set_image(self, path, seed=42):
        frames = []
        if LOOP:
            bx, by, bs = map(int, LOOP_BOX.split(","))
            cap = cv2.VideoCapture(LOOP)
            src_fps = cap.get(cv2.CAP_PROP_FPS) or FPS
            raw = []
            while True:
                ok, fr = cap.read()
                if not ok:
                    break
                raw.append(cv2.resize(fr[by:by + bs, bx:bx + bs], (SIZE, SIZE), interpolation=cv2.INTER_AREA))
            # resample to 25 fps and ping-pong so the loop has no seam
            n = int(len(raw) * FPS / src_fps)
            raw = [raw[min(int(i * src_fps / FPS), len(raw) - 1)] for i in range(n)]
            frames = raw + raw[-2:0:-1]
        else:
            img = cv2.imread(str(path))
            frames = [cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA)]
        self._last_box = [160, 160, 352, 352]
        self.frames, self.boxes, self.latents, self.masks = [], [], [], []
        for fr in frames:
            b = self._box(fr)
            crop = cv2.resize(fr[b[1]:b[3], b[0]:b[2]], (256, 256), interpolation=cv2.INTER_LANCZOS4)
            masked = crop.copy()
            masked[128:] = 0
            self.latents.append(torch.cat([self._encode(masked), self._encode(crop)], 1))
            self.frames.append(fr)
            self.boxes.append(b)
            self.masks.append(self._mask(b[2] - b[0], b[3] - b[1]))
        self.latents = torch.cat(self.latents)
        self.reset()

    @staticmethod
    def _mask(w, h):
        """Feathered ellipse over the lower part of the crop: mouth, moustache, chin."""
        m = np.zeros((h, w), np.float32)
        cv2.ellipse(m, (w // 2, int(h * 0.72)), (int(w * 0.40), int(h * 0.27)), 0, 0, 360, 1.0, -1)
        k = max(3, int(w * 0.12) | 1)
        return cv2.GaussianBlur(m, (k, k), 0)[..., None]

    def reset(self):
        self._audio = np.zeros(self._hist, dtype=np.float32)
        self._idx = 0  # position in the avatar loop

    # ---- audio ----
    @torch.no_grad()
    def _features(self):
        """Whisper-tiny hidden states for the history buffer: [T50, 5 layers, 384]."""
        mel = self.fe(self._audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
        hs = self.whisper.encoder(mel.to(self.dev, self.dt), output_hidden_states=True).hidden_states
        feats = torch.stack(hs, dim=2)[0]  # [1500, 5, 384] for the padded 30 s
        return feats[: int(len(self._audio) / SAMPLE_RATE * 50)]

    @torch.no_grad()
    def step(self, pcm):
        assert len(pcm) == CHUNK_SAMPLES, len(pcm)
        self._audio = np.concatenate([self._audio[len(pcm):], pcm.astype(np.float32)])
        feats = self._features()  # [T, 5, 384], last row = newest audio
        T = feats.shape[0]
        # Frames for the window that ends LOOKAHEAD_S before the newest sample.
        end_feat = T - int(LOOKAHEAD_S * 50)
        windows = []
        for k in range(CHUNK_FRAMES):
            c = end_feat - 2 * (CHUNK_FRAMES - k)  # feature index of this frame's start
            w = feats[c - 4: c + 6]                # 10 x 5 x 384
            windows.append(w.reshape(-1, 384))      # 50 x 384
        audio = self.pe(torch.stack(windows))
        n = len(self.frames)
        ids = [(self._idx + k) % n for k in range(CHUNK_FRAMES)]
        self._idx = (self._idx + CHUNK_FRAMES) % n
        lat = self.unet(self.latents[ids], self.t, encoder_hidden_states=audio).sample
        img = self.vae.decode(lat / self.vae.config.scaling_factor).sample
        img = ((img.float() / 2 + 0.5).clamp(0, 1) * 255).permute(0, 2, 3, 1).byte().cpu().numpy()  # RGB
        out = np.empty((CHUNK_FRAMES, SIZE, SIZE, 3), np.uint8)
        for k, i in enumerate(ids):
            fr = self.frames[i][..., ::-1].astype(np.float32)
            x1, y1, x2, y2 = self.boxes[i]
            face = cv2.resize(img[k], (x2 - x1, y2 - y1), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
            m = self.masks[i]
            fr[y1:y2, x1:x2] = face * m + fr[y1:y2, x1:x2] * (1 - m)
            out[k] = fr.clip(0, 255).astype(np.uint8)
        return out
