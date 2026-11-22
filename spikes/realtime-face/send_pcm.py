"""Test client: stream a WAV to the face server's PCM socket in small chunks, the way a TTS would.

  python send_pcm.py --rate 48000 --chunk-ms 160 --speed 4      # like the voice spike: 160 ms chunks, 4x real time
  python send_pcm.py --utterance-s 6 --gap-s 3 --total-s 300    # 6 s sentences with 3 s pauses for 5 minutes
"""
import argparse
import socket
import time

import librosa
import numpy as np

import engine as E

ap = argparse.ArgumentParser()
ap.add_argument("--audio", default=str(E.UPSTREAM / "examples" / "podcast_sichuan_16k.wav"))
ap.add_argument("--rate", type=int, default=16000, help="must match the server's --input-rate")
ap.add_argument("--chunk-ms", type=int, default=160)
ap.add_argument("--speed", type=float, default=1.0, help="x real time; 0 = as fast as the socket takes it")
ap.add_argument("--utterance-s", type=float, default=0, help="split into utterances this long (0 = one utterance)")
ap.add_argument("--gap-s", type=float, default=2.0, help="silence between utterances (nothing is sent)")
ap.add_argument("--total-s", type=float, default=20)
ap.add_argument("--port", type=int, default=17661)
args = ap.parse_args()

pcm, _ = librosa.load(args.audio, sr=args.rate, mono=True)
pcm = (np.clip(pcm, -1, 1) * 32767).astype("<i2")
n = args.rate * args.chunk_ms // 1000
utt = int(args.rate * args.utterance_s) or len(pcm)
pos, t_end = 0, time.time() + args.total_s
while time.time() < t_end:
    s = socket.create_connection(("127.0.0.1", args.port))
    seg = pcm[pos : pos + utt]
    pos = (pos + utt) % max(1, len(pcm) - utt)
    t0 = time.time()
    sent = 0
    for i in range(0, len(seg), n):
        s.sendall(seg[i : i + n].tobytes())
        sent = i + n
        if args.speed:
            time.sleep(max(0, t0 + (i + n) / args.rate / args.speed - time.time()))
        if time.time() > t_end:
            break
    s.close()  # end of utterance
    print(f"sent {min(sent, len(seg)) / args.rate:.1f}s utterance in {time.time() - t0:.1f}s", flush=True)
    if not args.utterance_s:
        break
    # wait for the utterance to finish playing, then pause
    time.sleep(max(0, len(seg) / args.rate - (time.time() - t0)) + args.gap_s)
