---
name: educational-video-reviewer
description: Review rendered educational videos and frame annotations for collisions, motion clarity, pedagogy, accessibility, and visual polish. Use after a Manim render; when review-config.json requests a focus or strictness; or when a user supplies clean and annotated frames with a note.
---

# Educational Video Reviewer

Inspect the actual rendered frames, return evidence tied to frame numbers, and distinguish blocking defects from taste. Do not infer that a layout is safe only because source-level guards exist.

## Workflow

1. Read `review-config.json`; default to `{"focus":"balanced","strictness":"normal"}` if missing.
2. Read `metadata.json` for duration and fps. Inspect `contact-sheet.png`, `poster.png`, and any directly attached clean/annotated review pair named in the request.
3. For `quick`, inspect the contact sheet and cited review frames. For `normal`, also extract and inspect the beginning, midpoint, and end of each major transition. For `obsessive`, inspect those plus every 10th rendered frame around transitions and dense visual beats.
4. Apply the rubric in [rubric.md](references/rubric.md), prioritizing the configured focus while still reporting true blockers in any category.
5. Write `review-report.json` using the schema below. Every issue needs frame evidence and a concrete correction. Use an empty issues array when the render passes.
6. Run `python ../../skills/educational-video-reviewer/scripts/validate_report.py review-report.json` from the project directory.
7. If an issue is blocking, patch the editable source, rerender once, and review the changed frames again. Do not chase subjective polish indefinitely.

## Report schema

```json
{
  "renderer": "manim",
  "focus": "balanced|layout|motion|pedagogy|accessibility|polish",
  "strictness": "quick|normal|obsessive",
  "verdict": "pass|needs_changes",
  "summary": "One concise assessment.",
  "issues": [
    {
      "severity": "blocking|important|suggestion",
      "category": "layout|motion|pedagogy|accessibility|polish",
      "frame": 120,
      "time": 4.0,
      "evidence": "What is visibly wrong in this frame.",
      "fix": "A specific Manim-level correction."
    }
  ]
}
```

## Annotation rules

- Compare `clean.png` with `annotated.png`; treat red circles, arrows, and strokes as spatial pointers only.
- Before opening source, write `interpretation.json` beside the review with `target`, `visualEvidence`, `requestedPropertyChange`, and `excludedNearbyObjects`.
- Select the smallest object enclosed or touched by the markup. A circle around one word does not target its sibling words, even when they share a style or group.
- After rerendering, inspect the same timestamp and confirm both that the target changed and every excluded nearby object remained unchanged.
- The note controls intent when markup is ambiguous.
- Fix the named region without changing unrelated beats.
- Never copy reviewer markup into the produced video.
