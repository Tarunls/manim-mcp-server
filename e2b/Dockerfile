FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates ffmpeg git fonts-dejavu-core fonts-noto-color-emoji \
    libcairo2 libcairo2-dev libdbus-1-3 libffi-dev libgbm-dev libasound2 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libnss3 libpango-1.0-0 \
    libpango1.0-dev libxcomposite1 libxdamage1 libxfixes3 libxkbcommon-dev \
    libxrandr2 pkg-config python3 python3-dev python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lesson-studio/deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
    && npx remotion browser ensure \
    && python3 -m venv /opt/lesson-studio/venv \
    && /opt/lesson-studio/venv/bin/pip install --no-cache-dir --retries 10 --timeout 120 "manim>=0.19,<0.20"

WORKDIR /opt/lesson-studio/app
COPY . .
RUN mkdir -p /opt/lesson-studio /workspace studio/projects \
    && mv /opt/lesson-studio/deps/node_modules node_modules \
    && mv /opt/lesson-studio/venv venv \
    && ln -s venv .venv \
    && chmod 0555 e2b/bootstrap.mjs \
    && chown -R node:node /workspace studio/projects \
    && chmod 0770 /workspace studio/projects

WORKDIR /workspace
USER node
