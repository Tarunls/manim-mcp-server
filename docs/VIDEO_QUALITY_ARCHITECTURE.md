# Video quality architecture

Updated: 2026-09-12

The generation contract is `brief -> teaching plan -> voice -> timed actions -> scene -> deterministic render checks -> visual diagnosis -> targeted repair -> verification`.

## Invariants

- `shared/models.json` is the source of truth for creative model routing. Script, scene, repair, and review use GPT-5.6 Sol at high reasoning by default.
- `shared/design-system.json` is the source of truth for font, palette, type scale, and spacing. Hosted and local jobs resolve the same preference names through `resolveDesign()` before authoring.
- Storyboard version 3 records a teaching goal, factual claims, required visual proof, an art direction, exact on-screen strings, beat checks, and action cues. Narrated action cues are aligned to provider word timestamps before scene authoring.
- Generated scenes subclass `QualityScene`. Every stable key state fails rendering when visible text is outside the safe frame, unreadably small, or colliding with other text.
- Production renders use one continuous Manim timeline. Parallel animation-range rendering is opt-in for timing-insensitive diagnostics because concatenated variable-frame-rate chunks shifted later visual events ahead of narration.
- Review frames sample the start, middle, and result of every beat at 540-pixel tile width and print the source timestamp above each frame.
- The visual critic diagnoses only. It cannot rewrite code. A separate repair call receives the structured issues and review frames. Every repaired render returns to the critic. A video is deliverable only with no critical or major issues and a score of at least 85.

## Current renderer boundary

Manim remains the procedural vector renderer for diagrams, equations, geometry, and explanatory motion. The teaching plan and review report are renderer-neutral so later adapters can compile the same plan to Remotion for UI and editorial motion, or Blender for spatial and physical scenes. Renderer selection should happen per beat only after common scene semantics and cross-renderer compositing are implemented.

## Evaluation

Release candidates must include a narrated end-to-end example, the structured review history, and contact sheets. The benchmark set should cover geometry, a physical process, a data explanation, software UI, humanities, and a general narrative. Track first-pass score, final score, repair count, render time, model time, factual defects, timing defects, layout failures, and human preference against the prior release.
