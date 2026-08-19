# Manim Studio project instructions

Projects below this directory are editable Manim Community Edition videos created by the local Studio app.

- Keep every project self-contained.
- The editable source is `scene.py` with one scene named `GeneratedScene`.
- Import the shared guards from `manim_layout` and use `assert_inside` plus `assert_scene_safe` before animations.
- Use `python3 ../../../scripts/render_scene.py . balanced` for browser renders.
- The render helper creates `output.mp4`, `poster.png`, `contact-sheet.png`, and `metadata.json`.
- Write 2-8 concise, timed narration beats to `narration.json`. Use `{ "segments": [{ "start": 0.0, "text": "..." }] }` and align each start time to the corresponding visual beat.
- When the server has `SPEECHIFY_API_KEY`, the render helper uses Speechify `simba-3.2` and muxes the AI narration into the MP4.
- Completed outputs are copied into immutable `versions/vNNN/` folders by the Studio server. Never edit those archived folders.
- Never delete earlier project folders or write outside the current project.
- Prefer deterministic Manim primitives. Do not download unrequested assets.
- Check text and object bounds before completing a render.
