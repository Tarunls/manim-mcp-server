# Operations

## First-run checklist

```sh
node --version
python3 --version
uv --version
ffmpeg -version
ffprobe -version
zip -v
codex --version
npm install
npm run setup:manim
codex login
npm run verify
npm run verify:media
```

Copy `.env.example` to `.env` and add only the providers you intend to use. The server loads `.env` in development and production. Restart it after changing variables.

## Required versus optional services

- Codex is required for prompt-driven authoring.
- Manim and FFmpeg are required by the current agent entry gate and render pipeline.
- Speechify is required only when narration is requested.
- Pexels is optional; other asset providers can search without a key.
- OpenAI, Runway, and Google generated video are optional and can incur material cost.
- Blender is optional and detected from `PATH`.

No provider generation is used as an automatic fallback. It runs only when a shot is explicitly routed to `generated`.

## Verification levels

`npm run verify` is the fast commit gate. It performs TypeScript validation, unit/integration tests, six creative regression contracts, and a production browser build.

`npm run verify:media` renders real MP4s. It checks Remotion bundling/rendering, shot cache hits/misses, proxy encoding, FFprobe metadata, and the complete QA report. Run it before changing renderer, FFmpeg, Remotion, or quality code.

`npm run regression:render` renders all deterministic Remotion regression cases. It is slower and is useful before major composition changes.

Provider adapter tests are mocked and never spend credits. Blender tests validate the constrained boundary without requiring Blender. Manim scene rendering requires the local `.venv` and is exercised by normal projects.

## Common failures

### Connect Codex is required

Run `codex login`, restart the server, or use the sidebar flow. Verify `codex app-server` is available from the same shell that starts Node.

### Manim setup required

Run `npm run setup:manim`, then check `.venv/bin/manim --version`. On systems without LaTeX, use Manim `Text`/`MarkupText` or install a TeX distribution before relying on `MathTex`.

### Narration rejected

Confirm `SPEECHIFY_API_KEY`, account limits, `SPEECHIFY_VOICE_ID`, and host-server network access. The app intentionally has no fallback voice. Codex does not receive the provider key or call Speechify from its sandbox; synthesis runs in the host render job. Measured speech automatically extends its visual slot when needed.

### Quality gate failed

Open `quality-report.json`. Fix errors before warnings. Typical fixes:

- move/scale text or diagrams inside `design.safeArea`;
- use at least 32px final-canvas text and sufficient contrast;
- import media through the asset service;
- give each narration segment measured `end` and `words` timing;
- make `format.duration` match the rendered timeline;
- verify the narration audio stream was muxed.

### Generated footage is stuck

Inspect `.generations/<shot-id>.json` and `/api/jobs`. Do not delete the record while the external task is active; it is the resume checkpoint. Provider output links expire, so allow the worker to archive the completed result immediately. Check provider concurrency, moderation, rate, and spend limits.

### Browser playback is laggy

The UI prefers `proxy.mp4` for saved revisions and uses `+faststart` files for seeking. Verify the proxy exists, hardware decoding is enabled, and the browser is not trying to play a provider/raw intermediate. Recreate a proxy through a normal render if needed.

## Data and recovery

Back up `studio/projects/` to retain timelines, assets, versions, exports, QA, and provider checkpoints. Back up `studio/projects.json` to retain chat/project index metadata. `studio/cache/` is disposable and can be regenerated, though deleting it makes the next render slower.

Do not edit `versions/vNNN/`. Branch a version from the UI, then edit the new project.

## Production hardening

Before internet exposure:

1. run Codex and all renderers in isolated per-job containers;
2. move jobs to a database-backed queue with leases/idempotency keys;
3. store assets/versions in object storage with signed access;
4. add application authentication and per-project authorization;
5. add provider spend limits, quotas, and verified webhooks;
6. scan uploaded/downloaded files and constrain codecs/dimensions;
7. centralize logs, metrics, traces, and failed-frame artifacts;
8. encrypt tenant secrets and never inherit a developer shell environment.
