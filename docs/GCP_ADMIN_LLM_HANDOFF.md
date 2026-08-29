# Next-agent staging and production handoff

Updated: 2026-08-29

This is the authoritative continuation document for the Manim Studio/Lesson Studio SaaS. Read it together with `docs/IMPLEMENTATION_STATUS.md`, then inspect current cloud state before making changes. Values in old commits, terminal history, or screenshots are not authoritative.

## Mission and hard boundaries

The product accepts an authenticated video request, reserves plan credits, queues a durable job, starts one isolated E2B sandbox, runs Codex against a job-scoped OpenAI relay, renders a Manim/Remotion/Composite video, optionally obtains Speechify narration through a scoped application bridge, uploads validated artifacts to private GCS, and returns an owner-authorized signed download.

The owner authorized staging work in GCP project `educationalvideo-506219` with a $20 monthly GCP budget alert and Stripe sandbox mode. The $20 figure is not a hard cap and excludes OpenAI, E2B, Speechify, and Stripe. Do not increase staging capacity or create production resources without new authorization.

Never print, copy into documentation, or commit any secret. Credentials that were supplied in chat must be rotated before production. Do not use a supplied administrator password. Use existing Secret Manager bindings.

Do not modify the legacy Cloud Run service named `lesson-studio`. The new services are `lesson-studio-staging-api` and `lesson-studio-staging-dispatcher`.

## Repository state

- Repository: `Tarunls/manim-mcp-server`
- Branch: `codex/manim-studio-mvp`
- Latest commit: `c74eb0d fix: invoke Manim through sandbox Python`
- Latest commit is pushed.
- The application image `app:c74eb0d` exists in Artifact Registry and passed Cloud Build.
- The matching E2B template `lesson-studio-renderer:c74eb0d` does **not** yet exist or has not been certified. Verify rather than assume.
- The working tree was clean before this documentation update. The untracked/ignored staging tfvars and Terraform plan are environment-local files and must never be committed.

Important recent commits:

| Commit | Purpose |
| --- | --- |
| `1a3e83d` | Supports the current Codex Responses WebSocket transport through the scoped relay. |
| `8ffdefc` | Separates long E2B execution from short HTTP request timeouts. |
| `9a95d29` | Allows a bounded full generation and fixes the Cloud Build ignore file so secrets/tfvars are excluded. |
| `48c07a2` / `86ff5ae` | Add and relocate the E2B Manim runtime. |
| `0c2d9ea` | Adds a 64-call allowance plus independent per-job estimated-cost limits. |
| `004c9c7` | Adds the secure loopback narration bridge and paid narrated smoke coverage. |
| `c74eb0d` | Avoids relocatable Manim launcher shebangs and strengthens the exact runtime smoke. |

## Current deployed staging state

| Item | Value |
| --- | --- |
| GCP project | `educationalvideo-506219` |
| Region | `us-central1` |
| Website | `https://useorune.com` |
| Edge IP | `136.68.115.171` |
| TLS certificate | `ACTIVE` |
| API revision | `lesson-studio-staging-api-00024-rtt` |
| Dispatcher revision | `lesson-studio-staging-dispatcher-00022-lvj` |
| API/dispatcher image | `.../lesson-studio/app:004c9c7` |
| E2B template selected by both services | `lesson-studio-renderer:004c9c7` |
| Cloud SQL | Private, zonal `db-f1-micro`, staging only |
| Active E2B cap | 2 |
| API max instances | 3 |
| Sandbox lifetime | 30 minutes |
| OpenAI request allowance | 64 calls per job |
| Normal cost cutoff | 2,000,000 micro-USD ($2 estimated) |
| Try-harder cost cutoff | $4 estimated |
| Per-response output cap | 12,000 tokens |
| Narration cap | 12 segments |
| Stripe | Temporary CLI sandbox, expires 2026-09-04 |

Terraform remote state is in the configured GCS backend. The last apply changed only the API and dispatcher `E2B_TEMPLATE_VERSION` from `86ff5ae` to `004c9c7`: zero resources added and zero destroyed.

## What is proven

### Edge and routing

- Apex DNS resolves to the Google load balancer.
- The Google-managed certificate is active.
- HTTP redirects to the matching HTTPS URL.
- The direct API `run.app` origin returns 404 and cannot bypass Cloud Armor/edge ingress.
- Identity Platform authorizes `useorune.com`.

### Authentication and privacy

- Real disposable signup and email verification passed.
- Verified login establishes the application session.
- Unverified users do not receive sessions and are offered another verification message.
- Session cookies are secure, host-only, HTTP-only, and exact-name parsed.
- CSRF and exact-origin checks fail closed.
- Password reset responses are enumeration-safe.
- Owner IDs are applied to projects, jobs, artifacts, billing, export, and deletion paths.
- Test account deletion cancels billing, removes private data, and removes the Identity Platform identity.

### Stripe sandbox

- Creator: $20/month, 10 credits.
- Pro: $50/month, 30 credits.
- Studio: $100/month, 70 credits.
- Faster costs 1 credit, Balanced 2, Try harder 4.
- Hosted Checkout works with Stripe's documented test card.
- A signed webhook, not the browser redirect, activates the plan.
- The payment smoke proved Creator activation, ten credits, Customer Portal creation, cancellation, and cleanup.
- Webhook replay/idempotency and entitlement behavior have unit/hosted-database coverage.
- Seven supported events are configured: completed/async Checkout, created/updated/deleted subscription, paid invoice, and failed invoice.

### Generation

- A complete silent generation passed the public route: signup, verification, Checkout-session creation, Cloud Tasks, private dispatcher, E2B, Codex, rendering, private GCS upload, metadata/signature checks, owner-authorized signed MP4 download, and cleanup.
- E2B starts from an immutable tag and runs without arbitrary internet access.
- The OpenAI key remains in the API service. The sandbox receives only a job-scoped relay credential.
- The relay supports Codex's WebSocket transport, constrains model/output/cost, and records usage without storing response bodies.
- Terminal failures restore credits and expose a generic user message.
- Reconciliation and durable cleanup protect against stalled jobs and leaked sandboxes.

## What is not proven

The paid narrated end-to-end generation is not complete. Job `2cf0e941-e293-4b93-8c37-9e5df7787d6d` reached E2B after successful payment and entitlement provisioning, then failed because the Composite renderer invoked a Manim console script whose shebang pointed to nonexistent `/app/.venv/bin/python3`. The user-visible failure was generic and the credit was restored.

The narration bridge itself has a passing security/unit test, but live Speechify narration plus final audio muxing has not yet passed because rendering stopped first.

Do not claim:

- that narrated generation works end to end;
- that `c74eb0d` is deployed;
- that the E2B template `c74eb0d` is built or certified;
- that staging is production-ready;
- that the service supports thousands of simultaneous renders.

## Candidate fix already completed

Commit `c74eb0d`:

- creates the E2B virtualenv directly at `/opt/lesson-studio/app/.venv`;
- makes `venv` a compatibility symlink to `.venv`;
- places `.venv/bin` first in the Codex child path;
- changes both Manim helpers to invoke `.venv/bin/python -m manim`;
- makes the E2B smoke execute Manim through that exact interpreter;
- adds a regression test for module-based invocation.

Local tests/build/Python checks passed. Cloud Build ID `4d198cda-fbbb-468c-b903-fbac489fdc8a` successfully published:

`us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:c74eb0d`

No cloud runtime was changed after that image build.

## Exact continuation order

Follow this order. Do not deploy the app image before certifying the matching E2B template.

1. Confirm the branch is still at `c74eb0d` or a documentation-only descendant and the working tree contains no unexpected code changes.
2. Build `lesson-studio-renderer:c74eb0d` from `e2b/Dockerfile` using `npm run e2b:build-template` in a temporary Cloud Run job that reads only the existing `e2b_api_key` secret.
3. Create/run a temporary release-smoke job with `E2B_TEMPLATE_VERSION=c74eb0d`. It must pass the exact `.venv/bin/python -m manim --version` check, Codex SDK import, FFmpeg, workspace write/read, blocked arbitrary egress, and guaranteed sandbox teardown.
4. Deploy `app:c74eb0d` using `cloudbuild.deploy.yaml`. That pipeline updates/runs migrations, then dispatcher, then API.
5. Update the ignored `infra/terraform/staging.auto.tfvars` image and E2B tag to `c74eb0d`. Run a fresh saved Terraform plan. Expect only intentional in-place service environment reconciliation; investigate any create, destroy, database, bucket, edge, IAM, or secret change.
6. Apply the exact reviewed plan.
7. Verify both services report the new immutable image and E2B tag, and readiness succeeds through `https://useorune.com`.
8. Run the paid narrated staging smoke:

```powershell
$env:APP_BASE_URL='https://useorune.com'
$env:GCP_PROJECT='educationalvideo-506219'
$env:STAGING_SMOKE_TIMEOUT_MS='1200000'
npm run smoke:staging-payment
```

Expected success text:

`Payment smoke passed: hosted Checkout, signed webhook provisioning, Customer Portal, and paid narrated generation.`

The script should verify Creator is active, narration is enabled, one Faster credit is consumed (ten to nine), metadata says narration is ready with Speechify `simba-3.2`, the private download is a valid MP4, and cleanup cancels the subscription and deletes the account.

9. Run the standard silent staging smoke, Playwright suite, unit/build/audit gates, and a final no-drift Terraform plan.
10. Inspect logs for the test job and verify the sandbox was terminated, no provider credential was logged, and no test user/subscription/project remains.
11. Update status documentation with actual evidence; never mark a step passed based only on code review.

## Temporary Cloud Run jobs

The following temporary jobs existed at the last inventory and may be removed after the replacement template and final evidence are complete:

- `lesson-studio-staging-e2b-release-48c07a2`
- `lesson-studio-staging-e2b-smoke-48c07a2`
- `lesson-studio-staging-e2b-release-86ff5ae`
- `lesson-studio-staging-e2b-smoke-86ff5ae`
- `lesson-studio-staging-e2b-release-004c9c7`
- `lesson-studio-staging-e2b-smoke-004c9c7`
- `lesson-studio-staging-usage-diagnostic`

List jobs again before cleanup and delete only exact temporary names. Do not delete `lesson-studio-staging-migrate`.

## Key files

| Area | Files |
| --- | --- |
| Public/API server and routes | `server/index.ts` |
| Hosted generation transactions | `server/hosted-generation-service.ts` |
| E2B dispatch and leases | `server/e2b-dispatcher.ts` |
| Scoped Codex HTTP/WS relay | `server/scoped-codex-proxy.ts`, `server/scoped-codex-websocket.ts` |
| E2B image/bootstrap | `e2b/Dockerfile`, `e2b/bootstrap.mjs` |
| Secure narration bridge | `e2b/narration-proxy.mjs`, `scripts/generate_narration.mjs` |
| Renderers | `scripts/render_scene.py`, `scripts/render_remotion.mjs`, `scripts/render_composite.mjs`, `scripts/render_manim_insert.py` |
| Artifact validation/storage | `server/artifact-service.ts`, `server/hosted-media-service.ts` |
| Identity/session security | `server/auth-service.ts`, auth routes in `server/index.ts` |
| Billing | `server/billing-service.ts`, Stripe routes/webhook in `server/index.ts` |
| Database/migrations | `server/database.ts`, `migrations/` |
| Staging smoke | `scripts/smoke_staging_e2e.ts`, `scripts/smoke_staging_payment.ts`, `scripts/smoke_e2b.ts` |
| Infrastructure | `infra/terraform/`, `cloudbuild.yaml`, `cloudbuild.deploy.yaml` |
| Security/regression tests | `tests/` |

## Secret and trust model

- Browser: no provider keys.
- API service: Identity Platform, Stripe, Speechify, upstream OpenAI, database, artifact signing, and callback access as required.
- Dispatcher: E2B key, database, artifact write scope, and callback material; no OpenAI/Stripe/Identity/Speechify provider keys.
- Codex child: job-scoped OpenAI relay URL/token and, when enabled, a loopback narration URL. It does not receive the upstream OpenAI key, Speechify key, GCP credentials, database URL, Stripe key, E2B key, or raw job callback token.
- E2B bootstrap: holds the job callback token and signed artifact upload URLs only for the active disposable job, writes sensitive temporary material with mode `0600`, and deletes it.
- GCS: private bucket, public access prevention, versioning, scoped signed reads/writes.

The loopback narration proxy is important: generated code calls only its localhost URL. The trusted bootstrap adds the hidden callback credential when forwarding to the API. Do not simplify this by exposing the callback token to Codex.

## Failure and cost behavior

- A generation reservation and job/outbox row are atomic.
- Duplicate submissions, tasks, callbacks, and Stripe events are idempotent.
- Retryable dispatch/provider failures return to the queue with bounded retry.
- Terminal failure and cancellation refund exactly once.
- Public errors are generic; private diagnostics stay in operational storage/logs.
- Sandbox execution can run for the configured job duration even though ordinary callback and HTTP requests have short bounded timeouts.
- The 64-call maximum is a completion allowance, not the primary spend limit. The independent estimated-cost ceiling is $2 for Faster/Balanced and $4 for Try harder.
- One observed 32-turn failed generation was estimated at $0.518306. Re-measure successful silent and narrated jobs before changing plan economics.

## Required tests

Local/CI gate:

```sh
npm ci
npm run check
npm test
npm run build
npm audit --audit-level=high
npm run test:e2e
```

Provider/staging gate:

```sh
npm run smoke:identity
npm run smoke:stripe
E2B_TEMPLATE_VERSION=<exact-tag> npm run smoke:e2b
APP_BASE_URL=https://useorune.com GCP_PROJECT=educationalvideo-506219 npm run smoke:staging
APP_BASE_URL=https://useorune.com GCP_PROJECT=educationalvideo-506219 npm run smoke:staging-payment
```

Smokes create disposable identities/subscriptions/jobs and attempt cleanup in `finally` blocks. A failed smoke still requires checking for leftovers.

## Production blockers after staging passes

- Use a separate protected Terraform state and a reviewed production tfvars file.
- Replace zonal shared-core Cloud SQL with regional HA and a load-tested dedicated tier.
- Create durable live Stripe products/prices, a restricted live key, live webhook secret, and production Customer Portal configuration. Keep `ALLOW_TEST_CHECKOUT=false`.
- Complete tax, refund, dispute, cancellation, support, terms, privacy, retention, subprocessors, and company-contact decisions.
- Review Identity Platform email sender/templates/action links.
- Configure notification channels and prove alerts reach a named human.
- Perform Cloud SQL restore, artifact recovery, queue pause/resume, application rollback, E2B rollback, provider outage, and secret-rotation drills.
- Obtain and test E2B/OpenAI/Speechify quotas for the intended capacity.
- Load-test authenticated API submission/SSE behavior independently from active E2B rendering.
- Protect deployment branches and the release service account.
- Rotate every credential ever pasted into chat before launch.

The architecture durably queues many users, but current staging runs only two sandboxes at once. Do not equate queued users with simultaneous renders.

## Final definition of done

Staging can be called certified only when both a silent and a paid narrated video complete through the public domain with correct billing, private artifacts, playback/download, credit accounting, sandbox teardown, and cleanup. Public production additionally requires the operational, legal, live-billing, capacity, recovery, and security items above.
