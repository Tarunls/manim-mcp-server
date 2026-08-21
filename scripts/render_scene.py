#!/usr/bin/env python3
"""Render one Manim Studio project into stable browser-facing assets."""

from __future__ import annotations

import ast
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


QUALITY_ARGS = {
    "draft": ["-ql"],
    "low": ["-ql"],
    "preview": ["-qm"],
    "medium": ["-qm"],
    # Browser default: full HD with smooth motion and half the frames of -qh.
    "balanced": ["-r", "1920,1080", "--fps", "30"],
    "high": ["-qh"],
}


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def has_layout_call(code: str, function_name: str, minimum_positional: int) -> bool:
    """Return true for a real call with enough peers, including starred groups."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.id if isinstance(node.func, ast.Name) else None
        if name != function_name:
            continue
        if any(isinstance(argument, ast.Starred) for argument in node.args):
            return True
        if len(node.args) >= minimum_positional:
            return True
    return False


def validate_generation_request(project_dir: Path, source: Path) -> None:
    request_file = project_dir / "generation-request.json"
    if not request_file.exists():
        return
    try:
        request = json.loads(request_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        fail("Generation freshness check failed: generation-request.json must contain valid JSON.")
    if request.get("mode") != "first-draft":
        return
    if request.get("renderer") != "manim":
        fail(f"Generation freshness check failed: the request expects {request.get('renderer')}, not manim.")
    try:
        started_at = datetime.fromisoformat(str(request["startedAt"]).replace("Z", "+00:00")).timestamp()
    except (KeyError, TypeError, ValueError):
        fail("Generation freshness check failed: generation-request.json has an invalid startedAt value.")
    plan_file = project_dir / "beat-plan.md"
    if not plan_file.exists() or plan_file.stat().st_size < 180:
        fail("Generation freshness check failed: beat-plan.md was not created for this request.")
    if plan_file.stat().st_mtime < started_at - 1:
        fail("Generation freshness check failed: beat-plan.md predates this request.")
    if source.stat().st_mtime < started_at - 1:
        fail("Generation freshness check failed: scene.py predates this request.")
    stop = {"create", "video", "explaining", "explain", "beautiful", "beautifully", "relate", "related", "their", "there", "about", "under", "with", "from", "into", "that", "this", "they", "them", "used", "using", "calculate", "show", "animate"}
    keywords = set()
    for word in re.findall(r"[a-z]{5,}", str(request.get("prompt", "")).lower()):
        if word in stop:
            continue
        keywords.add(word)
        if word.endswith("s") and len(word) > 5:
            keywords.add(word[:-1])
    plan = plan_file.read_text(encoding="utf-8").lower()
    if keywords and not any(word in plan for word in keywords):
        fail("Generation freshness check failed: beat-plan.md does not appear to address the requested topic.")


def main() -> None:
    if len(sys.argv) < 2:
        fail("Usage: render_scene.py PROJECT_DIR [draft|preview|balanced|high]")

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
    validate_generation_request(project_dir, source)
    if not re.search(r"class\s+GeneratedScene\s*\([^)]*Scene\s*\)", code):
        fail("scene.py must define GeneratedScene as a Scene subclass.")
    if "from manim_layout import" not in code:
        fail("scene.py must import the shared manim_layout guards.")
    if "assert_scene_safe(" not in code:
        fail("scene.py must call assert_scene_safe for its important visual groups.")
    if not has_layout_call(code, "assert_no_overlap", 2):
        fail("scene.py must call assert_no_overlap with at least two independent peer objects.")
    if not has_layout_call(code, "watch_no_overlap", 3):
        fail("scene.py must use watch_no_overlap with the scene and at least two moving peer objects.")
    if "RoundedRectangle(" in code and "assert_inside(" not in code:
        fail("Panel-based scenes must call assert_inside for every panel's content.")

    # A virtualenv puts executables in Scripts/ on Windows and bin/ elsewhere.
    manim = (root / ".venv" / "Scripts" / "manim.exe" if os.name == "nt"
             else root / ".venv" / "bin" / "manim")
    if not manim.exists():
        fail("Manim is not installed in .venv. Run: npm run setup:manim")

    media_dir = project_dir / ".media"
    command = [
        str(manim),
        *QUALITY_ARGS[quality],
        "--disable_caching",
        "--media_dir",
        str(media_dir),
        str(source),
        "GeneratedScene",
    ]
    started = time.time()
    environment = dict(os.environ)
    studio_root = str(root / "studio")
    environment["PYTHONPATH"] = studio_root + os.pathsep + environment.get("PYTHONPATH", "")
    result = subprocess.run(
        command,
        cwd=project_dir,
        text=True,
        capture_output=True,
        timeout=900,
        env=environment,
    )
    if result.returncode != 0:
        fail(result.stderr[-5000:] or result.stdout[-5000:] or "Manim render failed.")

    candidates = list((media_dir / "videos").rglob("GeneratedScene.mp4"))
    if not candidates:
        fail("Manim completed but no GeneratedScene.mp4 was found.")
    rendered = max(candidates, key=lambda item: item.stat().st_mtime)
    output = project_dir / "output.mp4"
    optimized = project_dir / "output.faststart.mp4"
    faststart = subprocess.run(
        ["ffmpeg", "-y", "-i", str(rendered), "-c", "copy", "-movflags", "+faststart", str(optimized)],
        text=True,
        capture_output=True,
        timeout=60,
    )
    if faststart.returncode != 0:
        fail(faststart.stderr[-2000:] or "Could not optimize the browser video.")
    optimized.replace(output)

    narration_config_file = project_dir / "narration-config.json"
    narration_enabled = True
    if narration_config_file.exists():
        try:
            narration_enabled = json.loads(narration_config_file.read_text(encoding="utf-8")).get("enabled") is not False
        except (json.JSONDecodeError, OSError):
            fail("narration-config.json must contain valid JSON.")

    narration_result = {"status": "disabled", "enabled": False}
    narration_file = project_dir / "narration.json"
    if narration_enabled:
        if not narration_file.exists():
            fail("Voice is enabled, but narration.json does not exist.")
        narration = subprocess.run(
            ["node", f"--env-file-if-exists={root / '.env'}", str(root / "scripts" / "generate_narration.mjs"), str(project_dir)],
            text=True,
            capture_output=True,
            timeout=300,
            env=environment,
        )
        if narration.returncode != 0:
            fail(narration.stderr[-3000:] or "Could not synthesize the narration.")
        try:
            narration_result = json.loads(narration.stdout.strip().splitlines()[-1])
        except (json.JSONDecodeError, IndexError):
            fail("Narration completed without valid metadata.")
        if (
            narration_result.get("status") != "ready"
            or narration_result.get("enabled") is not True
            or narration_result.get("provider") != "speechify"
            or narration_result.get("model") != "simba-3.2"
        ):
            fail("Narration must be generated by Speechify simba-3.2; fallback audio is not accepted.")

    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate:format=duration,bit_rate",
            "-of", "json", str(output),
        ],
        text=True,
        capture_output=True,
        timeout=30,
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
        text=True,
        capture_output=True,
        timeout=60,
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
        text=True,
        capture_output=True,
        timeout=90,
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
