# GCP infrastructure

This Terraform stack defines staging or production infrastructure; it does not run automatically from application CI.

Prerequisites:

1. Create the E2B API key Secret Manager secret named by `secret_ids.e2b_api_key`.
2. Use a live Stripe restricted key and a production webhook secret for the production workspace. Never point production at `stripe_test_api_key`.
3. Build and test an immutable application image and an immutable E2B template tag.
4. Create a remote, versioned Terraform state bucket and configure a `backend "gcs"` block locally or in the deployment pipeline.
5. Copy `terraform.tfvars.example` to an untracked environment-specific tfvars file.
6. After the first apply, point the `app_domain` DNS A record at `load_balancer_ip` and wait for the managed certificate to become active.

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
