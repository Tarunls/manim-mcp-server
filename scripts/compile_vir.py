#!/usr/bin/env python3
"""Compile a project's video.vir.json into deterministic Manim artifacts."""

from __future__ import annotations

import json
from pathlib import Path
import sys

from video_ir import VideoIRValidationError, compile_project


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: compile_vir.py PROJECT_DIR", file=sys.stderr)
        raise SystemExit(2)
    project_dir = Path(sys.argv[1]).resolve()
    try:
        compiled = compile_project(project_dir)
    except (ValueError, VideoIRValidationError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
    print(
        json.dumps(
            {
                "schemaVersion": compiled.report.schema_version,
                "virHash": compiled.vir_hash,
                "duration": compiled.report.duration_seconds,
                "beats": compiled.report.beat_count,
                "staticWaitRatio": compiled.report.static_wait_ratio,
                "outputs": ["scene.py", "narration.json"],
            }
        )
    )


if __name__ == "__main__":
    main()
