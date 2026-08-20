# Manim Studio project instructions

Projects below this directory are editable multi-renderer videos created by the local Studio app.

- Keep every project self-contained.
- The editable source of truth is `project.json`. `scene.py` is used only by shots routed to Manim and contains one scene named `GeneratedScene`.
- A Manim timeline shot points to its project-local source with `metadata.sceneFile` and may select `metadata.sceneClass`. Mixed timelines render each Manim shot independently and normalize it before assembly.
- Validate the storyboard and timeline with `node --import tsx ../../../scripts/validate_project.ts .` before rendering.
- Use the asset scripts for storyboard-selected media. Every import must retain license, attribution, content hash, and provenance in `project.json`.
- Import the shared guards from `manim_layout` and use `assert_inside` plus `assert_scene_safe` before animations.
- Use `python3 ../../../scripts/render_scene.py . balanced` for browser renders.
- The render helper creates `output.mp4`, `poster.png`, `contact-sheet.png`, and `metadata.json`.
- Write timed, chapter-length narration passages to `narration.json`. Run `node ../../../scripts/generate_narration.mjs . --prepare`, then align shots to the measured durations in `narration-timing.json`.
- Each passage should be 18-45 words, explain cause and effect, and connect naturally to the next idea. Use natural mathematical pronunciation, avoid fragments and fact lists, and budget about 145 words per minute plus breathing room.
- When the server has `SPEECHIFY_API_KEY`, the render helper uses Speechify `simba-3.2` with warm SSML delivery, maximum-fidelity MP3, timing guards, fades, and loudness normalization.
- Fallback narration is forbidden. Verify `metadata.json` reports provider `speechify`, model `simba-3.2`, and status `ready` after rendering.
- Completed outputs are copied into immutable `versions/vNNN/` folders by the Studio server. Never edit those archived folders.
- Never delete earlier project folders or write outside the current project.
- Prefer deterministic components. Download only storyboard-selected assets through the provided import tool.
- Check text and object bounds before completing a render.
