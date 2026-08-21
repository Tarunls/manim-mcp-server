#!/usr/bin/env python3
"""Validate the small JSON contract emitted by the educational video reviewer."""

from __future__ import annotations

import json
from pathlib import Path
import sys


ALLOWED = {
    "renderer": {"manim", "remotion", "composite"},
    "focus": {"balanced", "layout", "motion", "pedagogy", "accessibility", "polish"},
    "strictness": {"quick", "normal", "obsessive"},
    "verdict": {"pass", "needs_changes"},
}


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("Usage: validate_report.py review-report.json")
    path = Path(sys.argv[1])
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Could not read valid report JSON: {error}")
    for key, values in ALLOWED.items():
        if report.get(key) not in values:
            fail(f"Invalid {key}: {report.get(key)!r}")
    if not isinstance(report.get("summary"), str) or not report["summary"].strip():
        fail("summary must be a non-empty string")
    issues = report.get("issues")
    if not isinstance(issues, list):
        fail("issues must be an array")
    for index, issue in enumerate(issues):
        if issue.get("severity") not in {"blocking", "important", "suggestion"}:
            fail(f"Issue {index} has invalid severity")
        if issue.get("category") not in {"layout", "motion", "pedagogy", "accessibility", "polish"}:
            fail(f"Issue {index} has invalid category")
        if not isinstance(issue.get("frame"), int) or issue["frame"] < 0:
            fail(f"Issue {index} needs a non-negative integer frame")
        if not isinstance(issue.get("time"), (int, float)) or issue["time"] < 0:
            fail(f"Issue {index} needs a non-negative time")
        if not all(isinstance(issue.get(field), str) and issue[field].strip() for field in ("evidence", "fix")):
            fail(f"Issue {index} needs evidence and fix text")
    expected = "needs_changes" if issues else "pass"
    if report["verdict"] != expected:
        fail(f"verdict must be {expected} for this issues array")
    print("review-report.json is valid")


if __name__ == "__main__":
    main()
