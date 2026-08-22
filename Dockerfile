FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Manim/Pango, FFmpeg, and the shared libraries required by Remotion's Chrome
# Headless Shell. The generated lessons intentionally avoid LaTeX-only APIs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    ffmpeg \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    libcairo2 \
    libcairo2-dev \
    libdbus-1-3 \
    libffi-dev \
    libgbm-dev \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libnss3 \
    libpango-1.0-0 \
    libpango1.0-dev \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon-dev \
    libxrandr2 \
    pkg-config \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev
RUN npx remotion browser ensure

COPY . .
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir "manim>=0.19,<0.20" \
    && npm run build \
    && mkdir -p studio/projects

EXPOSE 8080
CMD ["npm", "start"]
