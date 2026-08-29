import { useEffect, useState } from "react";
import { errorMessage, request } from "../lib/api";
import type { BillingPlanId, PricingPlan } from "../types";
import { MarketingChrome } from "./MarketingChrome";
import { PricingCards } from "./PricingCards";

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
        "Paid plans are opening soon. You can create a free account and use the studio now.",
      );
      return;
    }
    window.location.href = `/studio?plan=${encodeURIComponent(plan)}`;
  }

  return (
    <MarketingChrome
      nav={<a href="/#how-it-works">How it works</a>}
      className="pricing-shell"
    >
      <section className="page-hero">
        <span className="kicker">Pricing</span>
        <h1>Simple plans for real output.</h1>
        <p>Pay for the amount of generation and reasoning you use.</p>
        <p className="page-hero-note">
          Faster uses 1 credit, Balanced uses 2, and Try harder uses 4.
        </p>
      </section>
      <section className="pricing-section" id="pricing">
        {!checkoutEnabled && !loadError && (
          <div className="launch-note">
            <strong>Free is available now.</strong>
            <span>Paid checkout is not enabled in this environment.</span>
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
    </MarketingChrome>
  );
}
