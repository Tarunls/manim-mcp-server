import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type express from "express";

export const csrfCookieName = "lesson_studio_csrf";

function cookies(header: string | undefined) {
  return new Map((header || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), part.slice(separator + 1)];
  }));
}

export function ensureCsrfToken(request: express.Request, response: express.Response) {
  const existing = cookies(request.header("cookie")).get(csrfCookieName);
  if (existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing)) return existing;
  const token = randomBytes(32).toString("base64url");
  response.cookie(csrfCookieName, token, {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60 * 1_000,
  });
  return token;
}

function equal(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMutationRequest(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const expectedOrigin = process.env.APP_BASE_URL?.trim();
  const origin = request.header("origin");
  if (expectedOrigin) {
    try {
      if (!origin || new URL(origin).origin !== new URL(expectedOrigin).origin) {
        return response.status(403).json({ error: "This request came from an untrusted origin." });
      }
    } catch {
      return response.status(403).json({ error: "This request came from an untrusted origin." });
    }
  }
  const cookieToken = cookies(request.header("cookie")).get(csrfCookieName) || "";
  const headerToken = request.header("x-csrf-token") || "";
  if (!cookieToken || !headerToken || !equal(cookieToken, headerToken)) {
    return response.status(403).json({ error: "Refresh the page and try again." });
  }
  next();
}

export function requestContext(request: express.Request, response: express.Response, next: express.NextFunction) {
  const requestId = request.header("x-request-id")?.slice(0, 128) || randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  next();
}

export function privacySafeIpHash(request: express.Request) {
  const secret = process.env.AUDIT_HASH_SECRET || (process.env.NODE_ENV === "production" ? "" : "development-only");
  if (!secret) throw new Error("AUDIT_HASH_SECRET is required in production.");
  return createHash("sha256").update(`${secret}:${request.ip}`).digest("hex");
}
