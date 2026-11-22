#!/usr/bin/env bash
# Start one call pod on a STOCK RunPod image, with nothing built locally:
#   image   runpod/pytorch:2.2.0-rc.229-cu1290-torch290-ubuntu2404 (torch 2.9 / CUDA 12.9 / Python 3.12)
#   args    bash -c 'echo $START | base64 -d > /start.sh; bash /start.sh > /workspace/start.log 2>&1'
#   env     START=<base64 of this file>, CODE_REPO, CODE_REF, LLM_*, POD_SECRET, POD_ADMIN_TOKEN
#   ports   8080/http  → https://<podId>-8080.proxy.runpod.net
# Weights go to /workspace (mount a network volume there and restarts skip the download).
# Same pins as the Dockerfile, which stays as the later CI-built image for fast cold starts.
set -euo pipefail
T0=$(date +%s); stamp() { echo "[$(( $(date +%s) - T0 ))s] $*"; }
W=/workspace; mkdir -p $W
CODE_REPO="${CODE_REPO:-https://github.com/HamSanders/soundbox}"
CODE_REF="${CODE_REF:-spike/realtime-call-pod}"
AUDIOCPP_VERSION=v0.9.5
NODE_VERSION=24.12.0; NODE_SHA256=bdebee276e58d0ef5448f3d5ac12c67daa963dd5e0a9bb621a53d1cefbc852fd
GGUF_REV=5140b027d3c416e5e3719002f98f09a196e0db6a
MUSETALK_COMMIT=2536eaf06b85f775d8e04b7fd81bf6699155a58d
MUSETALK_REV=c9ac4cdcedcae22c186fbbf67261961e246c4760
SDVAE_REV=31f26fdeee1355a5c34592e401dd41e45d25a493
WHISPER_REV=169d4a4341b33bc18d8881c4b69c2e104e1cc0af
YUNET_SHA256=8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4

stamp "apt"
apt-get update -qq && apt-get install -y -qq --no-install-recommends curl xz-utils git libgomp1 libgl1 libglib2.0-0 >/dev/null

if ! command -v node >/dev/null || [ "$(node --version)" != "v$NODE_VERSION" ]; then
  stamp "node $NODE_VERSION"
  cd /tmp && curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  echo "$NODE_SHA256  node-v$NODE_VERSION-linux-x64.tar.xz" | sha256sum -c - >/dev/null
  tar -xJf node-*.tar.xz -C /usr/local --strip-components=1 && rm node-*.tar.xz
fi

if [ ! -x /opt/audiocpp/audiocpp_server ]; then
  stamp "audio.cpp $AUDIOCPP_VERSION"
  mkdir -p /opt/audiocpp && cd /tmp
  for f in bin-ubuntu-x64-cuda12.8-colab cudart-ubuntu-x64-cuda12.8; do
    curl -fsSL "https://github.com/0xShug0/audio.cpp/releases/download/$AUDIOCPP_VERSION/audio-$AUDIOCPP_VERSION-$f.tar.gz" | tar -xz -C /opt/audiocpp --strip-components=1
  done
fi

stamp "pip (torch comes with the image: $(python3 -c 'import torch;print(torch.__version__)'))"
pip install -q numpy==2.5.4 scipy==1.18.1 opencv-python-headless==5.1.0.95 aiohttp==3.14.5 \
  diffusers==0.39.0 transformers==4.57.3 accelerate==1.16.0 safetensors==0.8.0 einops==0.8.2 \
  "huggingface_hub[hf_transfer]==0.36.2"

stamp "code $CODE_REPO@$CODE_REF"
rm -rf /src && git clone -q --depth 1 --branch "$CODE_REF" "$CODE_REPO" /src
S=/src/spikes
[ -d $W/musetalk-upstream ] || { git clone -q --filter=blob:none --no-checkout https://github.com/TMElyralab/MuseTalk $W/musetalk-upstream && git -C $W/musetalk-upstream checkout -q $MUSETALK_COMMIT; }
mkdir -p /opt/musetalk && ln -sfn $W/musetalk-upstream /opt/musetalk/upstream
(cd $S/realtime-voice && npm ci --omit=dev --no-audit --no-fund --silent)

stamp "weights (cached on $W)"
export HF_HUB_ENABLE_HF_TRANSFER=1
python3 - <<EOF
from huggingface_hub import hf_hub_download as get
A, M = "$W/models/audiocpp", "$W/models/musetalk"
for f in ["VoxCPM2-GGUF/voxcpm2-q8_0.gguf", "Nemotron-3.5-ASR-Streaming-0.6B-GGUF/nemotron-3.5-asr-streaming-0.6b-q8_0.gguf"]:
    get("audio-cpp/audio.cpp-gguf", f, revision="$GGUF_REV", local_dir=A)
for f in ["musetalkV15/unet.pth", "musetalkV15/musetalk.json"]:
    get("TMElyralab/MuseTalk", f, revision="$MUSETALK_REV", local_dir=M)
for f in ["config.json", "diffusion_pytorch_model.safetensors"]:
    get("stabilityai/sd-vae-ft-mse", f, revision="$SDVAE_REV", local_dir=M + "/sd-vae")
for f in ["config.json", "preprocessor_config.json", "pytorch_model.bin"]:
    get("openai/whisper-tiny", f, revision="$WHISPER_REV", local_dir=M + "/whisper")
EOF
mkdir -p $W/models/musetalk/yunet
Y=$W/models/musetalk/yunet/face_detection_yunet_2023mar.onnx
[ -f $Y ] || curl -fsSL -o $Y https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
echo "$YUNET_SHA256  $Y" | sha256sum -c - >/dev/null
[ -f $W/models/audiocpp/silero_vad.onnx ] || curl -fsSL -o $W/models/audiocpp/silero_vad.onnx https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx
ln -sfn $W/models/musetalk /opt/musetalk/models

# Portraits: none are in the public repo (provenance not cleared). FACES_URL = a tarball of PNGs, or put
# them in $W/faces yourself. Without any, the face server has nothing to animate, so it fails loudly.
mkdir -p /opt/faces $W/faces
if [ -n "${FACES_URL:-}" ] && [ -z "$(ls $W/faces/*.png 2>/dev/null)" ]; then curl -fsSL "$FACES_URL" | tar -xz -C $W/faces; fi
cp $W/faces/*.png /opt/faces/ 2>/dev/null || true

# One portrait inline (base64 JPEG/PNG in FACE_B64, named FACE_NAME) for a test pod without a FACES_URL.
if [ -n "${FACE_B64:-}" ]; then
  echo "$FACE_B64" | base64 -d > /tmp/face_in && python3 -c "import cv2,sys; cv2.imwrite(sys.argv[2], cv2.imread(sys.argv[1]))" /tmp/face_in "/opt/faces/${FACE_NAME:-face}.png"
fi

# No hosted LLM key? LOCAL_LLM=ollama runs a small model in the pod (OpenAI-compatible on :11434).
# A test convenience: it costs ~2-3 GB of VRAM and is not the production setup.
if [ "${LOCAL_LLM:-}" = "ollama" ]; then
  stamp "ollama"
  command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh >/dev/null
  export OLLAMA_MODELS=$W/ollama OLLAMA_KEEP_ALIVE=-1
  (ollama serve > /tmp/ollama.log 2>&1 &)
  for i in $(seq 1 60); do curl -fs http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done
  ollama pull "${LOCAL_LLM_MODEL:-qwen2.5:3b}" >/dev/null
  export LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_MODEL="${LOCAL_LLM_MODEL:-qwen2.5:3b}" LLM_API_KEY=ollama
fi

# Same layout and env as the Dockerfile, so entrypoint.sh runs unchanged.
mkdir -p /app && for d in realtime-voice realtime-face realtime-pod; do ln -sfn $S/$d /app/$d; done
export LD_LIBRARY_PATH=/opt/audiocpp SPIKE_AUDIOCPP_SERVER=/opt/audiocpp/audiocpp_server MIRLI_AUDIOCPP_BACKEND=cuda \
  SPIKE_MODELS_DIR=$W/models/audiocpp MIRLI_MUSETALK_HOME=/opt/musetalk SPIKE_DIR=/tmp/mirli-call \
  MIRLI_FACE_HOME=/tmp/mirli-face LLM_PROVIDER=openai POD_PORT=8080 PYTHONUNBUFFERED=1
# Remote callers: 384 px at JPEG 70 is ~23 KB a frame (~4.6 Mbit/s) against ~80 KB (16) at 512/92.
export FACE_JPEG="${FACE_JPEG:-70}" FACE_OUT_SIZE="${FACE_OUT_SIZE:-384}"
stamp "setup done; starting servers"
exec bash /app/realtime-pod/entrypoint.sh
