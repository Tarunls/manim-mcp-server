# Scene plan contract v1

Write `scene-plan.json` before `scene.py`. It is the semantic bridge between the lesson plan, deterministic layout checks, visual review, and localized repairs.

```json
{
  "version": 1,
  "lessonGoal": "Show why narrowing slices converge to exact accumulated area.",
  "beats": [
    {
      "id": "rough-estimate",
      "purpose": "Make the approximation visibly imperfect.",
      "dominantVisual": "A curve above four coarse rectangles.",
      "weight": 1,
      "objects": [
        {
          "id": "curve",
          "role": "primary mathematical object",
          "changePolicy": "preserve"
        },
        {
          "id": "rectangles",
          "role": "changing approximation",
          "changePolicy": "flexible"
        },
        {
          "id": "estimate-label",
          "role": "adjacent label",
          "changePolicy": "flexible"
        }
      ]
    }
  ]
}
```

Rules:

- IDs are lowercase letters, numbers, hyphens, or underscores and remain stable when an object persists across beats.
- `weight` is relative screen time, not an exact timestamp. Omit it to use `1`.
- `changePolicy: preserve` identifies the visual anchors a localized repair should avoid changing. Use `flexible` for objects that can move, resize, or restyle to solve the beat.
- Every object passed to `assert_inside`, `assert_scene_safe`, `assert_no_overlap`, or `watch_no_overlap` must use its exact plan ID in a literal `names=[...]` list.
- Name independent visual groups, not every primitive inside a deliberate composite. A curve and its own pale area fill can be one group; that group remains independent from its claim and labels.
- Revisions update this file deliberately. Do not rename unaffected objects merely because source code was reorganized.

The renderer uses beat weights to select stable and transition review frames. It writes `layout-audit.json` after deterministic checks and writes `repair-context.json` only when a named layout target fails.
