export function providerLabel(draftedBy) {
  if (draftedBy === "groq") return "Groq";
  if (draftedBy === "gemini") return "Gemini";
  return "rule-based fallback";
}

export function requestStateMessage({ loading, error, emptyMessage }) {
  if (loading) return "Loading…";
  if (error) return error;
  return emptyMessage;
}
