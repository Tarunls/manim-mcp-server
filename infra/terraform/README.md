# GCP infrastructure

This Terraform stack defines staging or production infrastructure; it does not run automatically from application CI.

Prerequisites:

1. Create the E2B API key Secret Manager secret named by `secret_ids.e2b_api_key`.
2. Use a live Stripe restricted key and a production webhook secret for the production workspace. Never point production at `stripe_test_api_key`.
3. Build and test an immutable application image and an immutable E2B template tag.
4. Create the remote, versioned Terraform state bucket named in `versions.tf`. State contains generated database and callback credentials and must not be public.
5. Copy `terraform.tfvars.example` to an untracked environment-specific tfvars file.
6. Domainless staging can leave `app_base_url` and `app_domain` empty and `enable_external_edge=false`; it uses the canonical `run.app` origin. After a domain is available, set the exact HTTPS origin, enable the edge, apply, create the DNS A record from `load_balancer_ip`, and wait for the managed certificate.

The checked-in staging example is deliberately budget constrained: `db-f1-micro`, zonal availability, 10 GB storage, two concurrent E2B workers, three API instances, scale-to-zero Cloud Run, and no global load balancer before DNS exists. The shared-core database has no SLA and is not accepted by the Terraform production safety check.

The project-scoped $20 budget sends threshold and forecast alerts to billing recipients. It is not a hard cap. OpenAI, E2B, Speechify, and Stripe charges are outside the GCP billing account and need separate provider controls.

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

Applying creates billable Cloud SQL, Cloud Run, GCS, networking, Cloud Tasks, and monitoring resources. Production has deletion protection. Run the migration job before sending traffic to a new image.

`cloudbuild.yaml` and `cloudbuild.deploy.yaml` select the environment's `release_service_account` explicitly and write logs only to Cloud Logging. It can publish images and update Cloud Run, but has no direct Secret Manager accessor grant. Treat it as a privileged deployment identity because it can deploy code under the runtime identities. The human or trigger that starts a build must have `iam.serviceAccounts.actAs` on this release identity.
