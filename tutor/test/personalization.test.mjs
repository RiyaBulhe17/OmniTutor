import assert from "node:assert/strict";
import test from "node:test";
import { simulateProfiles } from "../evaluation/personalization.mjs";

test("simulates mastery progression and repeated-question rate across learner profiles", () => {
  const report = simulateProfiles();
  assert.equal(report.profileCount, 3);
  assert.equal(report.questionCount, 18);
  assert.equal(report.repeatedQuestionCount, 4);
  assert.equal(report.questionRepetitionRate, 0.222);
  assert.ok(report.averageMasteryGain > 0);
  assert.ok(report.profiles.every((profile) => profile.sessions.length === 3));
  assert.match(report.limitation, /not a measured learning outcome/);
});

test("rejects malformed profile input", () => {
  assert.throws(() => simulateProfiles([]), /At least one simulated learner profile/);
  assert.throws(() => simulateProfiles([{ id: "invalid", sessions: [null] }]), /invalid session/);
});
