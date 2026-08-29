# Orune production architecture

Updated: 2026-08-29

This document is the implementation contract for the hosted SaaS. Production must run the stateless API, PostgreSQL, queue, object storage, and isolated generation workers as separate trust boundaries. Current staging follows these boundaries but deliberately uses a zonal shared-core Cloud SQL instance and two-sandbox capacity; those are not production settings.

## Request and data flow

1. The browser signs in through Identity Platform. The API exchanges the fresh Identity Platform ID token for a Firebase Admin session cookie.
2. Every protected request verifies that cookie and derives the user ID from its signed subject. A user ID supplied in a URL or JSON body is never trusted as identity.
3. The API writes user, project, billing, credit-ledger, and generation-job changes to PostgreSQL in transactions.
4. A generation request commits a job, credit reservation, and outbox event atomically. The dispatcher publishes that job to Cloud Tasks.
5. The private dispatch endpoint starts one E2B sandbox from the pinned renderer template, records the sandbox ID, starts the Codex/render bootstrap, and acknowledges the task.
6. The sandbox has no upstream OpenAI, GCP, database, Identity Platform, Stripe, E2B, or Speechify credential. Its `.env` contains a job-scoped OpenAI proxy token. The trusted bootstrap separately holds a callback token and narrowly scoped artifact upload URLs.
7. The API validates completion callbacks, verifies uploaded artifacts, commits the final version, and exposes short-lived signed read URLs after checking ownership.

## Trust boundaries

- **Public edge:** External Application Load Balancer, Google-managed TLS certificate, HTTPS redirect, and Cloud Armor rate bans. Terraform restricts API ingress to load-balancer and internal traffic so the public `run.app` URL cannot bypass edge policy.
- **Web/API:** Stateless Cloud Run service. It may access Identity Platform, PostgreSQL, Cloud Tasks, object metadata, and the upstream OpenAI key used only by the scoped proxy. It never executes generated code.
- **Dispatcher:** Private Cloud Run service invoked only by the Cloud Tasks OIDC service account. It may create and terminate E2B sandboxes but does not hold end-user sessions.
- **Sandbox:** One disposable E2B micro-VM per generation. Generated code and user prompts are untrusted. The sandbox cannot reach application secrets or another user's files.
- **Database:** Private-IP Cloud SQL PostgreSQL with PITR, deletion protection, and bounded connection pools. Production requires regional HA; budget staging is zonal `db-f1-micro`.
- **Artifacts:** Private Cloud Storage with uniform bucket-level access and public access prevention. Browsers use expiring signed URLs after application authorization.

The same immutable container image runs with `SERVICE_ROLE=api` or `SERVICE_ROLE=dispatcher`. Route guards fail closed across roles, and Terraform gives each role a different service account and different Secret Manager grants. The API cannot read the E2B credential; the dispatcher cannot read OpenAI, Identity Platform, Stripe, Speechify, or staff configuration.

## Database ownership model

`app_users.id` is the Identity Platform UID. Every user-owned table contains an `owner_id` foreign key. Repository methods require that owner ID and include it in every select/update/delete predicate. Cross-user misses return `404` to avoid confirming resource existence.

Credits are an immutable ledger. Generation reservation and job creation share a serializable transaction. Stripe webhook IDs and generation idempotency keys are unique so retries cannot double-charge or double-provision.

Run migrations with:

```sh
npm run db:migrate
```

Production starts with `REQUIRE_DATABASE=true`; this makes the service fail closed if `DATABASE_URL` is missing.

## Authentication and browser security

- Firebase Admin creates five-day `httpOnly`, `Secure`, `SameSite=Lax`, host-only cookies.
- Protected requests verify signatures, expiry, email verification, disabled-user state, and token revocation.
- State-changing browser requests use a double-submit CSRF token and exact production-origin checks.
- Authentication and generation endpoints have independent rate limits.
- Helmet supplies CSP, HSTS, frame, MIME-sniffing, and referrer protections in production.
- Password reset responses are enumeration-safe.

## Sandbox secret policy

Production secrets remain in Secret Manager. The dispatcher supplies a minimal environment to E2B. The sandbox creates `.env` with a job-scoped proxy token and proxy base URL, mode `0600`; it never receives the upstream OpenAI key, never logs the file, excludes it from archives, and deletes it before completion. The proxy token is accepted only while its job is active and is capped at 64 upstream calls by default. The Codex child environment does not receive the callback credential, and archive-bound files are rejected if they contain raw sandbox credential material, links, special files, or unsafe paths.

The Codex process must never inherit the web service environment. Speechify is exposed through a bootstrap-owned loopback bridge, not through a provider key or raw callback credential. Generated rendering code can submit only bounded narration requests to localhost; the trusted bridge validates them and attaches the active job callback credential while forwarding to the API. Each job can request at most twelve segments. The API calls Speechify, so the provider key never crosses the service boundary.

The loopback bridge is unit/security tested, but the final live narrated staging flow remains unverified as of 2026-08-29 because the deployed E2B image failed earlier during Manim startup. See `docs/IMPLEMENTATION_STATUS.md`.

## Hosted execution configuration

Hosted Cloud Run instances must set `EXECUTION_MODE=e2b`. Production startup fails closed unless PostgreSQL, Identity Platform, Stripe, Cloud Tasks, E2B, GCS, callback secrets, and HTTPS base URLs are all present.

Build a pinned worker template after changing renderer dependencies or bootstrap code:

```sh
E2B_TEMPLATE=lesson-studio-renderer \
E2B_TEMPLATE_VERSION=<immutable-release-id> \
npm run e2b:build-template
```

Certify the built image before updating Terraform:

```sh
E2B_TEMPLATE=lesson-studio-renderer \
E2B_TEMPLATE_VERSION=<immutable-release-id> \
npm run smoke:e2b
```

The template builds dependency layers outside the application source-copy target and moves them into the final source tree after that copy. The non-root `node` user owns only the writable workspace and generated-project directory.

Never deploy the mutable `dev` tag to production. Set Cloud Tasks maximum concurrent dispatches no higher than `E2B_MAX_CONCURRENT_SANDBOXES`; the database gate is a second line of defense, not a replacement for queue throttling.

The budget staging profile starts with two concurrent sandboxes, three API instances, a 30-minute sandbox lifetime, up to 64 OpenAI calls per job, and 12,000 output tokens per provider response. The larger call allowance lets a real agent finish, while an independent estimated-cost ceiling stops Faster/Balanced jobs at $2 and Try harder jobs at $4. Model selection is overwritten by the API: Faster and Balanced use `gpt-5.6-terra`, while Try harder uses `gpt-5.6-sol`. Provider-call rows record token counts and estimated cost without retaining response bodies.

Manim render helpers invoke the virtualenv interpreter as `python -m manim`. This is intentional: E2B snapshot/mount behavior can invalidate the absolute shebang embedded in a `manim` console launcher.

## Capacity model

Submitting a generation is fast and asynchronous. Cloud Tasks `maxConcurrentDispatches` must be at or below purchased E2B concurrency. Per-user and per-plan active-job limits prevent a single account from monopolizing the queue. E2B and OpenAI quota errors leave the job queued with exponential backoff instead of losing it.

Capacity claims are certified by load tests against staging and by written confirmation of E2B and OpenAI quotas. "Thousands of users" means all submissions are accepted durably; simultaneous active rendering is explicitly bounded by contracted capacity.
