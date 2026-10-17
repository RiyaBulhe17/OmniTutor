export function normalizeGroundedCitation(answer, allowedCitations) {
  if (typeof answer !== "string" || !Array.isArray(allowedCitations)) {
    return { text: typeof answer === "string" ? answer : "", citations: [], hadCitation: false, bracketed: false };
  }
  const match = answer.match(/(?:^|\n)Source:\s*([^\r\n]+)\s*$/i);
  if (!match) return { text: answer, citations: [], hadCitation: false, bracketed: false };

  const parts = match[1].split(/\s*;\s*/).map((part) => {
    const bracketed = part.startsWith("[") && part.endsWith("]");
    return { label: (bracketed ? part.slice(1, -1) : part).trim(), bracketed };
  });
  const citations = parts.map((part) => allowedCitations.find((label) => label === part.label) || null);
  const validCitations = citations.length > 0 && citations.every(Boolean)
    ? [...new Set(citations)]
    : [];
  return {
    text: answer.slice(0, match.index).trim(),
    citations: validCitations,
    hadCitation: true,
    bracketed: parts.length > 0 && parts.every((part) => part.bracketed),
  };
}
