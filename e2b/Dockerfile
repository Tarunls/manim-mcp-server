FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

# Cairo/Pango (Manim's text and vector stack) and FFmpeg. Nothing here renders
# in a browser, so no Chrome/headless-shell libraries are installed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates ffmpeg fontconfig git fonts-dejavu-core fonts-noto-color-emoji \
    libcairo2 libcairo2-dev libdbus-1-3 libffi-dev libpango-1.0-0 \
    libpango1.0-dev pkg-config python3 python3-dev python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lesson-studio/deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
    && mkdir -p /opt/lesson-studio/app \
    && python3 -m venv /opt/lesson-studio/app/.venv \
    && /opt/lesson-studio/app/.venv/bin/python -m pip install --no-cache-dir --retries 10 --timeout 120 "manim>=0.19,<0.20"

WORKDIR /opt/lesson-studio/app
COPY . .
RUN mkdir -p /opt/lesson-studio /workspace studio/projects \
    && mv /opt/lesson-studio/deps/node_modules node_modules \
    && ln -s .venv venv \
    && chmod 0555 e2b/bootstrap.mjs \
    && chown -R node:node /workspace studio/projects \
    && chmod 0770 /workspace studio/projects

# Manim resolves fonts through Pango by family name. Without the shipped face
# installed system-wide, every generated lesson silently falls back to DejaVu
# Sans. The grep fails the build rather than shipping a template that renders
# the wrong typeface.
RUN mkdir -p /usr/local/share/fonts/orune \
    && cp /opt/lesson-studio/app/fonts/OruneSerif*.ttf /usr/local/share/fonts/orune/ \
    && fc-cache -f \
    && fc-list : family | grep -q "Orune Serif"

WORKDIR /workspace
USER node
