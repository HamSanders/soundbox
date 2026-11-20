#!/usr/bin/env bash
# Dev helper: (re)start server.py in the background, wait for "ready". Usage: ./restart.sh <log-name> [server args]
cd "$(dirname "$0")"
PY="${MIRLI_FACE_HOME:-$HOME/mirli-spike-face}/venv/Scripts/python.exe"
pid=$(netstat -ano | grep "127.0.0.1:17660 .*LISTENING" | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null && sleep 2
name=$1; shift
rm -f "results/$name.jsonl"
nvidia-smi --query-gpu=memory.used --format=csv,noheader > "results/$name.vram_before.txt"
nohup "$PY" server.py --log "results/$name.jsonl" "$@" > results/server.log 2>&1 &
for i in $(seq 1 60); do grep -q "^ready" results/server.log && break; sleep 2; done
grep "^ready\|Error" results/server.log; cat "results/$name.vram_before.txt"
