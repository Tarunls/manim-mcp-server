# Production implementation status

Updated: 2026-08-23

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

## Completed deployment layer

- Separate `api` and `dispatcher` runtime roles with disjoint routes and Secret Manager access.
- Terraform for private-network regional Cloud SQL PostgreSQL, PITR/backups/deletion protection, Cloud Tasks, private versioned GCS, Cloud Run, migration job, least-privilege service accounts, and alert policies.
- External HTTPS load balancer, Google-managed certificate, TLS policy, HTTP-to-HTTPS redirect, Cloud Armor mutation rate bans, and Cloud Run ingress restricted to load-balancer/internal traffic.
- Commit-SHA application builds, gated CI, ordered migration/deployment pipeline, deployment runbook, rollback procedure, and production certification checklist.
- Hosted frame extraction, frame-review images, and licensed assets use owner-scoped private GCS objects instead of GCS-FUSE or local durable state.
- Revisions restore the prior immutable source archive in a new E2B sandbox; frame-review images and licensed assets are supplied through short-lived signed reads.

## Remaining before production launch

- Create the missing E2B Secret Manager secret and select the correct live Stripe secrets for production.
- Apply the staging Terraform plan (a billable operation), build the pinned E2B template, and run a real end-to-end generation.
- Point staging DNS at the load-balancer IP, wait for certificate activation, and verify direct `run.app` requests cannot bypass Cloud Armor.
- Complete load, restore, rollback, security, abuse, privacy/legal, and on-call certification before opening production traffic.

No production database or paid E2B capacity is provisioned by committing these files. Infrastructure creation remains an explicit deployment operation.
