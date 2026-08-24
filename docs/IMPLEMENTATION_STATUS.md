# Production implementation status

Updated: 2026-08-24

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
- Global E2B concurrency gating, crash-recoverable dispatch claims, one sandbox per generation, and sandbox termination on cancellation.
- Versioned E2B renderer template, official Codex SDK bootstrap, an ephemeral mode-`0600` `.env`, and automatic secret deletion.
- E2B egress restricted to signed GCS uploads and the application callback/proxy host. The sandbox receives no upstream OpenAI, GCP, database, Identity Platform, Stripe, or Speechify credential.
- Job-scoped OpenAI proxy tokens, active-job checks, and a concurrent-safe per-job call budget keep the upstream API key outside untrusted sandboxes.
- Private GCS artifacts validated by content type, size, generation, and storage checksum before completion; browser reads use ownership checks and ten-minute signed URLs.
- Job-scoped Speechify proxy capped at 12 segments so narration can render without exposing the provider key to generated code.
- PostgreSQL-backed Stripe profiles and idempotent webhook processing.
- A PostgreSQL integration test verifies migrations, generation idempotency, one-time credit reservation, failure, and refund behavior.
- Hosted billing integration tests verify signed webhook construction, replay idempotency, paid entitlement activation, cancellation, and project isolation against real PostgreSQL.
- Identity tests cover email normalization, verification gating, safe provider errors, reset enumeration safety, production cookie naming, and exact cookie parsing.
- Desktop and mobile Playwright coverage verifies public routes, pricing, auth states, CSRF fail-closed behavior, responsive overflow, and serious/critical accessibility findings.

## Completed deployment layer

- Separate `api` and `dispatcher` runtime roles with disjoint routes and Secret Manager access.
- Terraform for private-network regional Cloud SQL PostgreSQL, PITR/backups/deletion protection, Cloud Tasks, private versioned GCS, Cloud Run, migration job, least-privilege service accounts, and alert policies.
- External HTTPS load balancer, Google-managed certificate, TLS policy, HTTP-to-HTTPS redirect, Cloud Armor mutation rate bans, and Cloud Run ingress restricted to load-balancer/internal traffic.
- Commit-SHA application builds, gated CI, ordered migration/deployment pipeline, deployment runbook, rollback procedure, and production certification checklist.
- Hosted frame extraction, frame-review images, and licensed assets use owner-scoped private GCS objects instead of GCS-FUSE or local durable state.
- Revisions restore the prior immutable source archive in a new E2B sandbox; frame-review images and licensed assets are supplied through short-lived signed reads.
- An isolated Stripe CLI sandbox contains stable Creator and Pro lookup-key prices; real hosted Checkout creation was smoke-tested without provisioning access before a webhook.
- Identity Platform sign-up, verification gating, sign-in, Firebase session creation, session verification, and cleanup passed against the configured GCP project.
- A reusable release-smoke harness now verifies Identity Platform, Stripe Checkout, and the pinned E2B runtime without committing provider credentials.
- `lesson-studio-renderer:d13958f-r4` passed the E2B runtime smoke with a non-root user, Node 22, Manim, FFmpeg, Codex SDK resolution, workspace I/O, outbound-network denial, and sandbox teardown.
- Workload-based $20, $50, and $100 tiers are enforced server-side; Faster/Balanced use the cost-controlled model and Try harder is reserved for the highest-cost model.
- OpenAI calls now enforce model, output-token, and per-job request ceilings while recording token and estimated-cost telemetry without retaining provider response bodies.
- Authenticated users can export their data or delete their account, including subscription cancellation and private object cleanup.
- Privacy and terms routes document current processing, provider, billing, output-review, retention, and user-control boundaries for staging review.
- Terraform now supports a domainless, scale-to-zero staging profile with a shared-core database, two E2B workers, three API instances, and a $20 GCP alerting budget while retaining strict production safety checks.
- Immutable release `c50b97a` was published as application image `us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:c50b97a` and E2B template `lesson-studio-renderer:c50b97a`; the E2B runtime smoke passed.
- The protected remote Terraform state bucket and the first non-billable/low-cost staging resources were created. The apply stopped safely before Cloud SQL and Cloud Run when the active deployer lacked IAM-policy and private-service-networking administration permissions.

## Remaining before production launch

- Select and store a distinct live restricted Stripe key for production; the current isolated Stripe key is staging-only.
- Have a project owner grant the deployer temporary project Owner access (or the equivalent granular IAM/service-account/secret/network administration roles) and Billing Account Costs Manager on the linked billing account, then resume the remote-state-backed staging apply.
- After the apply completes, run the migration and a real callback-to-artifact generation through Cloud Tasks, Cloud Run, E2B, the scoped Codex proxy, and private GCS.
- Point staging DNS at the load-balancer IP, wait for certificate activation, and verify direct `run.app` requests cannot bypass Cloud Armor.
- Complete load, restore, rollback, security, abuse, privacy/legal, and on-call certification before opening production traffic.

The E2B API key and staging Stripe sandbox key exist in Secret Manager. No production database or reserved E2B capacity is provisioned. The partial staging apply currently has no Cloud SQL instance or Cloud Run service, so the main recurring staging cost has not started; resume it only after the documented IAM grant.
