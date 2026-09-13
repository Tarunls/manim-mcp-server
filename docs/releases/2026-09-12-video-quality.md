# Timed video quality release

Deployed: 2026-09-12

- Application image: `us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:55fa6cf`
- E2B template: `lesson-studio-renderer:55fa6cf`
- API revision: `lesson-studio-staging-api-00091-vjj`
- Dispatcher revision: `lesson-studio-staging-dispatcher-00085-tgl`
- Model policy: GPT-5.6 Sol at high reasoning for script, scene, repair, and review on every effort tier.

The release fixes the hosted design-preference resolution bug, introduces storyboard v3 with factual and visual acceptance checks plus word-timed actions, enforces stable text layout in Manim, replaces uniform low-resolution review with beat-aware frame sheets, separates visual diagnosis from scene repair, and verifies every repaired render again.

Parallel animation-range rendering is disabled by default. Production evidence showed that concatenating independently rendered variable-frame-rate chunks shifted later visual events ahead of their declared scene time. The same paper-folding scene failed review at 80 when rendered in parallel and passed at 90 without a scene change when rendered on one continuous timeline.

Validation and renderer smoke passed for the exact template. Hosted end-to-end smoke job `677f57b3-5c11-449c-aa74-ce5bbc546a0b` completed through authentication, billing endpoint validation, private dispatch, E2B generation, inspection, private MP4 upload, and cleanup. Terraform reported no drift after the deployment.

Rollback both services and the migration job to `app:defaa1d`, restore `E2B_TEMPLATE_VERSION=defaa1d`, and restore the previous model environment only if explicitly intended. Application and renderer tags must remain paired.
