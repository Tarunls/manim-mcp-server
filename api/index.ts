import type { VercelRequest, VercelResponse } from "@vercel/node";

// Serverless instances see a read-only repo; mutable project artifacts go to
// /tmp. Must be set before the server module initializes its stores.
process.env.STUDIO_DATA_ROOT ??= "/tmp/lesson-studio-data";

export const maxDuration = 300;

let ready = false;
let appPromise: Promise<import("express").Express> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = import("../server/index.js").then(async (m) => {
      await m.initializeStudio();
      ready = true;
      return m.studioApp;
    });
  }
  return appPromise;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const app = await getApp();
  return new Promise<void>((resolve) => {
    response.on("close", resolve);
    app(request as never, response as never);
  });
}
