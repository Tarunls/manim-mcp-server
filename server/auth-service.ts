import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1_000;

export type AuthUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  isStaff: boolean;
};

type IdentityResponse = {
  localId: string;
  email: string;
  idToken: string;
  emailVerified?: boolean;
};

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function normalizedEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
  return email;
}

function friendlyIdentityError(code: string) {
  if (code.includes("EMAIL_EXISTS")) return "An account already exists for this email. Sign in instead.";
  if (code.includes("EMAIL_NOT_FOUND") || code.includes("INVALID_PASSWORD") || code.includes("INVALID_LOGIN_CREDENTIALS")) return "That email or password is not correct.";
  if (code.includes("WEAK_PASSWORD")) return "Use a password with at least 10 characters.";
  if (code.includes("TOO_MANY_ATTEMPTS")) return "Too many attempts. Wait a moment and try again.";
  if (code.includes("USER_DISABLED")) return "This account has been disabled.";
  return "Account service is temporarily unavailable. Try again shortly.";
}

export class IdentityAuthService {
  readonly cookieName = process.env.NODE_ENV === "production" ? "__Host-lesson_studio_session" : "lesson_studio_session";
  private readonly apiKey = process.env.IDENTITY_PLATFORM_API_KEY?.trim() || "";
  private readonly staffEmails = new Set(
    (process.env.STAFF_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  constructor() {
    if (getApps().length === 0) {
      const projectId = process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim()
        || process.env.GOOGLE_CLOUD_PROJECT?.trim()
        || process.env.GCLOUD_PROJECT?.trim();
      initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
    }
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  get sessionDurationMs() {
    return SESSION_DURATION_MS;
  }

  sessionFromCookie(cookieHeader: string | undefined) {
    return cookieValue(cookieHeader, this.cookieName);
  }

  private async identityRequest<T>(action: string, body: Record<string, unknown>): Promise<T> {
    if (!this.configured) throw new Error("Account sign-in is not configured yet.");
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(friendlyIdentityError(result.error?.message || "IDENTITY_ERROR"));
    return result;
  }

  private userFromIdentity(result: IdentityResponse): AuthUser {
    const email = result.email.toLowerCase();
    const isStaff = this.staffEmails.has(email);
    return { uid: result.localId, email, emailVerified: Boolean(result.emailVerified) || isStaff, isStaff };
  }

  async signUp(emailValue: unknown, passwordValue: unknown) {
    const email = normalizedEmail(emailValue);
    const password = typeof passwordValue === "string" ? passwordValue : "";
    if (password.length < 10 || password.length > 128) throw new Error("Use a password between 10 and 128 characters.");
    const result = await this.identityRequest<IdentityResponse>("signUp", { email, password, returnSecureToken: true });
    await this.identityRequest("sendOobCode", { requestType: "VERIFY_EMAIL", idToken: result.idToken });
    return { user: this.userFromIdentity(result), verificationRequired: true as const };
  }

  async signIn(emailValue: unknown, passwordValue: unknown) {
    const email = normalizedEmail(emailValue);
    const password = typeof passwordValue === "string" ? passwordValue : "";
    const result = await this.identityRequest<IdentityResponse>("signInWithPassword", { email, password, returnSecureToken: true });
    const lookup = await this.identityRequest<{ users?: IdentityResponse[] }>("lookup", { idToken: result.idToken });
    const user = this.userFromIdentity(lookup.users?.[0] || result);
    if (!user.emailVerified) {
      await this.identityRequest("sendOobCode", { requestType: "VERIFY_EMAIL", idToken: result.idToken });
      throw new Error("Verify your email using the link we sent, then sign in again.");
    }
    const sessionCookie = await getAuth().createSessionCookie(result.idToken, { expiresIn: SESSION_DURATION_MS });
    return { user, sessionCookie };
  }

  async sendPasswordReset(emailValue: unknown) {
    const email = normalizedEmail(emailValue);
    try {
      await this.identityRequest("sendOobCode", { requestType: "PASSWORD_RESET", email });
    } catch {
      // Password reset is deliberately enumeration-safe.
    }
  }

  async authenticate(cookieHeader: string | undefined): Promise<AuthUser | undefined> {
    if (!this.configured) return undefined;
    const token = this.sessionFromCookie(cookieHeader);
    if (!token) return undefined;
    try {
      const claims = await getAuth().verifySessionCookie(token, process.env.AUTH_CHECK_REVOKED !== "false");
      const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
      if (!claims.uid || !email || claims.email_verified !== true) return undefined;
      return { uid: claims.uid, email, emailVerified: true, isStaff: this.staffEmails.has(email) };
    } catch {
      return undefined;
    }
  }

  async revoke(cookieHeader: string | undefined) {
    const token = this.sessionFromCookie(cookieHeader);
    if (!token) return;
    try {
      const claims = await getAuth().verifySessionCookie(token, false);
      await getAuth().revokeRefreshTokens(claims.uid);
    } catch {
      // Clearing a missing, expired, or already-revoked cookie is still successful.
    }
  }
}
