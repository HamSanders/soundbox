"""Ditto (antgroup/ditto-talkinghead, Apache-2.0 code) behind the same FaceEngine interface as
spikes/realtime-face/engine.py: set_image(path), reset(), step(pcm_float32_16k) -> RGB frames.

Upstream is imported from a checkout outside the repo (see ditto_common.py); nothing is copied.
The streaming loop is a re-arrangement of upstream's stream_pipeline_online.py
(`_audio2motion_worker`), run synchronously instead of in six threads, with three changes:

1. Smaller steps. Upstream's online config makes one motion-diffusion call per 10 frames
   (overlap_v2=70 of a 80-frame window) and holds 10 frames back for cross-fading, so the first
   frame needs ~0.8 s of audio. Here a step is CLIP frames (default 5 = 0.2 s, overlap 75) and only
   FUSE frames (default 2) are held back. Video trails the audio by DELAY_FRAMES = 2 (HuBERT
   look-ahead) + FUSE frames; `delay_s` says how much, so a server can delay its audio to match.
2. Speed. The motion diffusion model's denoising step is captured in a CUDA graph (eager PyTorch
   on Windows spends most of its time launching kernels: 27 ms -> 3.9 ms per step), and the warp
   network and decoder run in fp16 on the GPU without the numpy round trip between them.
3. Output is the 512x512 face crop the renderer produces (like FlashHead's 512x512), not pasted
   back into the full portrait. Pass putback=True for upstream's paste-back.
"""
import copy
import os
import time

import numpy as np

import ditto_common as dc
import torch
from stream_pipeline_online import StreamSDK

SAMPLE_RATE = 16000
FPS = 25
SIZE = 512
FRAME_SAMPLES = SAMPLE_RATE // FPS                    # 640
CLIP = int(os.environ.get("DITTO_CLIP", 5))           # frames per motion-diffusion call
FUSE = int(os.environ.get("DITTO_FUSE", 2))           # frames held back for cross-fade
STEPS = int(os.environ.get("DITTO_STEPS", 10))        # denoising steps (upstream online: 10)
CHUNK_SAMPLES = CLIP * FRAME_SAMPLES                  # 3200 = 0.2 s at the defaults
LOOKAHEAD = 2                                         # HuBERT chunk (3, 5, 2): 2 future frames
DELAY_FRAMES = LOOKAHEAD + FUSE
HUBERT_CS = (3, 5, 2)
HUBERT_LEN = int(sum(HUBERT_CS) * 0.04 * SAMPLE_RATE) + 80   # 6480 samples per HuBERT call


class _GraphedPredict:
    """CUDA graph of LMDM.model_predictions (one denoising step, guidance included)."""

    def __init__(self, lmdm):
        self.f = lmdm.model_predictions
        seq, dim = lmdm.seq_frames, lmdm.motion_feat_dim
        self.x = torch.zeros(1, seq, dim, device="cuda")
        self.kp = torch.zeros(1, dim, device="cuda")
        self.aud = torch.zeros(1, seq, lmdm.audio_feat_dim, device="cuda")
        self.t = torch.zeros(1, dtype=torch.long, device="cuda")
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.no_grad(), torch.cuda.stream(s):
            for _ in range(3):
                self.f(self.x, self.kp, self.aud, self.t)
        torch.cuda.current_stream().wait_stream(s)
        self.g = torch.cuda.CUDAGraph()
        with torch.no_grad(), torch.cuda.graph(self.g):
            self.out = self.f(self.x, self.kp, self.aud, self.t)

    def __call__(self, x, cond_frame, cond, t):
        self.x.copy_(x); self.kp.copy_(cond_frame); self.aud.copy_(cond); self.t.copy_(t)
        self.g.replay()
        return self.out[0].clone(), self.out[1].clone()


class FaceEngine:
    def __init__(self, compile_model=False, compile_vae=False, putback=False, **_):
        t0 = time.perf_counter()
        sdk = StreamSDK(dc.CFG_PKL, dc.DATA_ROOT)   # loads every model; starts no threads
        self.sdk = sdk
        self.putback = putback
        if os.environ.get("DITTO_ORT_ARENA") != "default":
            # onnxruntime's default arena grows in powers of two; HuBERT (1.4 GB fp32) then holds
            # far more VRAM than it uses. Re-open the session with exact-size growth.
            import onnxruntime as ort
            hub = sdk.wav2feat.w2f.hubert.model
            path = hub.session._model_path
            hub.session = ort.InferenceSession(path, providers=[
                ("CUDAExecutionProvider", {"arena_extend_strategy": "kSameAsRequested"}), "CPUExecutionProvider"])
        lmdm = sdk.audio2motion.lmdm.model           # core.models.modules.LMDM (PyTorch)
        lmdm.model_predictions = _GraphedPredict(lmdm)
        self.warp = sdk.warp_f3d.warp_net.model.half()
        self.decoder = sdk.decode_f3d.decoder.model.half()
        torch.backends.cudnn.benchmark = True
        self.load_s = time.perf_counter() - t0
        self.delay_s = DELAY_FRAMES / FPS
        self.source_info = None

    # -- setup -------------------------------------------------------------------------------
    def set_image(self, path, seed=42):
        sdk = self.sdk
        kw = dict(sdk.default_kwargs)
        crop = {k: kw[k] for k in ("crop_scale", "crop_vx_ratio", "crop_vy_ratio", "crop_flag_do_rot")}
        info = sdk.avatar_registrar(str(path), max_dim=kw["max_size"], n_frames=-1, **crop)
        self.source_info = info
        sdk.condition_handler.setup(info, kw["emo"], eye_f0_mode=kw["eye_f0_mode"], ch_info=kw["ch_info"])
        self._kw = kw
        self._f_s = torch.from_numpy(info["f_s_lst"][0]).cuda().half()
        self._seed = seed
        self._hold = None
        self._still_cache = None
        self._still_cache = self._still()   # render the still portrait once per face, not per reset()
        self.reset()

    def reset(self):
        """Forget audio and motion state (new utterance, barge-in)."""
        sdk, kw, info = self.sdk, self._kw, self.source_info
        torch.manual_seed(self._seed); np.random.seed(self._seed)
        a2m = sdk.audio2motion
        overlap = a2m.lmdm.seq_frames - CLIP
        a2m.setup(sdk.condition_handler.x_s_info_0, overlap_v2=overlap, fix_kp_cond=kw["fix_kp_cond"],
                  fix_kp_cond_dim=kw["fix_kp_cond_dim"], sampling_timesteps=STEPS, online_mode=True,
                  v_min_max_for_clip=kw["v_min_max_for_clip"], smo_k_d=kw["smo_k_d"])
        a2m.lmdm.model.setup(STEPS)
        a2m.fuse_length = FUSE
        a2m.fuse_alpha = np.arange(FUSE, dtype=np.float32).reshape(1, -1, 1) / FUSE
        sdk.motion_stitch.setup(
            N_d=-1, use_d_keys=kw["use_d_keys"], relative_d=kw["relative_d"], drive_eye=kw["drive_eye"],
            delta_eye_arr=kw["delta_eye_arr"], delta_eye_open_n=kw["delta_eye_open_n"],
            fade_out_keys=kw["fade_out_keys"], fade_type=kw["fade_type"], flag_stitching=kw["flag_stitching"],
            is_image_flag=info["is_image_flag"], x_s_info=info["x_s_info_lst"][0], d0=None,
            ch_info=kw["ch_info"], overall_ctrl_info=copy.deepcopy(kw["overall_ctrl_info"]))
        # HuBERT input: 3 frames of past context, plus LOOKAHEAD frames so each step's newest audio
        # serves as the look-ahead of the block that ends LOOKAHEAD frames earlier.
        # (+80 samples: upstream's HuBERT window is 10 frames + 80 samples long.)
        self._audio = np.zeros((HUBERT_CS[0] + LOOKAHEAD) * FRAME_SAMPLES + 80, np.float32)
        # Upstream primes the feature buffer with HuBERT features of `overlap` frames of silence.
        self._feat = sdk.wav2feat.wav2feat(np.zeros(overlap * FRAME_SAMPLES, np.float32), sr=SAMPLE_RATE)
        self._cond_idx = -len(self._feat)
        self._res = None           # motion sequence so far, [1, n, 265]
        self._valid = None         # index in _res of the next frame to emit
        self._pending = np.zeros(0, np.float32)
        self._hold = getattr(self, "_still_cache", None)   # still portrait, repeated while the delay fills

    # -- streaming ---------------------------------------------------------------------------
    @torch.no_grad()
    def step(self, pcm, early=None):
        """pcm: float32 16 kHz, any multiple of CHUNK_SAMPLES (0.2 s by default).
        Returns uint8 [len(pcm)/640, 512, 512, 3]. Frame k shows audio from DELAY_FRAMES earlier;
        the first DELAY_FRAMES frames after reset() are the still portrait.

        early: optional callback, called once per call with the block's first frame (plus the still
        padding after reset()) as soon as it is rendered, before the other frames; those frames are then
        NOT in the return value. Lets a server ship audio + first frame ~4 renders (~85 ms) sooner.
        Pass pcm of exactly one block when using it."""
        self._early = early
        self._pending = np.concatenate([self._pending, pcm.astype(np.float32)])
        out = []
        while len(self._pending) >= CHUNK_SAMPLES:
            blk, self._pending = self._pending[:CHUNK_SAMPLES], self._pending[CHUNK_SAMPLES:]
            out.extend(self._step_block(blk))
        return np.stack(out) if out else np.zeros((0, SIZE, SIZE, 3), np.uint8)

    def _step_block(self, blk):
        sdk, a2m = self.sdk, self.sdk.audio2motion
        self._audio = np.concatenate([self._audio, blk])
        feats = []
        while len(self._audio) >= HUBERT_LEN:   # one HuBERT call per 5 frames
            feats.append(sdk.wav2feat(self._audio[:HUBERT_LEN], chunksize=HUBERT_CS))
            self._audio = self._audio[HUBERT_CS[1] * FRAME_SAMPLES:]
        self._feat = np.concatenate([self._feat] + feats)
        seq = a2m.seq_frames
        # the newest `seq` features form the window; one diffusion call per CLIP new frames
        n_new = sum(len(f) for f in feats)
        assert n_new == CLIP, (n_new, CLIP)
        window = self._feat[-seq:]
        start_idx = self._cond_idx + len(self._feat) - seq
        cond = sdk.condition_handler(window, start_idx)[None]
        self._res = a2m(cond, self._res)
        if self._valid is None:
            self._valid = seq - FUSE
            emit = self._res[:, seq - CLIP: seq - FUSE]
            sdk.motion_stitch.d0 = a2m.cvt_fmt(self._res[0:1])[0]
        else:
            emit = self._res[:, self._valid: self._valid + CLIP]
            self._valid += CLIP
        L = self._res.shape[1]
        if L > seq * 2:
            cut = L - seq * 2
            self._res = self._res[:, cut:]
            self._valid -= cut
        if len(self._feat) > seq * 2:
            cut = len(self._feat) - seq * 2
            self._feat = self._feat[cut:]
            self._cond_idx += cut
        infos = a2m.cvt_fmt(emit)
        pad = [self._still()] * (CLIP - len(infos))   # first block after reset: still face in front
        if self._early is not None:
            head = pad + self._render(infos[:1])
            self._early(head)
            self._early = None
            return self._render(infos[1:])
        return pad + self._render(infos)

    def _still(self):
        if self._hold is None:
            info = self.source_info
            from core.atomic_components.motion_stitch import transform_keypoint
            x_s = transform_keypoint(info["x_s_info_lst"][0])
            self._hold = self._render_kp([x_s], [x_s])[0]
        return self._hold

    def _render(self, x_d_infos):
        info = self.source_info
        x_s_info = info["x_s_info_lst"][0]
        xs, xd = [], []
        for x_d_info in x_d_infos:
            x_s, x_d = self.sdk.motion_stitch(x_s_info, x_d_info)
            xs.append(x_s); xd.append(x_d)
        return self._render_kp(xs, xd)

    def _render_kp(self, xs, xd, batch=4):
        frames = []
        for i in range(0, len(xs), batch):
            ks = torch.from_numpy(np.concatenate(xs[i:i + batch])).cuda().half()
            kd = torch.from_numpy(np.concatenate(xd[i:i + batch])).cuda().half()
            f = self._f_s.expand(len(ks), -1, -1, -1, -1)
            img = self.decoder(self.warp(f, ks, kd))
            img = (img.float().clamp(0, 1) * 255).round().byte().permute(0, 2, 3, 1).cpu().numpy()
            if self.putback:
                info = self.source_info
                img = [self.sdk.putback(info["img_rgb_lst"][0], im.astype(np.float32), info["M_c2o_lst"][0])
                       for im in img]
            frames.extend(list(img))
        return frames
