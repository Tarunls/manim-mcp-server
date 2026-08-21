# Lesson Studio project instructions

Projects below this directory are editable educational videos created by the local Studio app. The host selects Manim, Remotion, or Composite. In Composite projects, Remotion is always the final compositor and Manim is limited to self-contained inserts.

- Keep every project self-contained.
- For Manim projects, the editable source is `scene.py` with one scene named `GeneratedScene`. Import the shared guards from `manim_layout`. Use `assert_inside`, `assert_scene_safe`, and `assert_no_overlap` at every stable visual beat; use `watch_no_overlap` while independent peers move.
- For Remotion projects, the editable source is `video.tsx` with one composition named `GeneratedVideo`. Import `LayoutAudit` and `LayoutItem` from `../../../remotion/layout` and keep the per-frame layout audit active.
- For Composite projects, keep the final source in `video.tsx`, Manim inserts in `manim/*.py`, and the insert manifest in `composite.json`. Remotion owns every final-canvas position, label, transition, and audio cue.
- Render Manim with `python3 ../../../scripts/render_scene.py . balanced`. Render Remotion with `node ../../../scripts/render_remotion.mjs . balanced`. Render Composite with `node ../../../scripts/render_composite.mjs . balanced`.
- The render helper creates `output.mp4`, `poster.png`, `contact-sheet.png`, and `metadata.json`.
- Read `narration-config.json`. When `enabled` is false, render a silent video and verify `metadata.json` reports narration disabled. When `enabled` is true, write 3-5 timed, chapter-length passages to `narration.json`, align them to the visual beats, and verify the final Speechify audio.
- Enabled passages should be 18-45 words, explain cause and effect, and connect naturally to the next idea. Use natural mathematical pronunciation, avoid fragments and fact lists, and budget about 145 words per minute plus breathing room.
- Enabled narration uses Speechify `simba-3.2` with warm SSML delivery, timing guards, fades, and loudness normalization. Fallback narration is forbidden.
- Completed outputs are copied into immutable `versions/vNNN/` folders by the Studio server. Never edit those archived folders.
- Never delete earlier project folders or write outside the current project.
- Prefer deterministic, renderer-native primitives. Use imported project assets only when they are listed in `assets.json`; generated source must not make network requests.
- For first drafts, read `../../references/DEFAULT_VISUAL_LANGUAGE.md` and treat the attached exemplar frames as the default visual quality bar. The complete integral timing reference is available at `../../references/integral-house-style/integral-reference.mp4`. Preserve the references' shared visual grammar, not their subject matter; never carry source-specific copy, formulas, narration, or graphics into an unrelated lesson.
- `reference-template/` is reference material, never active finished source. A first draft must write a fresh `beat-plan.md` and create transformed root source files after `generation-request.json`; the render helpers reject stale, untouched, or topic-mismatched work.
- Read `design-config.json` and use its selected font category and palette across the whole video.
- Write `asset-decision.json` before authoring. When authentic imagery materially helps, search through `node ../../../scripts/studio_asset.mjs . search "precise query"`, visually inspect at least three local previews, and import only a semantically correct result with the script's `import` command. Never choose blindly by result rank. Skip web imagery when native explanatory graphics are clearer.
- When `review-config.json` exists, read `../../skills/educational-video-reviewer/SKILL.md`, inspect the requested frames, and write a validated `review-report.json`.
- Frame feedback is stored under `reviews/` and arrives as direct local-image input. Always compare the clean image with its annotated copy, isolate the smallest marked target, list adjacent objects that must not change, and save that interpretation before editing. Red marks are reviewer markup, not video content.
- Check text and object bounds before completing a render. The 12-frame contact sheet is a sampling aid; the renderer's layout audit is the frame-by-frame collision gate.
