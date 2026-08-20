#!/usr/bin/env python3
"""Static contract validation and reproducibility metadata for generated scenes."""

from __future__ import annotations

import ast
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


REQUIRED_LAYOUT_IMPORTS = {
    "assert_inside",
    "assert_scene_safe",
    "fit_inside",
    "stack_in_panel",
}

HELPER_SIGNATURES = {
    "connect_mobjects": {
        "min_args": 2,
        "max_args": 2,
        "keywords": {"kind", "buff", "color", "stroke_width"},
    },
    "fit_inside": {"min_args": 2, "max_args": 3, "keywords": {"padding"}},
    "stack_in_panel": {
        "min_args": 1,
        "max_args": None,
        "keywords": {"padding", "buff", "aligned_edge"},
    },
    "assert_inside": {"min_args": 2, "max_args": None, "keywords": {"padding"}},
    "assert_scene_safe": {"min_args": 1, "max_args": None, "keywords": {"margin"}},
}

TEXT_CONSTRUCTORS = {"Text", "MarkupText", "Paragraph"}
PANEL_CONSTRUCTORS = {"RoundedRectangle"}


@dataclass(frozen=True)
class ContractIssue:
    line: int
    message: str


@dataclass(frozen=True)
class SceneContractReport:
    source_hash: str
    scene_classes: list[str]
    panel_variables: list[str]
    guarded_panels: list[str]
    font_families: list[str]
    explicit_wait_seconds: float
    estimated_duration_seconds: float
    dynamic_timing_calls: int
    issues: list[ContractIssue]

    @property
    def valid(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["valid"] = self.valid
        return result


@dataclass(frozen=True)
class NarrationContractReport:
    starts: list[float]
    word_counts: list[int]
    minimum_duration_seconds: float
    issues: list[ContractIssue]

    @property
    def valid(self) -> bool:
        return not self.issues


def _call_name(node: ast.Call) -> str | None:
    function = node.func
    if isinstance(function, ast.Name):
        return function.id
    if isinstance(function, ast.Attribute):
        return function.attr
    return None


def _qualified_call_name(node: ast.Call) -> str | None:
    parts: list[str] = []
    current: ast.expr = node.func
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        parts.append(current.id)
        return ".".join(reversed(parts))
    return None


def _number(node: ast.AST | None) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        value = _number(node.operand)
        return -value if value is not None else None
    return None


def _string(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _is_scene_base(node: ast.expr) -> bool:
    if isinstance(node, ast.Name):
        return node.id.endswith("Scene")
    if isinstance(node, ast.Attribute):
        return node.attr.endswith("Scene")
    return False


def _layout_imports(tree: ast.Module) -> set[str]:
    imported: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "manim_layout":
            imported.update(alias.name for alias in node.names)
    return imported


def _constructor_call(value: ast.AST, constructors: set[str]) -> ast.Call | None:
    current = value
    while isinstance(current, ast.Call):
        if _call_name(current) in constructors:
            return current
        if isinstance(current.func, ast.Attribute):
            current = current.func.value
            continue
        break
    return None


def _assigned_constructor_calls(tree: ast.Module, constructors: set[str]) -> dict[str, ast.Call]:
    assigned: dict[str, ast.Call] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        value = _constructor_call(node.value, constructors)
        if value is None:
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for target in targets:
            if isinstance(target, ast.Name):
                assigned[target.id] = value
    return assigned


def _guarded_panel_names(tree: ast.Module) -> set[str]:
    guarded: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or _call_name(node) != "assert_inside" or not node.args:
            continue
        if isinstance(node.args[0], ast.Name):
            guarded.add(node.args[0].id)
    return guarded


def _font_families(tree: ast.Module) -> list[str]:
    fonts: set[str] = set()
    has_text = False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or _call_name(node) not in TEXT_CONSTRUCTORS:
            continue
        has_text = True
        keyword = next((item for item in node.keywords if item.arg == "font"), None)
        value = _string(keyword.value) if keyword else None
        fonts.add(value or "<manim-default>")
    return sorted(fonts) if has_text else []


class _TimingVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.wait_seconds = 0.0
        self.estimated_duration = 0.0
        self.dynamic_calls = 0
        self.loop_depth = 0

    def _visit_loop(self, node: ast.For | ast.AsyncFor | ast.While) -> None:
        self.loop_depth += 1
        self.generic_visit(node)
        self.loop_depth -= 1

    visit_For = _visit_loop
    visit_AsyncFor = _visit_loop
    visit_While = _visit_loop

    def visit_Call(self, node: ast.Call) -> None:
        name = _qualified_call_name(node)
        if name in {"self.wait", "self.play"}:
            if self.loop_depth:
                self.dynamic_calls += 1
            elif name == "self.wait":
                duration_node = node.args[0] if node.args else None
                duration_keyword = next((item.value for item in node.keywords if item.arg == "duration"), None)
                duration = _number(duration_node or duration_keyword)
                if duration is None:
                    self.dynamic_calls += 1
                else:
                    self.wait_seconds += duration
                    self.estimated_duration += duration
            else:
                run_time_keyword = next((item.value for item in node.keywords if item.arg == "run_time"), None)
                run_time = _number(run_time_keyword)
                if run_time_keyword is not None and run_time is None:
                    self.dynamic_calls += 1
                else:
                    self.estimated_duration += run_time if run_time is not None else 1.0
        self.generic_visit(node)


def _timing_summary(tree: ast.Module) -> tuple[float, float, int]:
    visitor = _TimingVisitor()
    visitor.visit(tree)
    return visitor.wait_seconds, visitor.estimated_duration, visitor.dynamic_calls


def validate_narration_spec(spec: Any, estimated_scene_duration: float | None = None) -> NarrationContractReport:
    issues: list[ContractIssue] = []
    segments = spec.get("segments") if isinstance(spec, dict) else None
    if not isinstance(segments, list) or not 3 <= len(segments) <= 5:
        issues.append(ContractIssue(1, "narration.json must contain 3-5 timed segments."))
        return NarrationContractReport([], [], 0.0, issues)

    starts: list[float] = []
    word_counts: list[int] = []
    for index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            issues.append(ContractIssue(index, f"Narration segment {index} must be an object."))
            continue
        try:
            start = float(segment.get("start"))
        except (TypeError, ValueError):
            issues.append(ContractIssue(index, f"Narration segment {index} needs a numeric start."))
            continue
        text = str(segment.get("text") or "").strip()
        words = re.findall(r"\b[\w’'-]+\b", text, flags=re.UNICODE)
        if start < 0:
            issues.append(ContractIssue(index, f"Narration segment {index} cannot start before zero."))
        if not 18 <= len(words) <= 45:
            issues.append(
                ContractIssue(index, f"Narration segment {index} must contain 18-45 words; found {len(words)}.")
            )
        starts.append(start)
        word_counts.append(len(words))

    if starts and starts != sorted(starts):
        issues.append(ContractIssue(1, "Narration segment starts must be in ascending order."))
    if len(set(starts)) != len(starts):
        issues.append(ContractIssue(1, "Narration segment starts must be unique."))
    if starts and starts[0] > 1.0:
        issues.append(ContractIssue(1, "The first narration segment must begin within the first second."))

    minimum_duration = sum(word_counts) / 145.0 * 60.0 + len(word_counts) * 0.8
    if (
        estimated_scene_duration is not None
        and estimated_scene_duration > 0
        and minimum_duration - estimated_scene_duration > 2.0
    ):
        issues.append(
            ContractIssue(
                1,
                f"The narration needs about {minimum_duration:.1f}s but the explicit scene timeline is only "
                f"{estimated_scene_duration:.1f}s. Extend the visual beats instead of adding a final frozen hold.",
            )
        )
    return NarrationContractReport(starts, word_counts, round(minimum_duration, 3), issues)


def validate_scene_source(source: str) -> SceneContractReport:
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    issues: list[ContractIssue] = []
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        issues.append(ContractIssue(error.lineno or 1, f"Python syntax error: {error.msg}."))
        return SceneContractReport(source_hash, [], [], [], [], 0.0, 0.0, 0, issues)

    scene_classes = [
        node.name
        for node in tree.body
        if isinstance(node, ast.ClassDef) and any(_is_scene_base(base) for base in node.bases)
    ]
    if scene_classes != ["GeneratedScene"]:
        issues.append(
            ContractIssue(
                1,
                "Define exactly one Scene subclass named GeneratedScene; "
                f"found {scene_classes or 'none'}.",
            )
        )

    imported = _layout_imports(tree)
    missing_imports = sorted(REQUIRED_LAYOUT_IMPORTS - imported)
    if missing_imports:
        issues.append(
            ContractIssue(1, f"Import the required manim_layout helpers: {', '.join(missing_imports)}.")
        )

    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
    if not any(_call_name(call) == "assert_scene_safe" for call in calls):
        issues.append(ContractIssue(1, "Call assert_scene_safe() for the scene's important content."))

    for call in calls:
        name = _call_name(call)
        if name not in HELPER_SIGNATURES:
            continue
        signature = HELPER_SIGNATURES[name]
        argument_count = len(call.args)
        if argument_count < signature["min_args"]:
            issues.append(
                ContractIssue(call.lineno, f"{name}() needs at least {signature['min_args']} positional arguments.")
            )
        maximum = signature["max_args"]
        if maximum is not None and argument_count > maximum:
            issues.append(ContractIssue(call.lineno, f"{name}() accepts at most {maximum} positional arguments."))
        for keyword in call.keywords:
            if keyword.arg is not None and keyword.arg not in signature["keywords"]:
                issues.append(
                    ContractIssue(call.lineno, f"{name}() does not accept the keyword argument {keyword.arg!r}.")
                )

    panels = _assigned_constructor_calls(tree, PANEL_CONSTRUCTORS)
    guarded = _guarded_panel_names(tree)
    for name, call in sorted(panels.items()):
        if name not in guarded:
            issues.append(
                ContractIssue(call.lineno, f"Panel {name!r} must be passed as the first argument to assert_inside().")
            )

    random_calls = {
        name
        for call in calls
        if (name := _qualified_call_name(call))
        and (name.startswith("random.") or name.startswith("np.random.") or name.startswith("numpy.random."))
    }
    has_seed = any(name.endswith(".seed") for name in random_calls)
    unseeded = sorted(name for name in random_calls if not name.endswith(".seed"))
    if unseeded and not has_seed:
        first = next(
            call for call in calls if _qualified_call_name(call) in set(unseeded)
        )
        issues.append(
            ContractIssue(
                first.lineno,
                "Random scene generation must set an explicit seed before use: " + ", ".join(unseeded) + ".",
            )
        )

    wait_seconds, duration_seconds, dynamic_calls = _timing_summary(tree)
    return SceneContractReport(
        source_hash=source_hash,
        scene_classes=scene_classes,
        panel_variables=sorted(panels),
        guarded_panels=sorted(set(panels) & guarded),
        font_families=_font_families(tree),
        explicit_wait_seconds=round(wait_seconds, 3),
        estimated_duration_seconds=round(duration_seconds, 3),
        dynamic_timing_calls=dynamic_calls,
        issues=issues,
    )


def semantic_sample_times(duration: float, narration_starts: list[float], count: int = 6) -> list[float]:
    """Choose frames around visual beats, then fill remaining slots across the timeline."""
    if duration <= 0 or count <= 0:
        return []
    latest = max(0.0, duration - 0.1)
    candidates: list[float] = [min(max(duration * 0.08, 0.1), latest)]
    starts = sorted({max(0.0, min(float(value), latest)) for value in narration_starts})
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else duration
        candidates.append(min(start + 0.35, latest))
        candidates.append(min(start + max(0.35, (end - start) * 0.55), latest))
    candidates.extend(latest * (index + 0.5) / count for index in range(count))

    selected: list[float] = []
    for candidate in candidates:
        value = round(candidate, 3)
        if all(abs(value - existing) >= 0.12 for existing in selected):
            selected.append(value)
        if len(selected) == count:
            break
    return sorted(selected)


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: scene_contract.py SCENE.py", file=sys.stderr)
        raise SystemExit(2)
    source_path = Path(sys.argv[1])
    report = validate_scene_source(source_path.read_text(encoding="utf-8"))
    print(json.dumps(report.to_dict(), indent=2))
    raise SystemExit(0 if report.valid else 1)


if __name__ == "__main__":
    main()
