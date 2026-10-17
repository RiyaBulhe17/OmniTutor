export function validateAnswerVerification(results, questionCount) {
  if (!Array.isArray(results) || results.length !== questionCount) {
    throw new Error("The answer verifier returned the wrong number of results.");
  }
  const seen = new Set();
  for (const result of results) {
    if (!result || !Number.isInteger(result.index) || result.index < 0 || result.index >= questionCount
      || seen.has(result.index) || typeof result.verified !== "boolean"
      || typeof result.reason !== "string") {
      throw new Error("The answer verifier returned an invalid result.");
    }
    seen.add(result.index);
  }
  if (seen.size !== questionCount) {
    throw new Error("The answer verifier did not check every question.");
  }
  return results.slice().sort((first, second) => first.index - second.index);
}
