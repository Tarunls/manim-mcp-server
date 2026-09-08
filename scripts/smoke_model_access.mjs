// Run in a trusted release job with OPENAI_API_KEY mounted from Secret Manager.
// Never emit credentials, response bodies, or customer content.
import assert from "node:assert/strict";
import { resolveModels } from "./lesson_pipeline.mjs";

const key = process.env.OPENAI_API_KEY?.trim();
assert.ok(key, "OPENAI_API_KEY is required.");
for (const tier of ["balanced", "thorough"]) {
  const { code } = resolveModels(tier);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: code.model,
      reasoning: { effort: code.reasoning },
      service_tier: "default",
      store: false,
      max_output_tokens: 1024,
      input: "Return the JSON object with ready set to true.",
      text: { format: { type: "json_schema", name: "release_check", strict: true,
        schema: { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"], additionalProperties: false } } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error(JSON.stringify({ tier, model: code.model, status: response.status, code: result.error?.code, type: result.error?.type }));
    process.exit(1);
  }
  const text = result.output?.flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
  assert.equal(result.status, "completed");
  assert.equal(JSON.parse(text).ready, true);
  console.log(JSON.stringify({ tier, requestedModel: code.model, returnedModel: result.model, reasoning: code.reasoning, usage: result.usage, passed: true }));
}
