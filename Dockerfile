# Konchi server + web UI, headless.
#
#   docker build -t konchi .                                   # CPU, runs anywhere
#   docker build -t konchi:cuda \
#     --build-arg AUDIOCPP_TAG=full-cuda12 --build-arg AUDIOCPP_BACKEND=cuda .
#
# The audio.cpp runtime is not built here. The final stage starts FROM
# audio.cpp's own published image (ghcr.io/0xshug0/audio.cpp), which already
# carries `audiocpp_cli`, its ggml backend libraries, ffmpeg and the matching
# CUDA/Vulkan runtime, for amd64 and arm64. Konchi adds Node and itself on
# top. That keeps the GPU variants a build-arg rather than a second toolchain:
# upstream's Linux release tarballs ship no CUDA `audiocpp_cli` at all, and
# compiling ggml's CUDA kernels in this build would take the better part of an
# hour.
#
# See docs/INSTALL.md#docker for volumes, GPUs and KONCHI_ALLOWED_HOSTS.

# Which upstream audio.cpp image to build on: full-cpu, full-cuda12,
# full-cuda13 or full-vulkan. Those tags move daily; pin a dated one
# (full-cuda12-20261013-f1c299b) for a reproducible build.
ARG AUDIOCPP_IMAGE=ghcr.io/0xshug0/audio.cpp
ARG AUDIOCPP_TAG=full-cpu
ARG NODE_VERSION=22

# ── build: the UI bundle and the compiled server ─────────────────────────────
FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /src

# Manifests first so the dependency layer survives source edits. site/'s
# manifest is here only because it is a workspace in the root lockfile.
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY server/package.json server/
COPY site/package.json site/
RUN npm ci --workspace app --workspace server --include-workspace-root=false

COPY app/ app/
COPY server/ server/
# Same steps as scripts/build.mjs: build the UI, stage it as server/web (where
# the server serves it from), compile the server.
RUN npm run build --workspace app \
 && rm -rf server/web && cp -r app/dist server/web \
 && npm run build --workspace server

# tsc emits no JSON, and the server loads its model catalogs from beside its
# own modules. Put them there so the image needs nothing from src/.
RUN cd server/src && find . -name '*.json' -exec cp --parents {} ../dist/ \;

# ── deps: production node_modules only ───────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY server/package.json server/
COPY site/package.json site/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

FROM node:${NODE_VERSION}-bookworm-slim AS node

# ── runtime ──────────────────────────────────────────────────────────────────
FROM ${AUDIOCPP_IMAGE}:${AUDIOCPP_TAG}

# The backend audio.cpp is asked for. Set explicitly rather than detected: the
# detector probes `nvidia-smi`, which the NVIDIA runtime injects whenever the
# container gets --gpus — including into a CPU image whose binary has no CUDA
# backend to give it. cpu | cuda | vulkan, matching AUDIOCPP_TAG.
ARG AUDIOCPP_BACKEND=cpu

USER root

# Node is copied rather than installed so the version is whatever NODE_VERSION
# says, not whatever the base image's Ubuntu ships. The base already has curl
# (for the healthcheck), ffmpeg (for mp3 output) and ca-certificates.
COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /opt/konchi
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/server/dist ./server/dist
COPY --from=build /src/server/web ./server/web
COPY server/package.json ./server/package.json
COPY server/skills ./server/skills
COPY LICENSE ./

# `konchi pull …`, `konchi list` and friends from `docker exec` (`soundbox`
# is the pre-rename name, kept so existing scripts work).
RUN printf '#!/bin/sh\nexec node /opt/konchi/server/dist/cli.js "$@"\n' > /usr/local/bin/konchi \
 && chmod +x /usr/local/bin/konchi \
 && ln -s konchi /usr/local/bin/soundbox \
 && mkdir -p /data/models \
 && chown -R ubuntu:ubuntu /data

# /data is the whole of ~/.konchi: settings, the library database, generated
# sounds, and (under /data/models) the weights. Mount /data/models separately
# to keep tens of gigabytes of weights on a different disk from your library.
ENV KONCHI_DATA_DIR=/data \
    KONCHI_AUDIOCPP_BIN=/app/audiocpp_cli \
    KONCHI_AUDIOCPP_BACKEND=${AUDIOCPP_BACKEND} \
    NODE_ENV=production

# The upstream image's unprivileged user (uid/gid 1000). A bind-mounted /data
# must be writable by that uid.
USER ubuntu
VOLUME ["/data"]
EXPOSE 17494

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:17494/api/health >/dev/null || exit 1

# 0.0.0.0 is required for the published port to reach the server from outside
# the container. The server has no authentication — see docs/INSTALL.md#docker.
ENTRYPOINT ["node", "/opt/konchi/server/dist/cli.js"]
CMD ["--host", "0.0.0.0", "--port", "17494"]
