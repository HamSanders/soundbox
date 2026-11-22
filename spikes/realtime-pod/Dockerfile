# One Mirli real-time call per RunPod Pod: voice server (Node) + audio.cpp ASR/TTS + MuseTalk face server,
# behind pod.mjs on one port. The LLM is external (any OpenAI-compatible URL, set at pod create).
#
#   build (context = spikes/):  docker build -f realtime-pod/Dockerfile -t mirli-call-pod:dev .
#   run:                        see README.md (needs --gpus all; FACE=0 for a voice-only pod)
#
# Everything that could drift between builds is pinned: base image digest, audio.cpp release, Node tarball
# sha256, pip versions, Hugging Face revisions, the MuseTalk commit and the YuNet file hash.
# Base: same CUDA 12.8 runtime image (and digest) as ~/mirli-gpu-worker's RunPod images, checked 2026-11-21.
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04@sha256:ebef3c171eeef0298e4eb2e4be843105edf3b8b0ac45e0b43acee358e8046867

ARG AUDIOCPP_VERSION=v0.9.5
ARG NODE_VERSION=24.12.0
ARG NODE_SHA256=bdebee276e58d0ef5448f3d5ac12c67daa963dd5e0a9bb621a53d1cefbc852fd
# audio-cpp/audio.cpp-gguf: the same revision the gpu worker bakes (VoxCPM2 q8, Nemotron 3.5 ASR q8).
ARG GGUF_REV=5140b027d3c416e5e3719002f98f09a196e0db6a
ARG MUSETALK_COMMIT=2536eaf06b85f775d8e04b7fd81bf6699155a58d
ARG MUSETALK_REV=c9ac4cdcedcae22c186fbbf67261961e246c4760
ARG SDVAE_REV=31f26fdeee1355a5c34592e401dd41e45d25a493
ARG WHISPER_REV=169d4a4341b33bc18d8881c4b69c2e104e1cc0af
ARG YUNET_SHA256=8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4

ENV DEBIAN_FRONTEND=noninteractive PIP_BREAK_SYSTEM_PACKAGES=1 PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates curl xz-utils git libgomp1 libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Node, for the voice server and pod.mjs.
RUN cd /tmp && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  node-v${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c - \
 && tar -xJf node-*.tar.xz -C /usr/local --strip-components=1 && rm node-*.tar.xz && node --version

# audio.cpp: prebuilt CUDA 12.8 server + its CUDA runtime libraries (same release as the gpu worker).
RUN mkdir -p /opt/audiocpp && cd /tmp \
 && curl -fsSLO "https://github.com/0xShug0/audio.cpp/releases/download/${AUDIOCPP_VERSION}/audio-${AUDIOCPP_VERSION}-bin-ubuntu-x64-cuda12.8-colab.tar.gz" \
 && curl -fsSLO "https://github.com/0xShug0/audio.cpp/releases/download/${AUDIOCPP_VERSION}/audio-${AUDIOCPP_VERSION}-cudart-ubuntu-x64-cuda12.8.tar.gz" \
 && tar -xzf audio-*-bin-*.tar.gz -C /opt/audiocpp --strip-components=1 \
 && tar -xzf audio-*-cudart-*.tar.gz -C /opt/audiocpp --strip-components=1 \
 && rm -f /tmp/*.tar.gz && test -x /opt/audiocpp/audiocpp_server

# Python for the face server. torch cu128 wheels carry their own CUDA libs (Ada 4090 and Blackwell 5090).
RUN pip3 install --index-url https://download.pytorch.org/whl/cu128 torch==2.7.1 \
 && pip3 install numpy==2.5.4 scipy==1.18.1 opencv-python-headless==5.1.0.95 aiohttp==3.14.5 \
      diffusers==0.39.0 transformers==4.57.3 accelerate==1.16.0 safetensors==0.8.0 \
      "huggingface_hub[hf_xet]==0.36.2" einops==0.8.2

# MuseTalk upstream: only musetalk/models/unet.py is imported (PositionalEncoding). MIT.
RUN git clone --filter=blob:none --no-checkout https://github.com/TMElyralab/MuseTalk /opt/musetalk/upstream \
 && cd /opt/musetalk/upstream && git checkout -q ${MUSETALK_COMMIT} && rm -rf .git

# ---- weights (baked: no network volume, no download at start) ----
ENV SPIKE_MODELS_DIR=/models/audiocpp MIRLI_MUSETALK_HOME=/opt/musetalk
RUN python3 - <<EOF
from huggingface_hub import hf_hub_download as get
g, r = "audio-cpp/audio.cpp-gguf", "${GGUF_REV}"
for f in ["VoxCPM2-GGUF/voxcpm2-q8_0.gguf",
          "Nemotron-3.5-ASR-Streaming-0.6B-GGUF/nemotron-3.5-asr-streaming-0.6b-q8_0.gguf"]:
    get(g, f, revision=r, local_dir="/models/audiocpp")
EOF
RUN python3 - <<EOF
from huggingface_hub import hf_hub_download as get
M = "/opt/musetalk/models"
for f in ["musetalkV15/unet.pth", "musetalkV15/musetalk.json"]:
    get("TMElyralab/MuseTalk", f, revision="${MUSETALK_REV}", local_dir=M)
for f in ["config.json", "diffusion_pytorch_model.safetensors"]:
    get("stabilityai/sd-vae-ft-mse", f, revision="${SDVAE_REV}", local_dir=M + "/sd-vae")
for f in ["config.json", "preprocessor_config.json", "pytorch_model.bin"]:
    get("openai/whisper-tiny", f, revision="${WHISPER_REV}", local_dir=M + "/whisper")
EOF
RUN mkdir -p /opt/musetalk/models/yunet && cd /opt/musetalk/models/yunet \
 && curl -fsSL -o face_detection_yunet_2023mar.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
 && echo "${YUNET_SHA256}  face_detection_yunet_2023mar.onnx" | sha256sum -c - \
 && curl -fsSL -o /models/audiocpp/silero_vad.onnx https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx \
 && find /models /opt/musetalk/models -name .cache -type d -prune -exec rm -rf {} + \
 && rm -rf /root/.cache/huggingface

# ---- code (last, so a code change doesn't re-download anything) ----
COPY realtime-voice/package.json realtime-voice/package-lock.json /app/realtime-voice/
RUN cd /app/realtime-voice && npm ci --omit=dev --no-audit --no-fund
COPY realtime-voice/server.mjs realtime-voice/setup.mjs /app/realtime-voice/
COPY realtime-voice/lib/ /app/realtime-voice/lib/
COPY realtime-voice/public/ /app/realtime-voice/public/
COPY realtime-face/server.py realtime-face/musetalk_engine.py /app/realtime-face/
COPY realtime-face/web/ /app/realtime-face/web/
# Portraits offered on the call page. Gitignored in the repo: realtime-pod/build.sh copies them in.
COPY realtime-pod/faces/ /opt/faces/
COPY realtime-pod/pod.mjs realtime-pod/entrypoint.sh /app/realtime-pod/

ENV LD_LIBRARY_PATH=/opt/audiocpp \
    SPIKE_AUDIOCPP_SERVER=/opt/audiocpp/audiocpp_server \
    MIRLI_AUDIOCPP_BACKEND=cuda \
    SPIKE_DIR=/tmp/mirli-call \
    MIRLI_FACE_HOME=/tmp/mirli-face \
    LLM_PROVIDER=openai \
    POD_PORT=8080 \
    PYTHONUNBUFFERED=1
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=180s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
WORKDIR /app
CMD ["bash", "/app/realtime-pod/entrypoint.sh"]
