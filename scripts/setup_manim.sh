#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/"
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  uv venv .venv
fi

uv pip install --python .venv/bin/python "manim>=0.19,<0.20"
.venv/bin/manim --version
