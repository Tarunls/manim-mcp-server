# Manim Studio project instructions

Projects below this directory are editable Manim Community Edition videos created by the local Studio app.

- Keep every project self-contained.
- Prefer Video IR v0.2 as the editable source for videos built from text, panels, basic shapes, connectors, groups, and relational layout. Read `../video-ir.schema.json` and `../video-ir.example.json` before authoring it. The renderer deterministically generates `scene.py` and `narration.json`; never edit those generated files.
- Use hand-authored `scene.py` with one scene named `GeneratedScene` for plots, graphs, mathematical transforms, or geometry not supported by Video IR v0.1. Do not leave a stale `video.vir.json` beside a hand-authored scene because the renderer always treats the IR as authoritative.
- Import the shared guards from `manim_layout` and use `assert_inside` plus `assert_scene_safe` before animations.
- Use `python3 ../../../scripts/render_scene.py . balanced` for browser renders.
- The render helper creates `output.mp4`, `poster.png`, `contact-sheet.png`, and `metadata.json`.
- In Video IR projects, write one narration passage per beat; the compiler generates timed `narration.json`. In hand-authored projects, write 3-5 timed passages to `narration.json` using `{ "segments": [{ "start": 0.0, "text": "..." }] }`.
- Each passage should be 18-45 words, explain cause and effect, and connect naturally to the next idea. Use natural mathematical pronunciation, avoid fragments and fact lists, and budget about 145 words per minute plus breathing room.
- Derive the scene duration from that narration budget before animating. Three minimum-length passages need about 25 seconds; do not compensate for an undersized visual plan with long static waits. Keep explicit `self.wait()` time below 35% unless a sustained reading hold is intentional.
- Define v0.2 motion durations as theme tokens aligned exactly to the output frame grid. Use connector nodes for relationships instead of guessed arrow endpoints. Prefer push, crossfade, or morph transitions when ideas continue across beats; these transitions pre-reveal the next beat, so its cues should emphasize rather than enter those nodes again.
- Give each beat's declared focus an entrance or emphasis cue. Do not use the same motion action more than twice in a beat; vary motion by communicative role rather than adding arbitrary glitter.
- When the server has `SPEECHIFY_API_KEY`, the render helper uses Speechify `simba-3.2` with warm SSML delivery, maximum-fidelity MP3, timing guards, fades, and loudness normalization.
- Fallback narration is forbidden. Verify `metadata.json` reports provider `speechify`, model `simba-3.2`, and status `ready` after rendering.
- Completed outputs are copied into immutable `versions/vNNN/` folders by the Studio server. Never edit those archived folders.
- Never delete earlier project folders or write outside the current project.
- Prefer deterministic Manim primitives. Do not download unrequested assets.
- Use a renderer-installed font family. The render preflight intentionally fails instead of allowing Pango to silently substitute different text metrics.
- Seed every use of `random` or `numpy.random`; the render contract rejects unseeded randomness.
- Check text and object bounds before completing a render.
- The renderer strictly validates and compiles Video IR before validating generated `scene.py`, samples the contact sheet at narration beats, and records IR/source/font/runtime provenance plus timing metrics in `metadata.json`.
