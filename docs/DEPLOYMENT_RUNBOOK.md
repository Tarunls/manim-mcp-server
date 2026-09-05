# GCP deployment runbook

Updated: 2026-09-02

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

The deployed image/template are currently `81b9483` (deployed 2026-09-02; E2B smoke and the silent staging smoke passed). It rewrites the narration audio assembly — see "Narration audio" below. That release restores nine commits from 2026-08-30/31 (`bb9b604`..`2452405`, the showcase landing page and the 9:16 vertical format) that had been built and deployed from a local clone but never pushed; their trees were recovered from the Cloud Build source archives onto branch `recover/aug30-31-local-work` and merged.

**Before any release, verify nothing is unpushed:** compare the `COMMIT_SHA` values in `gcloud builds list` and the live services' image tags against `git branch -r --contains <sha>`. A SHA git does not know means local work that must be recovered from `gs://educationalvideo-506219_cloudbuild/source/` before deploying over it.

One item is outstanding, and one caveat applies:

1. **Narrated generation is not yet re-proven end to end.** ElevenLabs is enabled and verified at the provider (see below), but a full narrated job has not run since. `smoke:staging-payment` cannot cover it while `BILLING_MODE_REQUIRED=live`, because that script pays with Stripe's `4242…` test card. Prove narration with a staff-account generation instead, or temporarily use a sandbox Stripe key.

2. **Terraform drift.** `E2B_TEMPLATE_VERSION=81b9483` was set with `gcloud run services update` before Terraform ran. `staging.auto.tfvars` is now reconstructed on the release machine and the plan is clean; keep `image`/`e2b_template_version` in it current so future plans reconcile instead of reverting.

### ElevenLabs narration (enabled 2026-09-02)

The `elevenlabs_api_key` secret is granted to `ls-staging-api` and mounted on the API service. Verified with the exact production request shape (`eleven_multilingual_v2`, `mp3_44100_128`, the same `voice_settings`): all three configured voices in `shared/narration-voices.json` return real MP3 audio. The earlier `payment_required` no longer reproduces.

**The key is a restricted key.** It has no `user_read` scope (`/v1/user/subscription` and `/v1/voices` return 401) and is scoped to specific voices — a built-in voice such as Rachel `21m00Tcm4TlvDq8ikawM` returns `voice_not_found`. So a 404 on a built-in voice is expected and is *not* evidence of a broken key; test only voice IDs the key is scoped to. Before adding a voice to `narration-voices.json`, confirm that exact `voiceId` returns 200 with this key.

Granting secret access requires the project owner (`tarun.l.sankar@gmail.com`); an editor account gets 403 on `secretmanager.secrets.setIamPolicy`. Because Terraform's `google_secret_manager_secret_iam_member` performs a read-modify-write, an editor cannot apply that resource even when the binding already exists — import it into state instead:

```sh
terraform -chdir=infra/terraform import \
  'google_secret_manager_secret_iam_member.api_existing["elevenlabs_api_key"]' \
  "projects/educationalvideo-506219/secrets/elevenlabs_api_key roles/secretmanager.secretAccessor serviceAccount:ls-staging-api@educationalvideo-506219.iam.gserviceaccount.com"
```

### Narration audio

`scripts/generate_narration.mjs` assembles the voice track. Three rules, each learned from a defect that shipped:

1. **Never use `silenceremove` with `stop_periods=-1`.** It strips every silence in a passage rather than capping unusual ones. Measured on a clip whose pauses were 0.60s and 1.49s it returned 0.23s and 0.23s, so unrelated pauses collapsed to the same length and delivery alternately rushed and stalled. Raising `stop_duration` to 1.0 made it worse (0.60s → 0.05s). Trim the ends only; spoken pauses are prosody.
2. **Never run `loudnorm` single-pass over the mixed track.** Single-pass loudnorm rides gain, so on a mostly-silent track it lifts the floor between passages and ducks each entry. Measure per passage (`print_format=json`), then apply with `measured_*` and `linear=true`, and do not normalise the mix again.
3. **Keep intermediates PCM and pin `-ar 48000`.** MP3 intermediates stack a second lossy generation and prepend encoder delay, drifting each passage off its timeline slot. loudnorm resamples to 192kHz internally, so without an explicit rate the muxed track came out as 96kHz AAC.

Do not ask a provider to speak off-tempo (`speed`, `<prosody rate>`): it warps synthesised prosody. `NARRATION_SPEED` is 1 deliberately. Pacing belongs in how much text a passage carries.

Because spoken pauses are now preserved, passages are slightly longer than under the old filter, so a passage can overrun its visual slot. That failure is intentional and its message is actionable ("Shorten the passage or extend the scene"); do not fix it by compressing audio again.

There is no ffmpeg on the WSL release machine. Verify audio changes in a throwaway Cloud Run job on the app image: A/B the filter chains with `silencedetect` and compare gap positions, then run the real script end to end against a stub provider via `NARRATION_PROXY_URL` (the stub must be its own process — `execFileSync` blocks the event loop).

## Release invariants

1. Application and E2B releases use immutable commit tags, never only `latest`.
2. If `e2b/`, renderer code, renderer dependencies, or the pipeline bootstrap changes, build and smoke the matching E2B template before deploying the application.
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

The smoke must use the exact immutable tag, disable arbitrary internet access, execute `/opt/lesson-studio/app/.venv/bin/python -m manim --version`, import the lesson pipeline module, find FFmpeg, write/read the workspace, and terminate the sandbox in all outcomes.

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
