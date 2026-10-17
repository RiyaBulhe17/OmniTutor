import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGroundedCitation } from "../source-citations.mjs";

const allowed = ["Lecture · p. 4", "Textbook · ch. 3"];

test("accepts a bracketed source label and removes the citation line", () => {
  assert.deepEqual(
    normalizeGroundedCitation("Answer.\nSource: [Lecture · p. 4]", allowed),
    { text: "Answer.", citations: ["Lecture · p. 4"], hadCitation: true, bracketed: true },
  );
});

test("normalizes an exact unbracketed label but rejects labels outside retrieved evidence", () => {
  assert.deepEqual(
    normalizeGroundedCitation("Answer.\nSource: Lecture · p. 4", allowed),
    { text: "Answer.", citations: ["Lecture · p. 4"], hadCitation: true, bracketed: false },
  );
  assert.deepEqual(normalizeGroundedCitation("Answer.\nSource: Invented · p. 8", allowed).citations, []);
});

test("accepts multiple exact source labels and rejects any unknown label", () => {
  assert.deepEqual(
    normalizeGroundedCitation("Answer.\nSource: Lecture · p. 4; [Textbook · ch. 3]", allowed),
    { text: "Answer.", citations: ["Lecture · p. 4", "Textbook · ch. 3"], hadCitation: true, bracketed: false },
  );
  assert.deepEqual(
    normalizeGroundedCitation("Answer.\nSource: [Lecture · p. 4]; [Textbook · ch. 3]", allowed),
    { text: "Answer.", citations: ["Lecture · p. 4", "Textbook · ch. 3"], hadCitation: true, bracketed: true },
  );
  assert.deepEqual(normalizeGroundedCitation("Answer.\nSource: [Lecture · p. 4]; [Invented]", allowed).citations, []);
});

test("does not mistake an inexact or non-final source line for a valid citation", () => {
  assert.deepEqual(normalizeGroundedCitation("Answer.\nSource: [Lecture]", allowed).citations, []);
  assert.equal(normalizeGroundedCitation("Source: [Lecture · p. 4]\nMore answer", allowed).hadCitation, false);
});
