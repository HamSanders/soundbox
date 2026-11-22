#!/usr/bin/env bash
# dev helper: stop this spike's server + engines (by port), start again
for port in 17650 17651 17652 17653; do
  pid=$(netstat -ano | grep "127.0.0.1:$port " | grep LISTENING | awk '{print $5}' | head -1)
  [ -n "$pid" ] && taskkill //F //PID "$pid" > /dev/null 2>&1
done
sleep 1
node server.mjs > "$TEMP/spike-server.log" 2>&1 &
for i in $(seq 1 90); do grep -q "^open http" "$TEMP/spike-server.log" && break; sleep 1; done
cat "$TEMP/spike-server.log"
