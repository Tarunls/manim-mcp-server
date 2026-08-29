import { CONTACT_EMAIL } from "../lib/studio";
import { MarketingChrome } from "./MarketingChrome";

export default function Policy({ kind }: { kind: "privacy" | "terms" }) {
  const privacy = kind === "privacy";
  return (
    <MarketingChrome
      className="policy-shell"
      nav={
        <>
          <a href="/#examples">Examples</a>
          <a href="/pricing">Pricing</a>
          <a href={privacy ? "/terms" : "/privacy"}>
            {privacy ? "Terms" : "Privacy"}
          </a>
        </>
      }
    >
      <article className="policy-document">
        <span className="kicker">Last updated August 24, 2026</span>
        <h1>{privacy ? "Privacy policy" : "Terms of service"}</h1>
        <p className="policy-lede">
          {privacy
            ? "What Orune stores, why it stores it, and how to get it back or delete it."
            : "What you can expect from Orune, and what Orune expects from you."}
        </p>
        {privacy ? (
          <>
            <section>
              <h2>What we collect</h2>
              <p>
                We store your email, account and subscription state, prompts,
                project settings, generated media, review notes, usage records,
                and security audit events. Stripe processes payment details;
                Orune does not store full card numbers.
              </p>
            </section>
            <section>
              <h2>How data is used</h2>
              <p>
                We use this information to authenticate you, generate and
                deliver videos, enforce plan limits, process billing, prevent
                abuse, support the service, and improve reliability.
              </p>
            </section>
            <section>
              <h2>Service providers</h2>
              <p>
                Processing may involve Google Cloud and Identity Platform, E2B,
                OpenAI, Speechify, Stripe, and licensed-media sources selected
                in the product. We do not sell personal information.
              </p>
            </section>
            <section>
              <h2>Retention and control</h2>
              <p>
                Account data and current project artifacts are retained while
                your account is active. Operational logs, deleted object
                versions, and backups may remain for a limited security or
                recovery period. You can export or delete your account from
                account settings.
              </p>
            </section>
            <section>
              <h2>Contact</h2>
              <p>
                Privacy and deletion questions can be sent to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
            </section>
          </>
        ) : (
          <>
            <section>
              <h2>Using the service</h2>
              <p>
                You must provide accurate account information, protect your
                login, and use Orune lawfully. Do not generate abusive
                or infringing material, attack the service, evade plan limits,
                or attempt to obtain another user's data.
              </p>
            </section>
            <section>
              <h2>AI-generated output</h2>
              <p>
                Generated videos can contain mistakes. You are responsible for
                reviewing factual accuracy, rights, suitability, and required
                disclosures before publishing or relying on an output.
              </p>
            </section>
            <section>
              <h2>Plans and billing</h2>
              <p>
                Paid plans renew monthly through Stripe until cancelled.
                Generation credits reset each billing period, are not
                transferable, and have no cash value. Applicable refund
                decisions and subscription changes are handled through support
                and Stripe's billing portal.
              </p>
            </section>
            <section>
              <h2>Your content</h2>
              <p>
                You retain rights you hold in submitted material and generated
                output. You grant us the limited permission required to process,
                store, render, and deliver that material through our service
                providers.
              </p>
            </section>
            <section>
              <h2>Availability</h2>
              <p>
                The service is provided without a guarantee that every
                generation will complete or be error-free. Failed or cancelled
                generations are designed to refund reserved credits. Liability
                is limited to the extent permitted by applicable law.
              </p>
            </section>
            <section>
              <h2>Contact</h2>
              <p>
                Questions, refund requests, and abuse reports can be sent to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
            </section>
          </>
        )}
      </article>
    </MarketingChrome>
  );
}
