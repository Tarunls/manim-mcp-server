import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

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

type SessionPayload = AuthUser & {
  version: 1;
  expiresAt: number;
};

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

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
  readonly cookieName = "lesson_studio_session";
  private readonly apiKey = process.env.IDENTITY_PLATFORM_API_KEY?.trim() || "";
  private readonly sessionSecret = process.env.SESSION_SECRET?.trim() || "";
  private readonly staffEmails = new Set(
    (process.env.STAFF_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  constructor() {
    if (this.apiKey && this.sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters when Identity Platform is enabled.");
  }

  get configured() {
    return Boolean(this.apiKey && this.sessionSecret);
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
    if (password.length < 10) throw new Error("Use a password with at least 10 characters.");
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
    return user;
  }

  async sendPasswordReset(emailValue: unknown) {
    const email = normalizedEmail(emailValue);
    await this.identityRequest("sendOobCode", { requestType: "PASSWORD_RESET", email });
  }

  createSession(user: AuthUser) {
    const payload: SessionPayload = { ...user, version: 1, expiresAt: Date.now() + SESSION_DURATION_MS };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.sessionSecret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  authenticate(cookieHeader: string | undefined): AuthUser | undefined {
    if (!this.configured) return undefined;
    const token = cookieValue(cookieHeader, this.cookieName);
    if (!token) return undefined;
    const separator = token.lastIndexOf(".");
    if (separator < 1) return undefined;
    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = createHmac("sha256", this.sessionSecret).update(encoded).digest("base64url");
    if (!safeEqual(signature, expected)) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
      if (payload.version !== 1 || payload.expiresAt <= Date.now() || !payload.uid || !payload.email) return undefined;
      const isStaff = this.staffEmails.has(payload.email.toLowerCase());
      return { uid: payload.uid, email: payload.email, emailVerified: Boolean(payload.emailVerified) || isStaff, isStaff };
    } catch {
      return undefined;
    }
  }
}
