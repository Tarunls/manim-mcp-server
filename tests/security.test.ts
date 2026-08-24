import assert from "node:assert/strict";
import test from "node:test";
import type express from "express";

import { csrfCookieName, ensureCsrfToken, verifyMutationRequest } from "../server/security.js";

test("CSRF tokens are issued with restrictive cookie settings", () => {
  let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined;
  const request = { header: () => undefined } as unknown as express.Request;
  const response = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookie = { name, value, options };
    },
  } as unknown as express.Response;

  const token = ensureCsrfToken(request, response);
  assert.equal(cookie?.name, csrfCookieName);
  assert.equal(cookie?.value, token);
  assert.equal(cookie?.options.sameSite, "strict");
  assert.equal(cookie?.options.path, "/");
});

test("mutation requests require matching cookie and header tokens", () => {
  const token = "a".repeat(43);
  let status = 0;
  let nextCalled = false;
  const request = {
    method: "POST",
    header(name: string) {
      if (name === "cookie") return `${csrfCookieName}=${token}`;
      if (name === "x-csrf-token") return token;
      return undefined;
    },
  } as unknown as express.Request;
  const response = {
    status(value: number) { status = value; return this; },
    json() { return this; },
  } as unknown as express.Response;

  verifyMutationRequest(request, response, () => { nextCalled = true; });
  assert.equal(status, 0);
  assert.equal(nextCalled, true);
});

test("mutation requests reject mismatched CSRF tokens", () => {
  let status = 0;
  const request = {
    method: "POST",
    header(name: string) {
      if (name === "cookie") return `${csrfCookieName}=${"a".repeat(43)}`;
      if (name === "x-csrf-token") return "b".repeat(43);
      return undefined;
    },
  } as unknown as express.Request;
  const response = {
    status(value: number) { status = value; return this; },
    json() { return this; },
  } as unknown as express.Response;

  verifyMutationRequest(request, response, () => assert.fail("request should be rejected"));
  assert.equal(status, 403);
});
