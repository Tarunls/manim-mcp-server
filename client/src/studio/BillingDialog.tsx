import { CircleNotch } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { errorMessage, request } from "../lib/api";
import { CONTACT_EMAIL } from "../lib/studio";
import type { BillingPlanId, BillingState, PricingPlan } from "../types";
import { PricingCards } from "../routes/PricingCards";
import { Modal } from "./Modal";

export function BillingDialog({
  billing,
  onClose,
  onCheckout,
  onPortal,
}: {
  billing: BillingState;
  onClose: () => void;
  onCheckout: (plan: BillingPlanId) => void;
  onPortal: () => void;
}) {
  const [plans, setPlans] = useState<PricingPlan[]>();
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request<{ plans: PricingPlan[]; checkoutEnabled: boolean }>(
      "/api/pricing",
      { signal: controller.signal },
    )
      .then((result) => {
        setPlans(result.plans);
        setCheckoutEnabled(result.checkoutEnabled);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(errorMessage(reason, "Could not load plans."));
      });
    return () => controller.abort();
  }, []);

  return (
    <Modal
      label="Plan and billing"
      kicker="Plan & billing"
      title={`${billing.planName} plan`}
      className="billing-dialog"
      onClose={onClose}
      footer={
        <>
          <a className="modal-footer-note" href={`mailto:${CONTACT_EMAIL}`}>
            Questions? Contact us
          </a>
          {billing.hasStripeCustomer && (
            <button className="button button-secondary" onClick={onPortal}>
              Manage or cancel in Stripe
            </button>
          )}
        </>
      }
    >
      <div className="credit-meter">
        <div>
          <strong className="mono">{billing.creditsRemaining}</strong>
          <span>of {billing.entitlements.creditsPerMonth} credits left</span>
        </div>
        <span className="credit-track">
          <i
            style={{
              width: `${Math.max(0, Math.min(100, billing.entitlements.creditsPerMonth ? (billing.creditsRemaining / billing.entitlements.creditsPerMonth) * 100 : 0))}%`,
            }}
          />
        </span>
        <small>
          Renews{" "}
          {billing.periodEnd
            ? new Date(billing.periodEnd).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })
            : "monthly"}
        </small>
      </div>
      {error && <span className="form-error">{error}</span>}
      {!plans && !error && (
        <div className="dialog-loading">
          <CircleNotch className="spin" size={18} />
        </div>
      )}
      {plans && (
        <PricingCards
          plans={plans}
          currentPlan={billing.plan}
          checkoutEnabled={checkoutEnabled}
          onChoose={(plan) => (plan === "free" ? undefined : onCheckout(plan))}
        />
      )}
    </Modal>
  );
}
