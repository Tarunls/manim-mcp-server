import { spawnSync } from "node:child_process";

const project = process.env.GCP_PROJECT?.trim();
const region = process.env.GCP_REGION?.trim() || "us-central1";
const service = process.env.GCP_SERVICE?.trim() || "lesson-studio";
const runtimeServiceAccount = process.env.GCP_RUNTIME_SERVICE_ACCOUNT?.trim();
const bucket = process.env.GCP_DATA_BUCKET?.trim() || `${project}-lesson-studio-data`;
const gcloud = process.env.GCLOUD_BIN?.trim() || (process.platform === "win32" ? "gcloud.cmd" : "gcloud");

if (!project || !runtimeServiceAccount) throw new Error("Set GCP_PROJECT and GCP_RUNTIME_SERVICE_ACCOUNT before running this script.");

function execute(args) {
  const windowsCommandScript = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(gcloud);
  return spawnSync(windowsCommandScript ? `"${gcloud}"` : gcloud, args, { encoding: "utf8", shell: windowsCommandScript });
}

function run(args) {
  const result = execute(args);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "gcloud failed").trim());
  return result.stdout.trim();
}

run(["services", "enable", "storage.googleapis.com", "--project", project, "--quiet"]);
const existing = execute(["storage", "buckets", "describe", `gs://${bucket}`, "--project", project]);
if (existing.status !== 0) {
  run([
    "storage", "buckets", "create", `gs://${bucket}`,
    "--project", project,
    "--location", region,
    "--uniform-bucket-level-access",
    "--public-access-prevention",
  ]);
}
run([
  "storage", "buckets", "add-iam-policy-binding", `gs://${bucket}`,
  "--project", project,
  "--member", `serviceAccount:${runtimeServiceAccount}`,
  "--role", "roles/storage.objectUser",
  "--quiet",
]);
run([
  "run", "services", "update", service,
  "--project", project,
  "--region", region,
  "--add-volume", `name=studio-data,type=cloud-storage,bucket=${bucket}`,
  "--add-volume-mount", "volume=studio-data,mount-path=/data",
  "--update-env-vars", "STUDIO_DATA_ROOT=/data",
  "--concurrency", "40",
  "--max-instances", "1",
  "--quiet",
]);

console.log(`Cloud Storage bucket ${bucket} is mounted at /data with a single-writer Cloud Run configuration.`);
