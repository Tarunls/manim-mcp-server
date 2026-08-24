# Lesson Studio production architecture

This document is the implementation contract for the hosted SaaS. Production must run the stateless API, PostgreSQL, queue, object storage, and isolated generation workers as separate trust boundaries.

## Request and data flow

1. The browser signs in through Identity Platform. The API exchanges the fresh Identity Platform ID token for a Firebase Admin session cookie.
2. Every protected request verifies that cookie and derives the user ID from its signed subject. A user ID supplied in a URL or JSON body is never trusted as identity.
3. The API writes user, project, billing, credit-ledger, and generation-job changes to PostgreSQL in transactions.
4. A generation request commits a job, credit reservation, and outbox event atomically. The dispatcher publishes that job to Cloud Tasks.
5. The private dispatch endpoint starts one E2B sandbox from the pinned renderer template, records the sandbox ID, starts the Codex/render bootstrap, and acknowledges the task.
6. The sandbox has no GCP, database, Identity Platform, or Stripe credential. It receives only its OpenAI API key, a one-time callback token, and narrowly scoped artifact upload URLs.
7. The API validates completion callbacks, verifies uploaded artifacts, commits the final version, and exposes short-lived signed read URLs after checking ownership.

## Trust boundaries

- **Public edge:** External Application Load Balancer and Cloud Armor. Cloud Run ingress should accept only load-balancer and internal traffic after the custom domain is active.
- **Web/API:** Stateless Cloud Run service. It may access Identity Platform, PostgreSQL, Cloud Tasks, and object metadata. It never executes generated code.
- **Dispatcher:** Private Cloud Run service invoked only by the Cloud Tasks OIDC service account. It may create and terminate E2B sandboxes but does not hold end-user sessions.
- **Sandbox:** One disposable E2B micro-VM per generation. Generated code and user prompts are untrusted. The sandbox cannot reach application secrets or another user's files.
- **Database:** Private-IP Cloud SQL PostgreSQL with regional HA, PITR, deletion protection, and bounded connection pools.
- **Artifacts:** Private Cloud Storage with uniform bucket-level access and public access prevention. Browsers use expiring signed URLs after application authorization.

The same immutable container image runs with `SERVICE_ROLE=api` or `SERVICE_ROLE=dispatcher`. Route guards fail closed across roles, and Terraform gives each role a different service account and different Secret Manager grants. The API cannot read OpenAI or E2B credentials; the dispatcher cannot read Identity Platform, Stripe, Speechify, or staff configuration.

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

Production secrets remain in Secret Manager. The dispatcher supplies a minimal environment to E2B. If a local `.env` file is required by the Codex bootstrap, the sandbox creates it with mode `0600`, never logs it, excludes it from archives, and deletes it before completion.

The Codex process must never inherit the web service environment. Speechify and licensed-asset operations should move behind scoped application callbacks so their provider keys are not visible to generated code.

The current hosted worker implements this rule for Speechify. Each active job can request at most twelve narration segments through its one-time callback credential. The application calls Speechify; the provider key never crosses the sandbox boundary.

## Hosted execution configuration

Hosted Cloud Run instances must set `EXECUTION_MODE=e2b`. Production startup fails closed unless PostgreSQL, Identity Platform, Stripe, Cloud Tasks, E2B, GCS, callback secrets, and HTTPS base URLs are all present.

Build a pinned worker template after changing renderer dependencies or bootstrap code:

```sh
E2B_TEMPLATE=lesson-studio-renderer \
E2B_TEMPLATE_VERSION=<immutable-release-id> \
npm run e2b:build-template
```

Never deploy the mutable `dev` tag to production. Set Cloud Tasks maximum concurrent dispatches no higher than `E2B_MAX_CONCURRENT_SANDBOXES`; the database gate is a second line of defense, not a replacement for queue throttling.

## Capacity model

Submitting a generation is fast and asynchronous. Cloud Tasks `maxConcurrentDispatches` must be at or below purchased E2B concurrency. Per-user and per-plan active-job limits prevent a single account from monopolizing the queue. E2B and OpenAI quota errors leave the job queued with exponential backoff instead of losing it.

Capacity claims are certified by load tests against staging and by written confirmation of E2B and OpenAI quotas. "Thousands of users" means all submissions are accepted durably; simultaneous active rendering is explicitly bounded by contracted capacity.
