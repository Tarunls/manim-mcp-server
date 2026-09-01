# GCP deployment runbook

Updated: 2026-08-29

Read `docs/GCP_ADMIN_LLM_HANDOFF.md` before deploying. It records the exact current release and the incomplete narrated-generation certification.

## Environment

- Project: `educationalvideo-506219`
- Region: `us-central1`
- Canonical staging origin: `https://useorune.com`
- Edge IP: `136.68.115.171`
- Managed TLS: active
- Terraform: protected remote GCS state
- Runtime services: `lesson-studio-staging-api` and `lesson-studio-staging-dispatcher`
- Migration job: `lesson-studio-staging-migrate`
- Legacy service `lesson-studio`: do not modify

The deployed image/template are currently `004c9c7`. Candidate application image `c74eb0d` is built but not deployed; its E2B template must be built and smoked first.

## Release invariants

1. Application and E2B releases use immutable commit tags, never only `latest`.
2. If `e2b/`, renderer code, renderer dependencies, or the Codex bootstrap changes, build and smoke the matching E2B template before deploying the application.
3. Run migrations before dispatcher and API.
4. API and dispatcher must receive the same `E2B_TEMPLATE_VERSION`; the API persists it on job submission and the dispatcher starts that exact version.
5. Review every Terraform plan. Do not accept unexpected replacement/destruction of Cloud SQL, GCS, networking, edge, IAM, secrets, or state.
6. Keep secret values out of source, tfvars, Cloud Build substitutions, terminal output, and documentation.

## Application image build

`cloudbuild.yaml` runs type checking, tests, the production build, and dependency audit before publishing the commit and convenience tags.

```sh
gcloud builds submit \
  --config cloudbuild.yaml \
  --project educationalvideo-506219 \
  --substitutions=COMMIT_SHA=<commit>,_REGION=us-central1,_REPOSITORY=lesson-studio,_ENVIRONMENT=staging \
  .
```

The `c74eb0d` build already succeeded as Cloud Build `4d198cda-fbbb-468c-b903-fbac489fdc8a`; do not rebuild it unless registry verification shows the image is missing.

## E2B template release

Build the exact tag using the existing E2B Secret Manager secret in a short-lived, narrowly scoped job. Do not copy the key to a local file or command line.

The build command inside that trusted job is:

```sh
E2B_TEMPLATE=lesson-studio-renderer \
E2B_TEMPLATE_VERSION=<commit> \
npm run e2b:build-template
```

Then run the matching smoke:

```sh
E2B_TEMPLATE=lesson-studio-renderer \
E2B_TEMPLATE_VERSION=<commit> \
npm run smoke:e2b
```

The smoke must use the exact immutable tag, disable arbitrary internet access, execute `/opt/lesson-studio/app/.venv/bin/python -m manim --version`, import the Codex SDK, find FFmpeg, write/read the workspace, and terminate the sandbox in all outcomes.

Do not treat an existence check of `.venv/bin/manim` as sufficient. E2B image mounting can invalidate console-script shebangs; production renderers intentionally use `python -m manim`.

## Ordered deployment

After the E2B smoke passes, deploy the matching application image:

```sh
gcloud builds submit \
  --config cloudbuild.deploy.yaml \
  --project educationalvideo-506219 \
  --substitutions=COMMIT_SHA=<commit>,_REGION=us-central1,_REPOSITORY=lesson-studio,_ENVIRONMENT=staging \
  .
```

The pipeline updates and executes the migration job, updates the dispatcher, and then updates the API. Verify each service routes 100% to a ready revision using the exact image.

Update the ignored `infra/terraform/staging.auto.tfvars`:

```hcl
image                = "us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:<commit>"
e2b_template_version = "<commit>"
```

Plan and apply:

```sh
terraform -chdir=infra/terraform plan -out=staging.tfplan -input=false
terraform -chdir=infra/terraform show staging.tfplan
terraform -chdir=infra/terraform apply -input=false staging.tfplan
```

On this host the Google provider may require both `GOOGLE_PROJECT` and `GOOGLE_CLOUD_QUOTA_PROJECT` set to `educationalvideo-506219`. The tfvars and saved plan are ignored and must remain uncommitted.

## Post-deploy verification

Verify:

- `https://useorune.com/api/health` and `/api/health/ready` return success;
- HTTP redirects to HTTPS;
- the managed certificate remains active;
- the direct API `run.app` URL does not serve the application;
- API and dispatcher use the intended image and E2B tag;
- dispatcher remains private and accepts only the Cloud Tasks identity;
- no secrets are present in logs or uploaded source archives.

Run:

```sh
npm run check
npm test
npm run build
npm audit --audit-level=high
npm run test:e2e
E2B_TEMPLATE_VERSION=<commit> npm run smoke:e2b
APP_BASE_URL=https://useorune.com GCP_PROJECT=educationalvideo-506219 npm run smoke:staging
APP_BASE_URL=https://useorune.com GCP_PROJECT=educationalvideo-506219 STAGING_SMOKE_TIMEOUT_MS=1200000 npm run smoke:staging-payment
```

`smoke:staging-payment` is the release gate for hosted payment plus narration. It must prove hosted Checkout, signed webhook activation, Customer Portal, credit debit, narrated E2B generation, approved-provider metadata/audio, private MP4 download, cancellation, and account cleanup. The default voice exercises Speechify; release-specific checks should also exercise any newly enabled ElevenLabs voice after provider billing is active.

After a failed smoke, confirm that the subscription, test identity, project, job, and E2B sandbox were removed or terminated. Failure cleanup is implemented but must be verified.

## Rollback

- Application: route both API and dispatcher back to the prior known-good immutable image.
- E2B: restore the prior certified immutable template tag independently.
- Database: migrations are forward-only; deploy a compatibility fix or corrective migration. Do not restore the entire database merely to roll back code.
- Queue: pause dispatch before changing worker behavior; durable jobs remain in PostgreSQL.
- Secrets: add a replacement Secret Manager version, deploy and verify it, then disable the old version and audit access.
- Never destroy Cloud SQL, Terraform state, or the artifact bucket during rollback.

The prior `004c9c7` release is not a fully certified rollback for narrated generation because its Manim launcher failed in the paid narrated smoke. It remains evidence for payment, auth, secure failure handling, and the silent path.

## Logging and diagnostics

Log request/job/sandbox IDs, safe state changes, latency, provider status, token counts, and estimated cost. Do not log prompts, emails, cookies, provider response bodies, signed URLs, callback tokens, or secret values.

`generation_jobs.error_message` is public and generic. `error_detail` and server logs are operational only and must not appear in user APIs or exports.

## Capacity and cost

Staging is intentionally limited to two active sandboxes, three API instances, a zonal shared-core database, and a $20 GCP alert. The budget does not stop spend and excludes external providers. Production requires a separate state, regional non-shared-core Cloud SQL, provider quota confirmation, load testing, alert recipients, and a larger approved budget.
