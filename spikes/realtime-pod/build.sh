#!/usr/bin/env bash
# Build the call pod image. Run from anywhere; needs Docker (in WSL on the dev box: sudo or the docker group).
#   ./build.sh [tag]                      default tag mirli-call-pod:dev
# Portraits: copies the spike's persona faces from $MIRLI_FACE_HOME/faces (default ~/mirli-spike-face/faces)
# into faces/ (gitignored). Provenance of each portrait must be cleared before a public pod uses it.
set -euo pipefail
cd "$(dirname "$0")"
SRC="${MIRLI_FACE_SRC:-${MIRLI_FACE_HOME:-$HOME/mirli-spike-face}/faces}"
mkdir -p faces
if [ -z "$(ls faces/*.png 2>/dev/null)" ]; then
  for n in 0fea11caf8194e3d86b337b9-56ea891b Arjun-109f5dca Ingrid-f97bfb9e Luca-0c5992f8 Marcus-b18bacb5 Mei-b8824cb2 Sofia-72d4cebc; do
    cp "$SRC/$n.png" faces/ 2>/dev/null || echo "missing portrait $n (skipped)"
  done
fi
[ -n "$(ls faces/*.png 2>/dev/null)" ] || { echo "no portraits in faces/"; exit 1; }
cd ..
time docker build -f realtime-pod/Dockerfile -t "${1:-mirli-call-pod:dev}" .
docker image ls "${1:-mirli-call-pod:dev}"
