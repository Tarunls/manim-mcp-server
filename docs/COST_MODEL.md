# Cost and margin model

Updated: 2026-08-24

This is an operating model, not a guarantee. Provider prices and generation behavior change, so recorded usage and invoices remain the source of truth.

## Current public price inputs

- OpenAI standard API rates used by the hosted policy are documented on the [official API pricing page](https://platform.openai.com/pricing): `gpt-5.6-terra` is the cost-controlled model for Faster and Balanced work; `gpt-5.6-sol` is reserved for Try harder work.
- E2B bills running sandboxes per second. Its [official pricing page](https://e2b.dev/pricing) lists the Hobby tier with up to 20 concurrent sandboxes and separate CPU/RAM usage charges.
- Speechify lists pay-as-you-go API narration at [$10 per million characters](https://speechify.com/pricing-api/).
- Stripe's US standard card rate is [2.9% plus $0.30 per successful domestic-card transaction](https://stripe.com/pricing).
- In `us-central1`, Cloud SQL lists `db-f1-micro` at [$0.0105 per hour](https://cloud.google.com/sql/pricing), or about $7.67 for a 730-hour month before storage and backups. This shared-core tier has no Cloud SQL SLA and is staging-only.
- Cloud Run is request-priced and has a free tier; Cloud Tasks includes its [first one million monthly operations](https://cloud.google.com/tasks/pricing) at no charge; qualifying `us-central1` Cloud Storage has a small [Always Free allowance](https://cloud.google.com/storage/pricing).

## Plans and workload units

| Plan | Price | Credits | Approximate monthly generation choices |
| --- | ---: | ---: | --- |
| Free | $0 | 1 | 1 Faster |
| Creator | $20 | 10 | 10 Faster or 5 Balanced |
| Pro | $50 | 30 | 30 Faster, 15 Balanced, or 7 Try harder |
| Studio | $100 | 70 | 70 Faster, 35 Balanced, or 17 Try harder |

Mixed usage consumes the same credit pool. Faster costs 1 credit, Balanced costs 2, and Try harder costs 4.

At standard US card rates, approximate revenue after the payment transaction fee is $19.12, $48.25, and $96.80 respectively. That is not net profit: OpenAI, E2B, narration, storage, support, refunds, taxes, and fixed infrastructure still apply.

## Enforced cost controls

- Faster and Balanced use `gpt-5.6-terra`; Try harder uses `gpt-5.6-sol`.
- The API overwrites any sandbox-supplied model selection.
- Each provider response is capped at 12,000 output tokens and a generation is capped at 12 OpenAI calls.
- Provider-call records store model, status, input tokens, cached tokens, output tokens, and an estimated micro-USD cost without storing provider response content.
- Staging starts with two concurrent E2B sandboxes and three API instances.
- The E2B sandbox has a 30-minute lifetime and is terminated on completion, cancellation, or dispatch failure.
- The project has a $20 monthly GCP alerting budget at 50%, 80%, 100%, and forecasted 100%. Google documents that ordinary budget alerts do not enforce a hard spending cap.

The $20 GCP budget does not include OpenAI, E2B, Speechify, or Stripe. Those providers need their own account-level limits. No public plan should be marketed with an unlimited-generation promise.
