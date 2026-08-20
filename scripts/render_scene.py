#!/usr/bin/env python3
"""Render one Manim Studio project into stable browser-facing assets."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time

from scene_contract import semantic_sample_times, validate_narration_spec, validate_scene_source


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
    contract = validate_scene_source(code)
    if not contract.valid:
        details = "\n".join(f"line {issue.line}: {issue.message}" for issue in contract.issues)
        fail(f"Scene contract validation failed:\n{details}")

    narration_file = project_dir / "narration.json"
    narration_contract = None
    narration_bytes = None
    if narration_file.exists():
        narration_bytes = narration_file.read_bytes()
        try:
            narration_spec = json.loads(narration_bytes)
        except json.JSONDecodeError as error:
            fail(f"Invalid narration.json: {error}")
        estimated_duration = contract.estimated_duration_seconds if contract.dynamic_timing_calls == 0 else None
        narration_contract = validate_narration_spec(narration_spec, estimated_duration)
        if not narration_contract.valid:
            details = "\n".join(f"segment {issue.line}: {issue.message}" for issue in narration_contract.issues)
            fail(f"Narration contract validation failed:\n{details}")

    manim = root / ".venv" / "bin" / "manim"
    if not manim.exists():
        fail("Manim is not installed in .venv.")

    media_dir = project_dir / ".media"
    # Each render gets a clean Manim workspace so a stale concatenated movie can
    # never be mistaken for the output of the current source.
    if media_dir.exists():
        shutil.rmtree(media_dir)
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

    narration_result = {"status": "not_requested", "enabled": False}
    if narration_file.exists():
        narration = subprocess.run(
            ["node", str(root / "scripts" / "generate_narration.mjs"), str(project_dir)],
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

    narration_starts = narration_contract.starts if narration_contract else []
    narration_spec_hash = hashlib.sha256(narration_bytes).hexdigest() if narration_bytes else None

    contact_sheet_times = semantic_sample_times(duration, narration_starts, count=6)
    contact_sheet = project_dir / "contact-sheet.png"
    with tempfile.TemporaryDirectory(prefix="manim-contact-") as temporary:
        temporary_dir = Path(temporary)
        stills: list[Path] = []
        for index, timestamp in enumerate(contact_sheet_times):
            still = temporary_dir / f"frame-{index:02d}.png"
            extracted = subprocess.run(
                [
                    "ffmpeg", "-y", "-ss", f"{timestamp:.3f}", "-i", str(output),
                    "-frames:v", "1", str(still),
                ],
                text=True,
                capture_output=True,
                timeout=60,
            )
            if extracted.returncode != 0:
                fail(extracted.stderr[-2000:] or f"Could not extract contact-sheet frame at {timestamp:.3f}s.")
            stills.append(still)

        filters = [
            f"[{index}:v]scale=480:270:force_original_aspect_ratio=decrease,"
            f"pad=480:270:(ow-iw)/2:(oh-ih)/2:color=white[v{index}]"
            for index in range(len(stills))
        ]
        layout = "|".join(f"{(index % 3) * 480}_{(index // 3) * 270}" for index in range(len(stills)))
        filters.append(
            "".join(f"[v{index}]" for index in range(len(stills)))
            + f"xstack=inputs={len(stills)}:layout={layout}:fill=white[out]"
        )
        sheet_command = ["ffmpeg", "-y"]
        for still in stills:
            sheet_command.extend(["-i", str(still)])
        sheet_command.extend(
            ["-filter_complex", ";".join(filters), "-map", "[out]", "-frames:v", "1", str(contact_sheet)]
        )
        sheet = subprocess.run(sheet_command, text=True, capture_output=True, timeout=90)
        if sheet.returncode != 0:
            fail(sheet.stderr[-2000:] or "Could not create the contact sheet.")

    version_probe = subprocess.run(
        [str(manim), "--version"], text=True, capture_output=True, timeout=30
    )
    version_lines = (version_probe.stdout or version_probe.stderr).strip().splitlines()
    manim_version = version_lines[-1] if version_lines else "unknown"

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
        "contactSheetTimes": contact_sheet_times,
        "narration": narration_result,
        "provenance": {
            "renderedAt": datetime.now(timezone.utc).isoformat(),
            "sourceHash": contract.source_hash,
            "narrationSpecHash": narration_spec_hash,
            "manimVersion": manim_version,
            "pythonVersion": platform.python_version(),
            "fontFamilies": contract.font_families,
        },
        "contract": {
            "panelCount": len(contract.panel_variables),
            "guardedPanelCount": len(contract.guarded_panels),
            "explicitWaitSeconds": contract.explicit_wait_seconds,
            "explicitWaitRatio": round(contract.explicit_wait_seconds / max(duration, 0.001), 4),
            "estimatedDurationSeconds": contract.estimated_duration_seconds,
            "dynamicTimingCalls": contract.dynamic_timing_calls,
            "narrationMinimumSeconds": narration_contract.minimum_duration_seconds if narration_contract else None,
            "narrationWordCounts": narration_contract.word_counts if narration_contract else [],
        },
    }
    (project_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
