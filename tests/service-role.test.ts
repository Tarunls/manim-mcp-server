import assert from "node:assert/strict";
import test from "node:test";
import { routeAllowedForService } from "../server/service-role.js";

test("dispatcher exposes only health and authenticated worker routes", () => {
  assert.equal(routeAllowedForService("dispatcher", "/api/internal/generation/dispatch"), true);
  assert.equal(routeAllowedForService("dispatcher", "/api/internal/generation/reconcile"), true);
  assert.equal(routeAllowedForService("dispatcher", "/api/health/ready"), true);
  assert.equal(routeAllowedForService("dispatcher", "/api/projects"), false);
});

test("public API cannot expose dispatcher endpoints", () => {
  assert.equal(routeAllowedForService("api", "/api/internal/generation/dispatch"), false);
  assert.equal(routeAllowedForService("api", "/api/internal/generation/reconcile"), false);
  assert.equal(routeAllowedForService("api", "/api/projects"), true);
});
