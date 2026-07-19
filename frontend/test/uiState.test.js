import test from "node:test";
import assert from "node:assert/strict";
import { providerLabel, requestStateMessage } from "../src/providerLabels.js";

test("provider labels match the actual drafting provider", () => {
  assert.equal(providerLabel("groq"), "Groq");
  assert.equal(providerLabel("gemini"), "Gemini");
  assert.equal(providerLabel("rules"), "rule-based fallback");
});

test("loading and failure states always have visible copy", () => {
  assert.equal(requestStateMessage({ loading: true }), "Loading…");
  assert.equal(requestStateMessage({ loading: false, error: "Backend unavailable" }), "Backend unavailable");
  assert.equal(requestStateMessage({ loading: false, emptyMessage: "Nothing yet" }), "Nothing yet");
});
