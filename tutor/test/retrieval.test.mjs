import assert from "node:assert/strict";
import test from "node:test";
import { retrieveSourceEvidence, tokenizeEvidence } from "../retrieval.mjs";

const sources = [
  {
    title: "Lecture",
    location: "Lecture · p. 4",
    content: "Self-attention lets each token weigh every other token in the same sequence. Attention scores combine queries, keys, and values.",
  },
  {
    title: "Textbook",
    location: "Textbook · ch. 3",
    content: "Positional encodings add information about token order. A transformer layer also uses residual connections and normalization.",
  },
];

test("retrieves the passage that covers a question and retains its source location", () => {
  const results = retrieveSourceEvidence("How do queries, keys, and values combine in attention?", sources);
  assert.ok(results.length > 0);
  assert.equal(results[0].citation, "Lecture · p. 4");
  assert.match(results[0].text, /queries, keys, and values/);
});

test("keeps self-attention answers focused on matching self-attention evidence", () => {
  const results = retrieveSourceEvidence("What does self-attention let each token do?", sources);
  assert.equal(results.length, 1);
  assert.equal(results[0].citation, "Lecture · p. 4");
});

test("returns no evidence for an off-material question", () => {
  assert.deepEqual(
    retrieveSourceEvidence("How do black holes evaporate through Hawking radiation?", sources),
    [],
  );
});

test("supports Unicode query terms without discarding them", () => {
  assert.ok(tokenizeEvidence("ध्यान序列").length > 0);
});

test("normalizes Q/K/V notation to the written attention terms", () => {
  assert.deepEqual(tokenizeEvidence("Q, K, and V"), ["query", "key", "value"]);
  assert.equal(retrieveSourceEvidence("Q, K, and V", sources).length > 0, true);
});

test("retrieves all query, key, and value roles when an answer spans separate passages", () => {
  const passages = [
    { title: "Lecture", content: "An input embedding is projected into a query, key, and value." },
    { title: "Video", content: "Queries are the questions asked by each token and keys help match relevant information." },
    { title: "Video", content: "Values hold the information that gets mixed together." },
  ];
  const evidence = retrieveSourceEvidence("What are query, key, and value in an attention layer?", passages, 6);
  assert.ok(evidence.some(({ text }) => /embedding is projected/i.test(text)));
  assert.ok(evidence.some(({ text }) => /queries are the questions/i.test(text)));
  assert.ok(evidence.some(({ text }) => /values hold the information/i.test(text)));
});

test("rejects invalid limits rather than returning an arbitrary context", () => {
  assert.deepEqual(retrieveSourceEvidence("attention", sources, 0), []);
});
