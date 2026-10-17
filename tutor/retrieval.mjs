const STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "between", "but", "by", "can", "could", "did",
  "do", "does", "for", "from", "give", "had", "has", "have", "he", "her", "here", "him", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "more", "most", "much", "my",
  "of", "on", "or", "our", "please", "she", "should", "so", "some", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through", "to", "us",
  "very", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your", "explain", "describe", "tell", "mean", "make", "help",
]);
const TERM_ALIASES = new Map([
  ["q", "query"], ["queries", "query"], ["question", "query"], ["questions", "query"],
  ["k", "key"], ["keys", "key"], ["matching", "match"],
  ["v", "value"], ["values", "value"], ["mixed", "value"], ["mixing", "value"],
  ["combined", "value"], ["combining", "value"],
  ["scores", "score"], ["scaled", "scale"], ["scaling", "scale"], ["heads", "head"],
]);

export function tokenizeEvidence(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((token) => TERM_ALIASES.get(token) || token)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token)) || [];
}

function sourceSentences(sources) {
  return sources.flatMap((source) => {
    if (typeof source.content !== "string" || !source.content.trim()) return [];
    return (source.content.match(/[^.!?\n]+[.!?\n]?/gu) || [])
      .map((text) => text.trim())
      .filter((text) => text.length > 12)
      .map((text) => ({
        text,
        source,
        terms: tokenizeEvidence(text),
      }));
  });
}

export function retrieveSourceEvidence(query, sources, limit = 6) {
  if (!Array.isArray(sources) || !Number.isInteger(limit) || limit < 1) return [];
  const queryTerms = [...new Set(tokenizeEvidence(query))];
  if (!queryTerms.length) return [];
  const queryText = String(query).toLowerCase().replace(/[\u2010-\u2015]/g, "-");
  const wantsCrossAttention = /\bcross[- ]attention\b/.test(queryText);
  const wantsSelfAttention = /\bself[- ]attention\b/.test(queryText);
  const hasFullQkvQuery = ["query", "key", "value"].every((term) => queryTerms.includes(term));
  const documents = sourceSentences(sources);
  if (!documents.length) return [];
  const documentFrequency = new Map(queryTerms.map((term) => [
    term,
    documents.reduce((count, document) => count + Number(document.terms.includes(term)), 0),
  ]));
  const averageLength = documents.reduce((sum, document) => sum + document.terms.length, 0) / documents.length || 1;
  const scored = documents.map((document) => {
    const frequencies = new Map();
    for (const term of document.terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    let score = 0;
    let matchedTerms = 0;
    for (const term of queryTerms) {
      const frequency = frequencies.get(term) || 0;
      if (!frequency) continue;
      matchedTerms++;
      const df = documentFrequency.get(term) || 0;
      const inverseDocumentFrequency = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + 1.5 * (1 - 0.75 + 0.75 * document.terms.length / averageLength);
      score += inverseDocumentFrequency * frequency * 2.5 / denominator;
    }
    return { ...document, score, matchedTerms };
  }).filter((item) => {
    if (item.score <= 0 || !item.matchedTerms) return false;
    const isCrossAttention = /\bcross[- ]attention\b/i.test(item.text);
    const isSelfAttention = /\bself[- ]attention\b/i.test(item.text);
    if (wantsCrossAttention && isSelfAttention && !isCrossAttention) return false;
    if (wantsSelfAttention && isCrossAttention && !isSelfAttention) return false;
    if (hasFullQkvQuery && !wantsCrossAttention && isCrossAttention) return false;
    return true;
  });

  const bestScore = Math.max(0, ...scored.map((item) => item.score));
  const relevanceFloor = hasFullQkvQuery
    ? Math.max(0.45, bestScore * 0.65)
    : Math.max(0.45, bestScore * 0.75);
  const relevant = scored
    .filter((item) => item.score >= relevanceFloor)
    .sort((first, second) => second.score - first.score || second.matchedTerms - first.matchedTerms);
  const selected = relevant.slice(0, limit);
  if (hasFullQkvQuery) {
    const roleMatchers = [
      (text) => /\bqueries?\b/i.test(text) && /\b(question|projected)\w*\b/i.test(text),
      (text) => /\bkeys?\b/i.test(text) && /\b(description|match)\w*\b/i.test(text),
      (text) => /\bvalues?\b/i.test(text) && /\b(information|mix|combin)\w*\b/i.test(text),
    ];
    for (const matchesRole of roleMatchers) {
      if (selected.some((item) => matchesRole(item.text))) continue;
      const bestForRole = scored
        .filter((item) => matchesRole(item.text))
        .sort((first, second) => second.score - first.score || second.matchedTerms - first.matchedTerms)[0];
      if (bestForRole && !selected.includes(bestForRole)) selected.push(bestForRole);
    }
  }

  return selected
    .sort((first, second) => second.score - first.score || second.matchedTerms - first.matchedTerms)
    .slice(0, limit)
    .map(({ text, source, score, matchedTerms }) => ({
      text,
      source,
      citation: source.location || source.title,
      score,
      matchedTerms,
    }));
}
