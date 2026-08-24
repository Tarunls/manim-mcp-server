import { OAuth2Client } from "google-auth-library";
import type express from "express";

const verifier = new OAuth2Client();

export async function verifyCloudTask(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_DISPATCH === "true") return next();
  const audience = process.env.GENERATION_DISPATCH_URL?.trim();
  const expectedServiceAccount = process.env.GENERATION_DISPATCH_SERVICE_ACCOUNT?.trim();
  const authorization = request.header("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!audience || !expectedServiceAccount || !token) return response.status(401).json({ error: "Unauthorized task delivery." });
  try {
    const ticket = await verifier.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || payload.email !== expectedServiceAccount) throw new Error("Unexpected task identity.");
    return next();
  } catch {
    return response.status(401).json({ error: "Unauthorized task delivery." });
  }
}
