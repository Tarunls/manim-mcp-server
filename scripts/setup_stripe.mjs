import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function stripeExecutable() {
  if (process.env.STRIPE_CLI_PATH) return process.env.STRIPE_CLI_PATH;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const local = path.join(
      process.env.LOCALAPPDATA,
      "StripeCLI",
      "stripe.exe",
    );
    if (fs.existsSync(local)) return local;
  }
  return "stripe";
}

function stripe(args) {
  const profileArgs = process.env.STRIPE_CLI_PROJECT
    ? ["--project-name", process.env.STRIPE_CLI_PROJECT]
    : [];
  return JSON.parse(
    execFileSync(stripeExecutable(), [...profileArgs, ...args], {
      encoding: "utf8",
    }),
  );
}

const plans = [
  {
    name: "Orune Creator",
    description:
      "10 monthly generation credits with Balanced thinking, narration, and licensed visual search.",
    amount: 2000,
    lookupKey: "lesson_studio_creator_monthly",
  },
  {
    name: "Orune Pro",
    description:
      "30 monthly generation credits with Try harder thinking, narration, and licensed visual search.",
    amount: 5000,
    lookupKey: "lesson_studio_pro_monthly",
  },
  {
    name: "Orune Studio",
    description:
      "70 monthly generation credits and the highest concurrency for publishing workflows.",
    amount: 10000,
    lookupKey: "lesson_studio_studio_monthly",
  },
];

const existingPrices = stripe(["prices", "list", "--limit", "100"]).data || [];
for (const plan of plans) {
  const existing = existingPrices.find(
    (price) => price.lookup_key === plan.lookupKey && price.active,
  );
  if (
    existing?.unit_amount === plan.amount &&
    existing.currency === "usd" &&
    existing.recurring?.interval === "month"
  ) {
    console.log(`${plan.name}: ${existing.id} already exists`);
    continue;
  }
  const product = stripe([
    "products",
    "create",
    "--name",
    plan.name,
    "--description",
    plan.description,
  ]);
  const price = stripe([
    "prices",
    "create",
    "-d",
    `currency=usd`,
    "-d",
    `unit_amount=${plan.amount}`,
    "-d",
    "recurring[interval]=month",
    "-d",
    `product=${product.id}`,
    "-d",
    `lookup_key=${plan.lookupKey}`,
    ...(existing ? ["-d", "transfer_lookup_key=true"] : []),
  ]);
  if (existing) stripe(["prices", "update", existing.id, "-d", "active=false"]);
  console.log(`${plan.name}: created ${price.id}`);
}
