import React, { useEffect, useState } from "react";
import { ConvexReactClient } from "convex/react";
import {
  ConvexAuthProvider,
  useConvexAuth,
  useAuthActions,
  useAuthToken,
} from "@convex-dev/auth/react";
import { CheckCircle, FilmSlate } from "@phosphor-icons/react";

export const convexUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_CONVEX_URL || "";

const client = convexUrl ? new ConvexReactClient(convexUrl) : undefined;

// Live JWT issued by convex-auth. Bound by <TokenBinder/> inside the provider;
// module-level helpers (request(), EventSource) read it from here.
let currentAuthToken: string | null = null;

export function authToken() {
  return currentAuthToken;
}

function TokenBinder() {
  const token = useAuthToken();
  useEffect(() => {
    currentAuthToken = token;
  }, [token]);
  return null;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthProvider client={client}>
      <TokenBinder />
      <Gate>
        {children}
      </Gate>
    </ConvexAuthProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return (
      <div className="auth-screen">
        <div className="auth-form-panel">
          <p className="auth-subtitle">Loading Lesson Studio…</p>
        </div>
      </div>
    );
  }
  if (isAuthenticated) return <>{children}</>;
  return <AuthScreen />;
}

const VALUE_POINTS = [
  "Describe a lesson in one sentence and get an editable video draft",
  "Review every frame, mark up mistakes, and request precise fixes",
  "Manim-quality math visuals with narration, pacing, and polish handled for you",
];

function AuthScreen() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signUp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn("password", {
        flow: mode,
        email: email.trim(),
        password,
      });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message.replace(/^Uncaught Error: /, "")
          : mode === "signUp" ? "Could not create the account." : "Could not sign in.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-editorial" aria-hidden="true">
        <div className="auth-brand">
          <span className="brand-mark"><FilmSlate weight="fill" size={16} /></span>
          Lesson Studio
        </div>

        <div>
          <h1 className="auth-headline">
            The fastest path from idea to <em>teachable video</em>.
          </h1>
          <ul className="auth-points">
            {VALUE_POINTS.map((point) => (
              <li key={point}>
                <CheckCircle weight="fill" size={17} />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-footnote">Every render is versioned. Every fix is a sentence away.</p>
      </section>

      <main className="auth-form-panel">
        <form className="auth-card" onSubmit={submit} noValidate>
          <h2 className="auth-title">
            {mode === "signUp" ? "Create your account" : "Welcome back"}
          </h2>
          <p className="auth-subtitle">
            {mode === "signUp"
              ? "Start with free credits. No card required."
              : "Sign in to continue to your projects."}
          </p>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              required
              placeholder="you@school.edu"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="auth-input"
              type="password"
              required
              minLength={8}
              placeholder={mode === "signUp" ? "At least 8 characters" : undefined}
              value={password}
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "signUp" ? "Create account" : "Sign in"}
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode(mode === "signUp" ? "signIn" : "signUp");
              setError("");
            }}
          >
            {mode === "signUp"
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        </form>
      </main>
    </div>
  );
}
