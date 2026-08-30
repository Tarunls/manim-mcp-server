# Lesson Studio project instructions

Projects below this directory are editable educational videos created by the Studio app. Every lesson is rendered with Manim Community Edition in the studio's paper visual style.

- Keep every project self-contained.
- The editable source is `scene.py` with one scene named `GeneratedScene`. Import the shared guards from `manim_layout`. Use `assert_inside`, `assert_scene_safe`, and `assert_no_overlap` at every stable visual beat; use `watch_no_overlap` while independent peers move.
- ALL text goes through `manim_paper` (`load_design`, `running_head`, `claim`, `swap_claim`, `label`, `caption`, `expr`, `text`). Freehand `Text(...)` calls are forbidden and the renderer rejects a scene that skips the import — freehand text is how frames end up with a different size, alignment, and spacing everywhere.
- Route every primary visual through `manim_paper.fit_stage(...)` so it stays in the stage band between the claim and the caption.
- A label sits directly against the object it names, in that object's colour (`manim_paper.label`). Never draw a pointer line from a label to something far away.
- A label for marks inside a grid goes OUTSIDE the grid, aligned over the marks it names. Include every label in `assert_no_overlap`; the renderer refuses scenes without that call.
- Iterate with `python3 ../../../scripts/render_scene.py . draft` for fast checks; the final render must be `python3 ../../../scripts/render_scene.py . balanced`. Run renders in the foreground with a generous command timeout and wait for them — never background a render or poll it with sleep loops.
- The render helper creates `output.mp4`, `poster.png`, `contact-sheet.png`, and `metadata.json`.
- Read `narration-config.json`. When `enabled` is false, render a silent video and verify `metadata.json` reports narration disabled. When `enabled` is true, write 3-5 timed, chapter-length passages to `narration.json`, align them to the visual beats, and verify the final Speechify audio.
- Enabled passages should be 18-45 words, explain cause and effect, and connect naturally to the next idea. Use natural mathematical pronunciation, avoid fragments and fact lists, and budget about 145 words per minute plus breathing room.
- Enabled narration uses Speechify `simba-3.2` with warm SSML delivery, timing guards, fades, and loudness normalization. Fallback narration is forbidden.
- Completed outputs are copied into immutable `versions/vNNN/` folders by the Studio server. Never edit those archived folders.
- Never delete earlier project folders or write outside the current project.
- Prefer deterministic, renderer-native primitives. Use imported project assets only when they are listed in `assets.json`; generated source must not make network requests.
- Read `../../references/DEFAULT_VISUAL_LANGUAGE.md` before planning a first draft and follow its paper style exactly: warm paper ground, no cards or eyebrow tags, an editorial left margin, one working colour, and one payoff colour used once.
- A first draft must write a fresh `beat-plan.md` and create `scene.py` after `generation-request.json`; the render helper rejects stale or topic-mismatched work.
- Read `design-config.json` and use its selected font category and palette across the whole video. Pass `font=` on every `Text` and `MarkupText` using the family in `font.manim`; never hardcode a system font.
- Write `asset-decision.json` before authoring. When authentic imagery materially helps, search through `node ../../../scripts/studio_asset.mjs . search "precise query"`, visually inspect at least three local previews, and import only a semantically correct result with the script's `import` command. Never choose blindly by result rank. Skip web imagery when native explanatory graphics are clearer.
- When `review-config.json` exists, read `../../skills/educational-video-reviewer/SKILL.md`, inspect the requested frames, and write a validated `review-report.json`.
- Frame feedback is stored under `reviews/` and arrives as direct local-image input. Always compare the clean image with its annotated copy, isolate the smallest marked target, list adjacent objects that must not change, and save that interpretation before editing. Red marks are reviewer markup, not video content.
- Check text and object bounds before completing a render. The 12-frame contact sheet is a sampling aid; the renderer's layout audit is the frame-by-frame collision gate.
