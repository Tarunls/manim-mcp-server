import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import type { BillingEntitlements, BillingPlanId, BillingState, GenerationEffort, PricingPlan } from "./types.js";

const DAY = 24 * 60 * 60 * 1_000;
const ACTIVE_SUBSCRIPTIONS = new Set(["active", "trialing"]);

export const PRICING_PLANS: Record<BillingPlanId, PricingPlan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    description: "Make and review your first visual lesson.",
    entitlements: { creditsPerMonth: 1, maxEffort: "quick", narration: false, licensedAssets: false },
    features: ["1 generation credit each month", "Faster thinking", "Precision math with polished motion", "Frame review and favorites", "MP4 download"],
  },
  creator: {
    id: "creator",
    name: "Creator",
    monthlyPrice: 20,
    description: "A practical plan for teachers and solo creators.",
    entitlements: { creditsPerMonth: 10, maxEffort: "balanced", narration: true, licensedAssets: true },
    features: ["10 generation credits each month", "Faster and Balanced thinking", "Speechify narration", "Licensed visual search", "Precision visuals, reviews, favorites, and downloads"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPrice: 49,
    description: "More room and deeper reasoning for frequent production.",
    entitlements: { creditsPerMonth: 30, maxEffort: "thorough", narration: true, licensedAssets: true },
    features: ["30 generation credits each month", "Faster, Balanced, and Try harder", "Speechify narration", "Licensed visual search", "Precision visuals, reviews, favorites, and downloads"],
  },
};

type StoredBillingProfile = {
  userId: string;
  plan: BillingPlanId;
  status: BillingState["status"];
  email?: string;
  creditsUsed: number;
  periodStart: string;
  periodEnd: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

function freePeriod(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

function generationCost(effort: GenerationEffort) {
  return effort === "thorough" ? 4 : effort === "balanced" ? 2 : 1;
}

function effortRank(effort: GenerationEffort) {
  return effort === "thorough" ? 3 : effort === "balanced" ? 2 : 1;
}

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

function subscriptionPeriod(subscription: Stripe.Subscription) {
  const value = subscription as Stripe.Subscription & { current_period_start?: number; current_period_end?: number };
  const item = subscription.items.data[0] as Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number };
  const start = value.current_period_start || item?.current_period_start || Math.floor(Date.now() / 1_000);
  const end = value.current_period_end || item?.current_period_end || Math.floor((Date.now() + 30 * DAY) / 1_000);
  return { periodStart: new Date(start * 1_000).toISOString(), periodEnd: new Date(end * 1_000).toISOString() };
}

export class BillingService {
  private readonly storePath: string;
  private readonly profiles = new Map<string, StoredBillingProfile>();
  private readonly staffUsers = new Set<string>();
  private readonly stripe?: Stripe;

  constructor(root: string) {
    this.storePath = path.join(root, "studio", "billing.json");
    if (process.env.STRIPE_SECRET_KEY) this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    this.load();
  }

  get configured() {
    return Boolean(this.stripe && process.env.STRIPE_WEBHOOK_SECRET);
  }

  get billingMode(): BillingState["billingMode"] {
    const key = process.env.STRIPE_SECRET_KEY || "";
    if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
    if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
    return "unconfigured";
  }

  setStaffAccess(userId: string, enabled: boolean) {
    if (enabled) this.staffUsers.add(userId);
    else this.staffUsers.delete(userId);
  }

  listPlans() {
    return Object.values(PRICING_PLANS);
  }

  private load() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as StoredBillingProfile[];
      for (const profile of stored) this.profiles.set(profile.userId, profile);
    } catch {
      // First run has no billing store.
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify([...this.profiles.values()], null, 2));
  }

  private profile(userId: string, email?: string) {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = { userId, plan: "free", status: "free", creditsUsed: 0, ...freePeriod(), email };
      this.profiles.set(userId, profile);
      this.persist();
    } else if (email && !profile.email) {
      profile.email = email;
      this.persist();
    }
    this.refreshPeriod(profile);
    return profile;
  }

  private refreshPeriod(profile: StoredBillingProfile) {
    if (Date.parse(profile.periodEnd) > Date.now()) return;
    if (profile.plan === "free" || !ACTIVE_SUBSCRIPTIONS.has(profile.status)) {
      Object.assign(profile, freePeriod(), { creditsUsed: 0, plan: "free", status: "free" });
      this.persist();
    }
  }

  getState(userId: string, email?: string): BillingState {
    const profile = this.profile(userId, email);
    if (this.staffUsers.has(userId)) {
      return {
        userId,
        plan: "pro",
        planName: "Studio team",
        status: "active",
        creditsUsed: 0,
        creditsRemaining: 999,
        periodEnd: profile.periodEnd,
        email: profile.email,
        isStaff: true,
        stripeConfigured: this.configured,
        billingMode: this.billingMode,
        hasStripeCustomer: false,
        entitlements: { ...PRICING_PLANS.pro.entitlements, creditsPerMonth: 999 },
      };
    }
    const subscribed = profile.plan !== "free" && ACTIVE_SUBSCRIPTIONS.has(profile.status);
    const plan = subscribed ? profile.plan : "free";
    const definition = PRICING_PLANS[plan];
    return {
      userId,
      plan,
      planName: definition.name,
      status: subscribed ? profile.status : "free",
      creditsUsed: profile.creditsUsed,
      creditsRemaining: Math.max(0, definition.entitlements.creditsPerMonth - profile.creditsUsed),
      periodEnd: profile.periodEnd,
      email: profile.email,
      isStaff: false,
      stripeConfigured: this.configured,
      billingMode: this.billingMode,
      hasStripeCustomer: Boolean(profile.stripeCustomerId),
      entitlements: definition.entitlements,
    };
  }

  assertEffort(userId: string, effort: GenerationEffort) {
    const state = this.getState(userId);
    if (effortRank(effort) > effortRank(state.entitlements.maxEffort)) {
      throw new Error(`${effort === "thorough" ? "Try harder" : "Balanced"} thinking is available on a higher plan.`);
    }
  }

  assertNarration(userId: string) {
    if (!this.getState(userId).entitlements.narration) throw new Error("AI voice is available on Creator and Pro.");
  }

  assertLicensedAssets(userId: string) {
    if (!this.getState(userId).entitlements.licensedAssets) throw new Error("Licensed visual search is available on Creator and Pro.");
  }

  reserveGeneration(userId: string, effort: GenerationEffort) {
    this.assertEffort(userId, effort);
    if (this.staffUsers.has(userId)) return 0;
    const profile = this.profile(userId);
    const state = this.getState(userId);
    const cost = generationCost(effort);
    if (state.creditsRemaining < cost) {
      throw new Error(`This request needs ${cost} generation credit${cost === 1 ? "" : "s"}. Upgrade or wait for your monthly credits to renew.`);
    }
    profile.creditsUsed += cost;
    this.persist();
    return cost;
  }

  refundGeneration(userId: string, credits: number) {
    if (this.staffUsers.has(userId) || credits <= 0) return;
    const profile = this.profile(userId);
    profile.creditsUsed = Math.max(0, profile.creditsUsed - credits);
    this.persist();
  }

  async createCheckout(userId: string, plan: BillingPlanId, email: string | undefined, baseUrl: string) {
    if (!this.stripe) throw new Error("Stripe test mode is not configured yet. Add STRIPE_SECRET_KEY to .env.");
    if (this.staffUsers.has(userId)) throw new Error("Studio team accounts already include full access.");
    if (this.billingMode !== "live" && process.env.ALLOW_TEST_CHECKOUT !== "true") {
      throw new Error("Paid subscriptions are opening soon. You can use the Free plan now.");
    }
    if (plan === "free") throw new Error("The Free plan does not need checkout.");
    const lookupKey = plan === "creator" ? "lesson_studio_creator_monthly" : "lesson_studio_pro_monthly";
    const prices = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data[0];
    if (!price) throw new Error(`Stripe price ${lookupKey} does not exist in this test account.`);
    const profile = this.profile(userId, email);
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      integration_identifier: `lesson_studio_${randomBytes(4).toString("hex")}`,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${baseUrl}/studio?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancelled#pricing`,
      allow_promotion_codes: true,
      customer: profile.stripeCustomerId,
      customer_email: profile.stripeCustomerId ? undefined : profile.email,
      client_reference_id: userId,
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
    });
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return session.url;
  }

  async createPortal(userId: string, baseUrl: string) {
    if (!this.stripe) throw new Error("Stripe test mode is not configured yet.");
    const profile = this.profile(userId);
    if (!profile.stripeCustomerId) throw new Error("There is no paid billing account to manage yet.");
    const session = await this.stripe.billingPortal.sessions.create({ customer: profile.stripeCustomerId, return_url: `${baseUrl}/studio` });
    return session.url;
  }

  constructWebhook(payload: Buffer, signature: string) {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) throw new Error("Stripe webhook verification is not configured.");
    return this.stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  }

  handleWebhook(event: Stripe.Event) {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "unpaid") return;
      const userId = session.metadata?.userId || session.client_reference_id;
      const plan = session.metadata?.plan as BillingPlanId | undefined;
      if (!userId || !plan || plan === "free") return;
      const profile = this.profile(userId, session.customer_details?.email || undefined);
      profile.plan = plan;
      profile.status = "active";
      profile.stripeCustomerId = stripeId(session.customer);
      profile.stripeSubscriptionId = stripeId(session.subscription);
      this.persist();
      return;
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = stripeId(invoice.customer);
      const profile = [...this.profiles.values()].find((candidate) => candidate.stripeCustomerId === customerId);
      if (!profile) return;
      profile.status = event.type === "invoice.paid" ? "active" : "past_due";
      this.persist();
      return;
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = stripeId(subscription.customer);
      const profile = [...this.profiles.values()].find((candidate) => candidate.stripeCustomerId === customerId || candidate.userId === subscription.metadata.userId);
      if (!profile) return;
      const previousEnd = profile.periodEnd;
      const plan = subscription.metadata.plan as BillingPlanId | undefined;
      if (plan === "creator" || plan === "pro") profile.plan = plan;
      profile.status = subscription.status === "trialing" ? "trialing" : subscription.status === "active" ? "active" : subscription.status === "past_due" ? "past_due" : subscription.status === "incomplete" ? "incomplete" : "canceled";
      profile.stripeCustomerId = customerId;
      profile.stripeSubscriptionId = subscription.id;
      Object.assign(profile, subscriptionPeriod(subscription));
      if (profile.periodEnd !== previousEnd) profile.creditsUsed = 0;
      if (event.type === "customer.subscription.deleted") Object.assign(profile, freePeriod(), { plan: "free", status: "free", creditsUsed: 0 });
      this.persist();
    }
  }
}
