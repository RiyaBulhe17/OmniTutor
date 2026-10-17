const INITIAL_KNOWLEDGE = 0.2;
const GUESS_PROBABILITY = 0.2;
const SLIP_PROBABILITY = 0.1;
const LEARNING_PROBABILITY = 0.12;
const RETENTION_THRESHOLD = 0.65;

export function estimateMastery(record) {
  return Number.isFinite(record?.pKnown) && record.pKnown >= 0 && record.pKnown <= 1
    ? record.pKnown
    : null;
}

export function updateBktMastery(record, correct, now = new Date(), evidence = "quiz") {
  if (typeof correct !== "boolean" || Number.isNaN(now.getTime())) {
    throw new TypeError("A BKT update requires a boolean response and a valid timestamp.");
  }
  if (evidence !== "quiz" && evidence !== "self-report") {
    throw new TypeError("BKT evidence must be a quiz response or an explicit learner self-report.");
  }
  const previous = estimateMastery(record) ?? INITIAL_KNOWLEDGE;
  const guessProbability = evidence === "quiz" ? GUESS_PROBABILITY : 0.35;
  const slipProbability = evidence === "quiz" ? SLIP_PROBABILITY : 0.3;
  const learningProbability = evidence === "quiz" ? LEARNING_PROBABILITY : 0.03;
  const probabilityCorrect = previous * (1 - slipProbability) + (1 - previous) * guessProbability;
  const posterior = correct
    ? (previous * (1 - slipProbability)) / probabilityCorrect
    : (previous * slipProbability) / (previous * slipProbability + (1 - previous) * (1 - guessProbability));
  const pKnown = Math.min(0.999, Math.max(0.001, posterior + (1 - posterior) * learningProbability));
  const halfLifeDays = 1 + 30 * pKnown;
  const intervalDays = pKnown <= RETENTION_THRESHOLD
    ? 1
    : Math.min(30, Math.max(1, Math.round(halfLifeDays * Math.log(pKnown / RETENTION_THRESHOLD))));
  const nextReviewAt = new Date(now.getTime() + intervalDays * 86_400_000);
  return {
    pKnown,
    attempts: (Number.isInteger(record?.attempts) ? record.attempts : 0) + 1,
    correct: (Number.isInteger(record?.correct) ? record.correct : 0) + Number(correct),
    quizAttempts: (Number.isInteger(record?.quizAttempts) ? record.quizAttempts : 0) + Number(evidence === "quiz"),
    selfReports: (Number.isInteger(record?.selfReports) ? record.selfReports : 0) + Number(evidence === "self-report"),
    lastEvidence: evidence,
    updatedAt: now.toISOString(),
    nextReviewAt: nextReviewAt.toISOString(),
  };
}

export function getDueReviewTopics(knowledge, now = new Date()) {
  if (!knowledge || typeof knowledge !== "object" || Number.isNaN(now.getTime())) return [];
  return Object.entries(knowledge)
    .filter(([, record]) => estimateMastery(record) !== null
      && typeof record.nextReviewAt === "string"
      && Date.parse(record.nextReviewAt) <= now.getTime())
    .map(([topic, record]) => ({ topic, pKnown: record.pKnown, nextReviewAt: record.nextReviewAt }))
    .sort((first, second) => first.pKnown - second.pKnown);
}
