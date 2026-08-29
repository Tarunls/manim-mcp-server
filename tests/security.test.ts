import assert from "node:assert/strict";
import test from "node:test";
import type express from "express";

import { csrfCookieName, ensureCsrfToken, requestContext, verifyMutationRequest } from "../server/security.js";

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

test("mutation requests require the exact configured origin", () => {
  const previousBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://studio.example.com";
  const token = "a".repeat(43);
  try {
    for (const [origin, expectedStatus, expectedNext] of [
      ["https://studio.example.com", 0, true],
      ["https://studio.example.com.evil.test", 403, false],
      ["http://studio.example.com", 403, false],
      [undefined, 403, false],
    ] as const) {
      let status = 0;
      let nextCalled = false;
      const request = {
        method: "POST",
        header(name: string) {
          if (name === "origin") return origin;
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
      assert.equal(status, expectedStatus);
      assert.equal(nextCalled, expectedNext);
    }
  } finally {
    if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBaseUrl;
  }
});

test("request context echoes well-formed caller IDs", () => {
  let header = "";
  let nextCalled = false;
  const requestId = "trace_1234-ABC";
  const request = { header: () => requestId } as unknown as express.Request;
  const response = {
    locals: {},
    setHeader(_name: string, value: string) { header = value; },
  } as unknown as express.Response;
  requestContext(request, response, () => { nextCalled = true; });
  assert.equal(header, requestId);
  assert.equal(response.locals.requestId, header);
  assert.equal(nextCalled, true);
});

test("request context replaces malformed caller IDs instead of reflecting them", () => {
  for (const hostile of ["r".repeat(256), "bad\r\nSet-Cookie: x=1", "", "id with spaces"]) {
    let header = "";
    const request = { header: () => hostile || undefined } as unknown as express.Request;
    const response = {
      locals: {},
      setHeader(_name: string, value: string) { header = value; },
    } as unknown as express.Response;
    requestContext(request, response, () => undefined);
    assert.notEqual(header, hostile);
    assert.match(header, /^[0-9a-f-]{36}$/);
  }
});
