# Astra: quality and cost

Policy prepared September 7, 2026. This change is local until the API and E2B template are deployed together.

| Studio setting | Model | Reasoning | Hosted estimated-spend stop threshold |
| --- | --- | --- | --- |
| Faster, including Free | GPT-5.6 Terra | medium | $2 |
| Balanced | GPT-6 Astra | medium | $2 |
| Try harder | GPT-6 Astra | high | $4 |

Balanced is the normal preference. Free accounts remain limited to Faster through existing server entitlements. All execution paths share `e2b/generation-models.json`. No subscription prices or generation credit charges have changed.

## What cheap means here

Astra is not a cheaper token SKU. Published standard rates are $10 input, $1 cached input, $12.50 cache writes and $50 output per million tokens. Reasoning consumes output tokens. Input/cache rates double and output rises 1.5x beyond 272K input tokens. [Official Astra rates](https://developers.openai.com/api/docs/models/gpt-6-astra).

For illustration, 10,000 ordinary input tokens and 2,000 output tokens cost $0.20; with 6,000 of those input tokens cached, $0.146. Neither number is a video cost: an agent makes multiple calls, including code and review, and uses render compute and optional narration. The proxy conservatively counts all uncached Astra input at $12.50/million to allow for cache writes, so its estimate for the second example is $0.156.

The MVP preserves reasoning for video authoring while avoiding xhigh/max defaults and priority processing. The proxy sets the model, reasoning effort and standard service tier itself, caps each response at 12,000 output tokens, and retains the existing job spend checks. It does not silently fall back to another model when Astra is unavailable.

The $2/$4 figures are soft admission thresholds. They are checked against recorded usage before starting a call; a running call or delayed accounting can overshoot. Failed/disconnected calls without usage can also be undercounted by the existing relay. They exclude rendering, speech, storage, payment fees and refunds. Local mode uses a direct API connection and has no hosted job spend enforcement. Do not advertise a guaranteed price per video based on these thresholds.

## Rollout and validation

1. Use an OpenAI project key with Astra access. This checkout currently has no `OPENAI_API_KEY`, so live availability and generation quality have not been benchmarked here.
2. Run one short integral prompt with Balanced and confirm model, accepted output, visual review and provider usage. Repeat with a targeted frame edit and Try harder. Preserve the artifacts and invoice usage for comparison.
3. Evaluate at least ten representative prompts: short and long lessons, advanced integrals, diagrams, revisions and optional narration. Compare accepted video cost, failure/retry rate, total generation time and visual correctness with the previous routing. A higher per-token price can still be worthwhile if fewer attempts are needed; that is a hypothesis until measured.
4. Build an immutable E2B template from this branch and deploy the API/dispatcher with that same template version. Rebuilding only the frontend does not change hosted execution. Keep the previous API and template revisions available for rollback.
5. Check spend using provider billing as well as `job_provider_calls`. Do not raise job budgets automatically when a generation runs out of budget.

## Next cost experiment

OpenAI lists Flex and Batch at half standard rates. Batch is poorly matched to the current interactive tool loop. Flex trades latency and availability for price, so test transport compatibility, timeouts and retry behavior before enabling it; do not auto-fallback to standard if that defeats the user's cost ceiling. [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing).

Keep stable instructions and tool definitions ahead of changing lesson material to improve automatic prefix cache reuse. Cache hits are an optimization, not a guaranteed discount. [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
