# Manim Studio

Manim Studio is a local AI video production MVP. Give it a prompt in the browser; a Codex production agent plans a storyboard, builds an editable timeline, creates narration and licensed assets, routes each shot to the right renderer, checks the result, and retains every revision.

The UI stays intentionally small: project sidebar, streamed agent chat, live video canvas, timeline, inspector, asset browser, and revision history.

## What works

- Canonical `project.json` video IR with shots, tracks, clips, transforms, assets, narration, design tokens, and renderer routing.
- Live Remotion preview plus full-quality MP4 rendering at the project resolution and frame rate.
- Specialized Manim shots inside mixed timelines, constrained Blender 3D scenes, and optional generated footage providers.
- Speechify `simba-3.2` narration with measured segment/word timing and no synthetic fallback.
- Licensed search/import through Openverse, Pexels, Poly Haven, and Iconify with hashes, credits, and provenance.
- Shot-level render cache, durable jobs, fast proxies, proper seeking/fullscreen controls, and cancellable work.
- Automated schema, safe-area, typography, contrast, asset, audio, video, duration, and provenance checks.
- Immutable version history and non-destructive branches from any saved revision.
- Delivery ZIP with MP4, proxy, rendered shots, `.otio`, `project.json`, captions, credits, assets, timing, provenance, and QA results.

## Quick start

Prerequisites:

- Node.js 20+
- Python 3.10+
- [`uv`](https://docs.astral.sh/uv/)
- FFmpeg and FFprobe on `PATH`
- `zip` and `unzip`
- [Codex CLI](https://developers.openai.com/codex/cli/) installed
- Optional: Blender on `PATH` for 3D shots

```sh
git clone https://github.com/Tarunls/manim-mcp-server.git
cd manim-mcp-server
git checkout codex/manim-studio-mvp
npm install
npm run setup:manim
cp .env.example .env
codex login
npm run dev
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321).

The app reuses local Codex CLI authentication. If it is signed out, use **Connect Codex** in the sidebar. No Codex token is sent to browser JavaScript.

## Environment

All keys are server-only. Never use a `VITE_*` name for a secret.

| Variable | Purpose |
| --- | --- |
| `SPEECHIFY_API_KEY` | Required when narration is requested |
| `SPEECHIFY_VOICE_ID` | Optional voice override; default `geffen_32` |
| `PEXELS_API_KEY` | Optional Pexels footage/image search |
| `OPENAI_API_KEY` | Optional OpenAI generated-video provider |
| `RUNWAYML_API_SECRET` | Optional Runway generated-video provider |
| `GEMINI_API_KEY` | Optional Google generated-video provider |
| `VIDEO_GENERATION_PROVIDER` | Optional preference: `openai`, `runway`, or `google` |
| `PORT` | Local port; default `4321` |

Openverse, Poly Haven, and Iconify search do not require provider keys. Legacy aliases `RUNWAY_API_KEY` and `GOOGLE_API_KEY` remain supported.

Never commit `.env`. If a key was pasted into a chat, issue, or commit, replace it at the provider before using the project.

## Development commands

```sh
npm run dev                # local server with reload
npm run build              # production client + TypeScript validation
npm start                  # serve the production build
npm run test               # unit and integration tests
npm run regression         # six creative contract fixtures
npm run regression:render  # also render the Remotion fixtures
npm run verify             # check + tests + regression + build
npm run verify:media       # real Remotion/cache/QA MP4 smoke tests
npm run setup:manim        # repository-local Manim CE environment
```

Project-level tools:

```sh
npm run validate:project -- studio/projects/PROJECT_ID
npm run render:project -- studio/projects/PROJECT_ID
npm run check:project -- studio/projects/PROJECT_ID
```

## How a prompt becomes a video

```text
Prompt
  → fast Codex authoring pass: storyboard, editable project.json, optional Manim source
  → host-only Speechify synthesis and measured timing
  → shot routing: Remotion | Manim | Blender | generated footage
  → shot cache and FFmpeg assembly
  → proxy, poster, contact sheet, QA, provenance
  → immutable revision and delivery bundle
```

`project.json` is always the source of truth. Renderer files and MP4s are derived artifacts. Codex never calls Speechify or renders inside its sandbox; the host job worker owns provider credentials, rendering, inspection, and archival. Targeted chat revisions patch the smallest affected project region, then produce a new immutable `versions/vNNN` snapshot.

Generated-video jobs are asynchronous and may take minutes. Their external job ID is saved under `.generations/`, so an interrupted worker resumes polling instead of submitting a duplicate paid request. Finished provider files are copied locally before their temporary URLs expire.

## Project layout

```text
studio/projects/<project-id>/
  project.json
  scene.py                         # optional Manim source
  assets/
  narration.json
  narration-timing.json
  output.mp4
  proxy.mp4
  poster.png
  contact-sheet.png
  metadata.json
  quality-report.json
  provenance.json
  versions/v001/...
  exports/<timestamp>/...zip
```

Local projects, jobs, caches, exports, and credentials are gitignored.

## Renderer contract

- **Remotion**: typography, captions, UI, shapes, footage, charts, audio, and final browser preview.
- **Manim**: equations, graphs, geometry, and technical vector explanations. A shot declares `metadata.sceneFile` and optional `metadata.sceneClass`.
- **Blender**: safe JSON scene descriptions containing primitives, transforms, materials, lights, cameras, and keyframes. Project-authored Blender Python is not executed.
- **Generated footage**: cinematic/organic footage through an explicitly configured provider. A shot declares `metadata.generationPrompt` and may choose a provider/model.
- **FFmpeg**: normalization, audio contract, concatenation, proxies, posters, contact sheets, and delivery encoding.

Every rendered shot is normalized to the same dimensions, frame rate, H.264 pixel format, AAC audio stream, and exact timeline duration before assembly.

## Quality and licensing

A render does not enter version history when required checks fail. Errors include invalid IR, unsafe text/diagram bounds, unreadable contrast, missing asset licenses/hashes/credits, narration overlaps, missing audio, and duration mismatch. Sustained black, frozen, or silent regions are warnings recorded in `quality-report.json`.

Online media must be imported through the asset service. Raw URLs are not accepted as project assets because they omit content hashes, license fields, creator credits, and source provenance.

## Production boundary

This branch is a correctly structured local MVP, not a hardened multi-tenant service. It binds to `127.0.0.1`. Before public hosting, move renderers to isolated workers, add user authentication and authorization, rate/spend limits, object storage, a database-backed job queue, webhook verification, malware scanning, and tenant-level secret management.

Further documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Operations and troubleshooting](docs/OPERATIONS.md)
- [Video IR authoring](docs/VIDEO_IR.md)

## Legacy MCP server

The original Python MCP server remains at `src/manim_server.py` for existing integrations. It executes Manim code and returns rendered media. The Studio website is the primary product path on this branch.

## License

MIT. See [LICENSE.txt](LICENSE.txt).
