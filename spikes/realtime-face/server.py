"""Real-time talking face server (spike).

  PCM in  : TCP 127.0.0.1:17661, raw mono s16le at --input-rate (default 16000). No framing.
            Closing the connection, or 250 ms without data, ends the utterance.
  Browser : http://127.0.0.1:17660/  (WebSocket /ws carries audio + JPEG frames per 0.96 s chunk)
  Control : POST /flush (barge-in: drop everything queued), GET /stats
  Engine  : GET /engine, POST /engine {"name": "flashhead"|"ditto"} restarts this server on the other model
            (each lives in its own venv; only one fits beside the voice stack on a 16 GB card)
  Faces   : GET /faces (list), GET /faces/<id> (image), POST /faces (upload, raw image body),
            GET|POST /face (current portrait; POST {"id": ...} switches it, ~0.5 s, no restart)

The model works in fixed steps of 24 frames = 0.96 s of audio, so that is the unit everywhere.
"""
import argparse
import asyncio
import json
import struct
import subprocess
import threading
import hashlib
import os
import time
from pathlib import Path

import cv2
import numpy as np
from aiohttp import web, WSMsgType, ClientSession
from scipy.signal import resample_poly

import importlib.util
import socket
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from call_router import Busy, CallRouter  # noqa: E402
import call_token  # noqa: E402

SPIKES = Path(__file__).resolve().parent.parent
ENGINES = {
    # name: (engine.py, python of its venv, what to call it in the page)
    "flashhead": (SPIKES / "realtime-face" / "engine.py",
                  Path(os.environ.get("MIRLI_FACE_HOME", Path.home() / "mirli-spike-face")) / "venv" / "Scripts" / "python.exe",
                  "FlashHead Lite"),
    "ditto": (SPIKES / "realtime-face-ditto" / "engine.py",
              Path(os.environ.get("MIRLI_DITTO_HOME", Path.home() / "mirli-spike-ditto")) / "venv" / "Scripts" / "python.exe",
              "Ditto"),
    "musetalk": (SPIKES / "realtime-face" / "musetalk_engine.py",
                 Path(os.environ.get("MIRLI_FACE_HOME", Path.home() / "mirli-spike-face")) / "venv" / "Scripts" / "python.exe",
                 "MuseTalk 1.5"),
    "pro": (SPIKES / "realtime-face" / "engine.py",
            Path(os.environ.get("MIRLI_FACE_HOME", Path.home() / "mirli-spike-face")) / "venv" / "Scripts" / "python.exe",
            "FlashHead Pro"),
    # No model: draws the portrait with a level bar. For tests and machines without the weights.
    "fake": (SPIKES / "realtime-face" / "fake_engine.py", Path(sys.executable), "Test pattern"),
}
ENGINES["lite"] = ENGINES["flashhead"]  # older name, still used by run scripts
_pre = argparse.ArgumentParser(add_help=False)
_pre.add_argument("--engine", default=os.environ.get("FACE_ENGINE", "flashhead"), choices=list(ENGINES))
ENGINE = _pre.parse_known_args()[0].engine
_path = ENGINES[ENGINE][0]
sys.path.insert(0, str(_path.parent))
_spec = importlib.util.spec_from_file_location("face_engine", _path)
E = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(E)
if not hasattr(E, "CHUNK_FRAMES"):
    E.CHUNK_FRAMES = E.CHUNK_SAMPLES * E.FPS // E.SAMPLE_RATE
if ENGINE == "pro":  # Wan VAE: 5 motion frames, 28 new frames (1.12 s) per step
    E.MOTION_FRAMES, E.CHUNK_FRAMES = 5, 28
    E.CHUNK_SAMPLES = E.CHUNK_FRAMES * E.SAMPLE_RATE // E.FPS

ap = argparse.ArgumentParser()
ap.add_argument("--engine", default=ENGINE, choices=list(ENGINES))
ap.add_argument("--no-fast-first", dest="fast_first", action="store_false",
                help="Ditto: send the first lip-synced frame before the rest of its block (default on)")
ap.add_argument("--wait-port", action="store_true", help="wait for the HTTP port to be free (used when switching engine)")
ap.add_argument("--image", default=str(Path(os.environ.get("MIRLI_FACE_HOME", Path.home() / "mirli-spike-face")) / "upstream" / "SoulX-FlashHead" / "examples" / "girl.png"))
ap.add_argument("--input-rate", type=int, default=16000, help="sample rate of the PCM socket (48000 for the voice spike)")
ap.add_argument("--http-port", type=int, default=17660)
ap.add_argument("--pcm-port", type=int, default=17661)
ap.add_argument("--tap", default=None, help="also subscribe to the voice spike's WebSocket tap, e.g. ws://127.0.0.1:17650/tap")
ap.add_argument("--no-idle", action="store_true", help="do not generate silent 'listening' motion between utterances")
ap.add_argument("--max-lead", type=float, default=3.0, help="stop generating when this many seconds are already queued for playback")
ap.add_argument("--compile", action="store_true")
ap.add_argument("--jpeg-quality", type=int, default=int(os.environ.get("FACE_JPEG", 92)))
ap.add_argument("--out-size", type=int, default=int(os.environ.get("FACE_OUT_SIZE", 0)),
                help="downscale frames to this many pixels square before JPEG (0 = as generated); bandwidth for remote callers")
ap.add_argument("--log", default=None, help="append one JSON line per chunk and per browser report")
args = ap.parse_args()

# Portraits you can switch between. Uploads live outside the repo, beside the weights.
FACES = Path(os.environ.get("MIRLI_FACE_HOME", Path.home() / "mirli-spike-face")) / "faces"
FACES.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD = 15 * 1024 * 1024


def face_id_for(path):
    return Path(path).stem


def seed_faces():
    """Make sure the starting portrait (--image) is in the list."""
    src = Path(args.image)
    dst = FACES / (src.stem + ".png")
    if not dst.exists():
        img = cv2.imread(str(src))
        if img is not None:
            cv2.imwrite(str(dst), img)
    return dst.stem


current_face = seed_faces()
pending_face = None   # set by POST /face, applied by the engine thread between steps

CHUNK_S = E.CHUNK_FRAMES / E.FPS
IN_CHUNK = args.input_rate * E.CHUNK_FRAMES // E.FPS  # input samples per model step
assert IN_CHUNK * E.FPS == args.input_rate * E.CHUNK_FRAMES, "input rate must give a whole number of samples per model step"
# Engines whose frames trail their audio (Ditto: look-ahead + cross-fade) say by how much; the
# audio sent with each step is held back by the same amount so lips and sound line up.
DELAY_IN = int(round(getattr(E, "delay_s", 0.0) * args.input_rate))
hold = np.zeros(DELAY_IN, dtype=np.int16)
IDLE_LEAD_S = 0.7      # generate an idle chunk when less than this is queued in the browser
END_OF_UTTERANCE_S = 0.25

lock = threading.Lock()
wake = threading.Event()
pcm_in = np.zeros(0, dtype=np.int16)   # audio waiting to be turned into frames
last_rx = 0.0                           # when PCM last arrived
utter_t0 = None                         # arrival time of the first sample of an utterance, until its first chunk is taken
in_utterance = False
flush_gen = 0                           # bumped by /flush; a step started before the bump is discarded
play_head = 0.0                         # wall-clock time at which everything sent so far has finished playing
router = CallRouter()   # which socket gets the frames: the active call's only (call_router.py)
SECRET = call_token.local_secret()   # None = auth off (old spike pages)
ORIGINS = call_token.allowed_origins()
tap_call = None         # the call whose speech the tap follows; None = the server-wide tap
tap_changed = None      # asyncio.Event, set when tap_call changes
engine_ready = False
loop = None
log_f = open(args.log, "a") if args.log else None
stats = {"chunks": 0, "speech_chunks": 0, "idle_chunks": 0, "step_ms": [], "first_frame_ms": [], "vram_mib": [],
         "browser": []}


def log(obj):
    if log_f:
        log_f.write(json.dumps(obj) + "\n")
        log_f.flush()


def feed(samples):
    """Thread-safe: append int16 mono samples at args.input_rate."""
    global pcm_in, last_rx, utter_t0, in_utterance
    with lock:
        if not in_utterance:
            in_utterance, utter_t0 = True, time.time()
        pcm_in = np.concatenate([pcm_in, samples])
        last_rx = time.time()
    wake.set()


def flush():
    global pcm_in, utter_t0, in_utterance, flush_gen, play_head, hold
    with lock:
        hold = np.zeros(DELAY_IN, dtype=np.int16)
        pcm_in = np.zeros(0, dtype=np.int16)
        utter_t0, in_utterance = None, False
        flush_gen += 1
        play_head = 0.0
    broadcast(json.dumps({"type": "flush"}))


def broadcast(msg):
    """Send to the active call's socket only (the name is kept from the spike, where it really did broadcast)."""
    async def _send():
        for ws in router.targets():
            try:
                await (ws.send_bytes(msg) if isinstance(msg, bytes) else ws.send_str(msg))
            except Exception:
                pass
    if loop:
        asyncio.run_coroutine_threadsafe(_send(), loop)


def take_chunk():
    """Returns (int16 chunk at input rate, kind, t0) or None if there is nothing to do yet."""
    global pcm_in, utter_t0, in_utterance
    now = time.time()
    with lock:
        queued = play_head - now
        if queued > args.max_lead:
            return None
        if len(pcm_in) >= IN_CHUNK:
            chunk, pcm_in = pcm_in[:IN_CHUNK], pcm_in[IN_CHUNK:]
            t0, utter_t0 = utter_t0, None
            return chunk, "speech", t0
        if in_utterance and now - last_rx > END_OF_UTTERANCE_S:
            in_utterance = False
            if len(pcm_in):
                chunk = np.concatenate([pcm_in, np.zeros(IN_CHUNK - len(pcm_in), dtype=np.int16)])
                pcm_in = np.zeros(0, dtype=np.int16)
                t0, utter_t0 = utter_t0, None
                return chunk, "speech", t0
        if not args.no_idle and router.busy and len(pcm_in) == 0 and queued < IDLE_LEAD_S:
            return np.zeros(IN_CHUNK, dtype=np.int16), "idle", None
    return None


def engine_thread():
    global play_head, current_face, pending_face, hold
    kw = {} if ENGINE == "ditto" else {"model_type": "lite" if ENGINE == "flashhead" else ENGINE}
    eng = E.FaceEngine(compile_model=args.compile, compile_vae=args.compile, **kw)
    # MuseTalk keeps its look-ahead on the engine object, Ditto on the module (DELAY_IN above);
    # hold the audio back by whichever one applies, never both.
    delay_n = 0 if DELAY_IN else int(round(getattr(eng, "delay_s", 0) * args.input_rate))
    delay_buf = np.zeros(delay_n, dtype=np.int16)
    last_flush = flush_gen
    eng.set_image(FACES / f"{current_face}.png")
    for _ in range(2):  # warm-up: the first step is ~1.5 s slower (cuDNN autotune, allocator)
        eng.step(np.zeros(E.CHUNK_SAMPLES, dtype=np.float32))
    eng.reset()
    global engine_ready
    engine_ready = True  # GET /stats reports it; the call pod's /readyz waits on it
    print(f"engine: {ENGINE}", flush=True)
    print(f"ready: model loaded in {eng.load_s:.1f}s, http://127.0.0.1:{args.http_port}/  pcm tcp :{args.pcm_port} "
          f"({args.input_rate} Hz s16le mono)", flush=True)
    enc = [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality]
    seq = 0
    while True:
        if pending_face is not None:
            want, pending_face = pending_face, None
            t = time.time()
            flush()
            eng.set_image(FACES / f"{want}.png")
            current_face = want
            print(f"face -> {want} in {time.time() - t:.2f}s", flush=True)
            broadcast(json.dumps({"type": "face", "id": want}))
        job = take_chunk()
        if job is None:
            wake.wait(0.02)
            wake.clear()
            continue
        chunk, kind, t0 = job
        gen = flush_gen
        if gen != last_flush:  # barge-in: the held-back tail belongs to the old utterance
            delay_buf[:] = 0
            last_flush = gen
        if delay_n:
            both = np.concatenate([delay_buf, chunk])
            chunk, delay_buf = both[:len(chunk)], both[len(chunk):]
        t_start = time.time()
        f32 = chunk.astype(np.float32) / 32768.0
        if args.input_rate != E.SAMPLE_RATE:
            f32 = resample_poly(f32, E.SAMPLE_RATE, args.input_rate).astype(np.float32)
        sent = {"audio": False, "frames": 0, "t_send": None}

        def send(frames, final):
            # The first message of a chunk carries its audio; a later one (cont) carries only frames
            # that belong to the same chunk, starting at frame index `start_i`.
            global hold, play_head
            nonlocal chunk
            if args.out_size:
                frames = [cv2.resize(f, (args.out_size, args.out_size), interpolation=cv2.INTER_AREA) for f in frames]
            jpegs = [cv2.imencode(".jpg", cv2.cvtColor(f, cv2.COLOR_RGB2BGR), enc)[1].tobytes() for f in frames]
            if gen != flush_gen:
                return False  # barge-in happened while this was generating
            if not sent["audio"]:
                if DELAY_IN:
                    both = np.concatenate([hold, chunk])
                    chunk, hold = both[:len(chunk)], both[len(chunk):]
                t_send = time.time()
                with lock:
                    play_head = max(play_head, t_send) + CHUNK_S
                head = {"type": "chunk", "seq": seq, "kind": kind, "rate": args.input_rate, "fps": E.FPS,
                        "samples": len(chunk), "frames": [len(j) for j in jpegs], "t_audio0": t0, "t_send": t_send}
                pcm = chunk.tobytes()
                sent["audio"], sent["t_send"] = True, t_send
            else:
                head = {"type": "chunk", "cont": True, "seq": seq, "start_i": sent["frames"], "fps": E.FPS,
                        "samples": 0, "frames": [len(j) for j in jpegs]}
                pcm = b""
            h = json.dumps(head).encode()
            broadcast(struct.pack("<I", len(h)) + h + pcm + b"".join(jpegs))
            sent["frames"] += len(frames)
            return True

        early = (lambda fr: send(fr, False)) if args.fast_first and ENGINE == "ditto" else None
        frames = eng.step(f32, early=early) if early else eng.step(f32)
        t_gen = time.time()
        if not send(frames, True) and gen != flush_gen:
            continue
        t_send = sent["t_send"]
        rec = {"ev": "chunk", "seq": seq, "kind": kind, "step_ms": round((t_gen - t_start) * 1000, 1),
               "jpeg_ms": round(max(0.0, t_send - t_gen) * 1000, 1), "t": t_send}
        if t0 is not None:
            rec["audio_to_send_ms"] = round((t_send - t0) * 1000, 1)
            stats["first_frame_ms"].append(rec["audio_to_send_ms"])
        stats["chunks"] += 1
        stats[kind + "_chunks"] += 1
        stats["step_ms"] = (stats["step_ms"] + [rec["step_ms"]])[-500:]
        log(rec)
        seq += 1


def vram_thread():
    while True:
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=5).stdout.strip()
            stats["vram_mib"] = (stats["vram_mib"] + [int(out.splitlines()[0])])[-3600:]
            log({"ev": "vram", "mib": stats["vram_mib"][-1], "t": time.time()})
        except Exception:
            pass
        time.sleep(1)


async def pcm_client(reader, writer):
    odd = b""
    try:
        while data := await reader.read(65536):
            data = odd + data
            n = len(data) // 2 * 2
            odd = data[n:]
            feed(np.frombuffer(data[:n], dtype="<i2"))
    finally:
        writer.close()


def tap_url(base, call):
    """The voice worker's tap for one call (?call=<id>), or the server-wide tap when call is None."""
    if call is None:
        return base
    return base + ("&" if "?" in base else "?") + "call=" + call


async def tap_client(base):
    """Subscribe to the voice worker's tap: binary = PCM, text = JSON events (flush = barge-in).
    Follows the active call: when it changes, reconnect to that call's tap so only its speech is lip-synced."""
    while True:
        call = tap_call
        if SECRET and call is None:
            await tap_changed.wait()   # with auth on there is no server-wide tap to follow; wait for a call
            tap_changed.clear()
            continue
        url = tap_url(base, call)
        headers = {}
        if SECRET:
            headers["Authorization"] = "Bearer " + call_token.sign({"call": call or "face", "aud": ["tap"]}, SECRET, 60)
        tap_changed.clear()
        watcher = None
        try:
            async with ClientSession() as s, s.ws_connect(url, max_msg_size=0, headers=headers) as ws:
                print("tap connected:", url, flush=True)
                watcher = asyncio.create_task(_close_on_change(ws, call))
                async for m in ws:
                    if m.type == WSMsgType.BINARY:
                        feed(np.frombuffer(m.data[: len(m.data) // 2 * 2], dtype="<i2"))
                    elif m.type == WSMsgType.TEXT:
                        ev = json.loads(m.data)
                        if ev.get("type") == "flush":
                            flush()
                        elif ev.get("type") == "format" and ev.get("sample_rate", args.input_rate) != args.input_rate:
                            print(f"WARNING: tap is {ev.get('sample_rate')} Hz but --input-rate is {args.input_rate}", flush=True)
        except Exception as e:
            print("tap:", e, flush=True)
        if watcher:
            watcher.cancel()
        if tap_call == call:
            await asyncio.sleep(2)


async def _close_on_change(ws, call):
    while tap_call == call:
        await tap_changed.wait()
        tap_changed.clear()
    await ws.close()


def follow_call(call):
    """Point the tap at this call (None = the server-wide tap)."""
    global tap_call
    if tap_call != call:
        tap_call = call
        if tap_changed is not None:
            tap_changed.set()


def _who(request, aud):
    """(call, admin) for a request, or raises an HTTP error. Without a secret: legacy, call from ?call= or None."""
    origin = request.headers.get("Origin")
    if ORIGINS and origin and origin not in ORIGINS:
        raise web.HTTPForbidden(text="origin not allowed")
    if not SECRET:
        return request.query.get("call"), True
    tok = call_token.token_from_headers(request.headers)
    if not tok:
        raise web.HTTPUnauthorized(text="token required")
    try:
        p = call_token.verify(tok, SECRET, aud=aud)
    except call_token.TokenError as e:
        raise web.HTTPUnauthorized(text=str(e))
    auds = p["aud"] if isinstance(p["aud"], list) else [p["aud"]]
    return p["call"], "admin" in auds


def require(request, aud="face"):
    if SECRET:
        _who(request, aud)


_anon = 0


async def ws_handler(request):
    global _anon
    call, _ = _who(request, "face")
    explicit = call is not None   # a real call id (token, or ?call= on an open server): follow its own tap
    if call is None:
        _anon += 1
        call = f"anon-{_anon}"
    ws = web.WebSocketResponse(max_msg_size=0, protocols=(call_token.WS_PROTOCOL,))
    await ws.prepare(request)
    try:
        replaced, switched = router.attach(call, ws)
    except Busy:
        # Close codes 4000-4999 are ours: 4409 = this face is serving another call.
        await ws.close(code=4409, message=b"busy: this face is on another call")
        return ws
    if replaced is not None:
        await replaced.close(code=4000, message=b"replaced by a newer connection for this call")
    if switched:
        flush()  # nothing the previous call queued may reach this one
        follow_call(call if explicit else None)
    wake.set()
    try:
        async for m in ws:
            if m.type == WSMsgType.TEXT:
                rep = json.loads(m.data)
                rep["ev"] = "browser"
                stats["browser"] = (stats["browser"] + [rep])[-3600:]
                log(rep)
    finally:
        if router.detach(call, ws):
            flush()
            follow_call(None)
    return ws


async def end_handler(request):
    """POST /internal/calls/{id}/end (admin token): the Call API hung up this call."""
    _, admin = _who(request, "admin")
    if not admin:
        raise web.HTTPForbidden(text="admin token required")
    call = request.match_info["id"]
    ws = router.end(call)
    if ws is not None:
        flush()
        follow_call(None)
        await ws.close(code=4001, message=b"call ended")
    return web.json_response({"ended": ws is not None})


async def readyz_handler(_request):
    return web.json_response({"ready": engine_ready, "busy": router.busy, "engine": ENGINE, "auth": bool(SECRET)})


async def flush_handler(request):
    require(request)
    flush()
    return web.json_response({"ok": True})


async def stats_handler(_request):
    s = stats["step_ms"]
    v = stats["vram_mib"]
    return web.json_response({
        "engine": ENGINE, "ready": engine_ready, "chunks": stats["chunks"], "speech_chunks": stats["speech_chunks"], "idle_chunks": stats["idle_chunks"],
        "step_ms_median": float(np.median(s)) if s else None,
        "gen_fps": E.CHUNK_FRAMES / (float(np.median(s)) / 1000) if s else None,
        "audio_to_send_ms": stats["first_frame_ms"][-20:],
        "vram_mib_now": v[-1] if v else None, "vram_mib_peak": max(v) if v else None,
        "browser_last": stats["browser"][-1] if stats["browser"] else None,
    })


def list_faces():
    files = sorted(FACES.glob("*.png"), key=lambda p: p.stat().st_mtime)
    return [{"id": p.stem, "name": p.stem.split("-")[0]} for p in files]


async def faces_handler(_request):
    return web.json_response({"faces": list_faces(), "current": current_face})


async def face_image_handler(request):
    fid = request.match_info["id"]
    p = FACES / f"{fid}.png"
    if "/" in fid or "\\" in fid or not p.exists():
        raise web.HTTPNotFound()
    return web.FileResponse(p)


async def upload_handler(request):
    require(request)
    body = await request.read()
    if not body or len(body) > MAX_UPLOAD:
        raise web.HTTPBadRequest(text="send one image, up to 15 MB")
    img = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise web.HTTPBadRequest(text="not an image cv2 can read (png, jpg, webp, bmp)")
    # Centre-crop to a square and store at 512, as the model will see it. X-Crop: "x,y,size" picks the
    # square instead (an avatar pack's talk-still faceBox, so the live face pastes back exactly there).
    h, w = img.shape[:2]
    crop = request.headers.get("X-Crop", "")
    try:
        x, y, side = (int(v) for v in crop.split(",")) if crop else (0, 0, 0)
    except ValueError:
        raise web.HTTPBadRequest(text="X-Crop must be x,y,size")
    if side <= 0 or x < 0 or y < 0 or x + side > w or y + side > h:
        side = min(h, w)
        y, x = (h - side) // 2, (w - side) // 2
    img = cv2.resize(img[y:y + side, x:x + side], (512, 512), interpolation=cv2.INTER_AREA)
    name = "".join(c for c in request.headers.get("X-Name", "photo") if c.isalnum())[:24] or "photo"
    fid = f"{name}-{hashlib.sha1(body + crop.encode()).hexdigest()[:8]}"
    cv2.imwrite(str(FACES / f"{fid}.png"), img)
    return web.json_response({"id": fid})


async def face_handler(request):
    global pending_face
    if request.method == "POST":
        require(request)
        fid = (await request.json()).get("id", "")
        if not (FACES / f"{fid}.png").exists() or "/" in fid or "\\" in fid:
            raise web.HTTPNotFound(text="no such face")
        pending_face = fid
        wake.set()
    return web.json_response({"current": current_face, "pending": pending_face})


@web.middleware
async def cors(request, handler):
    # The call page is served by the voice server on another port.
    origin = request.headers.get("Origin")
    if request.method == "OPTIONS":
        resp = web.Response()
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as e:
            resp = e
    if ORIGINS:
        if origin in ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
    else:
        resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Name, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


async def index(_request):
    return web.FileResponse(Path(__file__).parent / "web" / "index.html")


def _port_free(port):
    with socket.socket() as so:
        try:
            so.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


switching = None


async def engine_handler(request):
    """GET: which model is loaded. POST {"name"}: restart this server on the other model."""
    global switching
    info = {"current": ENGINE, "switching": switching,
            "available": [{"id": k, "name": v[2], "installed": v[1].exists() and v[0].exists()} for k, v in ENGINES.items()]}
    if request.method == "GET":
        return web.json_response(info)
    require(request, "admin")
    name = (await request.json()).get("name", "")
    if name not in ENGINES:
        raise web.HTTPBadRequest(text="unknown engine")
    if name == ENGINE:
        return web.json_response(info)
    py = ENGINES[name][1]
    if not py.exists():
        raise web.HTTPBadRequest(text=f"{ENGINES[name][2]} is not installed ({py})")
    switching = name
    argv = [a for a in sys.argv[1:]]
    if "--engine" in argv:
        i = argv.index("--engine"); del argv[i:i + 2]
    argv = [x for x in argv if not x.startswith("--engine=") and x != "--wait-port"]
    cmd = [str(py), str(Path(__file__).resolve()), "--engine", name, "--image", str(FACES / f"{current_face}.png"), "--wait-port"] +           [x for i, x in enumerate(argv) if not (x == "--image" or (i and argv[i - 1] == "--image"))]
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    log_path = Path(__file__).resolve().parent / "results" / "server.log"
    subprocess.Popen(cmd, cwd=str(Path(__file__).resolve().parent), stdout=open(log_path, "a"), stderr=subprocess.STDOUT,
                     creationflags=flags, close_fds=True)
    broadcast(json.dumps({"type": "engine", "switching": name}))
    print(f"switching engine -> {name}; exiting", flush=True)
    loop.call_later(0.4, lambda: os._exit(0))
    return web.json_response({**info, "switching": name})


async def main():
    global loop
    if args.wait_port:
        for _ in range(150):
            if _port_free(args.http_port) and _port_free(args.pcm_port):
                break
            await asyncio.sleep(0.2)
    loop = asyncio.get_running_loop()
    global tap_changed
    tap_changed = asyncio.Event()
    threading.Thread(target=vram_thread, daemon=True).start()
    threading.Thread(target=engine_thread, daemon=True).start()
    await asyncio.start_server(pcm_client, "127.0.0.1", args.pcm_port)
    if args.tap:
        asyncio.create_task(tap_client(args.tap))
    app = web.Application(middlewares=[cors], client_max_size=MAX_UPLOAD + 1024)
    app.add_routes([web.get("/", index), web.get("/ws", ws_handler), web.post("/flush", flush_handler),
                    web.get("/stats", stats_handler), web.get("/faces", faces_handler),
                    web.post("/faces", upload_handler), web.get("/faces/{id}", face_image_handler),
                    web.get("/face", face_handler), web.post("/face", face_handler),
                    web.get("/engine", engine_handler), web.post("/engine", engine_handler),
                    web.get("/readyz", readyz_handler), web.post("/internal/calls/{id}/end", end_handler),
                    web.options("/{tail:.*}", lambda r: web.Response())])
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", args.http_port).start()
    await asyncio.Event().wait()


asyncio.run(main())
