# Production launch checklist

Updated: 2026-08-29

Unchecked items are blockers. Staging evidence is not automatically production evidence.

## Current staging acceptance

- [x] `useorune.com` DNS points to the managed edge.
- [x] Google-managed TLS certificate is active.
- [x] HTTP redirects to HTTPS.
- [x] Direct `run.app` access cannot bypass the edge.
- [x] Identity Platform authorizes the custom domain.
- [x] Disposable signup, verification, login/session, and cleanup passed.
- [x] Stripe-hosted sandbox Checkout, signed webhook provisioning, Creator credits, Customer Portal, cancellation, and cleanup passed.
- [x] A silent public E2B/Codex generation produced and privately downloaded a validated MP4.
- [x] Failed narrated generation restored the credit and hid private diagnostics.
- [x] Candidate renderer fix `c74eb0d` passed local/Cloud Build gates and its app image was published.
- [ ] Build and smoke `lesson-studio-renderer:c74eb0d`.
- [ ] Deploy `app:c74eb0d` and pin both services to the matching template.
- [ ] Complete paid narrated generation with Speechify audio and a private MP4.
- [ ] Rerun silent generation, Playwright, dependency audit, and no-drift Terraform plan after the final deploy.
- [ ] Remove obsolete temporary E2B release/smoke/diagnostic jobs.

## Authentication and privacy

- [x] Verified email is required before an application session is created.
- [x] Session cookies are `Secure`, host-only, `httpOnly`, `SameSite=Lax`, and exact-name parsed.
- [x] CSRF double-submit and exact-origin checks fail closed.
- [x] Password reset is enumeration-safe.
- [x] User-owned repositories scope project/job/artifact/billing reads and writes by owner.
- [x] Data export and account deletion are implemented.
- [ ] Manually retest cross-user project, job, artifact, review, billing, export, and deletion IDs against staging.
- [ ] Review production email verification/reset sender, templates, localization, and action links.
- [ ] Publish reviewed privacy, terms, retention, deletion, subprocessor, support, and abuse policies.
- [ ] Rotate credentials ever shared outside Secret Manager before production.

## Billing

- [x] Server-enforced staging prices/credits are Creator $20/10, Pro $50/30, Studio $100/70.
- [x] Entitlement activates only from a verified Stripe webhook.
- [x] Webhook replay/idempotency has automated coverage.
- [x] Customer Portal is owner-scoped.
- [x] Account deletion cancels an active subscription.
- [ ] Replace or claim the temporary sandbox before 2026-09-04.
- [ ] Create distinct live restricted Stripe and webhook secrets.
- [ ] Verify production products, prices, Portal configuration, upgrade/downgrade, renewal, failed invoice, cancellation, refund, and dispute flows.
- [ ] Keep `ALLOW_TEST_CHECKOUT=false` and require live billing mode in production.
- [ ] Complete tax registration/policy decisions before enabling Stripe Tax.

## Sandbox and generation security

- [x] API and dispatcher have separate service accounts, routes, and secret grants.
- [x] Dispatcher is private and Cloud Tasks uses OIDC.
- [x] One disposable E2B sandbox is created per job from an immutable tag.
- [x] The upstream OpenAI key remains in the API service.
- [x] Codex receives a job-scoped relay credential, not OpenAI/GCP/database/Stripe/E2B/Speechify credentials.
- [x] Responses WebSocket relay enforces active-job, model, request, output, and estimated-cost policy.
- [x] Narration uses a loopback bridge so Codex does not receive the callback token.
- [x] E2B arbitrary internet access is denied.
- [x] Source archives reject links, special files, unsafe paths, excessive expansion, and credential material.
- [x] GCS uploads validate owner prefix, generation, content type, size, checksum, signature, and metadata.
- [x] Downloads require ownership and use short-lived signed URLs.
- [ ] Prove the `c74eb0d` exact Manim interpreter path in a real E2B runtime.
- [ ] Complete live narrated render, Speechify metadata validation, audio-track validation, mux, upload, playback, and download.
- [ ] Exercise cancellation during generation, invalid callback token, expired signed URL, malformed artifact, provider throttling, E2B quota exhaustion, timeout, and duplicate callback delivery.
- [ ] Verify no orphan sandbox remains after every success/failure/cancellation case.

## Reliability and recovery

- [x] Generation reservation, job, credit ledger, and outbox changes are transactional.
- [x] Named Cloud Tasks, Stripe events, submissions, and callbacks are idempotent.
- [x] Retryable failures release leases; terminal failures refund once.
- [x] Scheduled reconciliation expires stale work and drains durable sandbox cleanup.
- [x] Migration runner uses a PostgreSQL advisory lock.
- [ ] Configure regional HA and a non-shared-core production Cloud SQL tier.
- [ ] Perform and record a Cloud SQL restore drill into a separate recovery target.
- [ ] Verify artifact version recovery.
- [ ] Rehearse application, E2B template, queue, and secret rollback.
- [ ] Define recovery-time and recovery-point objectives.

## Scale and operations

- [ ] Confirm contracted E2B concurrency and OpenAI/Speechify throughput.
- [ ] Load-test authenticated submission, status polling/SSE, queueing, and database behavior.
- [ ] Separately load-test the approved number of simultaneous renders.
- [ ] Verify API p95 latency, Cloud SQL connections/CPU, queue age/retries, active sandboxes, job latency/failure rate, tokens, and provider cost.
- [ ] Configure Monitoring notification channels and prove alerts reach a named person.
- [ ] Assign support and on-call owners and document incident handling.
- [ ] Protect release branches and ensure untrusted changes cannot use the release service account.
- [ ] Approve a realistic production budget including GCP and external providers.

Current staging supports two simultaneous renders. It may durably queue more requests, but it is not certified for thousands of concurrent renders.
