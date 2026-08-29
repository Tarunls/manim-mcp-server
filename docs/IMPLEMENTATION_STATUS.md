# Production implementation status

Updated: 2026-08-29

This is the current source of truth for implementation and staging status. The detailed continuation procedure is in `docs/GCP_ADMIN_LLM_HANDOFF.md`.

## Executive status

The SaaS foundation is implemented and the staging website is online at `https://useorune.com`. Authentication, PostgreSQL persistence, Stripe sandbox billing, the private GCP edge, asynchronous jobs, E2B sandbox creation, Codex execution, private artifact storage, credit charging/refunds, and a complete silent generation have all passed real staging tests.

Staging is **not yet release-certified**. The latest paid narrated end-to-end test completed signup, Checkout, webhook provisioning, portal creation, job submission, and E2B startup, but failed when Composite invoked a Manim launcher whose embedded Python path was invalid in the mounted E2B image. The credit was restored and the disposable account/subscription were removed correctly.

Commit `c74eb0d` fixes the renderer to invoke `python -m manim`, creates the virtual environment at its final path, and strengthens the E2B runtime smoke. Its application image was built successfully, but its matching E2B template has not been built, smoked, deployed, or tested end to end. Do not report narration or release certification complete until that happens.

## Current staging inventory

| Item | Current state |
| --- | --- |
| GCP project | `educationalvideo-506219` |
| Region | `us-central1` |
| Canonical origin | `https://useorune.com` |
| Load-balancer IP | `136.68.115.171` |
| TLS | Google-managed certificate is `ACTIVE` |
| Deployed app image | `us-central1-docker.pkg.dev/educationalvideo-506219/lesson-studio/app:004c9c7` |
| API revision | `lesson-studio-staging-api-00024-rtt` |
| Dispatcher revision | `lesson-studio-staging-dispatcher-00022-lvj` |
| Deployed E2B template | `lesson-studio-renderer:004c9c7` |
| Candidate commit/image | `c74eb0d`; image build succeeded, not deployed |
| Candidate E2B template | Not built or certified |
| Stripe | Temporary CLI sandbox; expires 2026-09-04 |
| Staging capacity | Two active E2B sandboxes, API maximum three instances |
| GCP budget | $20 monthly alert, not a hard cap; external providers excluded |

Terraform remote state is active. The legacy public Cloud Run service named `lesson-studio` is separate and must not be modified.

## Confirmed staging behavior

- DNS points `useorune.com` to the managed edge, HTTP redirects to HTTPS, the certificate is active, and direct `run.app` requests cannot bypass the edge.
- Identity Platform authorizes `useorune.com`. Disposable staging tests proved signup, email verification, session creation, authenticated access, logout/account cleanup, and safe unverified-user handling.
- Session cookies, exact-origin checks, CSRF protection, revocation checks, endpoint rate limits, and owner-scoped repository queries are implemented.
- Stripe sandbox Creator, Pro, and Studio prices are $20, $50, and $100 monthly. Checkout uses Stripe-hosted pages; seven signed webhook event types are configured.
- A hosted payment smoke completed Checkout, processed the signed webhook, provisioned Creator with ten credits, opened Customer Portal, cancelled the subscription, and deleted the disposable account.
- A complete silent staging smoke passed signup, verification, cookies/CSRF, Stripe Checkout creation, Cloud Tasks, E2B/Codex generation, rendering, private GCS upload, ownership-protected signed download, MP4 signature validation, and cleanup.
- Failed generation paths restore credits exactly once and return a generic public message while retaining private diagnostics.
- The Codex proxy supports the current Responses WebSocket transport, keeps the upstream OpenAI key in the API service, enforces the selected model/output limits, and records usage/cost metadata without response bodies.
- Long-running E2B execution is separated from short HTTP request timeouts, so the worker is not killed at 30 seconds.
- The sandbox narration bridge binds only to loopback, allows only the narration route, validates bounded inputs, and keeps the job callback credential out of the Codex child. Its unit/security test passes.

## Latest failed acceptance test

The paid narrated smoke job was `2cf0e941-e293-4b93-8c37-9e5df7787d6d`. Payment and entitlement provisioning passed and the job reached E2B. It failed before artifact completion because `/opt/lesson-studio/app/.venv/bin/manim` contained an embedded reference to nonexistent `/app/.venv/bin/python3`.

The prior runtime smoke did not catch this because it checked the launcher existed but executed Manim through the alternate `venv` path. Commit `c74eb0d` addresses both weaknesses:

- the real E2B environment is now `/opt/lesson-studio/app/.venv`;
- `venv` is only a compatibility symlink to `.venv`;
- both Manim render helpers invoke the virtualenv Python as `python -m manim` instead of trusting a relocatable console-script shebang;
- the release smoke invokes Manim through the exact `.venv` interpreter used by rendering;
- a regression test checks both render helpers retain the module invocation.

## Verification evidence at `c74eb0d`

- Local unit suite: 36 tests total, 34 passed, two hosted PostgreSQL tests skipped without a local hosted database, zero failed.
- TypeScript/client production build: passed.
- Python syntax compilation for both Manim helpers: passed.
- `git diff --check`: passed before commit.
- Cloud Build `4d198cda-fbbb-468c-b903-fbac489fdc8a`: passed checks, tests, build, dependency audit, image build, and Artifact Registry push for `app:c74eb0d`.
- Playwright desktop/mobile/accessibility/CSRF coverage passed before the renderer-only `c74eb0d` change; rerun it during final certification.
- `npm audit` reported zero vulnerabilities in the preceding local gate and passed again inside the successful Cloud Build.

## Implemented architecture

- PostgreSQL schema for users, projects, billing profiles, immutable credit ledger, Stripe event idempotency, generation jobs, artifacts, job events, audit records, provider calls, and transactional outbox.
- Advisory-lock migration runner and serializable generation submission.
- Named Cloud Tasks with OIDC-authenticated delivery to a private dispatcher.
- Lease-based dispatch, bounded retries, global concurrency enforcement, stale-job reconciliation every five minutes, durable sandbox cleanup, and one E2B sandbox per generation.
- Private versioned GCS artifacts with type, size, checksum, signature, metadata, owner, and archive validation. Browser access uses short-lived signed reads after authorization.
- Separate API and dispatcher Cloud Run roles with disjoint routes, service accounts, and Secret Manager access.
- Data export, account deletion, subscription cancellation, and private object cleanup.
- Responsive public/auth/studio UI, privacy and terms routes, and Playwright accessibility coverage.
- React audit removed all `useMemo` and `useCallback` calls and unnecessary Effects. Remaining Effects synchronize genuine external systems such as EventSource, animation frames, image loading, drawing, and scrolling.

## Cost and safety controls

- Faster and Balanced use the cost-controlled model; Try harder uses the higher-cost model. The server overwrites sandbox model requests.
- Up to 64 OpenAI calls are allowed so a real generation can complete, but an independent estimated-cost ceiling stops normal Faster/Balanced jobs at $2 and Try harder jobs at $4.
- Each provider response is capped at 12,000 output tokens.
- A measured failed 32-turn staging run used about 923,724 input tokens, 876,410 cached input tokens, and 12,061 output tokens, with an estimated cost of $0.518306. This is diagnostic evidence, not a guaranteed per-video cost.
- Narration is capped at twelve server-mediated segments.
- The E2B sandbox lifetime is 30 minutes and staging active concurrency is two.
- The $20 GCP budget only alerts. It does not stop spending and excludes OpenAI, E2B, Speechify, and Stripe.

## Remaining staging work

1. Build `lesson-studio-renderer:c74eb0d` using the E2B key already held in Secret Manager.
2. Run `npm run smoke:e2b` against that exact immutable tag. It must exercise `.venv/bin/python -m manim`, Codex SDK resolution, FFmpeg, no-internet policy, and teardown.
3. Deploy the already-built `app:c74eb0d` through the ordered migration, dispatcher, then API release process.
4. Update Terraform's ignored staging tfvars to `image = ...:c74eb0d` and `e2b_template_version = "c74eb0d"`, review a fresh plan, and apply only the expected in-place changes.
5. Rerun `smoke:staging-payment`. It must finish with a paid narrated MP4, Speechify `simba-3.2` metadata/audio, nine remaining Creator credits, a private signed download, portal creation, and complete cleanup.
6. Rerun the silent staging smoke and Playwright suite, then check Terraform has no drift.
7. Remove only the explicitly listed temporary release/smoke/diagnostic Cloud Run jobs in the handoff document after their evidence is no longer needed.

## Remaining before public production

- Replace the expiring Stripe CLI sandbox with a durable test workspace if staging is still needed after 2026-09-04.
- Provision separate live restricted Stripe and webhook secrets; keep test checkout disabled in production.
- Review Identity Platform verification/reset email sender, templates, localization, and action links.
- Configure real monitoring notification channels and assign support/on-call ownership.
- Use regional HA and a non-shared-core Cloud SQL tier in a separate production Terraform state.
- Confirm contracted E2B capacity and OpenAI/Speechify quotas, then load-test API/SSE submission separately from active rendering.
- Complete restore, rollback, abuse, security, privacy/legal, tax, refund, dispute, retention, and incident-response sign-off.
- Rotate credentials that were ever pasted into chat or another non-secret channel before production.

The current staging profile is suitable only for a controlled beta after the narrated test passes. It is not sized or certified for thousands of simultaneous renders.
