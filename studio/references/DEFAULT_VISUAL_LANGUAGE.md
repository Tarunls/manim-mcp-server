# Default visual language

Every lesson is a Manim video in the studio's paper style: a printed page that moves. The look is quiet, editorial, and typographic. These rules are proven in rendered lessons — follow them literally rather than reinterpreting them.

## The typography system is code, not judgement

`studio/manim_paper.py` is on the render path's `PYTHONPATH`. Every piece of
text is created through it — `running_head`, `claim`, `swap_claim`, `label`,
`caption`, `expr`, and `text(design, body, role=...)` — and every primary
visual is placed with `fit_stage`. The module owns the sizes, the fonts (a
display cut for claims, a text cut for everything smaller), the left margin,
and the three horizontal bands of the frame. Do not hand-position text and do
not call `Text()` directly; the renderer rejects scenes that skip the module.

## The ground

- The background is warm paper. Read the exact value from `design-config.json` (`colors.background`) and set it explicitly on the scene.
- There is no dark background, no gradient, no glow, no vignette, and no drop shadow anywhere in the video.

## Ink and colour

- `colors.text` is the ink used for the claim sentence and for labels on the object.
- `colors.muted` is used only for the small running head.
- `colors.rule` is used for axes and for any rule that carries structure.
- `colors.primary` is the single working colour. It carries the mathematical object and nothing else.
- When a figure is built from parts the viewer has to count or tell apart, give each part the primary colour at a different fill opacity — the first palest, each addition a step deeper. One hue at several strengths still satisfies this rule, and it is the only way those parts stay legible; a finished figure where every part shares one flat fill has lost the argument it was drawn to make.
- `colors.accent` is the payoff colour. Use it exactly once in the whole lesson, at the moment the idea lands.
- Fills are pale — roughly 0.14 to 0.22 opacity — so the curve or edge stays readable on top of them.

## What a beat is

A beat is three things and nothing else:

1. A small running head.
2. One sentence of claim.
3. The mathematical object.

There are no cards, no rounded boxes, no uppercase eyebrow tags, no chips, no badges, and no decorative rules. If an element is not one of the three above, it does not belong on the frame.

## Layout and type

- Keep an editorial left margin. The running head, the claim, and the visual all align to the same left edge. Do not centre text.
- The claim is a full sentence in sentence case at about 40pt. The running head is about 19pt in the muted colour.
- Authority comes from size, tight leading, and space — never from bold weight and never from colour.
- Margins are generous. One idea is on screen at a time.
- Use the font family named in `design-config.json` (`font.manim`) for every piece of text. Never hardcode a system font and never omit the font so Manim silently falls back to a generic face.

## Motion

- Each beat must visibly transform the previous one. A beat that only swaps words has not earned its place.
- Never morph one sentence into another. `ReplacementTransform` between two `Text` mobjects smears the glyphs into an unreadable mess mid-tween. Always `FadeOut` the old sentence and `FadeIn` the new one.
- Never `Transform` between two Riemann-rectangle groups — or any two grids — with different element counts. Mid-tween the viewer sees two misaligned grids. Cross-fade instead: `FadeOut(old)` then `FadeIn(new)`.

## Axes

- Build axes with `include_tip=False` and `include_ticks=False`.
- Draw them thin, `stroke_width` about 1.6, in the rule colour. No arrowheads.

## Pacing

Build about four beats over 35-45 seconds unless the user requests another duration. This is a quality floor, not a template to copy literally: re-plan the pedagogy from scratch for every request. A repeated prompt is still a new production when the turn identifies itself as a first draft.

## Worked exemplars

`paper-house-style/frames/` holds four frames from lessons rendered in this
style. Look at them before planning a first draft; they are the quality bar.

- `01-claim-and-object.jpg` — the default beat: running head, one claim
  sentence, one object, and nothing else.
- `02-payoff-colour.jpg` — the accent colour used once, at the moment the idea
  lands, with the expression set beneath the object.
- `03-two-linked-views.jpg` — two views of one idea side by side, sharing a
  single working colour so the link between them reads.
- `04-single-accent-mark.jpg` — one marked point and one accent line against
  the working-colour curve.

`paper-house-style/pacing-reference.mp4` is a complete lesson in this style;
inspect it when transition cadence or motion continuity needs deeper checking.

These are references for visual judgement only. Never carry their subject,
wording, equations, or graphics into an unrelated lesson.

## Setting mathematics

There is no LaTeX in the render image, so expressions are composed from `Text`
mobjects and positioned by hand. Follow ordinary maths convention:

- Words and function names are upright: `area`, `slope at`, `max`.
- Single-letter variables are italic: `x`, `f(x)`, `dx`.
- Operators such as `∫` and `∑` are set noticeably larger than the terms they
  enclose, and nudged down a few hundredths of a unit to sit on the baseline.
- Build the expression as a `VGroup(...).arrange(RIGHT, buff=...)` rather than
  as one string with padded spaces; a single string spaces unevenly in a serif.
