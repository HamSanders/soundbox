"""One-off (`python convert_bf16.py [lite|pro]`): rewrite the DiT checkpoint from fp32 (6.1 GB) to bf16 (3.05 GB).

The pipeline casts the model to bf16 anyway, so results are unchanged; the smaller file
halves load-time RAM. Reads tensor by tensor with plain file I/O (no mmap), because
safetensors' copy-on-write mapping of the full file failed on a machine short of commit.
"""
import json
import shutil
import struct

import numpy as np
import torch
from safetensors.torch import save_file

import engine as E

src = E.MODELS / "SoulX-FlashHead-1_3B"
dst = E.MODELS / "SoulX-FlashHead-1_3B-bf16"
import sys
variant = sys.argv[1] if len(sys.argv) > 1 else "lite"
MODEL, VAE = {"lite": ("Model_Lite", "VAE_LTX"), "pro": ("Model_Pro", "VAE_Wan")}[variant]
(dst / MODEL).mkdir(parents=True, exist_ok=True)
shutil.copy(src / MODEL / "config.json", dst / MODEL / "config.json")
if not (dst / VAE).exists():
    shutil.copytree(src / VAE, dst / VAE)

out = {}
with open(src / MODEL / "diffusion_pytorch_model.safetensors", "rb") as f:
    n = struct.unpack("<Q", f.read(8))[0]
    header = json.loads(f.read(n))
    meta = header.pop("__metadata__", None)
    for name, info in header.items():
        assert info["dtype"] == "F32", (name, info["dtype"])
        a, b = info["data_offsets"]
        f.seek(8 + n + a)
        buf = np.frombuffer(f.read(b - a), dtype="<f4").reshape(info["shape"])
        out[name] = torch.from_numpy(buf.copy()).to(torch.bfloat16)
save_file(out, str(dst / MODEL / "diffusion_pytorch_model.safetensors"), metadata=meta)
print("wrote", dst, len(out), "tensors")
