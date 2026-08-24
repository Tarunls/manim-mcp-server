# Lesson Studio: GCP administrator and implementation-agent handoff

Updated: 2026-08-24

This document is intended to be sent as-is to the administrator of Google Cloud project `educationalvideo-506219` and to the administrator's coding/operations agent. It is the continuation brief for finishing Lesson Studio staging, adding the final domain, certifying the full hosted system, and preparing—but not prematurely launching—production.

## Operating mandate

Continue from the existing repository, branch, remote Terraform state, immutable application image, and immutable E2B template. Do not rebuild the system from scratch, destroy the partial staging resources, mutate the old singleton service, disclose secret values, or deploy production before staging passes every gate in this document.

The administrator is authorized to finish the **staging** deployment in GCP project `educationalvideo-506219`, using Stripe sandbox mode and the current $20 monthly GCP alerting budget. A normal Google Cloud budget is an alert, not a hard spend cap. The $20 GCP budget excludes OpenAI, E2B, Speechify, and Stripe. Keep the staging capacity limits in place.

Production is **not yet authorized under the $20 ceiling**. The repository intentionally blocks a production plan unless Cloud SQL is regional and non-shared-core and the managed external edge has a real domain. That production baseline will normally exceed a $20 monthly GCP budget. Do not weaken or bypass this safety check. Produce a reviewed production estimate and obtain explicit budget approval before applying a production state.

Never put secret plaintext in this document, Git, Terraform variables, plan output, chat messages, issue text, screenshots, or logs. Existing secrets must remain in Secret Manager. If a secret must be replaced, add a new enabled Secret Manager version through stdin or another non-logging mechanism and disable the superseded version after validation.

## Repository and release coordinates

- Repository: `https://github.com/Tarunls/manim-mcp-server`
- Working branch: `codex/manim-studio-mvp`
- Latest known implementation/documentation commit before this handoff: `c7b0af3`
- Application release currently selected for staging: `c50b97a`
- Immutable application image: `us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:c50b97a`
- Published image digest: `sha256:eba6e1562c7f856a62e9961a8c10ed476a23fcf3bbadab343e79e064c141a54f`
- Immutable E2B template: `lesson-studio-renderer:c50b97a`
- E2B build ID recorded during release: `401c6286-6e29-420a-873d-1167b5546d81`
- GCP project: `educationalvideo-506219`
- GCP project number: `359351998003`
- Region: `us-central1`
- Billing account linked to the project: `0181BB-902BC6-5D4673`
- Terraform backend bucket: `gs://educationalvideo-506219-lesson-studio-tfstate`
- Terraform backend prefix: `staging`
- Current staging state is remote and authoritative. Never replace it with a new local state.

Start by checking out and fast-forwarding the exact branch:

```sh
git clone https://github.com/Tarunls/manim-mcp-server.git
cd manim-mcp-server
git switch codex/manim-studio-mvp
git pull --ff-only origin codex/manim-studio-mvp
git status --short
```

Read these files before changing or applying anything:

- `docs/IMPLEMENTATION_STATUS.md`
- `docs/PRODUCTION_ARCHITECTURE.md`
- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/PRODUCTION_CHECKLIST.md`
- `docs/COST_MODEL.md`
- `infra/terraform/README.md`
- `infra/terraform/versions.tf`
- `infra/terraform/terraform.tfvars.example`

Respect any `AGENTS.md` files found in the repository. Preserve unrelated user changes. Use incremental, reviewed commits and push them to `codex/manim-studio-mvp` unless the repository owner requests a different branch.

## What is already implemented

The current branch contains:

- Firebase/Identity Platform email-password authentication with verified-email gating, Firebase Admin session cookies, revocation checks, safe password reset behavior, protected routing, and database synchronization.
- PostgreSQL ownership isolation for users, projects, generation jobs, artifacts, reviews, billing, credits, audit data, and provider usage.
- Double-submit CSRF protection, exact-origin checks, secure browser headers, endpoint rate limits, and host-only secure cookies.
- Authenticated data export and account deletion, including Stripe subscription cancellation, private object deletion, database deletion, and Identity Platform deletion.
- Stripe sandbox Checkout, Customer Portal, signed webhooks, webhook replay idempotency, subscription lifecycle handling, and immutable monthly credit accounting.
- Four plans: Free, Creator `$20`, Pro `$50`, and Studio `$100`.
- Workload credits: Faster costs 1, Balanced costs 2, and Try harder costs 4.
- Allowances: Free 1, Creator 10, Pro 30, and Studio 70 credits per billing period.
- A transactional outbox, Cloud Tasks delivery, per-plan active-job controls, and a global E2B concurrency gate.
- One disposable E2B sandbox per generation. The sandbox receives a job-scoped proxy token instead of the upstream OpenAI key.
- Direct sandbox access to OpenAI and arbitrary internet destinations is denied. Private artifacts use signed GCS transfers and ownership-checked signed reads.
- OpenAI model enforcement: Faster and Balanced use `gpt-5.6-terra`; Try harder uses `gpt-5.6-sol`.
- Deployed limits of 12 OpenAI calls per job, 12,000 output tokens per response, 30-minute sandbox lifetime, two concurrent staging E2B sandboxes, and three staging API instances.
- Provider token and estimated-cost telemetry without storing provider response bodies.
- Private, versioned GCS artifacts with public access prevention and lifecycle rules.
- Separate API, dispatcher, Cloud Tasks invoker, and release service accounts with split secret access.
- A domainless staging mode and a domain-enabled external HTTPS load balancer, Google-managed certificate, HTTP-to-HTTPS redirect, modern TLS policy, and Cloud Armor rate bans.
- Privacy and terms pages. They remain launch drafts until the legal entity, jurisdiction, support contact, retention commitments, and applicable tax/privacy obligations are reviewed by qualified owners.

## Verification already completed

The release candidate completed these checks before the partial GCP apply:

- TypeScript/Vite production build passed.
- Unit and integration suite passed: 23 tests.
- Playwright UI suite passed: 9 tests; 1 viewport-duplicate middleware check was intentionally skipped.
- Dependency audit reported no high or critical vulnerabilities.
- PostgreSQL migrations, generation idempotency, credit reservation/refund, signed Stripe webhook replay, billing lifecycle, identity normalization/revocation behavior, and project isolation were tested.
- Stripe sandbox hosted Checkout creation passed without granting entitlement before a webhook.
- Identity Platform sign-up, verification gating, sign-in, session creation/verification, and temporary-user cleanup passed.
- A real E2B smoke passed for `lesson-studio-renderer:c50b97a`, including Node 22, Manim, FFmpeg, Codex SDK resolution, non-root workspace access, outbound-network denial, and sandbox teardown.

These checks do **not** certify the still-undeployed callback-to-artifact path. Full hosted certification remains mandatory after Cloud SQL and the new Cloud Run services exist.

## Existing GCP environment and partial Terraform state

There is an older public Cloud Run service named `lesson-studio` at `https://lesson-studio-zzefkvyk5a-uc.a.run.app`. It is a legacy singleton with max scale 1 and GCS-FUSE state. Do not modify it, deploy the new image to it, run the legacy setup scripts against it, or use it as proof that the new architecture works. The new services are named:

- `lesson-studio-staging-api`
- `lesson-studio-staging-dispatcher`
- `lesson-studio-staging-migrate`

The first authorized Terraform apply created or tracked the following staging resources:

- Required Google APIs, including Cloud SQL, Cloud Tasks, Compute, Service Networking, Cloud Run, Secret Manager, Monitoring, and Billing Budgets.
- VPC `lesson-studio-staging`.
- Subnet `lesson-studio-staging-serverless`.
- Private service address `lesson-studio-staging-private-services`.
- Cloud Tasks queue `lesson-studio-staging-generation`, currently limited to two concurrent dispatches.
- Private artifact bucket `educationalvideo-506219-lesson-studio-staging-artifacts`.
- Service accounts `ls-staging-api`, `ls-staging-dispatch`, `ls-staging-tasks`, and `ls-staging-release`.
- Generated Secret Manager containers/versions for the audit hash and callback credential, and the generated database secret container.
- Runtime artifact-bucket grants.

The apply stopped safely before private service peering, Cloud SQL, the generated database URL version, Cloud Run API/dispatcher/migration resources, runtime IAM grants, monitoring policies, and the billing budget. The main recurring Cloud SQL staging cost therefore had not started at the time of this handoff.

The last refreshed plan, after fixing the billing-account identifier, was:

```text
Plan: 43 to add, 0 to change, 0 to destroy.
```

Do not assume that number is still current. Refresh state and create a new saved plan. Do not reuse any old `staging.tfplan` file.

## Required administrator permissions

The previous active deployer was `abhinav.malkoochi@gmail.com`, with Project Editor and Service Account User only. The apply failed on project IAM policy updates, service-account IAM policy updates, Secret Manager IAM policy updates, and private service networking. Budget creation also requires permissions on the linked billing account.

Preferred option: perform the remaining apply while authenticated as an existing project and billing administrator. Alternative: grant the deployer temporary authority, complete and validate the apply, then remove the broad temporary role and retain only explicitly required operational access.

The simple temporary grants are:

```sh
gcloud projects add-iam-policy-binding educationalvideo-506219 \
  --member=user:abhinav.malkoochi@gmail.com \
  --role=roles/owner

gcloud billing accounts add-iam-policy-binding 0181BB-902BC6-5D4673 \
  --member=user:abhinav.malkoochi@gmail.com \
  --role=roles/billing.costsManager
```

These commands must be run by identities already permitted to update the corresponding policies. If organization policy forbids temporary Owner, build an equivalent least-privilege deployment role that can:

- Read the project and enabled services.
- Create and administer the Terraform-managed resources.
- Update project IAM member bindings.
- Update IAM policies on the four Terraform service accounts.
- Update IAM policies on the named Secret Manager secrets.
- Create the Service Networking peering connection.
- Create project-scoped billing budgets on the linked billing account.
- Act as the runtime and release service accounts where required.

Do not work around IAM failures by making the runtime services use an existing broad service account.

After deployment, remove temporary Owner access. The release identity should keep only its Terraform-defined Artifact Registry writer, Cloud Run administrator, logging writer, and `actAs` grants on the two runtime identities. The human or CI trigger invoking Cloud Build also needs `iam.serviceAccounts.actAs` on `ls-staging-release`.

## Secret inventory and validation

Terraform expects these existing Secret Manager IDs:

| Secret ID | Consumer | Staging requirement |
| --- | --- | --- |
| `identity_platform_api_key` | API | Identity Platform web API key |
| `openai_api_key` | API only | Current upstream OpenAI API key |
| `e2b_api_key` | Dispatcher only | Current E2B API key |
| `speechify_key` | API only | Speechify key for narration |
| `stripe_sandbox_api_key` | API only | Stripe sandbox/test secret key |
| `stripe_webhook_secret` | API only | Signing secret for the active staging webhook endpoint |
| `staff_emails` | API only | Comma-separated approved staff emails |

Validate existence and enabled versions without reading or printing payloads:

```sh
for SECRET_ID in \
  identity_platform_api_key openai_api_key e2b_api_key speechify_key \
  stripe_sandbox_api_key stripe_webhook_secret staff_emails
do
  gcloud secrets describe "$SECRET_ID" \
    --project educationalvideo-506219 \
    --format='value(name)'
  gcloud secrets versions list "$SECRET_ID" \
    --project educationalvideo-506219 \
    --filter='state=ENABLED' \
    --format='value(name)' \
    --limit=1
done
```

Do not place the E2B or provider keys directly in the sandbox, browser, Terraform variables, Cloud Build substitutions, or source code. The Terraform IAM split is intentional: the API must not read the E2B key, and the dispatcher must not read OpenAI, Stripe, Identity Platform, Speechify, or staff secrets.

## Safely resume domainless staging

Install Terraform `>= 1.7` if it is not already available. Use the official HashiCorp release and verify its checksum. Authenticate, select the project, and verify the linked billing account before planning:

```sh
gcloud auth list
gcloud config set project educationalvideo-506219
gcloud billing projects describe educationalvideo-506219
gcloud projects get-iam-policy educationalvideo-506219 \
  --flatten='bindings[].members' \
  --filter='bindings.members:user:YOUR_DEPLOYER_EMAIL' \
  --format='table(bindings.role)'
```

Use an ignored `infra/terraform/staging.auto.tfvars` with these values. Do not commit it:

```hcl
project_id           = "educationalvideo-506219"
region               = "us-central1"
environment          = "staging"
image                = "us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:c50b97a"
app_base_url         = ""
app_domain           = ""
enable_external_edge = false
e2b_template_version = "c50b97a"

max_concurrent_sandboxes = 2
api_max_instances         = 3
sql_tier                  = "db-f1-micro"
sql_availability_type     = "ZONAL"
sql_disk_size_gb          = 10
billing_account_id        = "0181BB-902BC6-5D4673"
monthly_budget_usd        = 20

secret_ids = {
  identity_api_key  = "identity_platform_api_key"
  openai_api_key    = "openai_api_key"
  e2b_api_key       = "e2b_api_key"
  speechify_api_key = "speechify_key"
  stripe_api_key    = "stripe_sandbox_api_key"
  stripe_webhook    = "stripe_webhook_secret"
  staff_emails      = "staff_emails"
}

notification_channel_ids = []
```

Initialize only against the existing staging state and inspect the plan carefully:

```sh
terraform -chdir=infra/terraform init -reconfigure
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform state list
terraform -chdir=infra/terraform plan \
  -lock-timeout=60s \
  -out=staging-current.tfplan
terraform -chdir=infra/terraform show staging-current.tfplan
```

Expected outcome: additions that complete the staging stack and no destructive action. Stop and investigate any replacement, deletion, modification of the legacy `lesson-studio` service, different backend/prefix, unexpected region, production resource, public database address, or plaintext secret. Apply only the reviewed saved plan:

```sh
terraform -chdir=infra/terraform apply staging-current.tfplan
terraform -chdir=infra/terraform output
```

If the apply is interrupted or fails, preserve the resources and state. Correct the specific issue, refresh, make a new plan, and resume. Do not run `terraform destroy`, remove resources from state, force-unlock an active lock, or manually recreate Terraform-managed resources without first proving that is necessary.

After a successful apply, verify:

```sh
gcloud sql instances describe lesson-studio-staging-postgres \
  --project educationalvideo-506219

gcloud run services describe lesson-studio-staging-api \
  --project educationalvideo-506219 \
  --region us-central1

gcloud run services describe lesson-studio-staging-dispatcher \
  --project educationalvideo-506219 \
  --region us-central1

gcloud tasks queues describe lesson-studio-staging-generation \
  --project educationalvideo-506219 \
  --location us-central1
```

Confirm Cloud SQL uses private IP only, tier `db-f1-micro`, zonal availability, 10 GB storage, backups, PITR, and deletion protection. Confirm API max instances is 3, dispatcher/task concurrency is 2, both runtime services scale to zero, and the dispatcher has internal-only ingress.

Run the forward-only migration job before functional traffic:

```sh
gcloud run jobs execute lesson-studio-staging-migrate \
  --project educationalvideo-506219 \
  --region us-central1 \
  --wait
```

Inspect the execution status and logs without printing environment variables. Then verify:

```sh
STAGING_API_URL=$(terraform -chdir=infra/terraform output -raw api_url)
curl --fail --silent --show-error "$STAGING_API_URL/api/health"
curl --fail --silent --show-error "$STAGING_API_URL/api/health/ready"
```

Do not treat a successful health endpoint as full certification.

## Stripe sandbox completion

Staging must stay in Stripe test/sandbox mode:

- Terraform sets `BILLING_MODE_REQUIRED=test`.
- Terraform sets `ALLOW_TEST_CHECKOUT=true` only for staging.
- The `stripe_sandbox_api_key` secret must be a test/sandbox key.
- Never place a live Stripe key in the staging secret.

The sandbox account should have one active monthly USD price for each lookup key:

| Lookup key | Monthly amount |
| --- | ---: |
| `lesson_studio_creator_monthly` | `$20.00` |
| `lesson_studio_pro_monthly` | `$50.00` |
| `lesson_studio_studio_monthly` | `$100.00` |

The prices were already created in the isolated Stripe CLI profile named `lesson-studio`. Verify them against the same Stripe account referenced by `stripe_sandbox_api_key`. If they are absent or incorrect, securely authenticate the Stripe CLI to that sandbox and run:

```sh
STRIPE_CLI_PROJECT=lesson-studio npm run stripe:setup
```

Do not create duplicate active lookup keys or run setup against a live account.

The staging webhook endpoint must target the final staging origin plus `/api/stripe/webhook` and subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

For initial domainless testing, the origin is the Terraform `effective_app_base_url` output. After the custom domain is active, create a new endpoint for the custom HTTPS origin, store its signing secret as a new enabled `stripe_webhook_secret` version, roll a new API revision so it resolves `latest`, validate it, and disable the obsolete run.app endpoint.

`npm run stripe:cloud-webhook` defaults to the legacy service name `lesson-studio`. Do not run it with defaults. If used, explicitly set all of `GCP_PROJECT`, `APP_BASE_URL`, `GCP_REGION`, `GCP_SERVICE=lesson-studio-staging-api`, and `GCP_RUNTIME_SERVICE_ACCOUNT=ls-staging-api@educationalvideo-506219.iam.gserviceaccount.com`, inspect the script first, and ensure it is authenticated to the intended Stripe sandbox. A safer alternative is to configure the endpoint in the Stripe sandbox dashboard and add the returned signing secret directly to Secret Manager without exposing it to logs.

Stripe acceptance tests must prove:

1. Creator, Pro, and Studio buttons create hosted Checkout sessions with the correct recurring amount.
2. Creating or opening Checkout does not grant credits.
3. A valid signed completed-checkout/subscription webhook grants exactly one entitlement.
4. Replaying the identical webhook does not duplicate credits or ledger entries.
5. Billing Portal opens only for the authenticated customer's own Stripe customer.
6. Upgrade, downgrade, renewal, failed invoice, cancellation, and deletion events produce the documented database state.
7. Account deletion cancels the subscription before removing the user.
8. Invalid signatures return `400` and do not mutate billing state.

Use only Stripe's documented test payment methods. Do not make a real charge during staging certification.

## Identity Platform and authentication completion

Before browser testing, verify email/password sign-in is enabled and add the current staging hostname to Identity Platform authorized domains. For domainless staging, add the canonical Cloud Run hostname. For domain-enabled staging, add the exact custom hostname before testing that origin.

Do not run `npm run identity:setup` blindly. That legacy helper preserves old domains, adds `localhost`, creates staff users, and defaults to updating the old `lesson-studio` service. For the Terraform deployment, configure Identity Platform directly or update the script to accept an explicit staging mode and service name, with tests.

Configure and review Identity Platform email verification and password-reset templates, sender identity, localization, and action links. Never assume the default email is suitable for public launch. Production authorized domains should contain only intended staging/production domains; remove obsolete preview and localhost entries when operational access no longer needs them.

Authentication acceptance tests must cover:

1. New account creation sends verification email.
2. Unverified users cannot establish an application session.
3. A verified user can sign in and receives a `Secure`, `httpOnly`, host-only, `SameSite=Lax` cookie.
4. Logout clears the cookie and revocation checks reject revoked sessions.
5. Password-reset responses do not reveal whether an email exists.
6. Cross-origin and missing-CSRF mutations fail closed.
7. Protected application routes redirect or return `401` when signed out.
8. Cross-user project, job, artifact, billing, and review identifiers return `404`/`401` without leaking existence.
9. Data export contains only the authenticated user's data.
10. Account deletion removes the user's private objects, database records, and Identity Platform identity and cancels billing.

## Full E2B generation certification

The release smoke proves the image can start; it does not prove the hosted workflow. Use a verified staging staff account so certification does not exhaust a normal customer allowance. Run at least one Faster silent generation and one Balanced narrated generation through the website.

For each job verify this complete sequence:

1. Submission returns quickly and commits a durable PostgreSQL job, credit reservation, and outbox record atomically.
2. The outbox publishes one named Cloud Task; duplicate submission does not create a second job or charge.
3. The private dispatcher accepts only the Cloud Tasks OIDC identity.
4. Exactly one sandbox starts from `lesson-studio-renderer:c50b97a`.
5. The sandbox cannot access arbitrary internet hosts or `api.openai.com` directly.
6. The sandbox `.env` is mode `0600`, contains only the job-scoped proxy configuration, is excluded from archives, and is removed at completion.
7. The API overwrites model selection and enforces the 12-call and 12,000-output-token ceilings.
8. Narration calls Speechify through the scoped callback and never exposes the Speechify key to generated code.
9. Video/source uploads use only job-scoped signed GCS URLs and cannot write another user's prefix.
10. The completion callback is accepted only for the active matching job.
11. GCS validates content type, size, generation, and checksum before completion.
12. The website receives progress and completion cleanly and can play/download the final video through a short-lived owner-authorized signed URL.
13. The sandbox terminates after success, cancellation, timeout, or dispatch failure.
14. Failure/cancellation refunds credits exactly once.
15. Provider-call telemetry records model, status, tokens, and estimated cost but not response bodies, prompts in logs, keys, cookies, or signed URLs.

Also exercise queue retry, E2B quota exhaustion, OpenAI rate limiting, sandbox timeout, invalid callback token, expired signed URL, malformed artifact path, cancellation during generation, and duplicate callback delivery. Verify there are no orphan running sandboxes afterward.

Do not increase `max_concurrent_sandboxes` beyond 2 in this staging budget profile. Do not claim thousands of simultaneous renders. The architecture can durably queue many submissions, but active rendering capacity is bounded by E2B and OpenAI quotas and must be load-tested and contractually available.

## Add the staging domain and managed edge

Obtain the exact hostname from the project owner. Prefer a dedicated hostname such as `staging.example.com`; do not invent or purchase a domain without explicit authorization. Confirm who controls authoritative DNS and whether CAA records permit Google-managed certificates.

Once the hostname is approved, update only the staging tfvars:

```hcl
app_domain           = "staging.example.com"
app_base_url         = "https://staging.example.com"
enable_external_edge = true
```

The URL must have no trailing slash, and `app_base_url` must exactly equal `https://` plus `app_domain`. Run a new Terraform plan. The expected changes add the external managed load balancer, global IP, serverless NEG, Cloud Armor policy, TLS policy, redirect, and managed certificate, and change API ingress so the direct run.app URL cannot bypass the edge.

Apply the reviewed plan, then obtain the reserved IP:

```sh
terraform -chdir=infra/terraform output -raw load_balancer_ip
```

Create an authoritative DNS `A` record for the approved hostname pointing to that IP, initially with a short TTL such as 300 seconds. Do not proxy it through another CDN while provisioning the Google-managed certificate. If the zone has restrictive CAA records, explicitly permit the CA required by Google-managed certificates.

Wait for DNS propagation and certificate activation:

```sh
dig +short staging.example.com A
gcloud compute ssl-certificates describe lesson-studio-staging-certificate \
  --global \
  --project educationalvideo-506219
```

Then prove all of the following:

- `https://staging.example.com/api/health` and `/api/health/ready` succeed with the expected certificate and hostname.
- `http://staging.example.com/...` redirects to the equivalent HTTPS URL.
- TLS 1.0/1.1 are not accepted.
- The direct `run.app` URL cannot serve the application around Cloud Armor.
- Auth cookies are host-only for the custom domain.
- CSRF origin checks accept the exact custom HTTPS origin and reject others.
- Long-running/SSE generation progress works through the load balancer.
- Cloud Armor limits abusive auth/generation mutations while normal use remains functional.

Afterward, update Identity Platform authorized domains and replace the Stripe staging webhook with the custom-domain endpoint as described above. Re-run all auth, billing, and E2B tests from the custom origin.

## Monitoring, costs, and operations

The Terraform budget must be project-scoped at `$20` with actual-spend thresholds at 50%, 80%, and 100%, plus forecasted 100%. Verify billing recipients receive a test/real notification path. A budget does not stop resources automatically.

Create or supply real Monitoring notification channel IDs and apply them through `notification_channel_ids`. The checked-in default is empty, so alert policies otherwise have no human recipient. Test delivery for:

- Elevated API 5xx rate.
- Generation failure bursts.
- Cloud SQL CPU saturation.
- Budget thresholds and forecast.

Create dashboards or saved views for API request count/latency/error rate, Cloud Run instances, Cloud SQL CPU/connections/storage, outbox age, Cloud Tasks queue age/retries, active E2B jobs, job duration/failure codes, provider error rate, token usage, and estimated provider cost. Establish a named on-call/support owner before public traffic.

Keep these staging controls unchanged unless the owner explicitly raises the budget:

- Zonal `db-f1-micro`, 10 GB.
- API scale 0–3.
- Dispatcher/task/E2B concurrency 2.
- Database pool max 5 per process.
- 30-minute sandbox timeout.
- 12 OpenAI calls per job.
- 12,000 output tokens per response.

Review actual provider telemetry and invoices after representative jobs. The plan pricing is a starting margin model, not guaranteed profit. Do not market unlimited generation. Add provider-side usage limits/alerts for OpenAI, E2B, and Speechify because they are outside GCP billing.

## Test and release commands

Before deploying any code change, use Node 22 and run:

```sh
npm ci
npm run check
npm test
npm run build
npm audit --audit-level=high
npm run test:e2e
```

Provider smoke commands are:

```sh
npm run smoke:identity
npm run smoke:stripe
E2B_TEMPLATE=lesson-studio-renderer \
E2B_TEMPLATE_VERSION=c50b97a \
npm run smoke:e2b
```

Inject their required credentials securely for the process and unset them immediately afterward. Do not write a populated `.env` into Git or print it. `smoke:identity` creates and removes a temporary Identity user. `smoke:stripe` creates a temporary database user and hosted Checkout session but expects a reachable PostgreSQL database. `smoke:e2b` always attempts to terminate its disposable sandbox.

If application code changes after `c50b97a`, publish a new commit-SHA image and update Terraform to that immutable tag. Never deploy only `latest`. If `e2b/`, renderer dependencies, the Codex bootstrap, or the template build changes, publish and smoke a matching immutable E2B template before updating Terraform. Keep the app and template release identifiers aligned when practical.

Run the migration before updating both runtime services. `cloudbuild.deploy.yaml` performs migration, dispatcher update, then API update using `ls-staging-release`. Confirm the build invoker can act as that service account and that untrusted pull requests cannot invoke the privileged deployment identity.

## Rollback and incident behavior

- Application rollback: route both API and dispatcher to the last known-good immutable image; never use `latest` as the rollback target.
- E2B rollback: restore the last certified immutable E2B template independently.
- Database rollback: migrations are forward-only. Deploy a compatibility fix or corrective migration; do not restore the database merely to roll back code.
- Queue incident: pause the generation queue before changing dispatcher behavior. Durable jobs stay in PostgreSQL.
- Provider incident: preserve queued jobs and use bounded retry/backoff; do not leak raw provider errors to users.
- Secret incident: add a replacement Secret Manager version, deploy a revision, verify, disable the compromised version, audit access, and rotate affected job/session credentials.
- Never destroy Cloud SQL or the artifact bucket during rollback. Both have important deletion/retention protections.

Before launch, perform a real Cloud SQL restore drill into a separate recovery target and document recovery time and recovery point results. Verify artifact version recovery and rehearse reverting the API and E2B template.

## Production preparation after staging passes

Production must use a separate Terraform state. The checked-in backend currently defaults to prefix `staging`; never set `environment="production"` while initialized against that state. Create a distinct protected production prefix or bucket and explicitly initialize it, for example with a reviewed backend configuration. Confirm `terraform state list` is empty or contains only the intended production resources before the first production plan.

Production requires, at minimum:

- `environment = "production"`.
- A separately approved production hostname and exact HTTPS origin.
- `enable_external_edge = true`.
- Regional Cloud SQL.
- A non-shared-core Cloud SQL tier sized by staging load results.
- A separate live restricted Stripe key secret and separate live webhook signing secret.
- `ALLOW_TEST_CHECKOUT=false` and `BILLING_MODE_REQUIRED=live`—already selected by Terraform production mode.
- Separate, reviewed monitoring and billing thresholds.
- Confirmed E2B concurrency and OpenAI throughput quotas.
- A load test at the intended authenticated submission/SSE rate.
- Restore, rollback, abuse, security, privacy/legal, tax, support, and on-call sign-off.
- Protected CI/release branches and a reviewed deployment identity.

Do not copy the Stripe sandbox key or sandbox webhook into production. Do not turn on Stripe Tax until the business owner has established registrations and tax policy. Confirm refund, cancellation, dispute, support, and account-deletion processes. Replace draft legal text with reviewed company name, address/jurisdiction, effective date, support/privacy contact, retention policy, subprocessors, and applicable consumer/privacy disclosures.

The phrase “supports thousands of users” may be used only after distinguishing durable queued submissions from simultaneous renders. Certify API/database/SSE submission load separately from active E2B render capacity. Active generation concurrency must not exceed purchased E2B capacity or verified OpenAI/Speechify throughput.

## Definition of done for this handoff

Do not report the project complete merely because Terraform applied. Completion requires an evidence-backed report containing:

### Staging infrastructure

- Fresh Terraform plan and apply summaries with no unexpected deletion/replacement.
- API, dispatcher, migration job, Cloud SQL, Cloud Tasks, artifact bucket, monitoring, and `$20` budget status.
- Confirmation that Cloud SQL is private-only and dispatcher is internal-only.
- Confirmation that the legacy `lesson-studio` service was not mutated.

### Domain and edge

- Final staging hostname, DNS record, load-balancer IP, certificate `ACTIVE` status, HTTPS redirect result, direct run.app bypass result, and Cloud Armor validation.

### Authentication and privacy

- Verified sign-up/email verification/sign-in/logout/reset results.
- Cookie, revocation, CSRF, exact-origin, and cross-user isolation results.
- Data export and deletion results.
- Identity authorized-domain and email-template configuration.

### Billing

- Sandbox account/mode confirmation without keys.
- Three price lookup keys and amounts.
- Custom-domain webhook endpoint and subscribed event list without signing secret.
- Checkout, signed webhook, replay, renewal/failure/cancellation, Portal, and account-deletion test results.

### Generation

- One complete silent and one narrated video from browser request through queue, E2B, OpenAI proxy, render, GCS validation, callback, playback, and download.
- Cancellation/failure refund and sandbox teardown evidence.
- Secret/egress boundary, concurrency, token/call ceiling, artifact ownership, and telemetry evidence.

### Operational readiness

- Test/build/audit results.
- Monitoring notification test and dashboard links/identifiers.
- Current estimated monthly GCP fixed cost and measured external provider cost per representative generation.
- Remaining production blockers, explicit production budget estimate, and named owner for each blocker.
- Rollback and restore drill results before any production launch.

If any step is blocked by missing domain ownership, billing authority, legal/business decisions, provider quota, or secret ownership, stop that portion safely, leave existing state intact, and request the exact missing input. Do not invent business, legal, DNS, billing, or security values.
