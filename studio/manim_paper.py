"""The Orune paper typography system.

Every piece of text in a lesson goes through this module. Freehand ``Text()``
calls are forbidden in generated scenes because they are how lessons end up
with a different size, alignment, and spacing on every frame. The renderer
enforces the import; the functions here enforce the grid.

The grid: one left margin anchors everything. The running head sits at the
top, the claim under it, the stage owns the middle, and captions sit at the
bottom - all flush to ``LEFT_X``. Labels are the only text allowed elsewhere,
and they must sit adjacent to the object they name, in that object's colour.
"""

from __future__ import annotations

import json
import os
import sys

from manim import (
    DOWN,
    ITALIC,
    LEFT,
    NORMAL,
    RIGHT,
    UL,
    Axes,
    FadeIn,
    FadeOut,
    Mobject,
    Scene,
    Text,
    VGroup,
    config,
)

# Lessons render in one of two shapes: the 16:9 page, and the 9:16 phone cut
# for social. Manim would hand us a 4.5-unit-wide frame for 9:16, which is far
# too narrow to set a sentence in, so the vertical format claims a wider
# measure and a taller frame. The pixel aspect is identical either way.
VERTICAL = config.pixel_height > config.pixel_width
if VERTICAL:
    config.frame_width = 8.0
    config.frame_height = 8.0 * config.pixel_height / config.pixel_width

# The editorial grid, in scene units. Everything hangs off the left margin.
# The frame is three horizontal bands that never share space: the head band
# (running head + claim), the stage, and the caption band. Everything visual
# lives inside the stage; fit_stage() enforces it.
#
# The vertical grid keeps its bottom band deliberately deep: the lower fifth
# of a phone screen belongs to the app's own caption and buttons, so nothing
# that carries meaning is allowed to sit there.
if VERTICAL:
    LEFT_X = -3.45
    RIGHT_X = 3.45
    HEAD_Y = 5.75
    CAPTION_Y = -4.55
    STAGE_TOP = 3.15
    STAGE_BOTTOM = -3.50
else:
    LEFT_X = -5.6
    RIGHT_X = 5.6
    HEAD_Y = 3.05
    CAPTION_Y = -3.4
    STAGE_TOP = 1.7
    STAGE_BOTTOM = -2.85

MEASURE = RIGHT_X - LEFT_X

# The full type scale. There are no other sizes.
SIZE = {
    "head": 19,  # running head, muted
    "claim": 34 if VERTICAL else 40,  # the one sentence of the beat
    "sub": 28,  # a secondary statement under the claim (rare)
    "label": 24,  # a name attached to an object
    "caption": 22,  # the bottom-margin note
    "expr": 27,  # expression terms; operators are set 1.55x
}

_FALLBACKS = {
    "background": "#FBFAF7",
    "text": "#1A1917",
    "muted": "#8A857D",
    "rule": "#D9D4CA",
    "primary": "#2E5266",
    "accent": "#B07548",
}


# Roles set at display size use the display cut; everything smaller uses the
# text cut, whose optical size carries correct word spacing at 19-27pt.
_DISPLAY_ROLES = {"claim", "sub"}


def load_design(project_dir: str = ".") -> dict:
    """Read design-config.json and return {font, colors...} with fallbacks."""
    design = dict(_FALLBACKS)
    design["font"] = "Orune Serif"
    design["font_text"] = "Orune Serif Text"
    try:
        with open(os.path.join(project_dir, "design-config.json")) as handle:
            data = json.load(handle)
        for key in _FALLBACKS:
            value = (data.get("colors") or {}).get(key)
            if isinstance(value, str) and value.startswith("#"):
                design[key] = value
        font = (data.get("font") or {}).get("manim")
        if isinstance(font, str) and font.strip():
            design["font"] = font.strip()
            if font.strip() != "Orune Serif":
                design["font_text"] = font.strip()
    except (OSError, ValueError):
        pass
    return design


def text(design: dict, body: str, role: str = "label", *, italic: bool = False,
         color: str | None = None) -> Text:
    """The only sanctioned way to make text. Size comes from the role."""
    if role not in SIZE:
        raise ValueError(f"unknown text role {role!r}; use one of {sorted(SIZE)}")
    default = design["muted"] if role in ("head", "caption") else design["text"]
    family = design["font"] if role in _DISPLAY_ROLES else design.get(
        "font_text", design["font"]
    )
    return Text(
        body,
        font=family,
        font_size=SIZE[role],
        color=color or default,
        slant=ITALIC if italic else NORMAL,
    )


def running_head(design: dict, body: str) -> Text:
    head = text(design, body, role="head")
    head.move_to([LEFT_X, HEAD_Y, 0], aligned_edge=LEFT)
    return head


def _set_lines(design: dict, body: str, role: str, measure: float,
               *, italic: bool = False) -> Mobject:
    """One sentence set to a measure. Lines are separate mobjects arranged
    flush left, because a multi-line Text centres its own lines, and centred
    type would break the single margin every other function here maintains."""
    single = text(design, body, role=role, italic=italic)
    if single.width <= measure or " " not in body.strip():
        return single
    lines: list[str] = []
    current: list[str] = []
    for word in body.split():
        trial = current + [word]
        if current and text(design, " ".join(trial), role=role,
                            italic=italic).width > measure:
            lines.append(" ".join(current))
            current = [word]
        else:
            current = trial
    if current:
        lines.append(" ".join(current))
    rows = VGroup(*(text(design, line, role=role, italic=italic)
                    for line in lines))
    rows.arrange(DOWN, buff=0.16, aligned_edge=LEFT)
    return rows


def claim(design: dict, body: str, head: Mobject | None = None) -> Mobject:
    """The beat's one sentence, wrapped to the measure. A claim that needs
    more than three lines is a claim that needs fewer words."""
    sentence = _set_lines(design, body, "claim", MEASURE)
    if head is not None:
        sentence.next_to(head, DOWN, buff=0.3, aligned_edge=LEFT)
    else:
        sentence.move_to([LEFT_X, HEAD_Y - 0.75, 0], aligned_edge=LEFT)
    return sentence


def swap_claim(scene: Scene, old: Mobject, new: Mobject) -> None:
    """Replace one sentence with another. Sequential, never concurrent, and
    never a Transform: both alternatives smear glyphs mid-tween."""
    new.move_to(old.get_corner(UL), aligned_edge=UL)
    scene.play(FadeOut(old), run_time=0.35)
    scene.play(FadeIn(new), run_time=0.45)


def label(design: dict, target: Mobject, body: str, direction=RIGHT,
          *, color: str | None = None, buff: float = 0.22) -> Text:
    """A name for an object. It sits directly against the thing it names and
    inherits that thing's colour, so the reader never chases a pointer line
    across the frame. Pointer lines to distant labels are forbidden."""
    if color is None:
        try:
            picked = target.get_color().to_hex()
        except Exception:
            picked = design["text"]
        color = str(picked)
    tag = text(design, body, role="label", color=color)
    tag.next_to(target, direction, buff=buff)
    return tag


def caption(design: dict, body: str, *, italic: bool = False) -> Text:
    note = _set_lines(design, body, "caption", MEASURE, italic=italic)
    note.move_to([LEFT_X, CAPTION_Y, 0], aligned_edge=LEFT)
    return note


# Symbols that separate quantities rather than joining them; they take the
# wider setting on both sides.
_RELATIONS = {"=", "≠", "≈", "<", ">", "≤", "≥", "×", "·", "+", "-", "−", "±", "/", "÷"}


def expr(design: dict, *parts: tuple[str, str]) -> VGroup:
    """Set an expression from (body, kind) parts, kind in:
    "up" upright words, "it" italic variables, "op" oversized operators.
    Example: expr(d, ("area","up"), ("=","up"), ("∫","op"), ("f(x) dx","it"))
    """
    pieces = []
    for body, kind in parts:
        if kind == "op":
            piece = Text(body, font=design.get("font_text", design["font"]),
                         font_size=round(SIZE["expr"] * 1.55),
                         color=design["text"])
            piece.shift(DOWN * 0.05)
        elif kind == "it":
            piece = text(design, body, role="expr", italic=True)
        else:
            piece = text(design, body, role="expr")
        pieces.append(piece)
    # Space carries meaning in an expression. Terms that multiply have to sit
    # close enough to read as one quantity - set evenly, "2 pi r" reads as three
    # separate tokens instead of one - while relations and operators need room.
    group = VGroup(*pieces)
    for index in range(1, len(pieces)):
        previous_body, previous_kind = parts[index - 1]
        body, kind = parts[index]
        loose = (
            kind == "op"
            or previous_kind == "op"
            or body.strip() in _RELATIONS
            or previous_body.strip() in _RELATIONS
        )
        pieces[index].next_to(pieces[index - 1], RIGHT, buff=0.30 if loose else 0.09)
    return group


def fit_stage(mobject: Mobject, *, left: float = LEFT_X, right: float = RIGHT_X,
              top: float = STAGE_TOP, bottom: float = STAGE_BOTTOM,
              fill: bool | None = None) -> Mobject:
    """Scale and place a visual so it lives inside the stage band - the region
    between the claim above and the caption below. Route EVERY primary visual
    through this; it is what makes text/visual collisions impossible.

    The two formats want opposite things here. The page hangs its figure on the
    same left margin as the type and never enlarges it. The phone cut centres
    the figure and grows it to fill the stage, because a small diagram floating
    in a tall frame is a wasted post."""
    width = right - left
    height = top - bottom
    if fill is None:
        fill = VERTICAL
    if fill:
        mobject.scale(min(width / max(mobject.width, 1e-6),
                          height / max(mobject.height, 1e-6)))
    else:
        if mobject.width > width:
            mobject.scale_to_fit_width(width)
        if mobject.height > height:
            mobject.scale_to_fit_height(height)
    centre_x = left + width / 2 if VERTICAL else left + mobject.width / 2
    mobject.move_to([centre_x, bottom + height / 2, 0])
    return mobject


def narration_beats(project_dir: str = ".") -> list[dict]:
    """The start times the finished audio is actually mixed at.

    The narration mux places each line at its own ``start`` second, so those
    numbers - not the scene's own guesswork - are the clock the picture has to
    keep. Returns an empty list when the lesson is silent."""
    try:
        with open(os.path.join(project_dir, "narration.json")) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    beats = []
    for segment in data.get("segments") or []:
        try:
            beats.append({
                "start": float(segment["start"]),
                "end": float(segment.get("end") or 0.0),
            })
        except (KeyError, TypeError, ValueError):
            return []
    return sorted(beats, key=lambda beat: beat["start"])


def hold_for_narration(scene: Scene, beats: list[dict], index: int) -> None:
    """Hold the current beat until its narration line is done.

    Call this once at the end of every beat, in order. It waits until the next
    line begins - or, on the last beat, until the final line ends - so the
    voice and the picture stay together.

    Every target is an absolute time on the narration's own clock, which is
    what makes this safe: a beat whose animations run past their line simply
    starts late, and the very next call still lands on its own start time.
    Error never accumulates, so an overrun is reported and forgiven rather
    than raised - failing here would only cost a whole render to fix a beat
    that the following one already corrects."""
    if not beats or index >= len(beats):
        return
    if index + 1 < len(beats):
        target = beats[index + 1]["start"]
    else:
        target = beats[index]["end"] or beats[index]["start"]
    remaining = target - scene.time
    if remaining > 0:
        scene.wait(remaining)
    elif remaining < -0.4:
        print(
            f"note: beat {index + 1} ran {-remaining:.2f}s past its narration line; "
            f"the next beat re-syncs, but consider shortening it.",
            file=sys.stderr,
        )


def stage_axes(design: dict, **kwargs) -> Axes:
    """Axes in the house voice: thin rules, no ticks, no arrowheads."""
    config = {
        "color": design["rule"],
        "stroke_width": 1.6,
        "include_ticks": False,
        "include_tip": False,
    }
    config.update(kwargs.pop("axis_config", {}))
    return Axes(axis_config=config, **kwargs)
