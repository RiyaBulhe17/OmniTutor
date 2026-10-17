import assert from "node:assert/strict";
import test from "node:test";
import { summarizeQuizResponses } from "../assessment-results.mjs";

test("keeps learner self-checks out of objectively graded quiz scores", () => {
  assert.deepEqual(summarizeQuizResponses([
    { evidenceType: "quiz", correct: true },
    { evidenceType: "quiz", correct: false },
    { evidenceType: "self-report", correct: true },
    { evidenceType: "self-report", correct: false },
  ]), { objectiveScore: 1, objectiveTotal: 2, selfReportCount: 2 });
});

test("reports self-check-only sessions without fabricating a score", () => {
  assert.deepEqual(summarizeQuizResponses([
    { evidenceType: "self-report", correct: true },
  ]), { objectiveScore: 0, objectiveTotal: 0, selfReportCount: 1 });
});

test("rejects malformed response collections", () => {
  assert.throws(() => summarizeQuizResponses(null), /array/);
});
