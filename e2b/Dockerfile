# Lesson Studio agent sandbox.
# Build + publish with:
#   npx e2b template build --dockerfile e2b/Dockerfile --name lesson-studio-agent
FROM e2bdev/code-interpreter:latest

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core python3-venv python3-dev build-essential \
 && rm -rf /var/lib/apt/lists/*

USER user

# Node 22 + pinned codex CLI for the app-server bridge.
RUN curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
 && bash -lc "nvm install 22 && nvm alias default 22 && npm i -g @openai/codex@0.147.0"

# Python toolchain for Manim renders.
ENV PATH="/opt/venv/bin:$PATH"
RUN python3 -m venv /opt/venv \
 && pip install --no-cache-dir manim pillow numpy

# Project workspace layout mirrors the local studio/projects directory.
RUN mkdir -p /home/user/studio-projects
WORKDIR /home/user/studio-projects
