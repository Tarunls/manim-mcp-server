# GCP deployment runbook

## Current project inventory

Read-only inventory on 2026-08-23 found project `educationalvideo-506219` in `us-central1` with:

- one public `lesson-studio` Cloud Run service, session affinity enabled, effective max scale 1, and GCS-FUSE mounted as application state;
- Artifact Registry repository `lesson-studio`;
- an existing uniform-access data bucket;
- Identity Platform, Cloud Run, Artifact Registry, Cloud Build, Secret Manager, Logging, and Monitoring APIs enabled;
- no Cloud SQL Admin or Cloud Tasks API enabled yet;
- existing Identity Platform, OpenAI, Speechify, staff-email, Stripe test-key, and Stripe webhook secrets;
- no E2B API-key secret visible under the expected `e2b_api_key` name and no live Stripe-key secret identifiable by name.

Do not convert the existing singleton in place. Build staging beside it, validate end to end, and cut traffic only after data migration and rollback rehearsal.

## Release sequence

1. Create or verify the E2B and environment-appropriate Stripe secrets. Never print secret payloads into a terminal log.
2. Build an immutable E2B template with the same release identifier used in Terraform.
3. Submit `cloudbuild.yaml`; it runs typecheck, tests, build, and audit before publishing both commit-SHA and convenience `latest` image tags.
4. Review and apply `infra/terraform` for `staging`. Terraform application is intentionally manual because it creates billable resources.
5. Run the Cloud Run migration job. It uses a PostgreSQL advisory lock and can be invoked again safely.
6. Deploy the commit-SHA image with `cloudbuild.deploy.yaml`.
7. Verify readiness, sign-up/email verification/login/logout, ownership isolation, checkout/webhook idempotency, one silent and one narrated E2B generation, cancellation/refund, artifact access expiry, and a failed-job retry.
8. Run the load and security gates in `docs/PRODUCTION_CHECKLIST.md` before creating production traffic.

## Rollback

- Application rollback: route the API and dispatcher to the prior immutable image together. Do not use `latest` as a rollback target.
- Database rollback: migrations are forward-only. Deploy a compatibility fix or a new corrective migration; never restore the whole database merely to roll back application code.
- Queue rollback: pause the generation queue before changing dispatcher behavior. Existing jobs remain durable in PostgreSQL.
- E2B rollback: point `E2B_TEMPLATE_VERSION` at the last certified immutable template, then deploy the dispatcher revision.

## Secrets and logs

API and dispatcher service accounts have disjoint secret access. The API owns the upstream OpenAI key for its job-scoped proxy but cannot read the E2B key; the dispatcher cannot read OpenAI, Stripe, Identity Platform, Speechify, or staff secrets. Generated code receives only a job-scoped proxy token in `.env`; the bootstrap separately holds a callback credential and expiring upload URLs inside the disposable E2B boundary.

Application logs must contain IDs, state transitions, latency, and safe error codes—not prompts, emails, cookies, provider responses, signed URLs, or secret values.
