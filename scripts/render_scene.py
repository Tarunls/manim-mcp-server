#!/usr/bin/env python3
"""Render one lesson project into browser-facing assets.

This is a renderer, not a critic. It checks the things that make a render
impossible or unplayable - the scene class exists and parses, Manim succeeds,
the frame is the size the format promised - and otherwise trusts the scene.
"""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


QUALITY_ARGS = {
    "draft": ["-ql"],
    "low": ["-ql"],
    "preview": ["-qm"],
    "medium": ["-qm"],
    "balanced": ["-r", "1920,1080", "--fps", "30"],
    "high": ["-qh"],
    "vertical": ["-r", "1080,1920", "--fps", "30"],
    "vertical-draft": ["-r", "540,960", "--fps", "30"],
}

# The exact frame each format must produce, checked after the render so a
# mismatched aspect never reaches the upload.
EXPECTED_FRAME = {
    "balanced": (1920, 1080),
    "vertical": (1080, 1920),
}

CACHED_QUALITIES = {"draft", "low", "preview", "medium", "vertical-draft"}


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def defines_generated_scene(code: str) -> bool:
    """True when the file has a class called GeneratedScene with a Scene-like base."""
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        fail(f"scene.py does not parse: {error}")
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "GeneratedScene":
            bases = []
            for base in node.bases:
                if isinstance(base, ast.Name):
                    bases.append(base.id)
                elif isinstance(base, ast.Attribute):
                    bases.append(base.attr)
            return any(name.endswith("Scene") for name in bases)
    return False


def main() -> None:
    if len(sys.argv) < 2:
        fail("Usage: render_scene.py PROJECT_DIR [draft|preview|balanced|high|vertical|vertical-draft]")

    root = Path(__file__).resolve().parents[1]
    allowed_root = (root / "studio" / "projects").resolve()
    project_dir = Path(sys.argv[1]).resolve()
    quality = sys.argv[2] if len(sys.argv) > 2 else "balanced"

    if allowed_root not in project_dir.parents:
        fail("Project directory must be inside studio/projects.")
    if quality not in QUALITY_ARGS:
        fail(f"Unknown quality: {quality}")

    source = project_dir / "scene.py"
    if not source.exists():
        fail("scene.py does not exist.")
    code = source.read_text(encoding="utf-8")
    if not defines_generated_scene(code):
        fail("scene.py must define a class named GeneratedScene that subclasses a Manim Scene.")

    override_python = os.environ.get("MANIM_PYTHON", "").strip()
    venv = root / (".venv" if (root / ".venv").exists() else "venv")
    python = (
        Path(override_python).resolve()
        if override_python
        else (venv / "Scripts" / "python.exe" if os.name == "nt" else venv / "bin" / "python")
    )
    if not python.exists():
        fail("Manim is not installed in the project virtual environment. Run: npm run setup:manim")

    media_dir = project_dir / ".media"
    command = [
        str(python),
        str(root / "scripts" / "manim_runner.py"),
        "render",
        *QUALITY_ARGS[quality],
        *([] if quality in CACHED_QUALITIES else ["--disable_caching"]),
        "--media_dir",
        str(media_dir),
        str(source),
        "GeneratedScene",
    ]
    started = time.time()
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(project_dir) + os.pathsep + environment.get("PYTHONPATH", "")
    result = subprocess.run(
        command,
        cwd=project_dir,
        text=True,
        capture_output=True,
        timeout=1200,
        env=environment,
    )
    if result.returncode != 0:
        output = result.stderr or result.stdout or "Manim render failed."
        # Manim prints a boxed traceback; keep the end, which names the error.
        fail(output[-6000:])

    candidates = list((media_dir / "videos").rglob("GeneratedScene.mp4"))
    if not candidates:
        fail("Manim completed but no GeneratedScene.mp4 was found.")
    rendered = max(candidates, key=lambda item: item.stat().st_mtime)
    expected = EXPECTED_FRAME.get(quality)
    if expected:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height", "-of", "csv=p=0:s=x", str(rendered)],
            text=True, capture_output=True, timeout=60,
        )
        actual = probe.stdout.strip()
        if actual != f"{expected[0]}x{expected[1]}":
            fail(f"The render produced {actual or 'an unreadable frame'}, but {quality} must be {expected[0]}x{expected[1]}.")

    # The runner writes held frames once with a long timestamp, so this single
    # native pass turns the variable-rate intermediate into the constant
    # 30 fps file browsers and social apps expect, and adds faststart.
    output = project_dir / "output.mp4"
    optimized = project_dir / "output.faststart.mp4"
    fps_target = "30"
    encode = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(rendered),
            "-vf", f"fps={fps_target}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-an", "-movflags", "+faststart", str(optimized),
        ],
        text=True, capture_output=True, timeout=600,
    )
    if encode.returncode != 0:
        fail(encode.stderr[-2000:] or "Could not encode the browser video.")
    optimized.replace(output)

    narration_enabled = True
    narration_config_file = project_dir / "narration-config.json"
    if narration_config_file.exists():
        try:
            narration_enabled = json.loads(narration_config_file.read_text(encoding="utf-8")).get("enabled") is not False
        except (json.JSONDecodeError, OSError):
            fail("narration-config.json must contain valid JSON.")

    narration_result = {"status": "disabled", "enabled": False}
    narration_file = project_dir / "narration.json"
    if narration_enabled and narration_file.exists():
        narration = subprocess.run(
            ["node", f"--env-file-if-exists={root / '.env'}", str(root / "scripts" / "generate_narration.mjs"), str(project_dir)],
            text=True, capture_output=True, timeout=600, env=environment,
        )
        if narration.returncode != 0:
            fail(narration.stderr[-3000:] or "Could not attach the narration.")
        try:
            narration_result = json.loads(narration.stdout.strip().splitlines()[-1])
        except (json.JSONDecodeError, IndexError):
            fail("Narration completed without valid metadata.")
    elif narration_enabled:
        narration_result = {"status": "silent", "enabled": False, "reason": "the script has no spoken lines"}

    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate:format=duration,bit_rate",
            "-of", "json", str(output),
        ],
        text=True, capture_output=True, timeout=30,
    )
    if probe.returncode != 0:
        fail(probe.stderr[-2000:] or "Could not inspect the rendered video.")
    probe_data = json.loads(probe.stdout)
    stream = probe_data["streams"][0]
    duration = float(probe_data["format"]["duration"])
    numerator, denominator = stream["avg_frame_rate"].split("/", 1)
    fps = float(numerator) / max(float(denominator), 1.0)

    poster = project_dir / "poster.png"
    poster_time = min(max(duration * 0.18, 0.5), max(duration - 0.1, 0.5))
    frame = subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{poster_time:.3f}", "-i", str(output), "-frames:v", "1", str(poster)],
        text=True, capture_output=True, timeout=60,
    )
    if frame.returncode != 0:
        fail(frame.stderr[-2000:] or "Could not extract the poster frame.")

    contact_sheet = project_dir / "contact-sheet.png"
    interval = max(duration / 12.0, 0.12)
    sheet = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(output),
            "-vf", f"fps=1/{interval:.4f},scale=360:-2,tile=4x3:padding=8:margin=8:color=white",
            "-frames:v", "1", str(contact_sheet),
        ],
        text=True, capture_output=True, timeout=90,
    )
    if sheet.returncode != 0:
        fail(sheet.stderr[-2000:] or "Could not create the contact sheet.")

    metadata = {
        "scene": "GeneratedScene",
        "renderer": "manim",
        "quality": quality,
        "duration": duration,
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "fps": round(fps, 3),
        "bitRate": int(probe_data["format"].get("bit_rate", 0)),
        "bytes": output.stat().st_size,
        "renderSeconds": round(time.time() - started, 2),
        "source": "scene.py",
        "output": "output.mp4",
        "poster": "poster.png",
        "contactSheet": "contact-sheet.png",
        "narration": narration_result,
    }
    (project_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
