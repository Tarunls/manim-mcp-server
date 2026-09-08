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


def progress(message: str) -> None:
    """Progress lines go to stderr so the pipeline can relay them to the UI."""
    print(message, file=sys.stderr, flush=True)


def count_animations(base_command: list[str], source: Path, media_dir: Path, project_dir: Path, environment: dict) -> int:
    """Run the scene with every animation skipped and read back how many there were."""
    env = dict(environment)
    env["ORUNE_PRINT_ANIMATION_COUNT"] = "1"
    result = subprocess.run(
        [*base_command, "-s", "--media_dir", str(media_dir / "count"), str(source), "GeneratedScene"],
        cwd=project_dir, text=True, capture_output=True, timeout=600, env=env,
    )
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "Manim render failed.")[-6000:])
    match = re.search(r"ORUNE_ANIMATIONS=(\d+)", result.stderr)
    return int(match.group(1)) if match else 0


def run_manim_worker(command: list[str], project_dir: Path, environment: dict, on_line) -> subprocess.Popen:
    process = subprocess.Popen(
        command, cwd=project_dir, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=environment,
    )
    process.orune_lines = []

    def pump() -> None:
        assert process.stderr is not None
        for line in process.stderr:
            process.orune_lines.append(line)
            on_line(line)

    import threading
    process.orune_thread = threading.Thread(target=pump, daemon=True)
    process.orune_thread.start()
    return process


def render_in_parallel(base_command: list[str], source: Path, media_dir: Path, project_dir: Path, environment: dict, quality: str) -> Path:
    """Render the scene across several processes and join the pieces.

    Manim's -n a,b renders only animations a..b and skips the rest at almost
    no cost, so a scene with continuous motion can be cut into ranges and
    rendered on every CPU at once. Each worker writes its own contiguous
    chunk; the chunks are concatenated in order without re-encoding.
    """
    total = count_animations(base_command, source, media_dir, project_dir, environment)
    workers = int(os.environ.get("ORUNE_RENDER_WORKERS", "0") or 0) or min(4, os.cpu_count() or 1)
    workers = max(1, min(workers, total if total else 1))
    if quality in CACHED_QUALITIES:
        workers = 1
    done = {"count": 0}
    last_report = {"at": 0.0}

    def on_line(line: str) -> None:
        if "Partial movie file written" in line:
            done["count"] += 1
            now = time.time()
            if now - last_report["at"] >= 3 or done["count"] == total:
                last_report["at"] = now
                progress(f"render-progress {done['count']}/{max(total, done['count'])}")

    if workers <= 1 or total < 2:
        process = run_manim_worker(
            [*base_command, "--media_dir", str(media_dir), str(source), "GeneratedScene"], project_dir, environment, on_line,
        )
        try:
            process.wait(timeout=1200)
        except subprocess.TimeoutExpired:
            process.kill()
            fail("Manim render exceeded its time limit.")
        process.orune_thread.join(timeout=5)
        if process.returncode != 0:
            fail(("".join(process.orune_lines) or "Manim render failed.")[-6000:])
        candidates = list((media_dir / "videos").rglob("GeneratedScene.mp4"))
        if not candidates:
            fail("Manim completed but no GeneratedScene.mp4 was found.")
        return max(candidates, key=lambda item: item.stat().st_mtime)

    progress(f"render-workers {workers} animations {total}")
    bounds = [round(index * total / workers) for index in range(workers + 1)]
    processes = []
    for index in range(workers):
        first, last = bounds[index], bounds[index + 1] - 1
        if last < first:
            continue
        worker_media = media_dir / f"w{index}"
        command = [*base_command, "-n", f"{first},{last}", "--media_dir", str(worker_media), str(source), "GeneratedScene"]
        processes.append((index, worker_media, run_manim_worker(command, project_dir, environment, on_line)))
    deadline = time.time() + 1200
    for index, worker_media, process in processes:
        try:
            process.wait(timeout=max(1, deadline - time.time()))
        except subprocess.TimeoutExpired:
            for _, _, other in processes:
                other.kill()
            fail("Manim render exceeded its time limit.")
    chunks = []
    for index, worker_media, process in processes:
        process.orune_thread.join(timeout=5)
        if process.returncode != 0:
            for _, _, other in processes:
                if other.poll() is None:
                    other.kill()
            fail(("".join(process.orune_lines) or "Manim render failed.")[-6000:])
        candidates = list((worker_media / "videos").rglob("GeneratedScene.mp4"))
        if not candidates:
            fail(f"Render worker {index} produced no video.")
        chunks.append(max(candidates, key=lambda item: item.stat().st_mtime))
    if len(chunks) == 1:
        return chunks[0]
    list_file = media_dir / "chunks.txt"
    list_file.write_text("".join(f"file '{chunk.as_posix()}'\n" for chunk in chunks), encoding="utf-8")
    merged = media_dir / "GeneratedScene.merged.mp4"
    concat = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(merged)],
        text=True, capture_output=True, timeout=300,
    )
    if concat.returncode != 0:
        fail(concat.stderr[-2000:] or "Could not join the rendered chunks.")
    return merged


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
    started = time.time()
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(project_dir) + os.pathsep + environment.get("PYTHONPATH", "")
    base_command = [str(python), str(root / "scripts" / "manim_runner.py"), "render", *QUALITY_ARGS[quality]]
    if quality not in CACHED_QUALITIES:
        base_command.append("--disable_caching")
    rendered = render_in_parallel(base_command, source, media_dir, project_dir, environment, quality)

    # The scene's own clock decides the length. A runaway wait or run_time
    # would otherwise cost a ten-minute encode before anyone noticed.
    length_probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(rendered)],
        text=True, capture_output=True, timeout=60,
    )
    try:
        rendered_seconds = float(length_probe.stdout.strip())
    except ValueError:
        rendered_seconds = 0.0
    if rendered_seconds > 15 * 60:
        fail(
            f"The scene runs for {rendered_seconds / 60:.1f} minutes. A wait or run_time in scene.py is far "
            "longer than the storyboard's timeline; the scene's elapsed time must match the beat start and end times."
        )
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
        text=True, capture_output=True, timeout=900,
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
