"""Small, deterministic layout guards for generated Manim scenes."""

from __future__ import annotations

import numpy as np

from manim import Arrow, Line, Mobject, VGroup, config


def fit_inside(mobject: Mobject, container: Mobject, padding: float = 0.30) -> Mobject:
    """Scale a mobject down when needed and center it inside a container."""
    max_width = max(0.01, container.width - 2 * padding)
    max_height = max(0.01, container.height - 2 * padding)
    scale = min(1.0, max_width / max(mobject.width, 0.01), max_height / max(mobject.height, 0.01))
    if scale < 1.0:
        mobject.scale(scale)
    mobject.move_to(container.get_center())
    return mobject


def stack_in_panel(
    container: Mobject,
    *rows: Mobject,
    padding: float = 0.30,
    buff: float = 0.18,
    aligned_edge=None,
) -> VGroup:
    """Arrange rows as one unit, then fit the unit inside a panel."""
    group = VGroup(*rows)
    arrange_args = {"buff": buff}
    if aligned_edge is not None:
        arrange_args["aligned_edge"] = aligned_edge
    group.arrange(direction=(0, -1, 0), **arrange_args)
    fit_inside(group, container, padding=padding)
    return group


def assert_inside(container: Mobject, *mobjects: Mobject, padding: float = 0.16) -> None:
    """Fail rendering when any supplied mobject crosses a container's inner bounds."""
    left = container.get_left()[0] + padding
    right = container.get_right()[0] - padding
    bottom = container.get_bottom()[1] + padding
    top = container.get_top()[1] - padding
    violations: list[str] = []
    for index, mobject in enumerate(mobjects, start=1):
        if (
            mobject.get_left()[0] < left
            or mobject.get_right()[0] > right
            or mobject.get_bottom()[1] < bottom
            or mobject.get_top()[1] > top
        ):
            violations.append(f"item {index}")
    if violations:
        joined = ", ".join(violations)
        raise ValueError(f"Panel overflow: {joined} exceed the container's inner bounds.")


def assert_scene_safe(*mobjects: Mobject, margin: float = 0.32) -> None:
    """Fail rendering when important content leaves the 16:9 frame safe area."""
    left = -config.frame_width / 2 + margin
    right = config.frame_width / 2 - margin
    bottom = -config.frame_height / 2 + margin
    top = config.frame_height / 2 - margin
    violations: list[str] = []
    for index, mobject in enumerate(mobjects, start=1):
        if (
            mobject.get_left()[0] < left
            or mobject.get_right()[0] > right
            or mobject.get_bottom()[1] < bottom
            or mobject.get_top()[1] > top
        ):
            violations.append(f"item {index}")
    if violations:
        joined = ", ".join(violations)
        raise ValueError(f"Frame overflow: {joined} exceed the scene safe area.")


def connect_mobjects(
    source: Mobject,
    target: Mobject,
    *,
    kind: str = "arrow",
    buff: float = 0.12,
    color: str = "#888888",
    stroke_width: float = 4.0,
) -> Mobject:
    """Connect actual object boundaries instead of guessing endpoint coordinates."""
    delta = target.get_center() - source.get_center()
    length = float(np.linalg.norm(delta))
    if length < 1e-6:
        raise ValueError("Connector endpoints have the same center; position them separately first.")
    unit = delta / length
    start = source.get_boundary_point(unit)
    end = target.get_boundary_point(-unit)
    connector_type = Arrow if kind == "arrow" else Line
    connector = connector_type(
        start,
        end,
        buff=buff,
        color=color,
        stroke_width=stroke_width,
    )
    connector.set_z_index(-1)
    return connector
