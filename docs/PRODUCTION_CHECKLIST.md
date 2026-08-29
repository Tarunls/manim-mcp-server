# Production launch checklist

## Security

- Identity Platform authorized domains contain only staging and production domains.
- Session cookies are `Secure`, host-only, `httpOnly`, and revocation-tested.
- Cross-user project, job, artifact, review, and billing requests return `404` or `401` without leaking existence.
- Cloud Run dispatcher rejects public callers and accepts only the Cloud Tasks OIDC service account.
- The API `run.app` URL cannot bypass the HTTPS load balancer or Cloud Armor, and HTTP redirects to the canonical HTTPS origin. Satisfied for staging on 2026-08-28: the external edge and `useorune.com` certificate are live, the canonical origin is `https://useorune.com`, and API ingress is internal-and-cloud-load-balancing.
- E2B egress tests prove arbitrary hosts and direct OpenAI access are blocked; `.env` contains only a job-scoped proxy token, is mode `0600`, excluded from archives, and deleted.
- A completed/cancelled job and another job's proxy token cannot call the OpenAI proxy; the per-job budget remains enforced under concurrency. The estimated-cost ceiling (`CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB`) is the primary enforced budget, the call count (`CODEX_MAX_API_CALLS_PER_JOB`) is a backstop, and exhaustion returns a terminal `400`.
- GCS public access prevention and uniform bucket-level access are enabled.
- Secret Manager access logs show the API/dispatcher split described in the runbook.
- Dependency audit reports no high or critical vulnerabilities; SAST and container scanning pass.
- Only protected, reviewed release branches can invoke the privileged build/deploy identity; untrusted pull requests cannot run with it.
- Every deployed image tag corresponds to a pushed commit in this repository. Currently unmet: the staging image/template tag `004c9c7` is not a commit here; rebuild from a pushed commit before certification.

## Reliability

- Cloud SQL regional HA, PITR, automated backups, deletion protection, and a restore drill are verified.
- Duplicate browser requests, Stripe webhooks, Cloud Tasks deliveries, and sandbox callbacks do not double-charge or create duplicate versions.
- Queue pause/resume, E2B quota exhaustion, OpenAI throttling, sandbox timeout, callback timeout, and invalid artifact paths are exercised.
- Failed or cancelled generations refund credits exactly once.
- A failure at every pre-sandbox dispatch step leaves no job in `dispatching`; retryable failures release the lease and terminal failures store only a generic user message.
- The scheduled reconciler is invoked with its OIDC identity, expires stale dispatch/running/upload leases, drains durable sandbox-cleanup outbox entries after complete/fail/cancel, and remains idempotent on replay and account deletion.
- MP4, PNG, gzip, and metadata validation reject content-type spoofing, malformed metadata, oversized input, unsafe archives, links, special files, and secret material.
- A prior API image and prior E2B template can be restored independently.

## Scale gate

- Load test at least the target submission rate with realistic authenticated sessions and SSE connections.
- Confirm API p95 latency, Cloud SQL connection count/CPU, outbox age, queue age, task retries, active sandboxes, job completion latency, and provider error rate remain within the launch SLO.
- Cloud Tasks concurrency is at or below contracted E2B concurrency and verified OpenAI throughput.
- Per-plan active-job limits and global concurrency remain enforced under concurrent submissions.
- Do not claim thousands of simultaneous renders unless E2B and OpenAI have confirmed that active capacity; thousands of durable queued submissions are a separate claim.

## Product and operations

- Production Stripe prices, Customer Portal, tax/legal settings, webhook destination, and refund/support process are verified.
- Privacy policy, terms, retention/deletion process, support contact, and abuse response are published.
- Monitoring notification channels and on-call ownership are configured; alert tests reach a human. Terraform now defines an email channel (`alert_email`) wired into all alert policies; it takes effect at the next deliberate `terraform apply`.
- Staging end-to-end silent and narrated videos pass visual, audio, artifact, and download checks.

## Current release blockers (2026-08-28)

- `npm run smoke:staging` passed disposable signup, administrator verification, login/session creation, PostgreSQL persistence, Stripe sandbox Checkout creation, Cloud Tasks dispatch, E2B creation, scoped Codex callback authentication, safe failure handling, refund, and account cleanup. A full narrated staging generation through the callback-to-artifact path has still not passed end to end.
- A distinct live restricted Stripe key for production has not been selected or stored; the current isolated key is staging-only.
- Load, restore, and rollback certification remain outstanding.
- Rerun both silent and narrated staging generation before checking the final product-and-operations item.
