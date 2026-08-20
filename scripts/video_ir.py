#!/usr/bin/env python3
"""Validate and deterministically compile Manim Studio Video IR v0.1."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from typing import Any

try:
    from .scene_contract import validate_narration_spec, validate_scene_source
except ImportError:  # Executed from scripts/ as a standalone program.
    from scene_contract import validate_narration_spec, validate_scene_source


SCHEMA_VERSIONS = {"0.1", "0.2"}
NODE_TYPES = {"text", "panel", "rectangle", "circle", "square", "group", "connector"}
CONSTRAINT_TYPES = {"anchor", "nextTo", "align", "inside", "shift"}
CUE_ACTIONS = {
    "fadeIn", "create", "write", "grow", "slideIn", "draw",
    "indicate", "circumscribe", "wiggle", "flash",
    "fadeOut", "slideOut", "shrink", "uncreate",
}
ENTRANCE_ACTIONS = {"fadeIn", "create", "write", "grow", "slideIn", "draw"}
EMPHASIS_ACTIONS = {"indicate", "circumscribe", "wiggle", "flash"}
EXIT_ACTIONS = {"fadeOut", "slideOut", "shrink", "uncreate"}
EASINGS = {"smooth", "linear", "thereAndBack", "rushIn", "rushOut"}
TRANSITION_STYLES = {"fade", "slide", "shrink", "uncreate", "crossfade", "push", "morph"}
CONTINUITY_TRANSITIONS = {"crossfade", "push", "morph"}
ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


@dataclass(frozen=True)
class VideoIRIssue:
    path: str
    message: str


@dataclass(frozen=True)
class VideoIRReport:
    schema_version: str | None
    duration_seconds: float
    beat_count: int
    static_wait_seconds: float
    static_wait_ratio: float
    issues: list[VideoIRIssue]

    @property
    def valid(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["valid"] = self.valid
        return result


@dataclass(frozen=True)
class CompiledVideo:
    source: str
    narration: dict[str, Any]
    report: VideoIRReport
    vir_hash: str


class VideoIRValidationError(ValueError):
    def __init__(self, report: VideoIRReport):
        self.report = report
        details = "\n".join(f"{issue.path}: {issue.message}" for issue in report.issues)
        super().__init__(f"Video IR validation failed:\n{details}")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _require_keys(
    value: Any,
    path: str,
    required: set[str],
    allowed: set[str],
    issues: list[VideoIRIssue],
) -> bool:
    if not isinstance(value, dict):
        issues.append(VideoIRIssue(path, "must be an object."))
        return False
    for key in sorted(required - value.keys()):
        issues.append(VideoIRIssue(path, f"is missing required property {key!r}."))
    for key in sorted(value.keys() - allowed):
        issues.append(VideoIRIssue(f"{path}.{key}", "is not a supported property in Video IR v0.1."))
    return True


def _valid_id(value: Any, path: str, issues: list[VideoIRIssue]) -> bool:
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        issues.append(VideoIRIssue(path, "must match ^[a-z][a-z0-9-]{0,63}$."))
        return False
    return True


def _token_number(
    value: Any,
    spacing: dict[str, Any],
    path: str,
    issues: list[VideoIRIssue],
) -> float | None:
    if _is_number(value) and float(value) >= 0:
        return float(value)
    if isinstance(value, str) and value in spacing and _is_number(spacing[value]):
        return float(spacing[value])
    issues.append(VideoIRIssue(path, "must be a non-negative number or a defined theme.spacing token."))
    return None


def _duration_number(
    value: Any,
    durations: dict[str, Any],
    path: str,
    issues: list[VideoIRIssue],
) -> float | None:
    if _is_number(value) and 0 < float(value) <= 10:
        return float(value)
    if isinstance(value, str) and value in durations and _is_number(durations[value]):
        result = float(durations[value])
        if 0 < result <= 10:
            return result
    issues.append(VideoIRIssue(path, "must be a positive number up to 10 or a defined theme.motion.durations token."))
    return None


def _descendants(node_id: str, groups: dict[str, list[str]]) -> set[str]:
    result: set[str] = set()
    stack = list(groups.get(node_id, []))
    while stack:
        child = stack.pop()
        if child in result:
            continue
        result.add(child)
        stack.extend(groups.get(child, []))
    return result


def validate_video_ir(data: Any) -> VideoIRReport:
    issues: list[VideoIRIssue] = []
    total_duration = 0.0
    total_static = 0.0
    beat_count = 0
    schema_version = data.get("schemaVersion") if isinstance(data, dict) else None

    if not _require_keys(
        data,
        "$",
        {"schemaVersion", "format", "theme", "beats"},
        {"schemaVersion", "format", "theme", "beats"},
        issues,
    ):
        return VideoIRReport(None, 0.0, 0, 0.0, 0.0, issues)
    if schema_version not in SCHEMA_VERSIONS:
        issues.append(VideoIRIssue("$.schemaVersion", f"must be one of {sorted(SCHEMA_VERSIONS)}."))

    format_spec = data.get("format")
    frame_rate = 30
    if _require_keys(
        format_spec,
        "$.format",
        {"width", "height", "fps", "background", "safeArea"},
        {"width", "height", "fps", "background", "safeArea"},
        issues,
    ):
        for key, minimum, maximum in (("width", 320, 7680), ("height", 320, 4320)):
            value = format_spec.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
                issues.append(VideoIRIssue(f"$.format.{key}", f"must be an integer from {minimum} to {maximum}."))
        if (
            isinstance(format_spec.get("width"), int)
            and isinstance(format_spec.get("height"), int)
            and format_spec["height"] > 0
            and abs(format_spec["width"] / format_spec["height"] - 16 / 9) > 0.01
        ):
            issues.append(VideoIRIssue("$.format", "Video IR currently requires a 16:9 frame."))
        if format_spec.get("fps") not in {24, 25, 30, 50, 60}:
            issues.append(VideoIRIssue("$.format.fps", "must be one of 24, 25, 30, 50, or 60."))
        else:
            frame_rate = int(format_spec["fps"])
        if not isinstance(format_spec.get("background"), str):
            issues.append(VideoIRIssue("$.format.background", "must be a color string or palette token."))
        safe_area = format_spec.get("safeArea")
        if not _is_number(safe_area) or not 0.1 <= float(safe_area) <= 1.5:
            issues.append(VideoIRIssue("$.format.safeArea", "must be between 0.1 and 1.5 Manim units."))

    theme = data.get("theme")
    palette: dict[str, Any] = {}
    spacing: dict[str, Any] = {}
    text_styles: dict[str, Any] = {}
    motion_durations: dict[str, Any] = {}
    default_ease = "smooth"
    if _require_keys(
        theme,
        "$.theme",
        {"fontFamily", "palette", "spacing", "textStyles"},
        {"fontFamily", "palette", "spacing", "textStyles", "motion"},
        issues,
    ):
        if not isinstance(theme.get("fontFamily"), str) or not theme["fontFamily"].strip():
            issues.append(VideoIRIssue("$.theme.fontFamily", "must be a non-empty font family."))
        palette = theme.get("palette") if isinstance(theme.get("palette"), dict) else {}
        for token in ("background", "surface", "text", "muted", "accent"):
            if not isinstance(palette.get(token), str) or not palette[token]:
                issues.append(VideoIRIssue(f"$.theme.palette.{token}", "must define a color string."))
        for token, value in palette.items():
            if not isinstance(token, str) or not isinstance(value, str) or not value:
                issues.append(VideoIRIssue("$.theme.palette", "tokens and color values must be non-empty strings."))
        spacing = theme.get("spacing") if isinstance(theme.get("spacing"), dict) else {}
        if len(spacing) < 3:
            issues.append(VideoIRIssue("$.theme.spacing", "must define at least three spacing tokens."))
        for token, value in spacing.items():
            if not isinstance(token, str) or not _is_number(value) or not 0 <= float(value) <= 3:
                issues.append(VideoIRIssue(f"$.theme.spacing.{token}", "must be a number from 0 to 3."))
        text_styles = theme.get("textStyles") if isinstance(theme.get("textStyles"), dict) else {}
        if len(text_styles) < 3:
            issues.append(VideoIRIssue("$.theme.textStyles", "must define at least three text roles."))
        for role, style in text_styles.items():
            role_path = f"$.theme.textStyles.{role}"
            if not _require_keys(style, role_path, {"fontSize", "color", "weight"}, {"fontSize", "color", "weight"}, issues):
                continue
            if not _is_number(style.get("fontSize")) or not 12 <= float(style["fontSize"]) <= 160:
                issues.append(VideoIRIssue(f"{role_path}.fontSize", "must be from 12 to 160."))
            if not isinstance(style.get("color"), str):
                issues.append(VideoIRIssue(f"{role_path}.color", "must be a color string or palette token."))
            if style.get("weight") not in {"NORMAL", "MEDIUM", "SEMIBOLD", "BOLD"}:
                issues.append(VideoIRIssue(f"{role_path}.weight", "must be NORMAL, MEDIUM, SEMIBOLD, or BOLD."))
        motion = theme.get("motion")
        if motion is not None:
            motion_path = "$.theme.motion"
            if _require_keys(
                motion,
                motion_path,
                {"durations", "distance", "defaultEase"},
                {"durations", "distance", "defaultEase"},
                issues,
            ):
                motion_durations = motion.get("durations") if isinstance(motion.get("durations"), dict) else {}
                for token in ("fast", "base", "slow"):
                    value = motion_durations.get(token)
                    if not _is_number(value) or not 0.1 <= float(value) <= 4:
                        issues.append(VideoIRIssue(f"{motion_path}.durations.{token}", "must be from 0.1 to 4 seconds."))
                    elif abs(float(value) * frame_rate - round(float(value) * frame_rate)) > 1e-6:
                        issues.append(VideoIRIssue(f"{motion_path}.durations.{token}", f"must align to the {frame_rate} fps frame grid."))
                for token, value in motion_durations.items():
                    if token in {"fast", "base", "slow"}:
                        continue
                    if not isinstance(token, str) or not _is_number(value) or not 0.1 <= float(value) <= 4:
                        issues.append(VideoIRIssue(f"{motion_path}.durations.{token}", "must be from 0.1 to 4 seconds."))
                    elif abs(float(value) * frame_rate - round(float(value) * frame_rate)) > 1e-6:
                        issues.append(VideoIRIssue(f"{motion_path}.durations.{token}", f"must align to the {frame_rate} fps frame grid."))
                distance = motion.get("distance")
                if not _is_number(distance) or not 0.05 <= float(distance) <= 2:
                    issues.append(VideoIRIssue(f"{motion_path}.distance", "must be from 0.05 to 2 Manim units."))
                default_ease = motion.get("defaultEase")
                if default_ease not in EASINGS:
                    issues.append(VideoIRIssue(f"{motion_path}.defaultEase", f"must be one of {sorted(EASINGS)}."))
            if schema_version == "0.1":
                issues.append(VideoIRIssue(motion_path, "requires schemaVersion '0.2'."))

    beats = data.get("beats")
    if not isinstance(beats, list) or not 3 <= len(beats) <= 5:
        issues.append(VideoIRIssue("$.beats", "must contain 3-5 beats."))
        beats = beats if isinstance(beats, list) else []
    beat_count = len(beats)
    seen_beat_ids: set[str] = set()
    narration_segments: list[dict[str, Any]] = []

    for beat_index, beat in enumerate(beats):
        beat_path = f"$.beats[{beat_index}]"
        allowed_beat = {
            "id", "intent", "focus", "duration", "narration", "transitionDuration",
            "transition", "allowLongHold", "nodes", "constraints", "cues",
        }
        if not _require_keys(
            beat,
            beat_path,
            {"id", "intent", "focus", "duration", "narration", "nodes", "constraints", "cues"},
            allowed_beat,
            issues,
        ):
            continue
        beat_id = beat.get("id")
        if _valid_id(beat_id, f"{beat_path}.id", issues):
            if beat_id in seen_beat_ids:
                issues.append(VideoIRIssue(f"{beat_path}.id", f"duplicate beat id {beat_id!r}."))
            seen_beat_ids.add(beat_id)
        if not isinstance(beat.get("intent"), str) or not 8 <= len(beat["intent"].strip()) <= 300:
            issues.append(VideoIRIssue(f"{beat_path}.intent", "must contain 8-300 characters."))
        duration = beat.get("duration")
        duration_value = float(duration) if _is_number(duration) else 0.0
        if not _is_number(duration) or not 3 <= duration_value <= 30:
            issues.append(VideoIRIssue(f"{beat_path}.duration", "must be from 3 to 30 seconds."))
        elif abs(duration_value * frame_rate - round(duration_value * frame_rate)) > 1e-6:
            issues.append(VideoIRIssue(f"{beat_path}.duration", f"must align to the {frame_rate} fps frame grid."))
        transition_value = 0.5 if beat_index < len(beats) - 1 else 0.0
        if "transition" in beat and "transitionDuration" in beat:
            issues.append(VideoIRIssue(beat_path, "cannot define both transition and transitionDuration."))
        if "transition" in beat:
            transition_spec = beat["transition"]
            transition_path = f"{beat_path}.transition"
            if _require_keys(
                transition_spec,
                transition_path,
                {"style", "duration"},
                {"style", "duration", "direction", "distance"},
                issues,
            ):
                if schema_version == "0.1":
                    issues.append(VideoIRIssue(transition_path, "requires schemaVersion '0.2'."))
                style = transition_spec.get("style")
                if style not in TRANSITION_STYLES:
                    issues.append(VideoIRIssue(f"{transition_path}.style", f"must be one of {sorted(TRANSITION_STYLES)}."))
                if beat_index == len(beats) - 1 and style in CONTINUITY_TRANSITIONS:
                    issues.append(VideoIRIssue(f"{transition_path}.style", "requires a following beat."))
                resolved = _duration_number(transition_spec.get("duration"), motion_durations, f"{transition_path}.duration", issues)
                transition_value = resolved or 0.0
                if resolved is not None and abs(resolved * frame_rate - round(resolved * frame_rate)) > 1e-6:
                    issues.append(VideoIRIssue(f"{transition_path}.duration", f"must align to the {frame_rate} fps frame grid."))
                if "direction" in transition_spec and transition_spec["direction"] not in {"up", "down", "left", "right"}:
                    issues.append(VideoIRIssue(f"{transition_path}.direction", "must be up, down, left, or right."))
                if "distance" in transition_spec:
                    distance = transition_spec["distance"]
                    if not _is_number(distance) or not 0.05 <= float(distance) <= 4:
                        issues.append(VideoIRIssue(f"{transition_path}.distance", "must be from 0.05 to 4 Manim units."))
        else:
            transition = beat.get("transitionDuration", transition_value)
            transition_value = float(transition) if _is_number(transition) else 0.0
            if beat_index < len(beats) - 1 or "transitionDuration" in beat:
                if not _is_number(transition) or not 0.2 <= transition_value <= 2:
                    issues.append(VideoIRIssue(f"{beat_path}.transitionDuration", "must be from 0.2 to 2 seconds."))
                elif abs(transition_value * frame_rate - round(transition_value * frame_rate)) > 1e-6:
                    issues.append(VideoIRIssue(f"{beat_path}.transitionDuration", f"must align to the {frame_rate} fps frame grid."))
        if "allowLongHold" in beat and not isinstance(beat["allowLongHold"], bool):
            issues.append(VideoIRIssue(f"{beat_path}.allowLongHold", "must be a boolean."))
        narration = beat.get("narration")
        if not isinstance(narration, str) or not narration.strip():
            issues.append(VideoIRIssue(f"{beat_path}.narration", "must be non-empty text."))
        else:
            narration_segments.append({"start": round(total_duration, 3), "text": narration.strip()})
            word_count = len(re.findall(r"\b[\w’'-]+\b", narration, flags=re.UNICODE))
            narration_seconds = word_count / 145.0 * 60.0 + 0.8
            if duration_value > 0 and narration_seconds - duration_value > 2.0:
                issues.append(
                    VideoIRIssue(
                        f"{beat_path}.narration",
                        f"needs about {narration_seconds:.1f}s but this beat is only {duration_value:.1f}s.",
                    )
                )

        nodes = beat.get("nodes")
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 40:
            issues.append(VideoIRIssue(f"{beat_path}.nodes", "must contain 1-40 nodes."))
            nodes = nodes if isinstance(nodes, list) else []
        node_by_id: dict[str, dict[str, Any]] = {}
        groups: dict[str, list[str]] = {}
        parent_of: dict[str, str] = {}
        panels: set[str] = set()
        connectors: dict[str, dict[str, Any]] = {}

        for node_index, node in enumerate(nodes):
            node_path = f"{beat_path}.nodes[{node_index}]"
            if not isinstance(node, dict):
                issues.append(VideoIRIssue(node_path, "must be an object."))
                continue
            node_type = node.get("type")
            common = {"id", "type"}
            required = set(common)
            allowed = set(common)
            if node_type == "text":
                required |= {"text", "role"}
                allowed |= {"text", "role", "color"}
            elif node_type in {"panel", "rectangle"}:
                required |= {"width", "height"}
                allowed |= {"width", "height", "style"}
                if node_type == "panel":
                    allowed.add("cornerRadius")
            elif node_type == "circle":
                required.add("radius")
                allowed |= {"radius", "style"}
            elif node_type == "square":
                required.add("sideLength")
                allowed |= {"sideLength", "style"}
            elif node_type == "group":
                required |= {"children", "layout", "gap", "align"}
                allowed |= {"children", "layout", "gap", "align"}
            elif node_type == "connector":
                required |= {"from", "to", "kind"}
                allowed |= {"from", "to", "kind", "color", "strokeWidth", "buff"}
            else:
                issues.append(VideoIRIssue(f"{node_path}.type", f"must be one of {sorted(NODE_TYPES)}."))
            _require_keys(node, node_path, required, allowed, issues)
            node_id = node.get("id")
            if _valid_id(node_id, f"{node_path}.id", issues):
                if node_id in node_by_id:
                    issues.append(VideoIRIssue(f"{node_path}.id", f"duplicate node id {node_id!r}."))
                else:
                    node_by_id[node_id] = node
            if node_type == "text":
                if not isinstance(node.get("text"), str) or not node["text"].strip() or len(node["text"]) > 500:
                    issues.append(VideoIRIssue(f"{node_path}.text", "must contain 1-500 characters."))
                if node.get("role") not in text_styles:
                    issues.append(VideoIRIssue(f"{node_path}.role", "must reference a theme.textStyles role."))
            elif node_type in {"panel", "rectangle"}:
                for dimension in ("width", "height"):
                    if not _is_number(node.get(dimension)) or float(node[dimension]) <= 0:
                        issues.append(VideoIRIssue(f"{node_path}.{dimension}", "must be positive."))
                if node_type == "panel" and isinstance(node_id, str):
                    panels.add(node_id)
            elif node_type == "circle":
                if not _is_number(node.get("radius")) or float(node["radius"]) <= 0:
                    issues.append(VideoIRIssue(f"{node_path}.radius", "must be positive."))
            elif node_type == "square":
                if not _is_number(node.get("sideLength")) or float(node["sideLength"]) <= 0:
                    issues.append(VideoIRIssue(f"{node_path}.sideLength", "must be positive."))
            if node_type in {"panel", "rectangle", "circle", "square"}:
                style = node.get("style", {})
                style_path = f"{node_path}.style"
                if not isinstance(style, dict):
                    issues.append(VideoIRIssue(style_path, "must be an object."))
                else:
                    _require_keys(style, style_path, set(), {"fill", "stroke", "strokeWidth", "fillOpacity"}, issues)
                    for color_key in ("fill", "stroke"):
                        if color_key in style and not isinstance(style[color_key], str):
                            issues.append(VideoIRIssue(f"{style_path}.{color_key}", "must be a color string or palette token."))
                    if "strokeWidth" in style and (
                        not _is_number(style["strokeWidth"]) or not 0 <= float(style["strokeWidth"]) <= 20
                    ):
                        issues.append(VideoIRIssue(f"{style_path}.strokeWidth", "must be from 0 to 20."))
                    if "fillOpacity" in style and (
                        not _is_number(style["fillOpacity"]) or not 0 <= float(style["fillOpacity"]) <= 1
                    ):
                        issues.append(VideoIRIssue(f"{style_path}.fillOpacity", "must be from 0 to 1."))
                if node_type == "panel" and "cornerRadius" in node and (
                    not _is_number(node["cornerRadius"]) or not 0 <= float(node["cornerRadius"]) <= 1
                ):
                    issues.append(VideoIRIssue(f"{node_path}.cornerRadius", "must be from 0 to 1."))
            elif node_type == "group":
                children = node.get("children")
                valid_children = isinstance(children, list) and all(isinstance(child, str) for child in children)
                if not valid_children or not children or len(children) != len(set(children)):
                    issues.append(VideoIRIssue(f"{node_path}.children", "must contain unique child ids."))
                    children = children if valid_children else []
                groups[str(node_id)] = [child for child in children if isinstance(child, str)]
                if node.get("layout") not in {"row", "column"}:
                    issues.append(VideoIRIssue(f"{node_path}.layout", "must be row or column."))
                if node.get("align") not in {"start", "center", "end"}:
                    issues.append(VideoIRIssue(f"{node_path}.align", "must be start, center, or end."))
                _token_number(node.get("gap"), spacing, f"{node_path}.gap", issues)
            elif node_type == "connector":
                if schema_version == "0.1":
                    issues.append(VideoIRIssue(node_path, "connector nodes require schemaVersion '0.2'."))
                if isinstance(node_id, str):
                    connectors[node_id] = node
                if node.get("kind") not in {"arrow", "line"}:
                    issues.append(VideoIRIssue(f"{node_path}.kind", "must be arrow or line."))
                for endpoint in ("from", "to"):
                    if not isinstance(node.get(endpoint), str):
                        issues.append(VideoIRIssue(f"{node_path}.{endpoint}", "must reference a node id."))
                if node.get("from") == node.get("to"):
                    issues.append(VideoIRIssue(node_path, "connector endpoints must be different."))
                if "color" in node and not isinstance(node["color"], str):
                    issues.append(VideoIRIssue(f"{node_path}.color", "must be a color string or palette token."))
                if "strokeWidth" in node and (
                    not _is_number(node["strokeWidth"]) or not 0.5 <= float(node["strokeWidth"]) <= 20
                ):
                    issues.append(VideoIRIssue(f"{node_path}.strokeWidth", "must be from 0.5 to 20."))
                if "buff" in node:
                    _token_number(node["buff"], spacing, f"{node_path}.buff", issues)

        for group_id, children in groups.items():
            for child in children:
                if child not in node_by_id:
                    issues.append(VideoIRIssue(f"{beat_path}.nodes", f"group {group_id!r} references unknown child {child!r}."))
                elif child == group_id:
                    issues.append(VideoIRIssue(f"{beat_path}.nodes", f"group {group_id!r} cannot contain itself."))
                elif child in parent_of:
                    issues.append(VideoIRIssue(f"{beat_path}.nodes", f"node {child!r} belongs to both {parent_of[child]!r} and {group_id!r}."))
                else:
                    parent_of[child] = group_id
                if child in connectors:
                    issues.append(VideoIRIssue(f"{beat_path}.nodes", f"derived connector {child!r} cannot be a group child."))
        for group_id in groups:
            if group_id in _descendants(group_id, groups):
                issues.append(VideoIRIssue(f"{beat_path}.nodes", f"group cycle includes {group_id!r}."))
        for connector_id, connector in connectors.items():
            for endpoint in ("from", "to"):
                reference = connector.get(endpoint)
                if reference not in node_by_id:
                    issues.append(VideoIRIssue(f"{beat_path}.nodes", f"connector {connector_id!r} references unknown {endpoint} node {reference!r}."))
                elif reference in connectors:
                    issues.append(VideoIRIssue(f"{beat_path}.nodes", f"connector {connector_id!r} cannot connect to another connector."))

        focus = beat.get("focus")
        if focus not in node_by_id:
            issues.append(VideoIRIssue(f"{beat_path}.focus", "must reference a node in this beat."))

        constraints = beat.get("constraints")
        if not isinstance(constraints, list) or not 1 <= len(constraints) <= 80:
            issues.append(VideoIRIssue(f"{beat_path}.constraints", "must contain 1-80 ordered constraints."))
            constraints = constraints if isinstance(constraints, list) else []
        positioned: set[str] = set()
        contained_panels: set[str] = set()

        def mark_positioned(node_id: str) -> None:
            positioned.add(node_id)
            positioned.update(_descendants(node_id, groups))

        for constraint_index, constraint in enumerate(constraints):
            constraint_path = f"{beat_path}.constraints[{constraint_index}]"
            if not isinstance(constraint, dict):
                issues.append(VideoIRIssue(constraint_path, "must be an object."))
                continue
            kind = constraint.get("type")
            allowed = {"type", "target"}
            required = {"type", "target"}
            if kind == "anchor":
                allowed |= {"anchor", "inset"}
                required.add("anchor")
            elif kind == "nextTo":
                allowed |= {"reference", "direction", "gap", "align"}
                required |= {"reference", "direction"}
            elif kind == "align":
                allowed |= {"reference", "edge"}
                required |= {"reference", "edge"}
            elif kind == "inside":
                allowed |= {"container", "padding"}
                required.add("container")
            elif kind == "shift":
                allowed |= {"direction", "amount"}
                required |= {"direction", "amount"}
            else:
                issues.append(VideoIRIssue(f"{constraint_path}.type", f"must be one of {sorted(CONSTRAINT_TYPES)}."))
            _require_keys(constraint, constraint_path, required, allowed, issues)
            target = constraint.get("target")
            if target not in node_by_id:
                issues.append(VideoIRIssue(f"{constraint_path}.target", "references an unknown node."))
                continue
            if target in connectors:
                issues.append(VideoIRIssue(f"{constraint_path}.target", "derived connectors cannot receive layout constraints."))
                continue
            if kind == "anchor":
                if constraint.get("anchor") not in {
                    "center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"
                }:
                    issues.append(VideoIRIssue(f"{constraint_path}.anchor", "is not a supported frame anchor."))
                if "inset" in constraint:
                    _token_number(constraint["inset"], spacing, f"{constraint_path}.inset", issues)
                mark_positioned(target)
            elif kind in {"nextTo", "align"}:
                reference = constraint.get("reference")
                if reference not in node_by_id:
                    issues.append(VideoIRIssue(f"{constraint_path}.reference", "references an unknown node."))
                elif reference not in positioned:
                    issues.append(VideoIRIssue(f"{constraint_path}.reference", "must already be positioned by an earlier constraint."))
                if kind == "nextTo":
                    if constraint.get("direction") not in {"up", "down", "left", "right"}:
                        issues.append(VideoIRIssue(f"{constraint_path}.direction", "must be up, down, left, or right."))
                    if "gap" in constraint:
                        _token_number(constraint["gap"], spacing, f"{constraint_path}.gap", issues)
                    if "align" in constraint and constraint["align"] not in {"start", "center", "end"}:
                        issues.append(VideoIRIssue(f"{constraint_path}.align", "must be start, center, or end."))
                    mark_positioned(target)
                elif constraint.get("edge") not in {"top", "bottom", "left", "right"}:
                    issues.append(VideoIRIssue(f"{constraint_path}.edge", "must be top, bottom, left, or right."))
                if kind == "align" and target not in positioned:
                    issues.append(VideoIRIssue(f"{constraint_path}.target", "must already be positioned before it can be aligned."))
            elif kind == "inside":
                container = constraint.get("container")
                if container not in node_by_id:
                    issues.append(VideoIRIssue(f"{constraint_path}.container", "references an unknown node."))
                elif container not in positioned:
                    issues.append(VideoIRIssue(f"{constraint_path}.container", "must already be positioned by an earlier constraint."))
                if "padding" in constraint:
                    _token_number(constraint["padding"], spacing, f"{constraint_path}.padding", issues)
                if container in panels:
                    contained_panels.add(container)
                mark_positioned(target)
            elif kind == "shift":
                if target not in positioned:
                    issues.append(VideoIRIssue(f"{constraint_path}.target", "must already be positioned before it can be shifted."))
                if constraint.get("direction") not in {"up", "down", "left", "right"}:
                    issues.append(VideoIRIssue(f"{constraint_path}.direction", "must be up, down, left, or right."))
                if not _is_number(constraint.get("amount")) or not 0 <= float(constraint["amount"]) <= 8:
                    issues.append(VideoIRIssue(f"{constraint_path}.amount", "must be from 0 to 8."))

        for panel in sorted(panels - contained_panels):
            issues.append(VideoIRIssue(f"{beat_path}.constraints", f"panel {panel!r} must contain content through an inside constraint."))
        for connector_id, connector in connectors.items():
            if connector.get("from") in positioned and connector.get("to") in positioned:
                positioned.add(connector_id)
        top_level = set(node_by_id) - set(parent_of)
        for node_id in sorted(top_level - positioned):
            issues.append(VideoIRIssue(f"{beat_path}.constraints", f"top-level node {node_id!r} is not positioned."))

        cues = beat.get("cues")
        if not isinstance(cues, list) or not 1 <= len(cues) <= 40:
            issues.append(VideoIRIssue(f"{beat_path}.cues", "must contain 1-40 cues."))
            cues = cues if isinstance(cues, list) else []
        cursor = 0.0
        static_time = 0.0
        incoming_style = None
        if beat_index > 0 and isinstance(beats[beat_index - 1], dict):
            previous_transition = beats[beat_index - 1].get("transition")
            if isinstance(previous_transition, dict):
                incoming_style = previous_transition.get("style")
        visible: set[str] = set(node_by_id) if incoming_style in CONTINUITY_TRANSITIONS else set()
        action_counts: Counter[str] = Counter()
        focus_receives_attention = False
        active_end = max(0.0, duration_value - transition_value)
        for cue_index, cue in enumerate(cues):
            cue_path = f"{beat_path}.cues[{cue_index}]"
            if not _require_keys(
                cue,
                cue_path,
                {"start", "duration", "action", "targets"},
                {"start", "duration", "action", "targets", "direction", "ease", "stagger", "color", "distance"},
                issues,
            ):
                continue
            start = float(cue["start"]) if _is_number(cue.get("start")) else -1.0
            resolved_duration = _duration_number(cue.get("duration"), motion_durations, f"{cue_path}.duration", issues)
            cue_duration = resolved_duration or 0.0
            if start < 0:
                issues.append(VideoIRIssue(f"{cue_path}.start", "must be non-negative."))
            elif abs(start * frame_rate - round(start * frame_rate)) > 1e-6:
                issues.append(VideoIRIssue(f"{cue_path}.start", f"must align to the {frame_rate} fps frame grid."))
            if resolved_duration is not None and abs(cue_duration * frame_rate - round(cue_duration * frame_rate)) > 1e-6:
                issues.append(VideoIRIssue(f"{cue_path}.duration", f"must align to the {frame_rate} fps frame grid."))
            if start < cursor - 1e-6:
                issues.append(VideoIRIssue(cue_path, "overlaps or is out of order relative to the previous cue."))
            if start + cue_duration > active_end + 1e-6:
                issues.append(VideoIRIssue(cue_path, "extends into the reserved transition or beyond the beat."))
            if start >= cursor:
                static_time += start - cursor
            cursor = max(cursor, start + cue_duration)
            action = cue.get("action")
            if action not in CUE_ACTIONS:
                issues.append(VideoIRIssue(f"{cue_path}.action", f"must be one of {sorted(CUE_ACTIONS)}."))
            elif isinstance(action, str):
                action_counts[action] += 1
            uses_v02 = (
                action not in {"fadeIn", "create", "write", "grow", "indicate", "fadeOut"}
                or isinstance(cue.get("duration"), str)
                or any(key in cue for key in ("direction", "ease", "stagger", "color", "distance"))
            )
            if schema_version == "0.1" and uses_v02:
                issues.append(VideoIRIssue(cue_path, "these motion features require schemaVersion '0.2'."))
            if "direction" in cue and cue["direction"] not in {"up", "down", "left", "right"}:
                issues.append(VideoIRIssue(f"{cue_path}.direction", "must be up, down, left, or right."))
            ease = cue.get("ease", default_ease)
            if ease not in EASINGS:
                issues.append(VideoIRIssue(f"{cue_path}.ease", f"must be one of {sorted(EASINGS)}."))
            if "stagger" in cue and (
                not _is_number(cue["stagger"]) or not 0 <= float(cue["stagger"]) <= 1
            ):
                issues.append(VideoIRIssue(f"{cue_path}.stagger", "must be from 0 to 1."))
            if "color" in cue and not isinstance(cue["color"], str):
                issues.append(VideoIRIssue(f"{cue_path}.color", "must be a color string or palette token."))
            if "distance" in cue and (
                not _is_number(cue["distance"]) or not 0.05 <= float(cue["distance"]) <= 4
            ):
                issues.append(VideoIRIssue(f"{cue_path}.distance", "must be from 0.05 to 4 Manim units."))
            targets = cue.get("targets")
            valid_targets = isinstance(targets, list) and all(isinstance(target, str) for target in targets)
            if not valid_targets or not targets or len(targets) != len(set(targets)):
                issues.append(VideoIRIssue(f"{cue_path}.targets", "must contain unique node ids."))
                targets = targets if valid_targets else []
            expanded_targets: set[str] = set()
            for target in targets:
                if target not in node_by_id:
                    issues.append(VideoIRIssue(f"{cue_path}.targets", f"references unknown node {target!r}."))
                    continue
                expanded_targets.add(target)
                expanded_targets.update(_descendants(target, groups))
                if focus == target or focus in _descendants(target, groups):
                    if action in ENTRANCE_ACTIONS | EMPHASIS_ACTIONS:
                        focus_receives_attention = True
                is_visible = target in visible
                if action in ENTRANCE_ACTIONS and is_visible:
                    issues.append(VideoIRIssue(cue_path, f"cannot enter already-visible node {target!r}."))
                if action in EMPHASIS_ACTIONS | EXIT_ACTIONS and not is_visible:
                    issues.append(VideoIRIssue(cue_path, f"cannot {action} hidden node {target!r}."))
            if action in ENTRANCE_ACTIONS:
                visible.update(expanded_targets)
            elif action in EXIT_ACTIONS:
                visible.difference_update(expanded_targets)
        if schema_version == "0.2":
            overused_actions = sorted(action for action, count in action_counts.items() if count > 2)
            if overused_actions:
                issues.append(
                    VideoIRIssue(
                        f"{beat_path}.cues",
                        "repeat motion actions more than twice: " + ", ".join(overused_actions) + ". Vary the attention grammar.",
                    )
                )
            if not focus_receives_attention:
                issues.append(VideoIRIssue(f"{beat_path}.focus", "must receive an entrance or emphasis cue in this beat."))
        static_time += max(0.0, active_end - cursor)
        static_ratio = static_time / duration_value if duration_value > 0 else 0.0
        if static_ratio > 0.35 and beat.get("allowLongHold") is not True:
            issues.append(
                VideoIRIssue(
                    f"{beat_path}.cues",
                    f"leave {static_ratio:.1%} of the beat static; keep it at or below 35% or set allowLongHold intentionally.",
                )
            )
        total_static += static_time
        total_duration += duration_value

    narration_report = validate_narration_spec({"segments": narration_segments}, total_duration)
    for issue in narration_report.issues:
        issues.append(VideoIRIssue("$.beats.narration", issue.message))

    ratio = total_static / total_duration if total_duration > 0 else 0.0
    return VideoIRReport(
        schema_version=schema_version if isinstance(schema_version, str) else None,
        duration_seconds=round(total_duration, 3),
        beat_count=beat_count,
        static_wait_seconds=round(total_static, 3),
        static_wait_ratio=round(ratio, 4),
        issues=issues,
    )


def _py(value: Any) -> str:
    return repr(value)


def _identifier(beat_index: int, node_id: str) -> str:
    return f"b{beat_index}_{node_id.replace('-', '_')}"


def _resolve_color(value: str | None, palette: dict[str, str], fallback: str) -> str:
    return palette.get(value or fallback, value or palette[fallback])


def _resolve_spacing(value: Any, spacing: dict[str, float], fallback: float) -> float:
    if value is None:
        return fallback
    return float(spacing[value]) if isinstance(value, str) else float(value)


def _style_arguments(node: dict[str, Any], palette: dict[str, str]) -> str:
    style = node.get("style", {})
    fill = _resolve_color(style.get("fill"), palette, "surface")
    stroke = _resolve_color(style.get("stroke"), palette, "muted")
    stroke_width = float(style.get("strokeWidth", 1.5))
    fill_opacity = float(style.get("fillOpacity", 1.0))
    return (
        f"fill_color={_py(fill)}, fill_opacity={fill_opacity:g}, "
        f"stroke_color={_py(stroke)}, stroke_width={stroke_width:g}"
    )


def _group_order(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups = {node["id"]: node for node in nodes if node["type"] == "group"}
    ordered: list[dict[str, Any]] = []
    remaining = dict(groups)
    while remaining:
        ready = [
            node for node in remaining.values()
            if all(child not in remaining for child in node["children"])
        ]
        if not ready:  # Validation has already reported the cycle.
            return ordered
        for node in sorted(ready, key=lambda item: item["id"]):
            ordered.append(node)
            remaining.pop(node["id"])
    return ordered


def _resolve_duration(value: Any, durations: dict[str, float]) -> float:
    return float(durations[value]) if isinstance(value, str) else float(value)


def _transition_values(
    beat: dict[str, Any],
    beat_index: int,
    beat_count: int,
    durations: dict[str, float],
    default_distance: float,
) -> tuple[str, float, str, float]:
    transition = beat.get("transition")
    if isinstance(transition, dict):
        return (
            transition["style"],
            _resolve_duration(transition["duration"], durations),
            transition.get("direction", "left"),
            float(transition.get("distance", default_distance)),
        )
    duration = float(beat.get("transitionDuration", 0.5 if beat_index < beat_count - 1 else 0.0))
    return "fade", duration, "left", default_distance


def _animation_expression(
    action: str,
    variable: str,
    cue: dict[str, Any],
    palette: dict[str, str],
    default_distance: float,
    direction: dict[str, str],
) -> str:
    cue_direction = direction[cue.get("direction", "right")]
    distance = float(cue.get("distance", default_distance))
    color = _resolve_color(cue.get("color"), palette, "accent")
    if action == "slideIn":
        return f"FadeIn({variable}, shift={cue_direction} * {distance:g})"
    if action == "slideOut":
        return f"FadeOut({variable}, shift={cue_direction} * {distance:g})"
    if action == "draw":
        return f"DrawBorderThenFill({variable})"
    if action == "circumscribe":
        return f"Circumscribe({variable}, color={_py(color)}, fade_out=True)"
    if action == "wiggle":
        return f"Wiggle({variable})"
    if action == "flash":
        return f"Flash({variable}, color={_py(color)}, flash_radius=0.35)"
    classes = {
        "fadeIn": "FadeIn", "create": "Create", "write": "Write",
        "grow": "GrowFromCenter", "indicate": "Indicate", "fadeOut": "FadeOut",
        "shrink": "ShrinkToCenter", "uncreate": "Uncreate",
    }
    return f"{classes[action]}({variable})"


def compile_video_ir(data: dict[str, Any]) -> CompiledVideo:
    report = validate_video_ir(data)
    if not report.valid:
        raise VideoIRValidationError(report)

    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    vir_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    theme = data["theme"]
    palette = theme["palette"]
    spacing = theme["spacing"]
    format_spec = data["format"]
    background = _resolve_color(format_spec["background"], palette, "background")
    motion = theme.get("motion", {})
    durations = motion.get("durations", {})
    default_distance = float(motion.get("distance", 0.45))
    default_ease = motion.get("defaultEase", "smooth")
    lines = [
        "# GENERATED FROM video.vir.json; DO NOT EDIT.",
        f"# Video IR v{data['schemaVersion']}; canonical SHA-256 {vir_hash}",
        "from manim import *",
        "from manim_layout import assert_inside, assert_scene_safe, connect_mobjects, fit_inside, stack_in_panel",
        "",
        "",
        "class GeneratedScene(Scene):",
        "    def construct(self):",
        f"        self.camera.background_color = {_py(background)}",
    ]
    narration_segments: list[dict[str, Any]] = []
    timeline = 0.0

    direction = {"up": "UP", "down": "DOWN", "left": "LEFT", "right": "RIGHT"}
    edge = {"top": "UP", "bottom": "DOWN", "left": "LEFT", "right": "RIGHT"}
    anchor_vector = {
        "top": "UP", "bottom": "DOWN", "left": "LEFT", "right": "RIGHT",
        "top-left": "UL", "top-right": "UR", "bottom-left": "DL", "bottom-right": "DR",
    }
    # Construct and constrain every beat before the timeline begins. This makes
    # continuity transitions able to target the next scene graph directly.
    for beat_index, beat in enumerate(data["beats"], start=1):
        lines.extend(["", f"        # Compose beat {beat_index}: {beat['id']} — {beat['intent']}"])
        nodes = beat["nodes"]
        node_by_id = {node["id"]: node for node in nodes}
        for node in nodes:
            if node["type"] in {"group", "connector"}:
                continue
            variable = _identifier(beat_index, node["id"])
            if node["type"] == "text":
                style = theme["textStyles"][node["role"]]
                color = _resolve_color(node.get("color", style["color"]), palette, "text")
                lines.append(
                    f"        {variable} = Text({_py(node['text'])}, font={_py(theme['fontFamily'])}, "
                    f"font_size={float(style['fontSize']):g}, color={_py(color)}, weight={_py(style['weight'])})"
                )
            elif node["type"] == "panel":
                radius = float(node.get("cornerRadius", 0.18))
                lines.append(
                    f"        {variable} = RoundedRectangle(width={float(node['width']):g}, "
                    f"height={float(node['height']):g}, corner_radius={radius:g}, {_style_arguments(node, palette)})"
                )
            elif node["type"] == "rectangle":
                lines.append(
                    f"        {variable} = Rectangle(width={float(node['width']):g}, "
                    f"height={float(node['height']):g}, {_style_arguments(node, palette)})"
                )
            elif node["type"] == "circle":
                lines.append(
                    f"        {variable} = Circle(radius={float(node['radius']):g}, {_style_arguments(node, palette)})"
                )
            elif node["type"] == "square":
                lines.append(
                    f"        {variable} = Square(side_length={float(node['sideLength']):g}, {_style_arguments(node, palette)})"
                )

        for node in _group_order(nodes):
            variable = _identifier(beat_index, node["id"])
            children = ", ".join(_identifier(beat_index, child) for child in node["children"])
            gap = _resolve_spacing(node["gap"], spacing, 0.25)
            arrange_direction = "RIGHT" if node["layout"] == "row" else "DOWN"
            alignments = (
                {"start": "DOWN", "center": "ORIGIN", "end": "UP"}
                if node["layout"] == "row"
                else {"start": "LEFT", "center": "ORIGIN", "end": "RIGHT"}
            )
            lines.append(f"        {variable} = VGroup({children})")
            if node["align"] == "center":
                lines.append(f"        {variable}.arrange({arrange_direction}, buff={gap:g})")
            else:
                lines.append(
                    f"        {variable}.arrange({arrange_direction}, buff={gap:g}, "
                    f"aligned_edge={alignments[node['align']]})"
                )

        panel_guards: list[tuple[str, str, float]] = []
        for constraint in beat["constraints"]:
            target = _identifier(beat_index, constraint["target"])
            kind = constraint["type"]
            if kind == "anchor":
                inset = _resolve_spacing(constraint.get("inset"), spacing, float(format_spec["safeArea"]))
                if constraint["anchor"] == "center":
                    lines.append(f"        {target}.move_to(ORIGIN)")
                elif "-" in constraint["anchor"]:
                    lines.append(f"        {target}.to_corner({anchor_vector[constraint['anchor']]}, buff={inset:g})")
                else:
                    lines.append(f"        {target}.to_edge({anchor_vector[constraint['anchor']]}, buff={inset:g})")
            elif kind == "nextTo":
                reference = _identifier(beat_index, constraint["reference"])
                gap = _resolve_spacing(constraint.get("gap"), spacing, 0.25)
                lines.append(f"        {target}.next_to({reference}, {direction[constraint['direction']]}, buff={gap:g})")
                if constraint.get("align") in {"start", "end"}:
                    axis_edge = (
                        {"start": "LEFT", "end": "RIGHT"}
                        if constraint["direction"] in {"up", "down"}
                        else {"start": "DOWN", "end": "UP"}
                    )[constraint["align"]]
                    lines.append(f"        {target}.align_to({reference}, {axis_edge})")
            elif kind == "align":
                reference = _identifier(beat_index, constraint["reference"])
                lines.append(f"        {target}.align_to({reference}, {edge[constraint['edge']]})")
            elif kind == "inside":
                container = _identifier(beat_index, constraint["container"])
                padding = _resolve_spacing(constraint.get("padding"), spacing, 0.30)
                lines.append(f"        fit_inside({target}, {container}, padding={padding:g})")
                if node_by_id[constraint["container"]]["type"] == "panel":
                    panel_guards.append((container, target, min(padding, 0.16)))
            elif kind == "shift":
                lines.append(
                    f"        {target}.shift({direction[constraint['direction']]} * {float(constraint['amount']):g})"
                )

        for node in nodes:
            if node["type"] != "connector":
                continue
            variable = _identifier(beat_index, node["id"])
            source = _identifier(beat_index, node["from"])
            target = _identifier(beat_index, node["to"])
            connector_color = _resolve_color(node.get("color"), palette, "muted")
            connector_buff = _resolve_spacing(node.get("buff"), spacing, 0.12)
            stroke_width = float(node.get("strokeWidth", 4.0))
            lines.append(
                f"        {variable} = connect_mobjects({source}, {target}, kind={_py(node['kind'])}, "
                f"buff={connector_buff:g}, color={_py(connector_color)}, stroke_width={stroke_width:g})"
            )

        for container, target, padding in panel_guards:
            lines.append(f"        assert_inside({container}, {target}, padding={padding:g})")
        child_ids = {
            child for node in nodes if node["type"] == "group" for child in node["children"]
        }
        top_level = [node["id"] for node in nodes if node["id"] not in child_ids]
        beat_group = f"beat_{beat_index}_group"
        members = ", ".join(_identifier(beat_index, node_id) for node_id in top_level)
        lines.append(f"        {beat_group} = VGroup({members})")
        lines.append(f"        assert_scene_safe({beat_group}, margin={float(format_spec['safeArea']):g})")

    easing = {
        "smooth": "smooth", "linear": "linear", "thereAndBack": "there_and_back",
        "rushIn": "rush_into", "rushOut": "rush_from",
    }
    beat_count = len(data["beats"])
    for beat_index, beat in enumerate(data["beats"], start=1):
        lines.extend(["", f"        # Animate beat {beat_index}: {beat['id']}"])

        cursor = 0.0
        for cue in beat["cues"]:
            start = float(cue["start"])
            cue_duration = _resolve_duration(cue["duration"], durations)
            if start > cursor + 1e-9:
                lines.append(f"        self.wait({start - cursor:g})")
            animation_items = [
                _animation_expression(
                    cue["action"], _identifier(beat_index, target), cue,
                    palette, default_distance, direction,
                )
                for target in cue["targets"]
            ]
            stagger = float(cue.get("stagger", 0.0))
            if len(animation_items) > 1 and stagger > 0:
                animations = f"LaggedStart({', '.join(animation_items)}, lag_ratio={stagger:g})"
            else:
                animations = ", ".join(animation_items)
            rate_func = easing[cue.get("ease", default_ease)]
            lines.append(
                f"        self.play({animations}, run_time={cue_duration:g}, rate_func={rate_func})"
            )
            cursor = start + cue_duration

        transition_style, transition_duration, transition_direction, transition_distance = _transition_values(
            beat, beat_index - 1, beat_count, durations, default_distance
        )
        active_end = float(beat["duration"]) - transition_duration
        if active_end > cursor + 1e-9:
            lines.append(f"        self.wait({active_end - cursor:g})")
        beat_group = f"beat_{beat_index}_group"
        if transition_duration > 0:
            transition_vector = direction[transition_direction]
            next_group = f"beat_{beat_index + 1}_group" if beat_index < beat_count else None
            if transition_style == "fade":
                transition_animation = f"FadeOut({beat_group})"
            elif transition_style == "slide":
                transition_animation = f"FadeOut({beat_group}, shift={transition_vector} * {transition_distance:g})"
            elif transition_style == "shrink":
                transition_animation = f"ShrinkToCenter({beat_group})"
            elif transition_style == "uncreate":
                transition_animation = f"Uncreate({beat_group})"
            elif transition_style == "crossfade":
                transition_animation = f"FadeOut({beat_group}), FadeIn({next_group})"
            elif transition_style == "push":
                transition_animation = (
                    f"FadeOut({beat_group}, shift={transition_vector} * {transition_distance:g}), "
                    f"FadeIn({next_group}, shift=-{transition_vector} * {transition_distance:g})"
                )
            else:
                transition_animation = f"TransformMatchingShapes({beat_group}, {next_group})"
            lines.append(
                f"        self.play({transition_animation}, run_time={transition_duration:g}, rate_func=smooth)"
            )
        narration_segments.append({"start": round(timeline, 3), "text": beat["narration"].strip()})
        timeline += float(beat["duration"])

    source = "\n".join(lines) + "\n"
    narration = {"segments": narration_segments}
    scene_report = validate_scene_source(source)
    if not scene_report.valid:
        internal_issues = [
            VideoIRIssue("$compiler", f"generated scene line {issue.line}: {issue.message}")
            for issue in scene_report.issues
        ]
        raise VideoIRValidationError(
            VideoIRReport(
                report.schema_version, report.duration_seconds, report.beat_count,
                report.static_wait_seconds, report.static_wait_ratio, internal_issues,
            )
        )
    return CompiledVideo(source, narration, report, vir_hash)


def compile_project(project_dir: Path) -> CompiledVideo:
    vir_path = project_dir / "video.vir.json"
    try:
        data = json.loads(vir_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError("video.vir.json does not exist.") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid video.vir.json at line {error.lineno}: {error.msg}.") from error
    compiled = compile_video_ir(data)
    (project_dir / "scene.py").write_text(compiled.source, encoding="utf-8")
    (project_dir / "narration.json").write_text(
        json.dumps(compiled.narration, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return compiled
