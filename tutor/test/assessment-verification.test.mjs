import assert from "node:assert/strict";
import test from "node:test";
import { validateAnswerVerification } from "../assessment-verification.mjs";

test("requires one valid verification result per question and preserves question order", () => {
  const result = validateAnswerVerification([
    { index: 1, verified: true, reason: "Supported." },
    { index: 0, verified: false, reason: "The source does not support this key." },
  ], 2);
  assert.deepEqual(result.map((item) => item.index), [0, 1]);
  assert.equal(result[0].verified, false);
});

test("rejects incomplete, duplicate, and malformed verification results", () => {
  assert.throws(() => validateAnswerVerification([], 1), /wrong number/);
  assert.throws(() => validateAnswerVerification([
    { index: 0, verified: true, reason: "" },
    { index: 0, verified: true, reason: "" },
  ], 2), /invalid result/);
});
