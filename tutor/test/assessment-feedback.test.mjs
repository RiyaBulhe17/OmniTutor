import assert from "node:assert/strict";
import test from "node:test";
import { validateShortAnswerFeedback } from "../assessment-feedback.mjs";

test("accepts bounded formative feedback and trims displayed strings", () => {
  assert.deepEqual(validateShortAnswerFeedback({
    rating: "partially-correct",
    feedback: "  Explain the role of values. ",
    missingConcepts: ["  values  "],
  }), {
    rating: "partially-correct",
    feedback: "Explain the role of values.",
    missingConcepts: ["values"],
  });
});

test("rejects missing, overlong, or malformed feedback", () => {
  assert.throws(() => validateShortAnswerFeedback({ rating: "correct", feedback: "", missingConcepts: [] }), /malformed/);
  assert.throws(() => validateShortAnswerFeedback({
    rating: "incorrect", feedback: "Try again.", missingConcepts: [],
  }), /malformed/);
});
