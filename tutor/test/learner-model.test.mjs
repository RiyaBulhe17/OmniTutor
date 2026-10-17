import assert from "node:assert/strict";
import test from "node:test";
import { estimateMastery, getDueReviewTopics, updateBktMastery } from "../learner-model.mjs";

test("BKT starts from a cautious prior and learns from repeated correct responses", () => {
  const first = updateBktMastery(null, true, new Date("2026-01-01T00:00:00Z"));
  const second = updateBktMastery(first, true, new Date("2026-01-02T00:00:00Z"));
  assert.ok(first.pKnown > 0.2 && first.pKnown < 0.7);
  assert.ok(second.pKnown > first.pKnown);
  assert.equal(second.quizAttempts, 2);
  assert.equal(second.selfReports, 0);
});

test("an incorrect quiz response lowers estimated mastery and moves review sooner", () => {
  const known = { pKnown: 0.8, attempts: 3, quizAttempts: 3, selfReports: 0, correct: 3 };
  const after = updateBktMastery(known, false, new Date("2026-01-01T00:00:00Z"));
  assert.ok(after.pKnown < known.pKnown);
  assert.ok(Date.parse(after.nextReviewAt) <= Date.parse(known.nextReviewAt || "2026-02-01T00:00:00Z"));
  assert.equal(after.lastEvidence, "quiz");
});

test("tutoring self-reports are stored separately and have less influence than quiz evidence", () => {
  const prior = { pKnown: 0.5, attempts: 2, quizAttempts: 2, selfReports: 0, correct: 1 };
  const fromQuiz = updateBktMastery(prior, true, new Date("2026-01-01T00:00:00Z"));
  const fromSelfReport = updateBktMastery(prior, true, new Date("2026-01-01T00:00:00Z"), "self-report");
  assert.ok(fromSelfReport.pKnown > prior.pKnown);
  assert.ok(fromSelfReport.pKnown < fromQuiz.pKnown);
  assert.equal(fromSelfReport.quizAttempts, 2);
  assert.equal(fromSelfReport.selfReports, 1);
});

test("due-review scheduling returns only topics whose forgetting-curve review is due", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const topics = {
    overdue: { pKnown: 0.4, nextReviewAt: "2026-01-09T00:00:00Z" },
    upcoming: { pKnown: 0.8, nextReviewAt: "2026-01-12T00:00:00Z" },
    invalid: { pKnown: 1.5, nextReviewAt: "2026-01-01T00:00:00Z" },
  };
  assert.deepEqual(getDueReviewTopics(topics, now).map((item) => item.topic), ["overdue"]);
  assert.equal(estimateMastery(topics.invalid), null);
});

test("rejects invalid BKT evidence instead of silently corrupting the model", () => {
  assert.throws(() => updateBktMastery(null, "yes"), /boolean response/i);
  assert.throws(() => updateBktMastery(null, true, new Date(), "guess"), /evidence/i);
});
