import assert from "node:assert/strict";
import test from "node:test";
import { hasExpectedSignature, validateRenderMetadata } from "../server/artifact-service.js";

test("render metadata rejects missing, non-finite, and unreasonable durations", () => {
  assert.equal(validateRenderMetadata({ duration: 12.5, renderer: "composite", fps: 30 }).duration, 12.5);
  assert.throws(() => validateRenderMetadata({ renderer: "composite" }), /duration/);
  assert.throws(() => validateRenderMetadata({ duration: Number.NaN }), /duration/);
  assert.throws(() => validateRenderMetadata({ duration: 4_000 }), /duration/);
  assert.throws(() => validateRenderMetadata({ duration: 2, renderer: "shell" }), /renderer/);
});

test("artifact signatures reject files disguised by content type", () => {
  assert.equal(hasExpectedSignature("video", Buffer.from("....ftypisom")), true);
  assert.equal(hasExpectedSignature("video", Buffer.from("not an mp4")), false);
  assert.equal(hasExpectedSignature("source_archive", Buffer.from([0x1f, 0x8b, 0x08])), true);
  assert.equal(hasExpectedSignature("poster", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(hasExpectedSignature("metadata", Buffer.from('{"duration":10}')), true);
  assert.equal(hasExpectedSignature("metadata", Buffer.from('{"duration":0}')), false);
});
