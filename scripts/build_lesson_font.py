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

FAMILY = "Orune Serif"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(HERE, "fonts")

# WONK=1 keeps Fraunces' flared alternates, which is most of its character;
# SOFT=20 takes the hard edge off the terminals; opsz=28 sits in the middle of
# the 19-40pt range lessons actually set.
AXES = {"wght": 400, "opsz": 28, "SOFT": 20, "WONK": 1}

SOURCES = {
    "Regular": "Fraunces-Variable.ttf",
    "Italic": "Fraunces-Italic-Variable.ttf",
}


def build(style: str, source: str) -> None:
    font = TTFont(os.path.join(FONT_DIR, source))
    font.flavor = None
    static = instancer.instantiateVariableFont(font, AXES, inplace=False)
    full = FAMILY if style == "Regular" else f"{FAMILY} {style}"
    for record in static["name"].names:
        if record.nameID == 1:
            record.string = FAMILY
        elif record.nameID == 2:
            record.string = style
        elif record.nameID == 4:
            record.string = full
        elif record.nameID == 6:
            record.string = full.replace(" ", "")
        elif record.nameID == 16:
            record.string = FAMILY
        elif record.nameID == 17:
            record.string = style
    out = os.path.join(FONT_DIR, f"OruneSerif-{style}.ttf")
    static.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    for style, source in SOURCES.items():
        build(style, source)
    print(f'family="{FAMILY}"; install fonts/ into the image and run fc-cache')
