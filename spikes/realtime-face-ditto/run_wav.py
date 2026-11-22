"""Portrait + WAV -> MP4 with Ditto (PyTorch weights), printing timings.

  python run_wav.py --image face.png --wav speech.wav --out results/x.mp4 [--mode online|offline]
                    [--speed 1]   # online: how fast audio "arrives" (1 = real time, 0 = all at once)

Online mode is upstream's streaming path (inference.py's chunk loop) with upstream's online settings.
"""
import argparse, json, math, os, subprocess, threading, time

import ditto_common as dc  # noqa: F401  (installs shims first)
import librosa
import numpy as np
from stream_pipeline_offline import StreamSDK as OfflineSDK
from stream_pipeline_online import StreamSDK as OnlineSDK

ap = argparse.ArgumentParser()
ap.add_argument("--image", required=True)
ap.add_argument("--wav", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--mode", default="online")
ap.add_argument("--seconds", type=float, default=0)
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--steps", type=int, default=0, help="override diffusion steps")
args = ap.parse_args()

vram = []
stop = threading.Event()
def sample_vram():
    while not stop.is_set():
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True).stdout.strip()
        vram.append(int(out.splitlines()[0]))
        time.sleep(0.5)
threading.Thread(target=sample_vram, daemon=True).start()
time.sleep(1.2)
vram_before = vram[0]

t_load = time.perf_counter()
SDK = (OnlineSDK if args.mode == "online" else OfflineSDK)(dc.CFG_PKL, dc.DATA_ROOT)
import torch
print(f"load {time.perf_counter()-t_load:.1f}s")

audio, _ = librosa.load(args.wav, sr=16000)
if args.seconds:
    audio = audio[: int(args.seconds * 16000)]
num_f = math.ceil(len(audio) / 16000 * 25)

def one_run(tag):
    kw = dict(dc.ONLINE_KWARGS) if args.mode == "online" else {}
    if args.steps:
        kw["sampling_timesteps"] = args.steps
    tmp = os.path.abspath(args.out)
    t_setup = time.perf_counter()
    SDK.setup(args.image, tmp, **kw)
    setup_s = time.perf_counter() - t_setup
    SDK.writer.close()  # drop upstream's mp4 writer; keep frames in memory
    sink = SDK.writer = dc.FrameSink()
    SDK.setup_Nd(N_d=num_f)
    t0 = time.perf_counter()
    if args.mode == "online":
        cs = (3, 5, 2)
        a = np.concatenate([np.zeros(cs[0] * 640, np.float32), audio])
        split_len = int(sum(cs) * 0.04 * 16000) + 80
        for i in range(0, len(a), cs[1] * 640):
            chunk = a[i:i + split_len]
            if args.speed > 0:  # wait until this chunk's last real sample would have arrived
                avail = min(i + split_len - cs[0] * 640, len(audio)) / 16000 / args.speed
                d = t0 + avail - time.perf_counter()
                if d > 0: time.sleep(d)
            if len(chunk) < split_len:
                chunk = np.pad(chunk, (0, split_len - len(chunk)))
            SDK.run_chunk(chunk, cs)
    else:
        SDK.audio2motion_queue.put(SDK.wav2feat.wav2feat(audio))
    SDK.close()
    t_end = time.perf_counter()
    ts = np.array(sink.times) - t0
    n = len(ts)
    gaps = np.diff(ts[n // 4:]) if n > 8 else np.array([0])
    res = dict(tag=tag, mode=args.mode, frames=n, audio_s=len(audio) / 16000, setup_s=round(setup_s, 2),
               total_s=round(t_end - t0, 2), fps_overall=round(n / (t_end - t0), 1),
               fps_steady=round(1 / np.median(gaps), 1) if gaps.size and np.median(gaps) > 0 else None,
               first_frame_s=round(float(ts[0]), 3),
               torch_peak_gb=round(torch.cuda.max_memory_allocated() / 2**30, 2),
               torch_reserved_gb=round(torch.cuda.max_memory_reserved() / 2**30, 2))
    if args.mode == "online" and args.speed > 0:
        # lateness of frame k against when it is due if playback starts with the first audio sample
        late = ts - np.arange(n) / 25.0
        res["frame_lateness_s"] = dict(min=round(float(late.min()), 3), median=round(float(np.median(late)), 3),
                                       max=round(float(late.max()), 3))
    return res, sink

res, _ = one_run("warmup")
print(json.dumps(res))
res, sink = one_run("measured")
stop.set()
res["vram_before_mib"] = vram_before
res["vram_peak_mib"] = max(vram)
res["vram_delta_gb"] = round((max(vram) - vram_before) / 1024, 2)
print(json.dumps(res))

import imageio
tmp = args.out + ".noaudio.mp4"
w = imageio.get_writer(tmp, fps=25, codec="libx264", ffmpeg_params=["-crf", "18"], macro_block_size=2)
for f in sink.frames:
    w.append_data(f)
w.close()
import imageio_ffmpeg
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", "-i", tmp, "-i", args.wav,
                "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", args.out], check=True)
os.remove(tmp)
with open(os.path.splitext(args.out)[0] + ".summary.json", "w") as f:
    json.dump(res, f, indent=1)
print(args.out)
