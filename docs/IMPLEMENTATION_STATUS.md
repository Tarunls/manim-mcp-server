# Production implementation status

Updated: 2026-08-28

## Completed foundation

- PostgreSQL schema for users, projects, billing profiles, jobs, immutable credits, Stripe idempotency, artifacts, job events, audits, and transactional outbox.
- Ordered migration runner with a PostgreSQL advisory lock.
- Firebase Admin session cookies with revocation checks and email-verification enforcement.
- Double-submit CSRF protection, exact-origin validation, request IDs, security headers, and endpoint rate limits.
- Identity users are synchronized into `app_users` at successful login.
- Local file persistence remains available only as a transitional developer mode.

## Completed hosted execution core

- Owner-scoped PostgreSQL project repository used by hosted API reads and mutations.
- Serializable generation submission with advisory idempotency locks, immutable credit reservations, active-job limits, and a transactional outbox.
- Idempotent Cloud Tasks publication with a named task per generation and OIDC-authenticated delivery.
- Global E2B concurrency gating, lease-based dispatch claims, bounded retry attempts, and one sandbox per generation.
- The API and dispatcher now require the same immutable E2B template tag. Production startup fails closed when the tag is missing or set to `dev`; there is no implicit `default` template fallback.
- Every operation after a job claim is inside the dispatch failure boundary. Retryable provider failures return the job to `queued`; terminal failures refund exactly once and expose a generic message while retaining private diagnostics.
- A five-minute Cloud Scheduler reconciliation invokes the private dispatcher to expire stalled dispatch/running/upload jobs, terminate leaked sandboxes, and refund credits. Terminal sandbox cleanup is recorded in the durable outbox before completion, failure, or cancellation, so retries survive account deletion and database cascades. An in-process reconciliation loop provides an additional best-effort pass.
- Versioned E2B renderer template, official Codex SDK bootstrap, an ephemeral mode-`0600` `.env`, and automatic secret deletion.
- E2B egress restricted to signed GCS uploads and the application callback/proxy host. The sandbox receives no upstream OpenAI, GCP, database, Identity Platform, Stripe, or Speechify credential.
- Job-scoped OpenAI proxy tokens, active-job checks, and a concurrent-safe per-job call budget keep the upstream API key outside untrusted sandboxes.
- Private GCS artifacts validated by content type, size, generation, checksum, file signature, and bounded render-metadata schema before completion; browser reads use ownership checks and ten-minute signed URLs.
- Sandbox callbacks and uploads use bounded timeouts and retries. Downloads and uploads stream instead of buffering whole videos, source trees have file-count and expanded-size limits, and callback messages are redacted and length bounded.
- Job-scoped Speechify proxy capped at 12 segments so narration can render without exposing the provider key to generated code.
- PostgreSQL-backed Stripe profiles and idempotent webhook processing.
- PostgreSQL integration tests verify all migrations, generation idempotency, immutable template capture, lease ownership, retry release, stale-lease reconciliation, private diagnostics, one-time credit reservation, and refund behavior.
- Hosted billing integration tests verify signed webhook construction, replay idempotency, paid entitlement activation, cancellation, and project isolation against real PostgreSQL.
- Identity tests cover email normalization, verification gating, safe provider errors, reset enumeration safety, production cookie naming, and exact cookie parsing.
- Desktop and mobile Playwright coverage verifies public routes, pricing, auth states, authenticated studio hydration, CSRF fail-closed behavior, responsive overflow, and serious/critical accessibility findings.
- React state-reset and URL-workflow Effects, all `useMemo` calls, all `useCallback` calls, and an unused legacy chat implementation were removed. Remaining Effects are limited to external synchronization: EventSource/HTTP lifecycle, animation frames, image loading, canvas drawing, and DOM scrolling, each with cleanup where applicable.

## Completed deployment layer

- Separate `api` and `dispatcher` runtime roles with disjoint routes and Secret Manager access.
- Terraform for private-network regional Cloud SQL PostgreSQL, PITR/backups/deletion protection, Cloud Tasks, private versioned GCS, Cloud Run, migration job, least-privilege service accounts, and alert policies.
- External HTTPS load balancer, Google-managed certificate, TLS policy, HTTP-to-HTTPS redirect, Cloud Armor mutation rate bans, and Cloud Run ingress restricted to load-balancer/internal traffic.
- Commit-SHA application builds, gated CI, ordered migration/deployment pipeline, deployment runbook, rollback procedure, and production certification checklist.
- Hosted frame extraction, frame-review images, and licensed assets use owner-scoped private GCS objects instead of GCS-FUSE or local durable state.
- Revisions restore the prior immutable source archive in a new E2B sandbox; frame-review images and licensed assets are supplied through short-lived signed reads.
- An isolated Stripe CLI sandbox contains stable Creator and Pro lookup-key prices; real hosted Checkout creation was smoke-tested without provisioning access before a webhook.
- Identity Platform sign-up, verification gating, sign-in, Firebase session creation, session verification, and cleanup passed against the configured GCP project.
- A reusable release-smoke harness now creates and verifies a disposable Identity Platform user, creates a real Stripe sandbox Checkout Session, submits a real Cloud Tasks/E2B generation, validates the private MP4 signature, and deletes all test data without committing provider credentials.
- `lesson-studio-renderer:df61e03` passed the E2B runtime smoke with a non-root user, Node 22, Manim, FFmpeg, Codex SDK resolution, workspace I/O, outbound-network denial, and sandbox teardown.
- Workload-based $20, $50, and $100 tiers are enforced server-side; Faster/Balanced use the cost-controlled model and Try harder is reserved for the highest-cost model.
- OpenAI calls now enforce model and output-token ceilings while recording token and estimated-cost telemetry without retaining provider response bodies. The per-job budget is being redesigned so the estimated-cost ceiling (`CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB`, default 2000000 micro-USD) is the enforced primary limit and the API-call count (`CODEX_MAX_API_CALLS_PER_JOB`, 200) is a generous backstop; budget exhaustion returns a terminal `400` to the sandbox.
- Authenticated users can export their data or delete their account, including subscription cancellation and private object cleanup.
- Privacy and terms routes document current processing, provider, billing, output-review, retention, and user-control boundaries for staging review.
- Terraform now supports a domainless, scale-to-zero staging profile with a shared-core database, two E2B workers, three API instances, and a $20 GCP alerting budget while retaining strict production safety checks.
- The staging API and dispatcher serve application image `app:004c9c7` and pin new generation jobs to E2B template `lesson-studio-renderer:004c9c7`. Provenance problem: the deployed `004c9c7` tag does not correspond to a commit in this repository; future images must be built only from pushed commits so every deployed tag is traceable.
- The staging stack is applied from protected remote Terraform state, including private Cloud SQL, API/dispatcher/migration Cloud Run resources, Cloud Tasks, a private versioned artifact bucket, least-privilege identities, alert policies, an 11-chart operations dashboard, and a $20 monthly GCP budget alert. `staging.auto.tfvars` has been converged to the live edge-enabled configuration (edge on, `app_base_url`/`app_domain` set, image and template `004c9c7`).
- The external HTTPS load balancer, Google-managed certificate for `useorune.com` (ACTIVE), Cloud Armor policy `lesson-studio-staging-edge`, and HTTP-to-HTTPS redirect are LIVE at `136.68.115.171`. The canonical public staging origin is `https://useorune.com`; API ingress is restricted to internal-and-cloud-load-balancing, so direct `run.app` access is blocked. The pre-existing `lesson-studio` singleton remains unchanged.

## Remaining before production launch

- Restore billing/quota for the OpenAI API project referenced by GCP Secret Manager secret `openai_api_key`, or replace that secret with a funded API key and restart the API revision. The 2026-08-28 full staging smoke reached the scoped Codex proxy and was rejected by OpenAI with `Quota exceeded`; auth, database, Cloud Tasks, E2B dispatch, callback/refund handling, and Stripe sandbox Checkout succeeded before that external blocker.
- After OpenAI quota is restored, rerun `APP_BASE_URL=<staging-origin> GCP_PROJECT=educationalvideo-506219 npm run smoke:staging`, then run a narrated generation and inspect the visual/audio output. Do not promote while either test is incomplete.
- Select and store a distinct live restricted Stripe key for production; the current isolated Stripe key is staging-only.
- ~~Point staging DNS at the load-balancer IP~~ Done: `useorune.com` resolves to the load balancer, the managed certificate is ACTIVE, and direct `run.app` requests are blocked by the internal-and-cloud-load-balancing ingress.
- Apply the new Terraform email notification channel (`alert_email = abhinav@kyndir.com`, written but not yet applied), review Identity Platform email templates/sender identity, and assign a named support/on-call owner.
- Rebuild and deploy from a pushed commit so the deployed image tag is traceable to this repository (the current `004c9c7` tag is not).
- Complete load, restore, rollback, security, abuse, privacy/legal, and on-call certification before opening production traffic.

The OpenAI, E2B, Speechify, Identity Platform, staff-email, Stripe sandbox, and Stripe webhook credentials are bound from Secret Manager without committing their values. The E2B credential and immutable template are confirmed working; the OpenAI credential is configured but currently quota-blocked. No production database, live Stripe credential, or reserved E2B capacity is provisioned. Domainless staging now incurs the documented shared-core Cloud SQL and usage-based service costs; the $20 GCP budget is alerting only and excludes OpenAI, E2B, Speechify, and Stripe.
