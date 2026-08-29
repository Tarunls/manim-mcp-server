# Pinned by digest (node:22-bookworm-slim, multi-arch index) so builds are
# reproducible and immune to tag re-pointing. Refresh deliberately:
#   curl -sI .../v2/library/node/manifests/22-bookworm-slim -> docker-content-digest
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

ENV NODE_ENV=production \
    PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Cairo/Pango (Manim's text and vector stack) and FFmpeg. The generated lessons
# intentionally avoid LaTeX-only APIs, so no TeX distribution is installed.
# NOTE (future optimization): hosted (EXECUTION_MODE=e2b) services render inside
# E2B sandboxes and likely do not need Manim/FFmpeg in this image; they are kept
# for local-mode rendering until that is verified.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    ffmpeg \
    fontconfig \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    libcairo2 \
    libcairo2-dev \
    libdbus-1-3 \
    libffi-dev \
    libpango-1.0-0 \
    libpango1.0-dev \
    pkg-config \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir "manim>=0.19,<0.20"

COPY . .
# Manim resolves fonts through Pango by family name. Without this the lessons
# fall back to DejaVu Sans, which is most of why generated output used to look
# generic, so install the shipped face and rebuild the font cache.
RUN mkdir -p /usr/local/share/fonts/orune \
    && cp fonts/OruneSerif*.ttf /usr/local/share/fonts/orune/ \
    && fc-cache -f \
    && fc-list : family | grep -q "Orune Serif"
RUN npm run build \
    && mkdir -p studio/projects \
    && chown -R node:node /app/studio

# Drop dev dependencies now that the client bundle is built. Runtime only needs
# tsx (a production dependency) and the server deps; vite is imported
# dynamically in dev mode only.
RUN npm prune --omit=dev

# Run as the unprivileged user shipped with the official node image. The app
# only writes to /tmp (TMPDIR is forced to /tmp at startup), and to
# /app/studio when running in local-persistence mode, which is chowned above.
USER node

EXPOSE 8080
# Exec-form node as PID 1 (not npm) so SIGTERM from Cloud Run reaches the
# server and graceful shutdown works. Mirrors `npm start`.
CMD ["node", "--env-file-if-exists=.env", "./node_modules/tsx/dist/cli.mjs", "server/index.ts"]
