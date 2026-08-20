# HTTP API

The MVP binds to `127.0.0.1`. JSON request bodies use `Content-Type: application/json`.

## State and events

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Projects, auth, runtime, and current jobs |
| `GET` | `/api/events` | Server-sent project/job/message updates |
| `GET` | `/api/renderers` | Renderer capabilities and availability |
| `GET` | `/api/generation/providers` | Optional generated-video provider availability |

## Authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Begin managed Codex browser login |
| `POST` | `/api/auth/logout` | Disconnect the Codex account |

## Projects

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects` | Create a project; optional `{ "prompt": "..." }` |
| `POST` | `/api/projects/:id/messages` | Send a generation/revision prompt |
| `POST` | `/api/projects/:id/cancel` | Interrupt the active Codex turn |
| `GET` | `/api/projects/:id/timeline` | Read canonical Video IR |
| `PUT` | `/api/projects/:id/timeline` | Validate and atomically replace Video IR |
| `POST` | `/api/projects/:id/timeline/route` | Recompute shot renderer recommendations |
| `POST` | `/api/projects/:id/render` | Queue an incremental timeline render |
| `GET` | `/api/projects/:id/quality` | Re-run and return the quality report |
| `POST` | `/api/projects/:id/quality` | Same as GET for action-oriented clients |
| `POST` | `/api/projects/:id/versions/:versionId/branch` | Create an independent editable project from a revision |

## Assets

`GET /api/assets/search` accepts:

- `query` (required)
- `kind`
- `provider`: `pexels`, `openverse`, `polyhaven`, or `iconify`
- `commercial=false` to allow noncommercial candidates
- `modifications=false` to allow no-derivatives candidates
- `limit` up to 60

`POST /api/projects/:id/assets/import` accepts one returned candidate. The server revalidates the provider/URL, downloads with a byte cap, calculates SHA-256, stores it under the project, and appends a `VideoAsset` to the IR.

## Jobs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/jobs?projectId=...` | List durable jobs |
| `POST` | `/api/jobs/:id/cancel` | Cancel a queued/running job |

Render submission returns `202` with the job. Progress arrives through SSE `job` events.

## Exports

`POST /api/projects/:id/exports` accepts:

```json
{ "format": "bundle" }
```

Formats:

- `bundle`: complete delivery ZIP;
- `otio`: OpenTimelineIO timeline;
- `credits`: asset credit text;
- `srt`: narration captions.

The response contains a local `/media/...` URL. Export media and project media are served with no-cache headers.

## Errors

Validation and unavailable-capability errors return a JSON `{ "error": "..." }`. The browser should display the message and keep the current timeline intact. A failed render also updates project/job state through SSE.
