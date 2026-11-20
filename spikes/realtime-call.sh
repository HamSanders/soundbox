#!/usr/bin/env bash
# Start the voice spike and the face spike together on one GPU, then open
# http://127.0.0.1:17650 and press "Start call". With the face server up the
# call becomes a video call; without it (FACE=0) it stays a voice call.
#
# The LLM runs on the CPU by default so the face model fits on a 16 GB card
# beside speech-to-text and TTS. LLM_GPU_LAYERS=99 puts it back on the GPU.
set -e
cd "$(dirname "$0")"
export LLM_GPU_LAYERS="${LLM_GPU_LAYERS:-0}"
(cd realtime-voice && ./restart.sh)
if [ "${FACE:-1}" != "0" ]; then
  (cd realtime-face && ./restart.sh call --input-rate 48000 --tap ws://127.0.0.1:17650/tap ${FACE_IMAGE:+--image "$FACE_IMAGE"} "$@")
fi
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
echo "open http://127.0.0.1:17650"
# Change the person: FACE_IMAGE=path/to/portrait.png ./realtime-call.sh
# Use the PC2 LLM: LLM_PROVIDER=openai LLM_BASE_URL=http://127.0.0.1:17663/v1 LLM_MODEL=local LLM_NO_THINK=1
