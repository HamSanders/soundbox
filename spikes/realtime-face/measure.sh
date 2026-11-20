#!/usr/bin/env bash
# Measurement run: server + headless Chrome (muted) + PCM sender. Usage: ./measure.sh <name> <input-rate> <sender args...>
cd "$(dirname "$0")"
PY="${MIRLI_FACE_HOME:-$HOME/mirli-spike-face}/venv/Scripts/python.exe"
name=$1; rate=$2; shift 2
./restart.sh "$name" --input-rate "$rate" $SERVER_ARGS
prof=$(mktemp -d)
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --mute-audio --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$(cygpath -w "$prof")" --window-size=800,700 --remote-debugging-port=17662 \
  "http://127.0.0.1:17660/?autostart=1" >/dev/null 2>&1 &
sleep 6
"$PY" send_pcm.py --rate "$rate" "$@" | tail -3
sleep 5
curl -s http://127.0.0.1:17660/stats > "results/$name.stats.json"
powershell -c "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ? { \$_.CommandLine -like '*remote-debugging-port=17662*' } | % { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
"$PY" analyze.py "results/$name.jsonl" | tee "results/$name.summary.json"
