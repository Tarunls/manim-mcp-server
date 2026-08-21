"""Small, deterministic layout guards for generated Manim scenes."""

from __future__ import annotations

from itertools import combinations
from typing import Iterable

from manim import Mobject, Scene, VGroup, config


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


def _pair_key(first: str, second: str) -> frozenset[str]:
    return frozenset((first, second))


def assert_no_overlap(
    *mobjects: Mobject,
    min_gap: float = 0.12,
    names: Iterable[str] | None = None,
    allow_pairs: Iterable[tuple[str, str]] = (),
) -> None:
    """Fail when independent peer objects overlap or get too close.

    Pass composite groups rather than a container and its children. ``allow_pairs``
    is intentionally name-based so exceptions remain readable in generated code.
    """
    labels = list(names) if names is not None else [f"item {index}" for index in range(1, len(mobjects) + 1)]
    if len(labels) != len(mobjects):
        raise ValueError("names must contain exactly one label per mobject.")
    allowed = {_pair_key(first, second) for first, second in allow_pairs}
    collisions: list[str] = []
    for (first_index, first), (second_index, second) in combinations(enumerate(mobjects), 2):
        first_name = labels[first_index]
        second_name = labels[second_index]
        if _pair_key(first_name, second_name) in allowed:
            continue
        horizontal_gap = max(
            second.get_left()[0] - first.get_right()[0],
            first.get_left()[0] - second.get_right()[0],
        )
        vertical_gap = max(
            second.get_bottom()[1] - first.get_top()[1],
            first.get_bottom()[1] - second.get_top()[1],
        )
        if horizontal_gap < min_gap and vertical_gap < min_gap:
            collisions.append(f"{first_name} / {second_name}")
    if collisions:
        raise ValueError(
            f"Layout collision (minimum gap {min_gap:.2f}): " + ", ".join(collisions)
        )


def watch_no_overlap(
    scene: Scene,
    *mobjects: Mobject,
    min_gap: float = 0.12,
    names: Iterable[str] | None = None,
    allow_pairs: Iterable[tuple[str, str]] = (),
) -> Mobject:
    """Audit peer-object spacing on every rendered frame until removed.

    Store the returned watcher and remove it from the scene when that visual beat
    ends. This catches collisions that occur between otherwise safe key poses.
    """
    stable_names = tuple(names) if names is not None else None
    stable_allow_pairs = tuple(allow_pairs)
    watcher = Mobject()

    def audit(_mobject: Mobject, _dt: float = 0.0) -> None:
        assert_no_overlap(
            *mobjects,
            min_gap=min_gap,
            names=stable_names,
            allow_pairs=stable_allow_pairs,
        )

    watcher.add_updater(audit)
    scene.add(watcher)
    audit(watcher)
    return watcher
