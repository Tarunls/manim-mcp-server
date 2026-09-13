"""Small, general layout checks for generated Manim scenes.

The checks run after each animation and before each hold. They inspect text,
where accidental overlap and clipping are almost never meaningful, while
leaving visual geometry unrestricted. A render failure is sent back to the
scene model with the names and bounds needed to repair it.
"""

from __future__ import annotations

from itertools import combinations

from manim import Scene, Text, config


SAFE_MARGIN = 0.35
MINIMUM_TEXT_HEIGHT = 0.18
OVERLAP_EPSILON = 0.025


def _all_text(scene: Scene) -> list[Text]:
    found: list[Text] = []
    seen: set[int] = set()
    for root in scene.mobjects:
        for item in root.get_family():
            if (
                isinstance(item, Text)
                and id(item) not in seen
                and max(float(item.get_fill_opacity()), float(item.get_stroke_opacity())) > 0.01
            ):
                seen.add(id(item))
                found.append(item)
    return found


def _label(item: Text) -> str:
    value = getattr(item, "text", "") or "text"
    return repr(str(value)[:80])


def _bounds(item: Text) -> tuple[float, float, float, float]:
    return (
        float(item.get_left()[0]),
        float(item.get_right()[0]),
        float(item.get_bottom()[1]),
        float(item.get_top()[1]),
    )


def _intersection_area(first: Text, second: Text) -> float:
    a_left, a_right, a_bottom, a_top = _bounds(first)
    b_left, b_right, b_bottom, b_top = _bounds(second)
    return max(0.0, min(a_right, b_right) - max(a_left, b_left)) * max(
        0.0, min(a_top, b_top) - max(a_bottom, b_bottom)
    )


def audit_text_layout(scene: Scene) -> None:
    """Raise a useful render error when a stable text layout is unreadable."""
    texts = _all_text(scene)
    left = -float(config.frame_width) / 2 + SAFE_MARGIN
    right = float(config.frame_width) / 2 - SAFE_MARGIN
    bottom = -float(config.frame_height) / 2 + SAFE_MARGIN
    top = float(config.frame_height) / 2 - SAFE_MARGIN
    for item in texts:
        item_left, item_right, item_bottom, item_top = _bounds(item)
        if item_left < left or item_right > right or item_bottom < bottom or item_top > top:
            raise ValueError(
                f"Text {_label(item)} leaves the safe frame: bounds "
                f"({item_left:.2f}, {item_right:.2f}, {item_bottom:.2f}, {item_top:.2f})."
            )
        if float(item.height) < MINIMUM_TEXT_HEIGHT:
            raise ValueError(
                f"Text {_label(item)} is too small to read: height {float(item.height):.2f} scene units."
            )
    for first, second in combinations(texts, 2):
        overlap = _intersection_area(first, second)
        if overlap <= OVERLAP_EPSILON:
            continue
        smaller = max(min(float(first.width * first.height), float(second.width * second.height)), 0.001)
        if overlap / smaller > 0.04:
            raise ValueError(
                f"Text collision between {_label(first)} and {_label(second)}. "
                "Move them into separate layout regions or remove the obsolete label before adding its replacement."
            )


class QualityScene(Scene):
    """Scene base that audits readable text at every stable key state."""

    def _quality_audit(self) -> None:
        audit_text_layout(self)

    def play(self, *args, **kwargs):
        result = super().play(*args, **kwargs)
        self._quality_audit()
        return result

    def wait(self, *args, **kwargs):
        self._quality_audit()
        return super().wait(*args, **kwargs)
