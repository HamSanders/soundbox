"""Thin wrapper around SoulX-FlashHead Lite: one portrait + 0.96 s audio chunks in, 24 video frames out.

The chunk loop follows upstream's `generate_video.py --audio_encode_mode stream`
(https://github.com/Soul-AILab/SoulX-FlashHead, Apache-2.0). Upstream code is imported
from a checkout outside this repo; nothing of it is copied here except the few lines of
audio-window indexing in `_audio_embedding`.
"""
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch

HOME = Path(os.environ.get("MIRLI_FACE_HOME", Path.home() / "mirli-spike-face"))
UPSTREAM = HOME / "upstream" / "SoulX-FlashHead"
MODELS = HOME / "models"

SAMPLE_RATE = 16000      # Hz, mono; what wav2vec2 expects
FPS = 25
FRAME_NUM = 33           # frames the model denoises per step
# Lite (LTX VAE, 8x temporal stride). The server is Lite-only and uses these module constants.
MOTION_FRAMES = 9        # overlap re-encoded from the previous step
CHUNK_FRAMES = FRAME_NUM - MOTION_FRAMES          # 24 new frames per step
CHUNK_SAMPLES = CHUNK_FRAMES * SAMPLE_RATE // FPS  # 15360 samples = 0.96 s
# Pro (Wan VAE, 4x temporal stride): 5 motion frames, 28 new frames = 1.12 s per step.
MOTION_FRAMES_BY_MODEL = {"lite": 9, "pro": 5}
SIZE = 512
AUDIO_CONTEXT_S = 8      # seconds of audio history wav2vec2 sees
SAMPLE_STEPS = int(os.environ.get("FACE_STEPS", 6))   # denoising steps: more = cleaner mouth, slower
SAMPLE_SHIFT = 5
COLOR_CORRECTION = 1.0


class FaceEngine:
    def __init__(self, compile_model=False, compile_vae=False, model_type="lite"):
        self.motion_frames = MOTION_FRAMES_BY_MODEL[model_type]
        self.chunk_frames = FRAME_NUM - self.motion_frames
        self.chunk_samples = self.chunk_frames * SAMPLE_RATE // FPS
        sys.path.insert(0, str(Path(__file__).parent / "shims"))
        sys.path.insert(1, str(UPSTREAM))
        import flash_head.src.pipeline.flash_head_pipeline as fp

        fp.COMPILE_MODEL = compile_model
        fp.COMPILE_VAE = compile_vae
        # Upstream loads the checkpoint into system RAM as fp32 and casts afterwards; with little
        # free RAM that died with an access violation here. Load straight to the GPU as bf16 instead.
        _orig = fp.WanModelAudioProject.from_pretrained
        fp.WanModelAudioProject.from_pretrained = lambda d: _orig(
            d, torch_dtype=torch.bfloat16, low_cpu_mem_usage=True, device_map="cuda")
        t0 = time.perf_counter()
        self.pipe = fp.FlashHeadPipeline(
            checkpoint_dir=str(MODELS / "SoulX-FlashHead-1_3B-bf16"),  # made by convert_bf16.py
            model_type=model_type,
            wav2vec_dir=str(MODELS / "wav2vec2-base-960h"),
            device="cuda",
        )
        self.pipe.rank = 1  # upstream prints per-step timings when rank == 0
        self.load_s = time.perf_counter() - t0
        self._audio = np.zeros(SAMPLE_RATE * AUDIO_CONTEXT_S, dtype=np.float32)
        self._end = AUDIO_CONTEXT_S * FPS
        self._start = self._end - FRAME_NUM
        self._taps = (torch.arange(5) - 2).unsqueeze(0)

    def set_image(self, path, seed=42):
        self.pipe.prepare_params(
            cond_image_path_or_dir=str(path),
            target_size=(SIZE, SIZE),
            frame_num=FRAME_NUM,
            motion_frames_num=self.motion_frames,
            sampling_steps=SAMPLE_STEPS,
            seed=seed,
            shift=SAMPLE_SHIFT,
            color_correction_strength=COLOR_CORRECTION,
            use_face_crop=os.environ.get("FACE_CROP") == "1",  # zoom in on the face: more pixels for the mouth
        )
        self.reset()

    def reset(self):
        """Forget audio history and motion state (new utterance after a barge-in)."""
        self._audio[:] = 0
        self.pipe.reset_person_name()

    def _audio_embedding(self):
        emb = self.pipe.preprocess_audio(self._audio, sr=SAMPLE_RATE, fps=FPS)
        idx = torch.arange(self._start, self._end).unsqueeze(1) + self._taps
        idx = torch.clamp(idx, min=0, max=self._end - 1)
        return emb[idx][None, ...].contiguous()

    @torch.no_grad()
    def step(self, pcm):
        """pcm: float32 [-1, 1], exactly chunk_samples long (15360 for Lite). Returns uint8 [24, 512, 512, 3] RGB."""
        assert len(pcm) == self.chunk_samples, len(pcm)
        self._audio = np.concatenate([self._audio[len(pcm):], pcm.astype(np.float32)])
        sample = self.pipe.generate(self._audio_embedding().to("cuda"))
        frames = ((sample + 1) / 2).permute(1, 2, 3, 0).clip(0, 1) * 255
        return frames[self.motion_frames:].to(torch.uint8).cpu().numpy()
