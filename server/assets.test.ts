import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeRemoteUrl, AssetService } from "./assets/service.js";

test("asset imports block private network targets", async () => {
  await assert.rejects(() => assertSafeRemoteUrl("http://example.com/file.png"), /Only HTTPS/);
  await assert.rejects(() => assertSafeRemoteUrl("https://127.0.0.1/file.png"), /Private network/);
});

test("asset provider availability explains missing credentials", () => {
  const providers = new AssetService().providers.map((provider) => ({ id: provider.id, ...provider.available() }));
  assert.equal(providers.some((provider) => provider.id === "openverse" && provider.available), true);
  const pexels = providers.find((provider) => provider.id === "pexels");
  if (!process.env.PEXELS_API_KEY) assert.match(pexels?.reason || "", /PEXELS_API_KEY/);
});
