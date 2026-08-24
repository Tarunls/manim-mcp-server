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
- E2B egress restricted to OpenAI, signed GCS uploads, and the job callback host. The sandbox receives no GCP, database, Identity Platform, Stripe, or Speechify credential.
- Private GCS artifacts validated by content type, size, generation, and storage checksum before completion; browser reads use ownership checks and ten-minute signed URLs.
- Job-scoped Speechify proxy capped at 12 segments so narration can render without exposing the provider key to generated code.
- PostgreSQL-backed Stripe profiles and idempotent webhook processing.
- A PostgreSQL integration test verifies migrations, generation idempotency, one-time credit reservation, failure, and refund behavior.

## Remaining before production launch

- Move frame-review images and imported licensed assets from the transitional local filesystem to private GCS.
- Split the API and dispatcher deployments and add Terraform, CI/CD, monitoring, backups, and alerting.
- Provision staging, build the pinned E2B template, run an end-to-end generation, and certify load/security behavior before opening traffic.

No production database or paid E2B capacity is provisioned by committing these files. Infrastructure creation remains an explicit deployment operation.
