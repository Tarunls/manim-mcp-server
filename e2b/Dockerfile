# Lesson Studio agent sandbox (E2B v2 build system parses this via fromDockerfile).
# Build with: E2B_API_KEY=... node e2b/build-template.mjs
FROM e2bdev/code-interpreter:latest

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core python3-venv python3-dev build-essential \
      curl ca-certificates xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Node 22 straight from the official binaries (nvm needs an interactive shell).
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unsupported arch $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-${node_arch}.tar.xz" -o /tmp/node.tar.xz; \
    mkdir -p /usr/local/lib/nodejs; \
    tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs; \
    ln -sf "/usr/local/lib/nodejs/node-v22.14.0-linux-${node_arch}/bin/node" /usr/local/bin/node; \
    ln -sf "/usr/local/lib/nodejs/node-v22.14.0-linux-${node_arch}/bin/npm" /usr/local/bin/npm; \
    ln -sf "/usr/local/lib/nodejs/node-v22.14.0-linux-${node_arch}/bin/npx" /usr/local/bin/npx; \
    rm /tmp/node.tar.xz

RUN npm install -g @openai/codex@0.147.0 \
 && ln -sf "$(npm prefix -g)/bin/codex" /usr/local/bin/codex

# Python toolchain for Manim renders.
ENV PATH="/opt/venv/bin:/usr/local/bin:$PATH"
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir manim pillow numpy \
 && printf 'export PATH="/opt/venv/bin:/usr/local/lib/nodejs/node-v22.14.0-linux-x64/bin:$PATH"\n' > /etc/profile.d/lesson-studio.sh

# Project workspace layout mirrors the local studio/projects directory.
RUN mkdir -p /home/user/studio-projects /home/user/.lesson-studio-codex \
 && chown -R user:user /home/user
WORKDIR /home/user/studio-projects
