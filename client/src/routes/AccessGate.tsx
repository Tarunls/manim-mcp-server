import { ArrowRight, Check, CircleNotch, Warning } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { errorMessage, request } from "../lib/api";
import type { AccountUser } from "../lib/studio";

export default function AccessGate({
  configured,
  onAuthorized,
}: {
  configured: boolean;
  onAuthorized: (user: AccountUser) => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{
        authenticated: boolean;
        user: AccountUser;
        verificationRequired?: boolean;
      }>(mode === "signin" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.authenticated) {
        onAuthorized(result.user);
      } else {
        setMode("signin");
        setPassword("");
        setNotice("Check your email to verify the account, then sign in.");
      }
    } catch (caught) {
      setError(
        errorMessage(
          caught,
          mode === "signin"
            ? "Could not sign in."
            : "Could not create the account.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await request("/api/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setNotice(
        "If an account exists for that email, a reset link is on its way.",
      );
    } catch (caught) {
      setError(errorMessage(caught, "Could not send the reset email."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-page">
      <header className="site-nav">
        <div className="site-nav-inner">
          <a className="wordmark" href="/">
            Orune
          </a>
          <a className="text-link" href="/">
            Back to the site
          </a>
        </div>
      </header>
      <div className="access-body">
      <section className="access-card" aria-labelledby="access-title">
        <span className="kicker">
          {mode === "signin" ? "Welcome back" : "Start free"}
        </span>
        <h1 id="access-title">
          {mode === "signin" ? "Sign in to your studio" : "Create your account"}
        </h1>
        <p>
          {mode === "signin"
            ? "Your lessons, drafts, and every earlier render are where you left them."
            : "One lesson free. No card, and nothing to cancel."}
        </p>
        {!configured && (
          <div className="inline-error" role="alert">
            <Warning size={15} /> Account sign-in is being configured. Please
            try again shortly.
          </div>
        )}
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              minLength={10}
              aria-describedby="password-hint"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <small id="password-hint" className="field-hint">
              {mode === "signup"
                ? password.length > 0 && password.length < 10
                  ? `${10 - password.length} more character${10 - password.length === 1 ? "" : "s"} needed`
                  : "At least 10 characters."
                : " "}
            </small>
          </label>
          {error && (
            <div className="inline-error" role="alert">
              <Warning size={15} /> {error}
            </div>
          )}
          {notice && (
            <div className="inline-notice" role="status">
              <Check size={15} /> {notice}
            </div>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={
              !configured || submitting || !email || password.length < 10
            }
          >
            {submitting ? (
              <CircleNotch className="spin" size={17} />
            ) : (
              <>
                {mode === "signin" ? "Sign in" : "Create account"}{" "}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
        <div className="access-switch">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in instead"}
          </button>
          {mode === "signin" && (
            <button type="button" onClick={() => void resetPassword()}>
              Forgot password?
            </button>
          )}
        </div>
      </section>
      <figure className="access-aside">
        <div className="access-aside-frame stage-frame">
          <img
            src="/showcase/integral-2.jpg"
            alt="A rendered Orune frame showing a solid of revolution."
          />
        </div>
        <figcaption>
          <strong>This is the output, not a mockup.</strong>
          One frame from &ldquo;Area becomes volume&rdquo; &mdash; written as a
          single prompt, rendered with Manim, then corrected in the studio.
        </figcaption>
      </figure>
      </div>
    </main>
  );
}
