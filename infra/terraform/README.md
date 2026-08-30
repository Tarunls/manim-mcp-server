# GCP infrastructure

Updated: 2026-08-30

This Terraform stack defines staging or production infrastructure; it does not run automatically from application CI.

Prerequisites:

1. Create the E2B API key Secret Manager secret named by `secret_ids.e2b_api_key`.
2. Use a live Stripe restricted key and a production webhook secret for live billing. Never point live billing at a test or sandbox secret.
3. Build and test an immutable application image and an immutable E2B template tag.
4. Create the remote, versioned Terraform state bucket named in `versions.tf`. State contains generated database and callback credentials and must not be public.
5. Copy `terraform.tfvars.example` to an untracked environment-specific tfvars file.
6. A new domainless staging environment can leave `app_base_url` and `app_domain` empty and `enable_external_edge=false`. The existing staging environment is already domain-enabled at `https://useorune.com`, with edge IP `136.68.115.171` and an active managed certificate. Do not revert it to the `run.app` origin.

The checked-in staging example is deliberately budget constrained: `db-f1-micro`, zonal availability, 10 GB storage, two concurrent E2B workers, three API instances, scale-to-zero Cloud Run, and no global load balancer before DNS exists. The shared-core database has no SLA and is not accepted by the Terraform production safety check.

`billing_mode` is independent from the resource-name environment so an existing, domain-enabled beta stack can be promoted without replacing its database, load balancer, or user records. `auto` keeps the normal behavior (`staging` uses Stripe test mode and `production` uses live mode). A deliberate live promotion must set `billing_mode = "live"`, point `secret_ids.stripe_api_key` and `secret_ids.stripe_webhook` at live Secret Manager entries, and keep the exact public HTTPS edge enabled. Terraform refuses an unsafe live combination, and live mode always disables test Checkout.

The project-scoped $20 budget sends threshold and forecast alerts to billing recipients. It is not a hard cap. OpenAI, E2B, Speechify, and Stripe charges are outside the GCP billing account and need separate provider controls.

The existing `useorune.com` stack is deployed with application/E2B tag `ad08eb1` and live billing. Its resource names retain the `staging` suffix because it was promoted in place to preserve the domain edge, database, and user records; `billing_mode = "live"` is the production payment boundary. Read `docs/GCP_ADMIN_LLM_HANDOFF.md` before changing tfvars or applying.

The identity applying this stack must be able to update project, service-account, and Secret Manager IAM policies and create private service networking connections. It must also have `roles/billing.costsManager` on `billing_account_id` to create the budget. An interrupted apply is resumable from the protected GCS backend; review a new plan and do not destroy already-tracked resources.

Review before applying:

```sh
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=plan.tfplan
terraform show plan.tfplan
terraform apply plan.tfplan
```

Applying creates billable Cloud SQL, Cloud Run, GCS, networking, Cloud Tasks, Cloud Scheduler, and monitoring resources. Production has deletion protection. Run the migration job before sending traffic to a new image. The scheduler invokes the private dispatcher every five minutes to reconcile expired generation leases and terminate leaked E2B sandboxes.

`E2B_TEMPLATE_VERSION` is intentionally supplied to both the API and dispatcher: the API persists the immutable version on submission and the dispatcher starts exactly that version. A missing tag or `dev` value fails production startup. The E2B API key must belong to the same E2B team that owns the configured template.

The ignored staging tfvars and saved `*.tfplan` files may contain environment-specific infrastructure values and must never be committed. The application image is also managed by the ordered Cloud Build deploy pipeline; after a release, use Terraform to reconcile the immutable E2B tag and all declared environment settings, then require a no-drift plan.

`cloudbuild.yaml` and `cloudbuild.deploy.yaml` select the environment's `release_service_account` explicitly and write logs only to Cloud Logging. It can publish images and update Cloud Run, but has no direct Secret Manager accessor grant. Treat it as a privileged deployment identity because it can deploy code under the runtime identities. The human or trigger that starts a build must have `iam.serviceAccounts.actAs` on this release identity.
