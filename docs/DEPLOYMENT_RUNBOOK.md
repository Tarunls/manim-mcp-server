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

Release `c50b97a` is published as both an immutable application image and E2B template, and the E2B smoke passed. The remote-state-backed Terraform apply created the staging network, subnet, private-service address, Cloud Tasks queue, artifact bucket, runtime/release service accounts, secret containers/versions, and required APIs. It then stopped before Cloud SQL and Cloud Run because the active account `abhinav.malkoochi@gmail.com` has Editor and Service Account User, but cannot administer project IAM, service-account IAM, Secret Manager IAM, or private service networking.

The project owner must grant the deployer the missing authority before resuming. The simplest temporary grant is project Owner, removed after deployment in favor of a dedicated least-privilege release identity. Creating the project budget also requires Billing Account Costs Manager on billing account `0181BB-902BC6-5D4673`. A budget is an alert, not a spending lock.

```sh
gcloud projects add-iam-policy-binding educationalvideo-506219 \
  --member=user:abhinav.malkoochi@gmail.com \
  --role=roles/owner

gcloud billing accounts add-iam-policy-binding 0181BB-902BC6-5D4673 \
  --member=user:abhinav.malkoochi@gmail.com \
  --role=roles/billing.costsManager
```

These commands must be run by an identity already authorized to change the corresponding policies. Do not destroy the partial resources: a fresh `terraform plan` and `terraform apply` will resume from the protected GCS state.

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

The 2026-08-24 release-candidate certification passed on `lesson-studio-renderer:c50b97a`. This certifies the worker runtime, not the callback-to-artifact path; rerun the full silent and narrated generation checks after staging exists.
