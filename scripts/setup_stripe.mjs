import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function stripeExecutable() {
  if (process.env.STRIPE_CLI_PATH) return process.env.STRIPE_CLI_PATH;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const local = path.join(process.env.LOCALAPPDATA, "StripeCLI", "stripe.exe");
    if (fs.existsSync(local)) return local;
  }
  return "stripe";
}

function stripe(args) {
  return JSON.parse(execFileSync(stripeExecutable(), args, { encoding: "utf8" }));
}

const plans = [
  { name: "Lesson Studio Creator", description: "10 monthly generation credits with Balanced thinking, narration, and licensed visual search.", amount: 2000, lookupKey: "lesson_studio_creator_monthly" },
  { name: "Lesson Studio Pro", description: "30 monthly generation credits with Try harder thinking, narration, and licensed visual search.", amount: 4900, lookupKey: "lesson_studio_pro_monthly" },
];

const existingPrices = stripe(["prices", "list", "--limit", "100"]).data || [];
for (const plan of plans) {
  const existing = existingPrices.find((price) => price.lookup_key === plan.lookupKey && price.active);
  if (existing) {
    console.log(`${plan.name}: ${existing.id} already exists`);
    continue;
  }
  const product = stripe(["products", "create", "--name", plan.name, "--description", plan.description]);
  const price = stripe([
    "prices", "create",
    "-d", `currency=usd`,
    "-d", `unit_amount=${plan.amount}`,
    "-d", "recurring[interval]=month",
    "-d", `product=${product.id}`,
    "-d", `lookup_key=${plan.lookupKey}`,
  ]);
  console.log(`${plan.name}: created ${price.id}`);
}
