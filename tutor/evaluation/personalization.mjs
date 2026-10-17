import { estimateMastery, updateBktMastery } from "../learner-model.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROFILES = [
  {
    id: "new-learner",
    sessions: [
      [{ id: "attention-definition", topic: "Attention", correct: false }, { id: "qkv-basics", topic: "QKV", correct: false }],
      [{ id: "attention-weights", topic: "Attention", correct: true }, { id: "qkv-matching", topic: "QKV", correct: true }],
      [{ id: "attention-definition", topic: "Attention", correct: true }, { id: "qkv-values", topic: "QKV", correct: true }],
    ],
  },
  {
    id: "returning-learner",
    sessions: [
      [{ id: "attention-definition", topic: "Attention", correct: true }, { id: "cross-sequence", topic: "Cross-attention", correct: false }],
      [{ id: "attention-weights", topic: "Attention", correct: true }, { id: "cross-sequence", topic: "Cross-attention", correct: true }],
      [{ id: "attention-long-range", topic: "Attention", correct: true }, { id: "cross-query", topic: "Cross-attention", correct: true }],
    ],
  },
  {
    id: "struggling-learner",
    sessions: [
      [{ id: "qkv-basics", topic: "QKV", correct: false }, { id: "cross-sequence", topic: "Cross-attention", correct: false }],
      [{ id: "qkv-basics", topic: "QKV", correct: false }, { id: "cross-sequence", topic: "Cross-attention", correct: true }],
      [{ id: "qkv-values", topic: "QKV", correct: true }, { id: "cross-query", topic: "Cross-attention", correct: true }],
    ],
  },
];

export function simulateProfiles(profiles = PROFILES) {
  if (!Array.isArray(profiles) || !profiles.length) throw new TypeError("At least one simulated learner profile is required.");
  let questionCount = 0;
  let repeatedQuestionCount = 0;
  const results = profiles.map((profile) => {
    const mastery = {};
    const asked = new Set();
    const start = new Date("2026-01-01T00:00:00Z");
    const sessions = profile.sessions.map((questions, sessionIndex) => {
      if (!Array.isArray(questions)) throw new TypeError(`Profile ${profile.id} has an invalid session.`);
      const timestamp = new Date(start.getTime() + sessionIndex * 86_400_000);
      for (const question of questions) {
        if (typeof question.id !== "string" || typeof question.topic !== "string" || typeof question.correct !== "boolean") {
          throw new TypeError(`Profile ${profile.id} contains an invalid response.`);
        }
        questionCount++;
        if (asked.has(question.id)) repeatedQuestionCount++;
        asked.add(question.id);
        mastery[question.topic] = updateBktMastery(mastery[question.topic], question.correct, timestamp);
      }
      return {
        session: sessionIndex + 1,
        weakestTopic: Object.entries(mastery)
          .sort((first, second) => estimateMastery(first[1]) - estimateMastery(second[1]))[0]?.[0] || null,
      };
    });
    const topics = Object.fromEntries(Object.entries(mastery).map(([topic, record]) => [
      topic,
      {
        initialMastery: 0.2,
        finalMastery: Number(estimateMastery(record).toFixed(3)),
        gain: Number((estimateMastery(record) - 0.2).toFixed(3)),
        quizResponses: record.quizAttempts,
      },
    ]));
    return { id: profile.id, sessions, topics };
  });
  return {
    profileCount: results.length,
    questionCount,
    averageMasteryGain: Number((
      results.flatMap((profile) => Object.values(profile.topics).map((topic) => topic.gain))
        .reduce((sum, gain) => sum + gain, 0)
      / results.reduce((sum, profile) => sum + Object.keys(profile.topics).length, 0)
    ).toFixed(3)),
    questionRepetitionRate: questionCount ? Number((repeatedQuestionCount / questionCount).toFixed(3)) : 0,
    repeatedQuestionCount,
    profiles: results,
    limitation: "Synthetic response sequences illustrate model behavior; the mastery gain is not a measured learning outcome.",
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(simulateProfiles(), null, 2));
}
