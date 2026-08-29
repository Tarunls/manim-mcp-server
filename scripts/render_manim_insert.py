#!/usr/bin/env python3
"""Render a project-local Manim scene as a PNG sequence for Remotion."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 6:
        fail("Usage: render_manim_insert.py PROJECT_DIR SOURCE SCENE OUTPUT TRANSPARENT")
    root = Path(__file__).resolve().parents[1]
    allowed_root = (root / "studio" / "projects").resolve()
    project_dir = Path(sys.argv[1]).resolve()
    if allowed_root not in project_dir.parents:
        fail("Project directory must be inside studio/projects.")
    source = (project_dir / sys.argv[2]).resolve()
    if project_dir not in source.parents or not source.exists() or source.suffix != ".py":
        fail("Insert source must be a project-local Python file.")
    scene = sys.argv[3]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", scene):
        fail("Invalid Manim scene name.")
    output_dir = (project_dir / sys.argv[4]).resolve()
    if project_dir not in output_dir.parents:
        fail("Insert output must stay inside the project.")
    transparent = sys.argv[5].lower() == "true"
    venv = root / (".venv" if (root / ".venv").exists() else "venv")
    python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        fail("Manim is not installed in the project virtual environment.")
    media_dir = project_dir / ".composite-media" / output_dir.name
    if media_dir.exists():
        shutil.rmtree(media_dir)
    command = [
        str(python), "-m", "manim", "-r", "1920,1080", "--fps", "30", "--disable_caching", "--save_pngs", "--zero_pad", "6",
        "--media_dir", str(media_dir),
    ]
    if transparent:
        command.extend(["--transparent", "--format=mov"])
    command.extend([str(source), scene])
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(root / "studio") + os.pathsep + environment.get("PYTHONPATH", "")
    result = subprocess.run(command, cwd=project_dir, text=True, capture_output=True, timeout=900, env=environment)
    if result.returncode != 0:
        fail(result.stderr[-5000:] or result.stdout[-5000:] or "Manim insert render failed.")
    candidates = sorted((media_dir / "images").rglob(f"{scene}*.png"))
    if not candidates:
        fail(f"Manim completed but no PNG frames for {scene} were found.")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(candidates):
        shutil.copy2(frame, output_dir / f"{index:06d}.png")
    print(json.dumps({"source": sys.argv[2], "scene": scene, "output": sys.argv[4], "transparent": transparent, "frames": len(candidates), "fps": 30}))


if __name__ == "__main__":
    main()
