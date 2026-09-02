#!/usr/bin/env python3
"""Render one Manim Studio project into stable browser-facing assets."""

from __future__ import annotations

import ast
from datetime import datetime
import json
import math
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
    # 9:16 for social. The draft cut keeps the same aspect on purpose, so a
    # layout that only breaks when the frame is tall breaks during iteration
    # rather than on the final render.
    "vertical": ["-r", "1080,1920", "--fps", "30"],
    "vertical-draft": ["-r", "540,960", "--fps", "30"],
}

ENGINE_CONTRACT_VERSION = 1
SCENE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")

# The exact frame each format must produce, checked after the render so a
# mismatched aspect can never reach the upload.
EXPECTED_FRAME = {
    "balanced": (1920, 1080),
    "vertical": (1080, 1920),
}

# Iteration renders keep Manim's partial-movie cache so a re-render after an
# edit only redraws the changed animations. Final-quality renders disable it:
# they run once, and hashing every animation would only add overhead.
CACHED_QUALITIES = {"draft", "low", "preview", "medium", "vertical-draft"}


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


def _literal_string_list(node: ast.AST | None) -> list[str] | None:
    if not isinstance(node, (ast.List, ast.Tuple)):
        return None
    values: list[str] = []
    for item in node.elts:
        value = item.s if isinstance(item, ast.Str) else getattr(item, "value", None)
        if not isinstance(value, str):
            return None
        values.append(value)
    return values


def validate_named_layout_guards(tree: ast.AST, object_ids: set[str]) -> None:
    """Require collision reports to use the stable ids from scene-plan.json."""
    checked = 0
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.id if isinstance(node.func, ast.Name) else None
        if name not in {"assert_inside", "assert_scene_safe", "assert_no_overlap", "watch_no_overlap"}:
            continue
        checked += 1
        names_node = next((item.value for item in node.keywords if item.arg == "names"), None)
        names = _literal_string_list(names_node)
        if not names:
            fail(
                f"{name} must pass names=[...] using literal object ids from scene-plan.json "
                "so collision repairs can target the right objects."
            )
        unknown = sorted(set(names) - object_ids)
        if unknown:
            fail(f"{name} uses object ids missing from scene-plan.json: {', '.join(unknown)}")
        positional_peers = len(node.args) - (1 if name in {"assert_inside", "watch_no_overlap"} else 0)
        if not any(isinstance(argument, ast.Starred) for argument in node.args) and positional_peers != len(names):
            fail(f"{name} must provide exactly one stable name for each peer object.")
    if not checked:
        fail("scene.py must use named layout guards from scene-plan.json.")


def validate_scene_plan(project_dir: Path, request: dict | None = None) -> dict | None:
    """Validate the small semantic contract used for review and targeted repair."""
    request = request or {}
    required = request.get("engineContract") == ENGINE_CONTRACT_VERSION
    plan_path = project_dir / "scene-plan.json"
    if not plan_path.exists():
        if required:
            fail(
                "scene-plan.json is required by engine contract v1. Write it before scene.py "
                "with named beats and stable object ids."
            )
        return None
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        fail("scene-plan.json must contain valid JSON.")
    if not isinstance(plan, dict) or plan.get("version") != ENGINE_CONTRACT_VERSION:
        fail("scene-plan.json must be an object with version 1.")
    if not isinstance(plan.get("lessonGoal"), str) or len(plan["lessonGoal"].strip()) < 12:
        fail("scene-plan.json lessonGoal must be a meaningful sentence.")
    beats = plan.get("beats")
    if not isinstance(beats, list) or not 1 <= len(beats) <= 12:
        fail("scene-plan.json beats must contain between 1 and 12 beats.")
    beat_ids: set[str] = set()
    object_ids: set[str] = set()
    for index, beat in enumerate(beats, start=1):
        if not isinstance(beat, dict):
            fail(f"scene-plan.json beat {index} must be an object.")
        beat_id = beat.get("id")
        if not isinstance(beat_id, str) or not SCENE_ID.fullmatch(beat_id):
            fail(f"scene-plan.json beat {index} has an invalid id.")
        if beat_id in beat_ids:
            fail(f"scene-plan.json repeats beat id {beat_id}.")
        beat_ids.add(beat_id)
        for field in ("purpose", "dominantVisual"):
            if not isinstance(beat.get(field), str) or len(beat[field].strip()) < 8:
                fail(f"scene-plan.json beat {beat_id} needs a meaningful {field}.")
        weight = beat.get("weight", 1)
        if not isinstance(weight, (int, float)) or isinstance(weight, bool) or not 0.1 <= weight <= 10:
            fail(f"scene-plan.json beat {beat_id} has an invalid weight.")
        objects = beat.get("objects")
        if not isinstance(objects, list) or not 1 <= len(objects) <= 16:
            fail(f"scene-plan.json beat {beat_id} must name between 1 and 16 visible objects.")
        local_ids: set[str] = set()
        for item in objects:
            if not isinstance(item, dict):
                fail(f"scene-plan.json beat {beat_id} contains an invalid object.")
            object_id = item.get("id")
            if not isinstance(object_id, str) or not SCENE_ID.fullmatch(object_id):
                fail(f"scene-plan.json beat {beat_id} contains an invalid object id.")
            if object_id in local_ids:
                fail(f"scene-plan.json beat {beat_id} repeats object id {object_id}.")
            local_ids.add(object_id)
            object_ids.add(object_id)
            if not isinstance(item.get("role"), str) or not item["role"].strip():
                fail(f"scene-plan.json object {object_id} needs a role.")
            if item.get("changePolicy", "flexible") not in {"flexible", "preserve"}:
                fail(f"scene-plan.json object {object_id} has an invalid changePolicy.")
    plan["_objectIds"] = sorted(object_ids)
    return plan


def build_review_samples(duration: float, fps: float, scene_plan: dict | None, target: int = 12) -> list[dict]:
    """Choose stable beats and transition frames before adding uniform fallbacks."""
    duration = max(float(duration), 0.01)
    fps = max(float(fps), 1.0)
    last_frame = max(0, math.floor(duration * fps) - 1)
    candidates: list[tuple[float, str, str | None, int]] = []
    beats = scene_plan.get("beats", []) if scene_plan else []
    if beats:
        weights = [float(beat.get("weight", 1)) for beat in beats]
        total = sum(weights)
        boundaries = [0.0]
        for weight in weights:
            boundaries.append(boundaries[-1] + duration * weight / total)
        candidates.append((min(0.2, duration * 0.04), "opening", beats[0]["id"], 1))
        for index, beat in enumerate(beats):
            midpoint = (boundaries[index] + boundaries[index + 1]) / 2
            candidates.append((midpoint, "stable", beat["id"], 0))
        for index, boundary in enumerate(boundaries[1:-1], start=1):
            candidates.append((boundary, "transition", f"{beats[index - 1]['id']}->{beats[index]['id']}", 1))
        candidates.append((max(0, duration - max(0.12, 2 / fps)), "ending", beats[-1]["id"], 1))
        offset = max(2 / fps, min(0.16, duration / 120))
        for index, boundary in enumerate(boundaries[1:-1], start=1):
            transition_id = f"{beats[index - 1]['id']}->{beats[index]['id']}"
            candidates.append((boundary - offset, "transition-before", transition_id, 2))
            candidates.append((boundary + offset, "transition-after", transition_id, 2))
    for index in range(target * 2):
        candidates.append((duration * (index + 0.5) / (target * 2), "coverage", None, 3))

    selected: list[dict] = []
    seen_frames: set[int] = set()
    for time_value, kind, beat_id, priority in sorted(candidates, key=lambda item: (item[3], item[0])):
        frame = min(last_frame, max(0, round(time_value * fps)))
        if frame in seen_frames:
            continue
        seen_frames.add(frame)
        selected.append({
            "frame": frame,
            "time": round(frame / fps, 6),
            "kind": kind,
            **({"beatId": beat_id} if beat_id else {}),
        })
        if len(selected) >= target:
            break
    return sorted(selected, key=lambda item: item["frame"])


def write_repair_context(project_dir: Path, scene_plan: dict | None) -> dict | None:
    audit_path = project_dir / "layout-audit.json"
    if not audit_path.exists():
        return None
    try:
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    violations = audit.get("violations") if isinstance(audit, dict) else None
    if not isinstance(violations, list) or not violations:
        return None
    targets = sorted({name for issue in violations for name in issue.get("objects", []) if isinstance(name, str)})
    all_objects = set(scene_plan.get("_objectIds", [])) if scene_plan else set()
    context = {
        "version": 1,
        "kind": "layout-validation",
        "targets": targets,
        "preserve": sorted(all_objects - set(targets)),
        "violations": violations[:20],
        "instruction": "Change only the named targets needed to restore spacing. Preserve every listed object and unrelated beat.",
    }
    (project_dir / "repair-context.json").write_text(json.dumps(context, indent=2), encoding="utf-8")
    return context


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


def validate_narration_script(project_dir: Path, quality: str) -> None:
    """Enforce the narration rules that a markdown file cannot.

    Every one of these started as a written instruction that a generated
    lesson ignored: fragment narration read as a caption list rather than a
    voice, a social cut that came in at seventeen seconds, and an opening that
    was not the question the format is built around."""
    config_file = project_dir / "narration-config.json"
    if config_file.exists():
        try:
            if json.loads(config_file.read_text(encoding="utf-8")).get("enabled") is False:
                return
        except (json.JSONDecodeError, OSError):
            fail("narration-config.json must contain valid JSON.")
    script = project_dir / "narration.json"
    if not script.exists():
        return
    try:
        segments = json.loads(script.read_text(encoding="utf-8")).get("segments") or []
    except (json.JSONDecodeError, OSError):
        fail("narration.json must contain valid JSON.")
    if not segments:
        return
    for index, segment in enumerate(segments, start=1):
        words = len(str(segment.get("text", "")).split())
        if words < 12:
            fail(
                f"Narration passage {index} is {words} words. A passage must be a "
                "spoken sentence of at least 12 words (aim for 18-45), not a caption "
                "fragment - fragments read as a list of labels instead of a voice."
            )
        if words > 60:
            fail(f"Narration passage {index} is {words} words; split it, the limit is 60.")
    starts = [float(segment.get("start", 0)) for segment in segments]
    if starts != sorted(starts):
        fail("Narration passages must be in ascending order of start time.")
    if quality.startswith("vertical"):
        opening = str(segments[0].get("text", "")).lower()
        if "wondered" not in opening:
            fail(
                "A vertical lesson opens on the question the format is built around: "
                "the first narration line must ask 'Have you ever wondered why ...'. "
                f"It currently begins: {str(segments[0].get('text',''))[:80]!r}"
            )
        finish = max(float(segment.get("end") or 0) for segment in segments)
        if finish < 30:
            fail(
                f"The narration only runs to {finish:.1f}s. A vertical lesson is 35-45 "
                "seconds; give the transformation beat the room it needs."
            )


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
    request: dict = {}
    request_path = project_dir / "generation-request.json"
    if request_path.exists():
        try:
            request = json.loads(request_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            fail("generation-request.json must contain valid JSON.")
    scene_plan = validate_scene_plan(project_dir, request)
    if not re.search(r"class\s+GeneratedScene\s*\([^)]*Scene\s*\)", code):
        fail("scene.py must define GeneratedScene as a Scene subclass.")
    if "from manim_layout import" not in code:
        fail("scene.py must import the shared manim_layout guards.")
    if "from manim_paper import" not in code:
        fail(
            "scene.py must build all text through the manim_paper typography "
            "system (running_head, claim, label, caption, expr, fit_stage)."
        )
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        fail(f"scene.py does not parse: {error}")
    if request.get("engineContract") == ENGINE_CONTRACT_VERSION:
        validate_named_layout_guards(tree, set(scene_plan.get("_objectIds", [])) if scene_plan else set())
    forbidden = {"Text", "MarkupText"}
    called = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = (
            func.id
            if isinstance(func, ast.Name)
            else func.attr if isinstance(func, ast.Attribute) else None
        )
        if name:
            called.add(name)
    if called & forbidden:
        fail(
            "scene.py calls Text/MarkupText directly. All text must come from "
            "manim_paper (text, running_head, claim, label, caption, expr) so "
            "sizes, fonts, and spacing stay consistent."
        )
    if "assert_no_overlap" not in called:
        fail(
            "scene.py never calls assert_no_overlap. Assert the independent "
            "peers (including every label) at each stable beat."
        )
    if "assert_scene_safe(" not in code:
        fail("scene.py must call assert_scene_safe for its important visual groups.")
    narrated = (project_dir / "narration.json").exists()
    if narrated:
        config_file = project_dir / "narration-config.json"
        try:
            narrated = config_file.exists() and json.loads(
                config_file.read_text(encoding="utf-8")
            ).get("enabled") is not False
        except (json.JSONDecodeError, OSError):
            narrated = True
    if narrated and "hold_for_narration" not in called:
        fail(
            "This lesson is narrated, so every beat must end with "
            "manim_paper.hold_for_narration(self, beats, index) using timings from "
            "narration_beats('.'). Pacing a narrated beat with a bare self.wait() is "
            "what lets the voice drift ahead of or behind the picture."
        )
    validate_narration_script(project_dir, quality)
    if not has_layout_call(code, "assert_no_overlap", 2):
        fail("scene.py must call assert_no_overlap with at least two independent peer objects.")
    if not has_layout_call(code, "watch_no_overlap", 3):
        fail("scene.py must use watch_no_overlap with the scene and at least two moving peer objects.")
    if "RoundedRectangle(" in code and "assert_inside(" not in code:
        fail("Panel-based scenes must call assert_inside for every panel's content.")

    # Invoke Manim as a Python module. Console-script shebangs embed the build
    # path and can become invalid when a sandbox image is snapshotted/mounted.
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
        "-m",
        "manim",
        *QUALITY_ARGS[quality],
        *([] if quality in CACHED_QUALITIES else ["--disable_caching"]),
        "--media_dir",
        str(media_dir),
        str(source),
        "GeneratedScene",
    ]
    started = time.time()
    environment = dict(os.environ)
    studio_root = str(root / "studio")
    environment["PYTHONPATH"] = studio_root + os.pathsep + environment.get("PYTHONPATH", "")
    layout_audit_path = project_dir / "layout-audit.json"
    repair_context_path = project_dir / "repair-context.json"
    for stale_report in (layout_audit_path, repair_context_path):
        if stale_report.exists():
            stale_report.unlink()
    environment["ORUNE_LAYOUT_AUDIT_PATH"] = str(layout_audit_path)
    result = subprocess.run(
        command,
        cwd=project_dir,
        text=True,
        capture_output=True,
        timeout=900,
        env=environment,
    )
    if result.returncode != 0:
        repair = write_repair_context(project_dir, scene_plan)
        repair_note = (
            "\nTargeted layout repair is in repair-context.json; change only its targets and preserve the listed objects."
            if repair else ""
        )
        fail((result.stderr[-5000:] or result.stdout[-5000:] or "Manim render failed.") + repair_note)
    if repair_context_path.exists():
        repair_context_path.unlink()

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
            fail(
                f"The render produced {actual or 'an unreadable frame'}, but "
                f"{quality} must be {expected[0]}x{expected[1]}."
            )
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
        provider_model = (
            narration_result.get("provider"),
            narration_result.get("model"),
        )
        if (
            narration_result.get("status") != "ready"
            or narration_result.get("enabled") is not True
            or provider_model not in {
                ("speechify", "simba-3.2"),
                ("elevenlabs", "eleven_multilingual_v2"),
            }
        ):
            fail("Narration must be generated by an approved provider and model; fallback audio is not accepted.")

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

    review_samples = build_review_samples(duration, fps, scene_plan)
    review_manifest = {
        "version": 1,
        "strategy": "beat-aware-v1" if scene_plan else "uniform-v1",
        "grid": {"columns": 4, "rows": max(1, math.ceil(len(review_samples) / 4))},
        "samples": review_samples,
    }
    (project_dir / "review-frames.json").write_text(json.dumps(review_manifest, indent=2), encoding="utf-8")
    contact_sheet = project_dir / "contact-sheet.png"
    selected_frames = "+".join(f"eq(n\\,{sample['frame']})" for sample in review_samples)
    rows = review_manifest["grid"]["rows"]
    sheet = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(output),
            "-vf", f"select={selected_frames},scale=360:-2,tile=4x{rows}:padding=8:margin=8:color=white",
            "-fps_mode", "vfr",
            "-frames:v", "1", str(contact_sheet),
        ],
        text=True,
        capture_output=True,
        timeout=90,
    )
    if sheet.returncode != 0:
        fail(sheet.stderr[-2000:] or "Could not create the contact sheet.")

    layout_summary = None
    if layout_audit_path.exists():
        try:
            audit = json.loads(layout_audit_path.read_text(encoding="utf-8"))
            layout_summary = {
                "status": audit.get("status"),
                "checks": audit.get("checks"),
                "namedObjects": audit.get("namedObjects"),
                "violations": len(audit.get("violations", [])),
            }
        except (json.JSONDecodeError, OSError):
            layout_summary = None

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
        "review": {
            "strategy": review_manifest["strategy"],
            "sampleCount": len(review_samples),
            "manifest": "review-frames.json",
        },
        **({"layoutAudit": layout_summary} if layout_summary else {}),
        "narration": narration_result,
    }
    (project_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
