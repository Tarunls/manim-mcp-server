import { spawnSync } from "node:child_process";

const project = process.env.GCP_PROJECT?.trim();
const baseUrl = process.env.APP_BASE_URL?.trim()?.replace(/\/$/, "");
const region = process.env.GCP_REGION?.trim() || "us-central1";
const service = process.env.GCP_SERVICE?.trim() || "lesson-studio";
const runtimeServiceAccount = process.env.GCP_RUNTIME_SERVICE_ACCOUNT?.trim();
const gcloud = process.env.GCLOUD_BIN?.trim() || (process.platform === "win32" ? "gcloud.cmd" : "gcloud");
const stripe = process.env.STRIPE_BIN?.trim() || (process.platform === "win32" ? "stripe.cmd" : "stripe");

if (!project || !baseUrl || !runtimeServiceAccount) {
  throw new Error("Set GCP_PROJECT, APP_BASE_URL, and GCP_RUNTIME_SERVICE_ACCOUNT before running this script.");
}

function run(command, args, options = {}) {
  const windowsCommandScript = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
  const executable = windowsCommandScript ? `"${command}"` : command;
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    shell: windowsCommandScript,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout;
}

const webhookUrl = `${baseUrl}/api/stripe/webhook`;
const existing = JSON.parse(run(stripe, ["webhook_endpoints", "list", "--limit", "100"]));
if (existing.data?.some((endpoint) => endpoint.url === webhookUrl && endpoint.status === "enabled")) {
  throw new Error(`An enabled Stripe webhook already exists at ${webhookUrl}. Reuse its signing secret or remove it before rerunning setup.`);
}

const events = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];
const createArgs = [
  "webhook_endpoints",
  "create",
  "--url",
  webhookUrl,
  "--confirm",
];
for (const event of events) createArgs.push("--enabled-events", event);

const endpoint = JSON.parse(run(stripe, createArgs));
if (!endpoint.secret) throw new Error("Stripe did not return a signing secret for the new endpoint.");

const windowsGcloudScript = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(gcloud);
const described = spawnSync(windowsGcloudScript ? `"${gcloud}"` : gcloud, ["secrets", "describe", "stripe_webhook_secret", "--project", project], {
  encoding: "utf8",
  shell: windowsGcloudScript,
});
if (described.status !== 0) {
  run(gcloud, ["secrets", "create", "stripe_webhook_secret", "--project", project, "--replication-policy", "automatic"]);
}

run(gcloud, ["secrets", "versions", "add", "stripe_webhook_secret", "--project", project, "--data-file=-"], {
  input: endpoint.secret,
});
run(gcloud, [
  "secrets",
  "add-iam-policy-binding",
  "stripe_webhook_secret",
  "--project",
  project,
  "--member",
  `serviceAccount:${runtimeServiceAccount}`,
  "--role",
  "roles/secretmanager.secretAccessor",
  "--quiet",
]);
run(gcloud, [
  "run",
  "services",
  "update",
  service,
  "--project",
  project,
  "--region",
  region,
  "--update-secrets",
  "STRIPE_WEBHOOK_SECRET=stripe_webhook_secret:latest",
  "--update-env-vars",
  `APP_BASE_URL=${baseUrl}`,
  "--quiet",
]);

console.log(`Configured Stripe test webhook ${endpoint.id} for ${webhookUrl}.`);
