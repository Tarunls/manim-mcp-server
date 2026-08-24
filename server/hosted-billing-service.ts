import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { PRICING_PLANS } from "./billing-service.js";
import type { Database } from "./database.js";
import type { BillingPlanId, BillingState, GenerationEffort } from "./types.js";

type ProfileRow = {
  user_id: string;
  email: string;
  role: "user" | "staff" | "admin";
  plan: BillingPlanId;
  status: BillingState["status"];
  period_start: Date;
  period_end: Date;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  balance: string;
};

function effortRank(effort: GenerationEffort) {
  return effort === "thorough" ? 3 : effort === "balanced" ? 2 : 1;
}

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

function period(subscription: Stripe.Subscription) {
  const value = subscription as Stripe.Subscription & { current_period_start?: number; current_period_end?: number };
  const item = subscription.items.data[0] as Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number };
  const start = value.current_period_start || item?.current_period_start || Math.floor(Date.now() / 1000);
  const end = value.current_period_end || item?.current_period_end || Math.floor(Date.now() / 1000) + 30 * 86400;
  return [new Date(start * 1000), new Date(end * 1000)] as const;
}

export class HostedBillingService {
  private readonly stripe?: Stripe;

  constructor(private readonly db: Database) {
    if (process.env.STRIPE_SECRET_KEY) this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  get configured() {
    return Boolean(this.db.configured && this.stripe && process.env.STRIPE_WEBHOOK_SECRET);
  }

  get billingMode(): BillingState["billingMode"] {
    const key = process.env.STRIPE_SECRET_KEY || "";
    if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
    if (key.startsWith("sk_test_") || key.startsWith("rk_test_") || key.startsWith("rkcs_test_")) return "test";
    return "unconfigured";
  }

  private async ensureProfile(userId: string) {
    await this.db.query(
      `INSERT INTO billing_profiles (user_id, period_start, period_end)
       VALUES ($1, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    await this.db.query(
      `UPDATE billing_profiles
          SET plan = 'free', status = 'free', period_start = date_trunc('month', now()),
              period_end = date_trunc('month', now()) + interval '1 month', updated_at = now()
        WHERE user_id = $1 AND period_end <= now()
          AND (plan = 'free' OR status NOT IN ('active', 'trialing'))`,
      [userId],
    );
  }

  async getState(userId: string): Promise<BillingState> {
    await this.ensureProfile(userId);
    const result = await this.db.query<ProfileRow>(
      `SELECT bp.user_id, u.email, u.role, bp.plan, bp.status, bp.period_start, bp.period_end,
              bp.stripe_customer_id, bp.stripe_subscription_id,
              COALESCE(SUM(cl.amount) FILTER (
                WHERE cl.created_at >= bp.period_start AND cl.created_at < bp.period_end
              ), 0)::text AS balance
         FROM billing_profiles bp
         JOIN app_users u ON u.id = bp.user_id
         LEFT JOIN credit_ledger cl ON cl.user_id = bp.user_id
        WHERE bp.user_id = $1
        GROUP BY bp.user_id, u.email, u.role, bp.plan, bp.status, bp.period_start, bp.period_end,
                 bp.stripe_customer_id, bp.stripe_subscription_id`,
      [userId],
    );
    const profile = result.rows[0];
    if (!profile) throw new Error("Billing profile not found.");
    const staff = profile.role === "staff" || profile.role === "admin";
    const subscribed = profile.plan !== "free" && ["active", "trialing"].includes(profile.status);
    const plan = staff ? "pro" : subscribed ? profile.plan : "free";
    const definition = PRICING_PLANS[plan];
    const allowance = staff ? 999 : definition.entitlements.creditsPerMonth;
    const remaining = Math.max(0, allowance + Number(profile.balance));
    return {
      userId,
      plan,
      planName: staff ? "Studio team" : definition.name,
      status: staff ? "active" : subscribed ? profile.status : "free",
      creditsUsed: staff ? 0 : Math.max(0, -Number(profile.balance)),
      creditsRemaining: remaining,
      periodEnd: profile.period_end.toISOString(),
      email: profile.email,
      isStaff: staff,
      stripeConfigured: this.configured,
      billingMode: this.billingMode,
      hasStripeCustomer: Boolean(profile.stripe_customer_id),
      entitlements: staff ? { ...PRICING_PLANS.pro.entitlements, creditsPerMonth: 999 } : definition.entitlements,
    };
  }

  async assertEffort(userId: string, effort: GenerationEffort) {
    const state = await this.getState(userId);
    if (effortRank(effort) > effortRank(state.entitlements.maxEffort)) throw new Error("That thinking level is available on a higher plan.");
  }

  async assertNarration(userId: string) {
    if (!(await this.getState(userId)).entitlements.narration) throw new Error("AI voice is available on Creator and Pro.");
  }

  async assertLicensedAssets(userId: string) {
    if (!(await this.getState(userId)).entitlements.licensedAssets) throw new Error("Licensed visual search is available on Creator and Pro.");
  }

  async createCheckout(userId: string, plan: Exclude<BillingPlanId, "free">, email: string | undefined, baseUrl: string) {
    if (!this.stripe) throw new Error("Stripe is not configured.");
    if (this.billingMode !== "live" && process.env.ALLOW_TEST_CHECKOUT !== "true") throw new Error("Paid subscriptions are opening soon.");
    const state = await this.getState(userId);
    if (state.isStaff) throw new Error("Studio team accounts already include full access.");
    const lookupKey = plan === "creator" ? "lesson_studio_creator_monthly" : "lesson_studio_pro_monthly";
    const prices = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (!prices.data[0]) throw new Error(`Stripe price ${lookupKey} does not exist.`);
    const profile = await this.db.query<{ stripe_customer_id: string | null }>("SELECT stripe_customer_id FROM billing_profiles WHERE user_id = $1", [userId]);
    const customer = profile.rows[0]?.stripe_customer_id || undefined;
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      integration_identifier: `lesson_studio_${randomBytes(4).toString("hex")}`,
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      success_url: `${baseUrl}/studio?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancelled#pricing`,
      allow_promotion_codes: true,
      customer,
      customer_email: customer ? undefined : email,
      client_reference_id: userId,
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
    }, { idempotencyKey: `checkout:${userId}:${plan}:${Math.floor(Date.now() / 300_000)}` });
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return session.url;
  }

  async createPortal(userId: string, baseUrl: string) {
    if (!this.stripe) throw new Error("Stripe is not configured.");
    const profile = await this.db.query<{ stripe_customer_id: string | null }>("SELECT stripe_customer_id FROM billing_profiles WHERE user_id = $1", [userId]);
    const customer = profile.rows[0]?.stripe_customer_id;
    if (!customer) throw new Error("There is no paid billing account to manage yet.");
    return (await this.stripe.billingPortal.sessions.create({ customer, return_url: `${baseUrl}/studio` })).url;
  }

  constructWebhook(payload: Buffer, signature: string) {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) throw new Error("Stripe webhook verification is not configured.");
    return this.stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  }

  async handleWebhook(event: Stripe.Event) {
    await this.db.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO stripe_events (event_id, event_type, livemode, payload)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, event.type, event.livemode, JSON.stringify(event)],
      );
      if (!inserted.rowCount) return;
      try {
        if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId || session.client_reference_id;
          const plan = session.metadata?.plan;
          if (userId && (plan === "creator" || plan === "pro") && session.payment_status !== "unpaid") {
            await client.query(
              `UPDATE billing_profiles SET plan = $2, status = 'active', stripe_customer_id = $3,
                 stripe_subscription_id = $4, updated_at = now() WHERE user_id = $1`,
              [userId, plan, stripeId(session.customer), stripeId(session.subscription)],
            );
          }
        } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
          const subscription = event.data.object as Stripe.Subscription;
          const plan = subscription.metadata.plan;
          const userId = subscription.metadata.userId;
          const [start, end] = period(subscription);
          const status = event.type === "customer.subscription.deleted" ? "canceled"
            : subscription.status === "trialing" ? "trialing" : subscription.status === "active" ? "active"
              : subscription.status === "past_due" ? "past_due" : subscription.status === "incomplete" ? "incomplete" : "canceled";
          await client.query(
            `UPDATE billing_profiles SET
               plan = CASE WHEN $2 IN ('creator', 'pro') AND $3 <> 'canceled' THEN $2 ELSE 'free' END,
               status = CASE WHEN $3 = 'canceled' THEN 'free' ELSE $3 END,
               stripe_customer_id = $4, stripe_subscription_id = $5,
               period_start = $6, period_end = $7, updated_at = now()
             WHERE user_id = $1 OR stripe_customer_id = $4`,
            [userId || "", plan || "free", status, stripeId(subscription.customer), subscription.id, start, end],
          );
        } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
          const invoice = event.data.object as Stripe.Invoice;
          await client.query(
            `UPDATE billing_profiles SET status = $2, updated_at = now() WHERE stripe_customer_id = $1`,
            [stripeId(invoice.customer), event.type === "invoice.paid" ? "active" : "past_due"],
          );
        }
        await client.query("UPDATE stripe_events SET processed_at = now() WHERE event_id = $1", [event.id]);
      } catch (error) {
        await client.query("UPDATE stripe_events SET processing_error = $2 WHERE event_id = $1", [event.id, error instanceof Error ? error.message.slice(0, 1000) : "unknown"]);
        throw error;
      }
    });
  }
}
