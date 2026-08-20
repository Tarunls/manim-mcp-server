# Manim Studio project instructions

Projects below this directory are editable Manim Community Edition videos created by the local Studio app.

- Keep every project self-contained.
- The editable source is `scene.py` with one scene named `GeneratedScene`.
- Import the shared guards from `manim_layout` and use `assert_inside` plus `assert_scene_safe` before animations.
- Use `python3 ../../../scripts/render_scene.py . balanced` for browser renders.
- The render helper creates `output.mp4`, `poster.png`, `contact-sheet.png`, and `metadata.json`.
- Write 3-5 timed, chapter-length narration passages to `narration.json`. Use `{ "segments": [{ "start": 0.0, "text": "..." }] }` and align each start time to the corresponding visual beat.
- Each passage should be 18-45 words, explain cause and effect, and connect naturally to the next idea. Use natural mathematical pronunciation, avoid fragments and fact lists, and budget about 145 words per minute plus breathing room.
- Derive the scene duration from that narration budget before animating. Three minimum-length passages need about 25 seconds; do not compensate for an undersized visual plan with long static waits. Keep explicit `self.wait()` time below 35% unless a sustained reading hold is intentional.
- When the server has `SPEECHIFY_API_KEY`, the render helper uses Speechify `simba-3.2` with warm SSML delivery, maximum-fidelity MP3, timing guards, fades, and loudness normalization.
- Fallback narration is forbidden. Verify `metadata.json` reports provider `speechify`, model `simba-3.2`, and status `ready` after rendering.
- Completed outputs are copied into immutable `versions/vNNN/` folders by the Studio server. Never edit those archived folders.
- Never delete earlier project folders or write outside the current project.
- Prefer deterministic Manim primitives. Do not download unrequested assets.
- Seed every use of `random` or `numpy.random`; the render contract rejects unseeded randomness.
- Check text and object bounds before completing a render.
- The renderer validates `scene.py` structurally, samples the contact sheet at narration beats, and records source/font/runtime provenance plus timing metrics in `metadata.json`.
