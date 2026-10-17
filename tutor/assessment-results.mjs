export function summarizeQuizResponses(responses) {
  if (!Array.isArray(responses)) throw new TypeError("Quiz responses must be an array.");
  const selfReports = responses.filter((response) => response.evidenceType === "self-report");
  const objectivelyGraded = responses.filter((response) => response.evidenceType !== "self-report");
  return {
    objectiveScore: objectivelyGraded.filter((response) => response.correct === true).length,
    objectiveTotal: objectivelyGraded.length,
    selfReportCount: selfReports.length,
  };
}
