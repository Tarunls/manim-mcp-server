# The vertical cut, for a social feed

This is the playbook for a 9:16 lesson posted to TikTok, Reels or Shorts. It
is written to be followed literally, because these are made in volume and the
output has to be right the first time.

## Pick a concept that a single picture can prove

The whole lesson is **one transformation**: a thing the viewer already accepts,
changed once, so that the surprising fact falls out of the change. The proven
example is a circle sliced into rings and unrolled into a triangle - after the
unroll, the area formula is simply read off the shape.

A concept qualifies when all of these hold:

- a stranger with no maths past school can follow it with the sound off;
- one visual change carries the entire argument, not a chain of three or four;
- the payoff is a fact people have heard but never seen a reason for.

If explaining it needs a second idea introduced along the way, it is too big.
Cut it, or pick another concept. Abstract counting patterns and anything that
needs the viewer to hold several numbers in their head do not work here.

## The four beats

1. **The hook.** Open with "Have you ever wondered why ..." and name the fact.
   The viewer decides in about one second, so the first line is a real question
   about something they already believe.
2. **The setup.** Put the familiar object on screen, plainly.
3. **The transformation.** Change it, once, in full view. This is the beat
   people screenshot; give it the most time.
4. **The payoff.** State the fact the changed picture now makes obvious, and
   close on one short line that lands the surprise.

About 35 to 45 seconds in total.

## Narration is the clock

The mux places every line at its own start time, so the picture must keep that
clock or the voice slides out of sync for the rest of the video.

- Load the timings with `narration_beats(".")` and end **every** beat with
  `hold_for_narration(scene, beats, index)`, in order, counting from zero.
- Never pace a narrated beat with a hand-written `self.wait(...)`. That is the
  drift, and it is invisible until someone watches the whole video.
- A beat that overruns its line raises at render time. Shorten that beat's
  animations or give the passage more room; do not widen the tolerance.

Each line describes **what is on screen while it is spoken** - never something
that appeared two beats ago, never something still to come. If a line has to
reach forward or back to make sense, the beats are cut in the wrong places.

Narration text is fed to a speech engine, so write only ordinary words in it:
"pi r squared", "two pi r", "n squared". The real characters belong on screen,
in the claim and the expression. This applies to the spoken lines alone; it is
not a licence to write stiff prose. Read every line aloud - it should sound
like one person telling a friend something neat, in full sentences.

## Showing steps that must be counted

When a figure is built from parts the viewer is meant to count or tell apart,
give each part the primary colour at a different fill opacity - the first
palest, each addition a step deeper. That is one hue at several strengths, so
it keeps the single-working-colour rule while leaving the parts legible. A
finished figure in which every part shares one flat fill has lost the argument
it was drawn to make.

## Composing for the tall frame

`manim_paper` switches to the vertical grid by itself and centres and enlarges
the stage. What is left to get right:

- one clear object per beat, never a wide side-by-side arrangement;
- claims short enough to wrap to two lines;
- nothing that carries meaning in the bottom fifth, which the app covers with
  its own caption and buttons.
