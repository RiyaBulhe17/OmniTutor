import assert from "node:assert/strict";
import test from "node:test";
import { sourceTimestampSeconds } from "../source-files.mjs";

test("parses minute-second and hour-minute-second source locations", () => {
  assert.equal(sourceTimestampSeconds("Lecture · 06:30"), 390);
  assert.equal(sourceTimestampSeconds("Recording · 00:03:44"), 224);
  assert.equal(sourceTimestampSeconds("No timestamp"), null);
});
