#!/usr/bin/env bash
# Start the face server, the voice server and pod.mjs. If any of them exits, stop the rest and exit
# non-zero so RunPod restarts the container (and the router sees /healthz fail meanwhile).
set -u
: "${LLM_BASE_URL:?set LLM_BASE_URL (OpenAI-compatible, e.g. https://api.groq.com/openai/v1)}"
: "${LLM_MODEL:?set LLM_MODEL}"
mkdir -p "$SPIKE_DIR" "$MIRLI_FACE_HOME/faces"
cp -n /opt/faces/*.png "$MIRLI_FACE_HOME/faces/" 2>/dev/null || true
FACE_IMAGE="${FACE_IMAGE:-$(ls /opt/faces/*.png 2>/dev/null | head -1)}"
export POD_DEFAULT_FACE="$(basename "$FACE_IMAGE" .png)"  # pod.mjs restores it after each call

pids=()
t0=$(date +%s)
stamp() { echo "[$(( $(date +%s) - t0 ))s] $*"; }

# Voice first: the face server subscribes to its PCM tap and retries every 2 s until it is up.
(cd /app/realtime-voice && exec node server.mjs) &
pids+=($!)
stamp "voice server pid ${pids[-1]}"

if [ "${FACE:-1}" != "0" ]; then
  (cd /app/realtime-face && exec python3 server.py --engine musetalk --input-rate 48000 \
     --tap ws://127.0.0.1:17650/tap --image "$FACE_IMAGE" ${FACE_ARGS:-}) &
  pids+=($!)
  stamp "face server pid ${pids[-1]} (MuseTalk, portrait $FACE_IMAGE)"
fi

(cd /app/realtime-pod && exec node pod.mjs) &
pids+=($!)

trap 'kill "${pids[@]}" 2>/dev/null; wait; exit 0' TERM INT
wait -n "${pids[@]}"
code=$?
stamp "a process exited ($code); stopping the pod"
kill "${pids[@]}" 2>/dev/null
wait
exit "${code:-1}"
