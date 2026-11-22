#!/usr/bin/env bash
# Runs the turn bench under three endpointing settings, restarting the server
# for each. Results land in runs/bench-*.json. ~12 minutes.
cd "$(dirname "$0")/.."
run() { # name speculate endpoint
  export VAD_SPECULATE_MS=$2 VAD_ENDPOINT_MS=$3 SPIKE_RUN_LOG=$1.jsonl BENCH_NAME=bench-$1
  rm -f runs/$1.jsonl
  bash restart.sh > /dev/null
  node bench/turns.mjs 3 --barge > runs/bench-$1.log 2>&1
  tail -22 runs/bench-$1.log
}
run no-speculation 0 400
run default 160 400
run aggressive 96 300
