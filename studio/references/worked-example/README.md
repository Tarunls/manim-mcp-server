# A worked example, start to finish

This is a real, shipped lesson (eigenvectors): its `beat-plan.md` and the
`scene.py` that rendered it. It exists so a first draft can imitate proven
mechanics instead of deriving them, which is the difference between one
render and three.

Imitate the **mechanics**, never the topic:

- the four-beat shape: claim → visual change → guards → wait sized to narration;
- one `VGroup` layout with an invisible anchor routed through `fit_stage` once,
  before anything animates;
- `swap_claim` between beats, `watch_no_overlap` around the one moving
  transform, `assert_inside` + `assert_scene_safe` + `assert_no_overlap` at
  every settled beat;
- labels created with `label(...)` against the object they name, in that
  object's colour; the accent colour spent exactly once.

Your lesson's topic, visuals, and claims must come from the brief. If your
scene looks like this one with nouns swapped, the plan was not thought
through.
