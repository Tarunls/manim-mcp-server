# GCP deployment runbook

## Current project inventory

Read-only inventory on 2026-08-23 found project `educationalvideo-506219` in `us-central1` with:

- one public `lesson-studio` Cloud Run service, session affinity enabled, effective max scale 1, and GCS-FUSE mounted as application state;
- Artifact Registry repository `lesson-studio`;
- an existing uniform-access data bucket;
- Identity Platform, Cloud Run, Artifact Registry, Cloud Build, Secret Manager, Logging, and Monitoring APIs enabled;
- no Cloud SQL Admin or Cloud Tasks API enabled yet;
- existing Identity Platform, OpenAI, Speechify, staff-email, Stripe sandbox/test-key, Stripe webhook, and E2B API-key secrets;
- no live Stripe-key secret identifiable by name. Staging must use `stripe_sandbox_api_key`; production must use a separate live restricted key.

Do not convert the existing singleton in place. Build staging beside it, validate end to end, and cut traffic only after data migration and rollback rehearsal.

## Staging apply status (2026-08-24)

Release `df535ac` is deployed as immutable application image `us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:df535ac` and E2B template `lesson-studio-renderer:df535ac`. The domainless staging origin is `https://lesson-studio-staging-api-359351998003.us-central1.run.app`; the legacy `lesson-studio` service was not modified.

The remote-state-backed Terraform stack is fully applied for domainless staging and a fresh plan reports no changes. It includes the private VPC and Cloud SQL instance, API/dispatcher/migration Cloud Run resources, Cloud Tasks queue, private versioned artifact bucket, runtime and release identities, secret bindings, alert policies, operations dashboard, and the $20 monthly GCP budget alert. The budget is an alert, not a spending lock.

The migration, Identity Platform smoke, Stripe hosted-Checkout smoke, E2B runtime smoke, signed-out security checks, automated tests, and application build pass. The remaining staging acceptance work is a signed-in silent generation and narrated generation through the full callback-to-artifact path, notification-channel ownership, and the custom domain/managed edge after the owner supplies a hostname and DNS access.

## Release sequence

1. Create or verify the E2B and environment-appropriate Stripe secrets. Never print secret payloads into a terminal log.
2. Build an immutable E2B template with the same release identifier used in Terraform.
   Run `npm run smoke:e2b` against that exact tag before deploying it.
3. Submit `cloudbuild.yaml`; it runs typecheck, tests, build, and audit before publishing both commit-SHA and convenience `latest` image tags.
4. Review and apply `infra/terraform` for `staging`. The initial domainless configuration uses the canonical `run.app` origin and omits the global edge until DNS is supplied. Terraform application is intentionally manual because it creates billable resources.
5. Run the Cloud Run migration job. It uses a PostgreSQL advisory lock and can be invoked again safely.
6. Deploy the commit-SHA image with `cloudbuild.deploy.yaml`.
7. Verify readiness, sign-up/email verification/login/logout, ownership isolation, checkout/webhook idempotency, one silent and one narrated E2B generation, cancellation/refund, artifact access expiry, and a failed-job retry.
8. Run the load and security gates in `docs/PRODUCTION_CHECKLIST.md` before creating production traffic.

The $20 project budget is an alerting threshold, not a guaranteed stop. The initial staging database is a zonal shared-core instance without an SLA; production validation rejects that tier and requires regional availability, a non-shared-core database, the managed HTTPS edge, and a real domain.

## Rollback

- Application rollback: route the API and dispatcher to the prior immutable image together. Do not use `latest` as a rollback target.
- Database rollback: migrations are forward-only. Deploy a compatibility fix or a new corrective migration; never restore the whole database merely to roll back application code.
- Queue rollback: pause the generation queue before changing dispatcher behavior. Existing jobs remain durable in PostgreSQL.
- E2B rollback: point `E2B_TEMPLATE_VERSION` at the last certified immutable template, then deploy the dispatcher revision.

## Secrets and logs

API and dispatcher service accounts have disjoint secret access. The API owns the upstream OpenAI key for its job-scoped proxy but cannot read the E2B key; the dispatcher cannot read OpenAI, Stripe, Identity Platform, Speechify, or staff secrets. Generated code receives only a job-scoped proxy token in `.env`; the bootstrap separately holds a callback credential and expiring upload URLs inside the disposable E2B boundary.

Application logs must contain IDs, state transitions, latency, and safe error codes—not prompts, emails, cookies, provider responses, signed URLs, or secret values.

## Release smoke commands

The commands below require their named environment variables but never need secrets in repository files:

```sh
npm run smoke:identity
npm run smoke:stripe
E2B_TEMPLATE_VERSION=<immutable-release-id> npm run smoke:e2b
npm run test:e2e
```

`smoke:identity` creates and deletes a uniquely named temporary Identity Platform user. `smoke:stripe` creates a hosted sandbox Checkout session and deletes its temporary database user. `smoke:e2b` disables internet access, checks the pinned runtime, and always kills the disposable sandbox.

The 2026-08-24 runtime certification passed on `lesson-studio-renderer:df535ac`. This certifies the worker runtime, not the callback-to-artifact path; complete the signed-in silent and narrated generation checks before treating staging as fully accepted.
