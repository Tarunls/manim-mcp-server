import { useEffect, useState } from "react";
import { errorMessage, request } from "../lib/api";
import type { BillingPlanId, PricingPlan } from "../types";
import { MarketingChrome } from "./MarketingChrome";
import { PricingCards } from "./PricingCards";

const TERMS = [
  {
    q: "What is a credit?",
    a: "One credit is one pass of the generator. Faster spends 1, Balanced spends 2, and Try harder spends 4 — the slower settings give the model more room to plan and check the scenes before anything is rendered.",
  },
  {
    q: "What happens if a render fails?",
    a: "Failed and cancelled generations return the credits they reserved. You are not charged for a video you did not get.",
  },
  {
    q: "Do credits roll over?",
    a: "No. Credits reset at the start of each billing period, so a plan is a monthly allowance rather than a balance you accumulate.",
  },
  {
    q: "Can I change plans?",
    a: "At any time, from the billing panel in the studio. Changes take effect on the next invoice and your work stays where it is.",
  },
];

export default function Pricing() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

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
        setLoadError(errorMessage(reason, "Could not load pricing."));
      });
    return () => controller.abort();
  }, []);

  function choose(plan: BillingPlanId) {
    if (plan === "free") {
      window.location.href = "/studio";
      return;
    }
    if (!checkoutEnabled) {
      setNotice(
        "Paid checkout is not open yet. Make a free account and use the studio in the meantime.",
      );
      return;
    }
    window.location.href = `/studio?plan=${encodeURIComponent(plan)}`;
  }

  return (
    <MarketingChrome
      nav={
        <>
          <a href="/#examples">Examples</a>
          <a href="/#how-it-works">How it works</a>
        </>
      }
      className="pricing-shell"
    >
      <section className="page-head">
        <div className="page-head-inner">
          <div>
            <span className="kicker">Pricing</span>
            <h1>Pay for what you render.</h1>
          </div>
          <div>
            <p>
              Every plan uses the same renderer, the same studio, and the same
              frame-by-frame editing. The only thing that changes is how many
              lessons you can generate each month.
            </p>
            <p className="page-head-note">
              Faster spends 1 credit. Balanced spends 2. Try harder spends 4.
            </p>
          </div>
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        {!checkoutEnabled && !loadError && (
          <div className="launch-note">
            <strong>Free is live now.</strong>
            <span>Paid checkout is not enabled in this environment yet.</span>
          </div>
        )}
        {loadError && (
          <div className="inline-error" role="alert">
            {loadError}
          </div>
        )}
        {notice && (
          <div className="inline-notice" role="status">
            {notice}
          </div>
        )}
        <PricingCards
          plans={plans}
          checkoutEnabled={checkoutEnabled}
          onChoose={choose}
        />
      </section>

      <section className="pricing-terms" aria-labelledby="pricing-terms-title">
        <div className="pricing-terms-inner">
          <h2 id="pricing-terms-title">How billing works.</h2>
          <dl>
            {TERMS.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </MarketingChrome>
  );
}
