import assert from "node:assert/strict";
import test from "node:test";
import { IdentityAuthService } from "../server/auth-service.js";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("sign-up normalizes identity input and requests email verification", async () => {
  const previousKey = process.env.IDENTITY_PLATFORM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.IDENTITY_PLATFORM_API_KEY = "identity-test-key";
  const calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const action = url.pathname.split(":").at(-1) || "";
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ action, body });
    if (action === "signUp") {
      return Response.json({ localId: "user-1", email: body.email, idToken: "identity-token", emailVerified: false });
    }
    return Response.json({ email: body.email });
  };
  try {
    const auth = new IdentityAuthService();
    const result = await auth.signUp(" Teacher@Example.COM ", "long-enough-password");
    assert.equal(result.user.email, "teacher@example.com");
    assert.equal(result.user.emailVerified, false);
    assert.equal(result.verificationRequired, true);
    assert.deepEqual(calls, [
      { action: "signUp", body: { email: "teacher@example.com", password: "long-enough-password", returnSecureToken: true } },
      { action: "sendOobCode", body: { requestType: "VERIFY_EMAIL", idToken: "identity-token" } },
    ]);
  } finally {
    restore("IDENTITY_PLATFORM_API_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("identity errors are safe and do not disclose provider internals", async () => {
  const previousKey = process.env.IDENTITY_PLATFORM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.IDENTITY_PLATFORM_API_KEY = "identity-test-key";
  globalThis.fetch = async () => Response.json({ error: { message: "INVALID_LOGIN_CREDENTIALS : provider detail" } }, { status: 400 });
  try {
    const auth = new IdentityAuthService();
    await assert.rejects(() => auth.signIn("teacher@example.com", "long-enough-password"), {
      message: "That email or password is not correct.",
    });
  } finally {
    restore("IDENTITY_PLATFORM_API_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("unverified users are re-sent verification and never receive a session", async () => {
  const previousKey = process.env.IDENTITY_PLATFORM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.IDENTITY_PLATFORM_API_KEY = "identity-test-key";
  const actions: string[] = [];
  globalThis.fetch = async (input) => {
    const action = new URL(String(input)).pathname.split(":").at(-1) || "";
    actions.push(action);
    if (action === "signInWithPassword") return Response.json({ localId: "user-2", email: "teacher@example.com", idToken: "identity-token" });
    if (action === "lookup") return Response.json({ users: [{ localId: "user-2", email: "teacher@example.com", idToken: "identity-token", emailVerified: false }] });
    return Response.json({});
  };
  try {
    const auth = new IdentityAuthService();
    await assert.rejects(() => auth.signIn("teacher@example.com", "long-enough-password"), /Verify your email/);
    assert.deepEqual(actions, ["signInWithPassword", "lookup", "sendOobCode"]);
  } finally {
    restore("IDENTITY_PLATFORM_API_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("password reset is enumeration-safe while malformed emails are rejected", async () => {
  const previousKey = process.env.IDENTITY_PLATFORM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.IDENTITY_PLATFORM_API_KEY = "identity-test-key";
  globalThis.fetch = async () => Response.json({ error: { message: "EMAIL_NOT_FOUND" } }, { status: 400 });
  try {
    const auth = new IdentityAuthService();
    await auth.sendPasswordReset("missing@example.com");
    await assert.rejects(() => auth.sendPasswordReset("not-an-email"), /valid email/);
  } finally {
    restore("IDENTITY_PLATFORM_API_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("session cookies are parsed by exact name and production uses the Host prefix", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousKey = process.env.IDENTITY_PLATFORM_API_KEY;
  process.env.NODE_ENV = "production";
  process.env.IDENTITY_PLATFORM_API_KEY = "identity-test-key";
  try {
    const auth = new IdentityAuthService();
    assert.equal(auth.cookieName, "__Host-lesson_studio_session");
    assert.equal(auth.sessionFromCookie("other=x; __Host-lesson_studio_session=session-token"), "session-token");
    assert.equal(auth.sessionFromCookie("__Host-lesson_studio_session_extra=wrong"), undefined);
    assert.equal(auth.sessionDurationMs, 5 * 24 * 60 * 60 * 1_000);
  } finally {
    restore("NODE_ENV", previousNodeEnv);
    restore("IDENTITY_PLATFORM_API_KEY", previousKey);
  }
});
