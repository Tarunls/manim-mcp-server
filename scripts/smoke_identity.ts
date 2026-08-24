import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { IdentityAuthService } from "../server/auth-service.js";

async function main(): Promise<void> {
  if (!process.env.IDENTITY_PLATFORM_API_KEY?.trim())
    throw new Error(
      "IDENTITY_PLATFORM_API_KEY is required for the Identity Platform smoke test.",
    );

  const email = `lesson-studio-smoke-${randomUUID()}@example.com`;
  const password = `Smoke!${randomBytes(18).toString("base64url")}`;
  const service = new IdentityAuthService();
  let uid: string | undefined;
  try {
    const stale = (await getAuth().listUsers(1_000)).users
      .filter(
        (user) =>
          user.email?.startsWith("lesson-studio-smoke-") &&
          user.email.endsWith("@example.com"),
      )
      .map((user) => user.uid);
    if (stale.length) await getAuth().deleteUsers(stale);
    const registration = await service.signUp(email, password);
    uid = registration.user.uid;
    assert.equal(registration.verificationRequired, true);
    assert.equal(registration.user.emailVerified, false);
    await getAuth().updateUser(uid, { emailVerified: true });
    const signedIn = await service.signIn(email, password);
    assert.equal(signedIn.user.uid, uid);
    assert.equal(signedIn.user.emailVerified, true);
    const authenticated = await service.authenticate(
      `${service.cookieName}=${signedIn.sessionCookie}`,
    );
    assert.equal(authenticated?.uid, uid);
    assert.equal(authenticated?.email, email);
    console.log(
      "Identity Platform sign-up, verification gate, sign-in, and session verification passed.",
    );
  } finally {
    if (uid)
      await getAuth()
        .deleteUser(uid)
        .catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.split("\n", 1)[0]
      : "Unknown provider error";
  console.error(`Identity Platform smoke failed: ${message.slice(0, 500)}`);
  process.exitCode = 1;
});
