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

# Logs: each process writes to /tmp/logs/<name>.log (and the container log); pod.mjs serves them on
# GET /logs?name=voice|face|pod|start with the admin token, so a failing pod can be read without SSH.
mkdir -p /tmp/logs
run() { local name=$1; shift; ( "$@" ) > >(tee -a "/tmp/logs/$name.log") 2>&1 & pids+=($!); }

# The front door first, so /healthz and /logs answer while everything else starts.
run pod bash -c 'cd /app/realtime-pod && exec node pod.mjs'

# A host whose GPU is broken ("CUDA unknown error", seen on a Community 4090 on 2026-11-22) can't be fixed
# from inside the pod. Say so on /readyz (state "failed") so the router terminates it and picks another.
if ! python3 -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" 2>/tmp/logs/gpu-check.log; then
  { echo "GPU unavailable on this host:"; nvidia-smi 2>&1 | head -5; tail -3 /tmp/logs/gpu-check.log; } > /tmp/logs/GPU_FAILED
  stamp "GPU check failed; not starting the engines" | tee -a /tmp/logs/pod.log
  wait; exit 1
fi

# The voice server checks the LLM once at start-up and exits if it can't reach it. Wait for the LLM instead
# (it may be a pod that is still booting), up to LLM_WAIT_S.
for i in $(seq 1 "${LLM_WAIT_S:-900}"); do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${LLM_API_KEY:-}" "${LLM_BASE_URL%/}/models" || true)
  [ "$code" = "200" ] && break
  [ $((i % 30)) = 1 ] && stamp "waiting for the LLM at $LLM_BASE_URL (HTTP $code)" | tee -a /tmp/logs/pod.log
  sleep 1
done

# Voice next: the face server subscribes to its PCM tap and retries every 2 s until it is up.
run voice bash -c 'cd /app/realtime-voice && exec node server.mjs'
if [ "${FACE:-1}" != "0" ]; then
  run face bash -c "cd /app/realtime-face && exec python3 server.py --engine musetalk --input-rate 48000 --tap ws://127.0.0.1:17650/tap --image '$FACE_IMAGE' ${FACE_ARGS:-}"
fi
stamp "started: ${pids[*]}"

trap 'kill "${pids[@]}" 2>/dev/null; wait; exit 0' TERM INT
# By default a dead engine leaves the pod up (readyz stays 503, logs stay readable) instead of restarting
# the container, which would re-run the whole setup. POD_EXIT_ON_FAIL=1 restores exit-and-restart.
while true; do
  wait -n "${pids[@]}"
  code=$?
  stamp "a process exited ($code)" | tee -a /tmp/logs/pod.log
  if [ "${POD_EXIT_ON_FAIL:-0}" = "1" ]; then kill "${pids[@]}" 2>/dev/null; wait; exit "$code"; fi
  alive=(); for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && alive+=("$p"); done; pids=("${alive[@]}")
  [ ${#pids[@]} -eq 0 ] && exit "$code"
done
