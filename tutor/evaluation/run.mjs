import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { retrieveSourceEvidence } from "../retrieval.mjs";
import { simulateProfiles } from "./personalization.mjs";
import { normalizeGroundedCitation } from "../source-citations.mjs";

const benchmarkPath = new URL("./dataset.json", import.meta.url);
const benchmark = JSON.parse(await readFile(benchmarkPath, "utf8"));
const live = process.argv.includes("--live");
const baseUrl = process.env.FOLIO_URL || "http://127.0.0.1:5173";
const fallbackModel = "qwen2.5:3b";
const model = "gemini-flash-lite-latest";
const judgeSchema = {
  type: "object",
  required: ["faithfulness", "answer_relevancy", "citation_accuracy", "unsupported_claims"],
  additionalProperties: false,
  properties: {
    faithfulness: { type: "number", minimum: 0, maximum: 1 },
    answer_relevancy: { type: "number", minimum: 0, maximum: 1 },
    citation_accuracy: { type: "number", minimum: 0, maximum: 1 },
    unsupported_claims: { type: "boolean" },
  },
};

async function askFolio(messages, json = false, format) {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      fallbackModel,
      messages,
      json,
      ...(format ? { format } : {}),
      maxOutputTokens: 1200,
    }),
    signal: AbortSignal.timeout(125_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Folio evaluation request failed with HTTP ${response.status}.`);
  if (typeof payload.content !== "string" || !payload.content.trim()) {
    throw new Error("The configured model returned an empty evaluation response.");
  }
  return {
    content: payload.content,
    provider: payload.provider || "unknown",
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

const cases = [];
for (const item of benchmark.cases) {
  const evidence = retrieveSourceEvidence(item.question, benchmark.sources);
  const returnedIds = new Set(evidence.map((entry) => entry.source.id));
  const expected = new Set(item.relevantSources);
  const relevantRetrieved = [...expected].filter((id) => returnedIds.has(id)).length;
  const expectedEvidence = item.relevantEvidence || [];
  const expectedFragments = expectedEvidence.map((fragment) => fragment.toLowerCase());
  const matchingRetrieved = evidence.filter((entry) =>
    expectedFragments.some((fragment) => entry.text.toLowerCase().includes(fragment)));
  const relevantEvidence = expectedFragments.length
    ? matchingRetrieved.length
    : evidence.filter((entry) => expected.has(entry.source.id)).length;
  const contextPrecision = evidence.length
    ? relevantEvidence / evidence.length
    : expected.size === 0 ? 1 : 0;
  const contextRecall = expectedFragments.length
    ? new Set(matchingRetrieved.flatMap((entry) =>
      expectedFragments.filter((fragment) => entry.text.toLowerCase().includes(fragment)))).size / expectedFragments.length
    : expected.size
    ? relevantRetrieved / expected.size
    : evidence.length ? 0 : 1;
  const row = {
    id: item.id,
    offMaterial: Boolean(item.offMaterial),
    retrieved: evidence.map((entry) => entry.source.id),
    contextPrecision,
    contextRecall,
    refusedBeforeGeneration: evidence.length === 0,
  };
  if (live && !item.offMaterial && evidence.length) {
    const context = evidence.map((entry) => `[Source: ${entry.citation}]\n${entry.text}`).join("\n\n");
    const answerResult = await askFolio([
      {
        role: "system",
        content: `Answer only from the evidence below. If it does not support an answer, clearly say so. End with a source line formatted "Source: [exact source label]" or, when multiple sources directly support the answer, "Source: [exact label]; [exact label]". Use only the exact labels supplied below.\n\nEvidence:\n${context}`,
      },
      { role: "user", content: item.question },
    ]);
    const answer = answerResult.content;
    const citation = normalizeGroundedCitation(answer, [...new Set(evidence.map((entry) => entry.citation))]);
    const judgeResult = await askFolio([
      {
        role: "system",
        content: "You are a conservative RAG evaluation judge. Score the answer against only the supplied context and reference answer. Faithfulness is the proportion of answer claims directly supported by context. Answer relevancy measures whether it answers the question. Citation accuracy is 1 only when every cited exact source label supports the answer; otherwise 0. The cited source labels are supplied as a list. Return only the requested JSON; do not reward plausible outside facts.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question: item.question,
          referenceAnswer: item.referenceAnswer,
          context,
          answer: citation.text,
          citedSources: citation.citations,
          sourceLineFormatCompliant: citation.bracketed,
          relevantSourceLabels: evidence.filter((entry) => expected.has(entry.source.id)).map((entry) => entry.citation),
        }),
      },
    ], true, judgeSchema);
    let judged;
    try {
      judged = JSON.parse(judgeResult.content);
    } catch {
      throw new Error(`The evaluation judge returned invalid JSON for case ${item.id}.`);
    }
    for (const metric of ["faithfulness", "answer_relevancy", "citation_accuracy"]) {
      if (!Number.isFinite(judged[metric]) || judged[metric] < 0 || judged[metric] > 1) {
        throw new Error(`The evaluation judge returned an invalid ${metric} for case ${item.id}.`);
      }
    }
    row.answer = answer;
    row.answerProvider = answerResult.provider;
    row.judgeProvider = judgeResult.provider;
    row.faithfulness = judged.faithfulness;
    row.answerRelevancy = judged.answer_relevancy;
    row.citationAccuracy = judged.citation_accuracy;
    row.citationFormatCompliant = citation.bracketed;
    row.citationLabelMatchesExpected = citation.citations.length > 0
      && citation.citations.every((label) => evidence.some((entry) =>
        entry.citation === label && expected.has(entry.source.id)));
    row.unsupportedClaims = Boolean(judged.unsupported_claims);
  }
  cases.push(row);
}

const answerable = cases.filter((item) => !item.offMaterial);
const offMaterial = cases.filter((item) => item.offMaterial);
const report = {
  benchmark: benchmark.name,
  version: benchmark.version,
  generatedAt: new Date().toISOString(),
  mode: live ? "live model-judged" : "retrieval-only",
  model: live ? model : null,
  ...(live ? {
    providerUsage: {
      answers: Object.fromEntries(["gemini", "ollama", "unknown"].map((provider) => [
        provider,
        answerable.filter((item) => item.answerProvider === provider).length,
      ])),
      judges: Object.fromEntries(["gemini", "ollama", "unknown"].map((provider) => [
        provider,
        answerable.filter((item) => item.judgeProvider === provider).length,
      ])),
    },
  } : {}),
  caseCount: cases.length,
  personalization: simulateProfiles(),
  metrics: {
    contextPrecisionAt6: average(cases.map((item) => item.contextPrecision)),
    contextRecallAt6: average(answerable.map((item) => item.contextRecall)),
    offMaterialRefusalRate: offMaterial.length
      ? offMaterial.filter((item) => item.refusedBeforeGeneration).length / offMaterial.length
      : null,
    ...(live ? {
      faithfulness: average(answerable.map((item) => item.faithfulness)),
      answerRelevancy: average(answerable.map((item) => item.answerRelevancy)),
      citationAccuracy: average(answerable.map((item) => item.citationAccuracy)),
      citationLabelAccuracy: average(answerable.map((item) => Number(item.citationLabelMatchesExpected))),
      citationFormatCompliance: average(answerable.map((item) => Number(item.citationFormatCompliant))),
      unsupportedAnswerRate: answerable.filter((item) => item.unsupportedClaims).length / answerable.length,
    } : {}),
  },
  cases,
  limitations: [
    "This small, synthetic benchmark is a smoke/evaluation set, not a representative learner study.",
    "Faithfulness, answer relevancy, and citation accuracy use an LLM judge and require human review before claiming a formal score.",
    "Context precision and recall use annotated evidence fragments, not a human-reviewed RAGAS/DeepEval/TruLens run.",
    "The deterministic off-material test measures Folio's lexical retrieval gate, not every natural-language paraphrase.",
  ],
};

const outputPath = process.argv.find((argument) => argument.startsWith("--out="))?.slice(6);
if (outputPath) {
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report, null, 2));
