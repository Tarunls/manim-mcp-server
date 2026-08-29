import type { BillingPlanId, PricingPlan } from "../types";

export function PricingCards({
  plans,
  currentPlan,
  checkoutEnabled = true,
  onChoose,
}: {
  plans: PricingPlan[];
  currentPlan?: BillingPlanId;
  checkoutEnabled?: boolean;
  onChoose: (plan: BillingPlanId) => void;
}) {
  return (
    <div className="pricing-grid">
      {plans.map((plan) => (
        <article
          className={`pricing-card ${plan.id === "creator" ? "pricing-featured" : ""}`}
          key={plan.id}
        >
          <div className="pricing-card-head">
            <span className="pricing-ribbon" aria-hidden={plan.id !== "creator"}>
              {plan.id === "creator" ? "Recommended" : ""}
            </span>
            <span>{plan.name}</span>
            <strong>
              {plan.monthlyPrice ? `$${plan.monthlyPrice}` : "$0"}
              <small>/month</small>
            </strong>
          </div>
          <p>{plan.description}</p>
          <ul>
            {plan.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <button
            className={
              plan.id === "creator"
                ? "button button-primary"
                : "button button-secondary"
            }
            disabled={currentPlan === plan.id}
            onClick={() => onChoose(plan.id)}
          >
            {currentPlan === plan.id
              ? "Current plan"
              : plan.id === "free"
                ? "Start free"
                : !checkoutEnabled
                  ? "Not open yet"
                  : `Choose ${plan.name}`}
          </button>
        </article>
      ))}
    </div>
  );
}
