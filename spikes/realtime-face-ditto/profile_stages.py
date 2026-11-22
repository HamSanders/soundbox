"""Times each stage of Ditto's pipeline (single-threaded calls) on one portrait. Prints ms per call."""
import os, sys, time, collections
import ditto_common as dc
import numpy as np, torch, librosa
from stream_pipeline_online import StreamSDK
img, wav = sys.argv[1], sys.argv[2]
SDK = StreamSDK(dc.CFG_PKL, dc.DATA_ROOT)
T = collections.defaultdict(list)
def wrap(obj, name, label):
    cls = type(obj); f = getattr(cls, name)
    def g(*a, **k):
        torch.cuda.synchronize(); t = time.perf_counter(); r = f(*a, **k); torch.cuda.synchronize()
        T[label].append((time.perf_counter() - t) * 1000); return r
    setattr(cls, name, g)
wrap(SDK.wav2feat.w2f.hubert, "__call__", "hubert per 5-frame chunk")
wrap(SDK.audio2motion, "__call__", "lmdm per call")
wrap(SDK.motion_stitch, "__call__", "stitch per frame")
wrap(SDK.warp_f3d, "__call__", "warp per frame")
wrap(SDK.decode_f3d, "__call__", "decode per frame")
wrap(SDK.putback, "__call__", "putback per frame")
print("ORT providers:", SDK.wav2feat.w2f.hubert.model.session.get_providers())
audio, _ = librosa.load(wav, sr=16000); audio = audio[:16000*6]
for run in range(2):
    T.clear()
    SDK.setup(img, os.path.abspath("results/_tmp.mp4"), **dc.ONLINE_KWARGS); SDK.writer.close(); SDK.writer = dc.FrameSink()
    SDK.setup_Nd(N_d=150)
    cs = (3, 5, 2); a = np.concatenate([np.zeros(1920, np.float32), audio]); sl = 6480
    for i in range(0, len(a), 3200):
        c = a[i:i+sl]; c = np.pad(c, (0, sl-len(c))); SDK.run_chunk(c, cs)
    SDK.close()
for k, v in T.items():
    print(f"{k:28s} n={len(v):4d} median={np.median(v):7.1f} ms  p95={np.percentile(v,95):7.1f}")
print("frame shape", SDK.writer.frames[0].shape)
