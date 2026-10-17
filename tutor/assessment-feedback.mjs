const RATINGS = new Set(["correct", "partially-correct", "needs-work"]);

export function validateShortAnswerFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !RATINGS.has(value.rating)
    || typeof value.feedback !== "string" || !value.feedback.trim() || value.feedback.length > 1000
    || !Array.isArray(value.missingConcepts) || value.missingConcepts.length > 4
    || value.missingConcepts.some((concept) =>
      typeof concept !== "string" || !concept.trim() || concept.length > 200)) {
    throw new Error("The AI returned malformed short-answer feedback. No feedback was accepted or saved.");
  }
  return {
    rating: value.rating,
    feedback: value.feedback.trim(),
    missingConcepts: value.missingConcepts.map((concept) => concept.trim()),
  };
}
