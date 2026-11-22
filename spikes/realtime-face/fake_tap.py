"""Stand-in for the voice spike's `ws://127.0.0.1:17650/tap`, built from its hand-over note, to test `server.py --tap`.

Sends what the note describes: a `format` event on connect, then per sentence a `start` event, 48 kHz mono
s16le PCM in 7680-sample (160 ms) binary frames at ~4x real time, and an `end` event. With --flush-after N it
sends a `flush` (barge-in) N seconds into the second sentence. It is not the real server.
"""
import argparse
import asyncio
import json

import librosa
import numpy as np
from aiohttp import web

import engine as E

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=17650)
ap.add_argument("--sentence-s", type=float, default=5)
ap.add_argument("--gap-s", type=float, default=2)
ap.add_argument("--sentences", type=int, default=3)
ap.add_argument("--flush-after", type=float, default=0)
args = ap.parse_args()

RATE, N = 48000, 7680
pcm, _ = librosa.load(str(E.UPSTREAM / "examples" / "podcast_sichuan_16k.wav"), sr=RATE, mono=True)
pcm = (np.clip(pcm, -1, 1) * 32767).astype("<i2")


async def tap(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    await ws.send_str(json.dumps({"type": "format", "sample_rate": RATE, "channels": 1, "encoding": "pcm_s16le"}))
    await asyncio.sleep(3)
    per = int(RATE * args.sentence_s)
    for k in range(args.sentences):
        seg = pcm[k * per : (k + 1) * per]
        await ws.send_str(json.dumps({"type": "start", "turn": 1, "utterance": k, "text": f"sentence {k}"}))
        for i in range(0, len(seg), N):
            await ws.send_bytes(seg[i : i + N].tobytes())
            await asyncio.sleep(N / RATE / 4)
        await ws.send_str(json.dumps({"type": "end", "turn": 1, "utterance": k}))
        if k == 1 and args.flush_after:
            await asyncio.sleep(args.flush_after)
            await ws.send_str(json.dumps({"type": "flush"}))
            print("sent flush", flush=True)
        await asyncio.sleep(args.sentence_s * 0.75 + args.gap_s)
    await ws.close()
    return ws


app = web.Application()
app.add_routes([web.get("/tap", tap)])
web.run_app(app, host="127.0.0.1", port=args.port, print=None)
