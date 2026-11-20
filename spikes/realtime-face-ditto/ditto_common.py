"""Shared setup for the Ditto spike: paths, the Cython-blend shim, and the safe cfg loader.

Upstream (antgroup/ditto-talkinghead @ c3e47ee) lives in $MIRLI_DITTO_HOME/upstream, weights in
$MIRLI_DITTO_HOME/checkpoints. No upstream file is modified.
"""
import os
import pickle
import sys
import types

import numpy as np

HOME = os.environ.get("MIRLI_DITTO_HOME", os.path.expanduser("~/mirli-spike-ditto"))
UPSTREAM = os.path.join(HOME, "upstream")
DATA_ROOT = os.path.join(HOME, "checkpoints", "ditto_pytorch")
CFG_PKL = os.path.join(HOME, "checkpoints", "ditto_cfg", "v0.4_hubert_cfg_pytorch.pkl")

# Settings taken from upstream's own online (TensorRT) cfg, v0.4_hubert_cfg_trt_online.pkl.
ONLINE_KWARGS = dict(online_mode=True, overlap_v2=70, sampling_timesteps=10)


def _install():
    import torch  # noqa: F401  loads the CUDA/cuDNN DLLs onnxruntime-gpu needs on Windows

    if UPSTREAM not in sys.path:
        sys.path.insert(0, UPSTREAM)
    # upstream blends with a pyximport Cython module (needs a C compiler); same maths in numpy.
    def blend_images_cy(mask_warped, frame_warped, frame_rgb, result):
        m = mask_warped[..., None]
        np.copyto(result, np.clip(m * frame_warped + (1 - m) * frame_rgb, 0, 255).astype(np.uint8))

    mod = types.ModuleType("core.utils.blend")
    mod.blend_images_cy = blend_images_cy
    sys.modules["core.utils.blend"] = mod

    # upstream unpickles its cfg with plain pickle; only allow numpy reconstruction.
    class _NumpyOnly(pickle.Unpickler):
        def find_class(self, module, name):
            if not module.startswith("numpy"):
                raise pickle.UnpicklingError(f"refusing {module}.{name}")
            return super().find_class(module, name)

    import core.atomic_components.cfg as cfg

    def load_pkl(p):
        with open(p, "rb") as f:
            return _NumpyOnly(f).load()

    cfg.load_pkl = load_pkl


_install()


class FrameSink:
    """Stands in for upstream's video writer; keeps frames and the time each arrived."""

    def __init__(self, on_frame=None):
        import time
        self._time = time.perf_counter
        self.frames, self.times = [], []
        self.on_frame = on_frame

    def __call__(self, img, fmt="rgb"):
        t = self._time()
        self.frames.append(img.copy())
        self.times.append(t)
        if self.on_frame:
            self.on_frame(img, t)

    def close(self):
        pass
