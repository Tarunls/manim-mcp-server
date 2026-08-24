# Production implementation status

Updated: 2026-08-23

## Completed foundation

- PostgreSQL schema for users, projects, billing profiles, jobs, immutable credits, Stripe idempotency, artifacts, job events, audits, and transactional outbox.
- Ordered migration runner with a PostgreSQL advisory lock.
- Firebase Admin session cookies with revocation checks and email-verification enforcement.
- Double-submit CSRF protection, exact-origin validation, request IDs, security headers, and endpoint rate limits.
- Identity users are synchronized into `app_users` at successful login.
- Local file persistence remains available only as a transitional developer mode.

## Next milestones

- Replace project and billing JSON persistence with PostgreSQL repositories.
- Add atomic job creation, credit reservation, Stripe event processing, and Cloud Tasks dispatch.
- Build the versioned E2B template and sandbox bootstrap.
- Add signed artifact upload/download and completion validation.
- Split the API and dispatcher deployments and add Terraform, CI/CD, monitoring, backups, and load/security certification.

No production database or paid E2B capacity is provisioned by committing these files. Infrastructure creation remains an explicit deployment operation.
