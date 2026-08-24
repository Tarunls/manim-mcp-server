import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const project = process.env.GCP_PROJECT?.trim();
const runtimeServiceAccount = process.env.GCP_RUNTIME_SERVICE_ACCOUNT?.trim();
const service = process.env.GCP_SERVICE?.trim() || "lesson-studio";
const region = process.env.GCP_REGION?.trim() || "us-central1";
const baseUrl = process.env.APP_BASE_URL?.trim()?.replace(/\/$/, "");
const gcloud = process.env.GCLOUD_BIN?.trim() || (process.platform === "win32" ? "gcloud.cmd" : "gcloud");
const staff = [
  { email: "tarun.l.sankar@gmail.com", name: "Tarun", passwordSecret: "staff_tarun_initial_password" },
  { email: "abhinav.malkoochi@gmail.com", name: "Abhinav", passwordSecret: "staff_abhinav_initial_password" },
];

if (!project || !runtimeServiceAccount || !baseUrl) {
  throw new Error("Set GCP_PROJECT, GCP_RUNTIME_SERVICE_ACCOUNT, and APP_BASE_URL before running this script.");
}

function run(args, options = {}) {
  const windowsCommandScript = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(gcloud);
  const result = spawnSync(windowsCommandScript ? `"${gcloud}"` : gcloud, args, {
    encoding: "utf8",
    shell: windowsCommandScript,
    ...options,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "gcloud failed").trim());
  return result.stdout.trim();
}

async function googleRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, body };
}

function ensureSecret(name, value) {
  const described = spawnSync(process.platform === "win32" ? `"${gcloud}"` : gcloud, ["secrets", "describe", name, "--project", project], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (described.status !== 0) run(["secrets", "create", name, "--project", project, "--replication-policy", "automatic"]);
  const versions = run(["secrets", "versions", "list", name, "--project", project, "--filter", "state:ENABLED", "--format", "value(name)"]);
  if (!versions) run(["secrets", "versions", "add", name, "--project", project, "--data-file=-"], { input: value });
}

function grantSecret(name, member) {
  run(["secrets", "add-iam-policy-binding", name, "--project", project, "--member", member, "--role", "roles/secretmanager.secretAccessor", "--quiet"]);
}

run(["services", "enable", "identitytoolkit.googleapis.com", "secretmanager.googleapis.com", "--project", project, "--quiet"]);
const token = run(["auth", "print-access-token"]);

const initializeUrl = `https://identitytoolkit.googleapis.com/v2/projects/${project}/identityPlatform:initializeAuth`;
const initialized = await googleRequest(initializeUrl, token, { method: "POST", body: "{}" });
if (!initialized.ok && initialized.status !== 409 && !JSON.stringify(initialized.body).includes("ALREADY_EXISTS")) {
  throw new Error(`Identity Platform initialization failed: ${JSON.stringify(initialized.body)}`);
}

const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
const configResult = await googleRequest(configUrl, token);
if (!configResult.ok || !configResult.body.client?.apiKey) throw new Error(`Could not read Identity Platform config: ${JSON.stringify(configResult.body)}`);
const identityApiKey = configResult.body.client.apiKey;
const host = new URL(baseUrl).hostname;
const authorizedDomains = [...new Set([...(configResult.body.authorizedDomains || []), host, "localhost"] )];
const patched = await googleRequest(`${configUrl}?updateMask=signIn.email,authorizedDomains`, token, {
  method: "PATCH",
  body: JSON.stringify({
    name: `projects/${project}/config`,
    signIn: { email: { enabled: true, passwordRequired: true } },
    authorizedDomains,
  }),
});
if (!patched.ok) throw new Error(`Could not enable email/password accounts: ${JSON.stringify(patched.body)}`);

ensureSecret("identity_platform_api_key", identityApiKey);
ensureSecret("session_secret", randomBytes(48).toString("base64url"));
ensureSecret("staff_emails", staff.map((person) => person.email).join(","));
for (const secret of ["identity_platform_api_key", "session_secret", "staff_emails"]) {
  grantSecret(secret, `serviceAccount:${runtimeServiceAccount}`);
}

for (const person of staff) {
  const password = `${randomBytes(18).toString("base64url")}!7a`;
  const created = await googleRequest(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts?key=${encodeURIComponent(identityApiKey)}`, token, {
    method: "POST",
    body: JSON.stringify({ email: person.email, password, emailVerified: true, displayName: person.name }),
  });
  const alreadyExists = JSON.stringify(created.body).includes("EMAIL_EXISTS");
  if (!created.ok && !alreadyExists) throw new Error(`Could not create ${person.email}: ${JSON.stringify(created.body)}`);
  if (created.ok) {
    ensureSecret(person.passwordSecret, password);
    grantSecret(person.passwordSecret, `user:${person.email}`);
  }
}

run([
  "run", "services", "update", service,
  "--project", project,
  "--region", region,
  "--update-secrets", "IDENTITY_PLATFORM_API_KEY=identity_platform_api_key:latest,SESSION_SECRET=session_secret:latest,STAFF_EMAILS=staff_emails:latest",
  "--update-env-vars", "ALLOW_TEST_CHECKOUT=false",
  "--quiet",
]);

console.log("Identity Platform is enabled, staff accounts exist, and Cloud Run has the account secrets.");
console.log("Each staff member can read only their own initial-password secret in Secret Manager, then use Forgot password to replace it.");
