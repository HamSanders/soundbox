"""Stream a WAV through engine.FaceEngine the way server.py would, paced like live audio, and time it.

  python run_engine.py --image face.png --wav speech.wav --out results/x.mp4 [--speed 1] [--seconds 12]

speed 1 = audio arrives in real time, CHUNK_SAMPLES at a time; 4 = a TTS running 4x real time;
0 = all at once. Prints a JSON summary (also written next to the mp4).
"""
import argparse, json, os, subprocess, threading, time

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--image", required=True)
ap.add_argument("--wav", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--seconds", type=float, default=0)
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--putback", action="store_true")
args = ap.parse_args()

vram, stop = [], threading.Event()
def sample_vram():
    while not stop.is_set():
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True).stdout
        vram.append(int(out.split()[0]))
        time.sleep(0.5)
threading.Thread(target=sample_vram, daemon=True).start()
time.sleep(1.2)
vram_before = vram[0]

import engine as E
import librosa, torch

eng = E.FaceEngine(putback=args.putback)
t = time.perf_counter(); eng.set_image(args.image); set_image_s = time.perf_counter() - t
for _ in range(3):
    eng.step(np.zeros(E.CHUNK_SAMPLES, np.float32))
audio, _ = librosa.load(args.wav, sr=E.SAMPLE_RATE)
if args.seconds:
    audio = audio[: int(args.seconds * E.SAMPLE_RATE)]
audio = np.concatenate([audio, np.zeros((-len(audio)) % E.CHUNK_SAMPLES + E.DELAY_FRAMES * 640, np.float32)])

t = time.perf_counter(); eng.reset(); reset_s = time.perf_counter() - t
frames, step_ms, frame_ready = [], [], []
t0 = time.perf_counter()
for i in range(0, len(audio), E.CHUNK_SAMPLES):
    if args.speed > 0:
        d = t0 + (i + E.CHUNK_SAMPLES) / E.SAMPLE_RATE / args.speed - time.perf_counter()
        if d > 0:
            time.sleep(d)
    ts = time.perf_counter()
    f = eng.step(audio[i:i + E.CHUNK_SAMPLES])
    te = time.perf_counter()
    step_ms.append((te - ts) * 1000)
    frames.extend(f)
    frame_ready.extend([te - t0] * len(f))
stop.set()

D = E.DELAY_FRAMES
ready = np.array(frame_ready[D:])                 # frame k shows audio frame k
due = np.arange(len(ready)) / E.FPS                # when that audio would be heard if played on arrival
step_ms = np.array(step_ms[1:])
res = dict(clip=E.CLIP, fuse=E.FUSE, steps=E.STEPS, chunk_s=E.CHUNK_SAMPLES / E.SAMPLE_RATE,
           delay_s=eng.delay_s, speed=args.speed, audio_s=round(len(audio) / E.SAMPLE_RATE, 2),
           frames=len(frames), load_s=round(eng.load_s, 1), set_image_s=round(set_image_s, 2),
           reset_s=round(reset_s, 2),
           step_ms_median=round(float(np.median(step_ms)), 1), step_ms_p95=round(float(np.percentile(step_ms, 95)), 1),
           gen_fps=round(E.CLIP / (np.median(step_ms) / 1000), 1),
           first_audio_to_first_frame_s=round(float(ready[0]), 3),
           lateness_vs_audio_s=dict(median=round(float(np.median(ready - due)), 3), max=round(float((ready - due).max()), 3)),
           torch_peak_gb=round(torch.cuda.max_memory_allocated() / 2**30, 2),
           torch_reserved_gb=round(torch.cuda.max_memory_reserved() / 2**30, 2),
           vram_before_mib=vram_before, vram_peak_mib=max(vram), vram_delta_gb=round((max(vram) - vram_before) / 1024, 2))
print(json.dumps(res))

import imageio, imageio_ffmpeg
tmp = args.out + ".noaudio.mp4"
w = imageio.get_writer(tmp, fps=E.FPS, codec="libx264", ffmpeg_params=["-crf", "18"], macro_block_size=2)
for f in frames[D:]:                               # drop the delay so lips line up with the WAV
    w.append_data(f)
w.close()
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", "-i", tmp, "-i", args.wav, "-map", "0:v",
                "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", args.out], check=True)
os.remove(tmp)
with open(os.path.splitext(args.out)[0] + ".summary.json", "w") as fh:
    json.dump(res, fh, indent=1)
print(args.out)
