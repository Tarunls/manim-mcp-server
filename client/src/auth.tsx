import React, { useState } from "react";
import { ConvexReactClient } from "convex/react";
import {
  ConvexAuthProvider,
  useConvexAuth,
  useAuthActions,
} from "@convex-dev/auth/react";

export const convexUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_CONVEX_URL || "";

const client = convexUrl ? new ConvexReactClient(convexUrl) : undefined;

export function authToken() {
  try {
    return localStorage.getItem("convex-auth-token");
  } catch {
    return null;
  }
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthProvider client={client}>
      <Gate>
        {children}
      </Gate>
    </ConvexAuthProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  if (isAuthenticated) return <>{children}</>;
  return <AuthScreen />;
}

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
        redirectTo: window.location.origin,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">Lesson Studio</h1>
        <p className="auth-subtitle">
          {mode === "signUp" ? "Create your account to start generating." : "Welcome back. Sign in to continue."}
        </p>
        <label className="auth-label">
          Email
          <input
            className="auth-input"
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="auth-label">
          Password
          <input
            className="auth-input"
            type="password"
            required
            minLength={8}
            value={password}
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signUp" ? "Create account" : "Sign in"}
        </button>
        <button
          className="auth-switch"
          type="button"
          onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}
        >
          {mode === "signUp" ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </div>
  );
}
