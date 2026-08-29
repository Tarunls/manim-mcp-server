"""Build the "Orune Serif" lesson font from the Fraunces variable sources.

Manim renders text through Pango, which needs a real TTF/OTF and resolves it by
family name. Two things make that fragile in a sandbox:

  * The renderer image ships only DejaVu/Liberation, so an unavailable family
    falls back silently to a generic sans - the single biggest reason generated
    lessons used to look generic.
  * A variable font exposes its axes to Pango, which may pick a degenerate
    default instance and render visibly malformed glyphs.

So we pin every axis to one value, producing genuinely static fonts, and rename
the family to a name we control. Regenerate with:

    .venv/bin/python scripts/build_lesson_font.py
"""

from __future__ import annotations

import os

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(HERE, "fonts")

# Two optical cuts, used the way optical sizes are meant to be used. The
# display cut (opsz 30) carries the 40pt claim; the text cut (opsz 13) carries
# heads, labels, captions, and expressions - a display cut at those sizes has
# display-tight word spacing, which is why small text once read as "25people".
# WONK=1 keeps Fraunces' flared alternates; SOFT=20 rounds the terminals.
CUTS = {
    "Orune Serif": {"wght": 400, "opsz": 30, "SOFT": 20, "WONK": 1},
    "Orune Serif Text": {"wght": 400, "opsz": 13, "SOFT": 20, "WONK": 1},
}

SOURCES = {
    "Regular": "Fraunces-Variable.ttf",
    "Italic": "Fraunces-Italic-Variable.ttf",
}


def build(family: str, axes: dict, style: str, source: str) -> None:
    font = TTFont(os.path.join(FONT_DIR, source))
    font.flavor = None
    static = instancer.instantiateVariableFont(font, axes, inplace=False)
    full = family if style == "Regular" else f"{family} {style}"
    for record in static["name"].names:
        if record.nameID == 1:
            record.string = family
        elif record.nameID == 2:
            record.string = style
        elif record.nameID == 4:
            record.string = full
        elif record.nameID == 6:
            record.string = full.replace(" ", "")
        elif record.nameID == 16:
            record.string = family
        elif record.nameID == 17:
            record.string = style
    out = os.path.join(
        FONT_DIR, f"{family.replace(' ', '')}-{style}.ttf"
    )
    static.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    for family, axes in CUTS.items():
        for style, source in SOURCES.items():
            build(family, axes, style, source)
    print("install fonts/ into the image and run fc-cache")
