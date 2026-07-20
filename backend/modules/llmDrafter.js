// Picks an LLM provider to draft Jira ticket fields for a log incident, with
// a deterministic rule-based draft as the final fallback so the pipeline
// always produces something usable. Tries Groq first (rarely hits the
// billing-required gotcha some Google Cloud-issued Gemini keys do), then
// Gemini, then falls back to rules.
import { isGroqConfigured, draftTicketWithGroq } from "./groqClient.js";
import { isGeminiConfigured, draftTicketWithGemini } from "./geminiClient.js";

function priorityFromLevel(level, occurrences) {
  if (level === "CRITICAL") return "Highest";
  if (level === "ERROR") return occurrences > 100 ? "Highest" : "High";
  if (level === "WARN") return "Medium";
  return "Low";
}

function draftTicketDeterministic(incident) {
  return {
    summary: `${incident.errorCode}: ${incident.message} (${incident.service})`,
    description: [
      `Detected ${incident.occurrences} occurrence(s) of ${incident.errorCode} in ${incident.service} between ${incident.firstSeen} and ${incident.lastSeen}.`,
      "",
      `Message: ${incident.message}`,
      "",
      "Sample log:",
      "```",
      incident.sample,
      "```",
    ].join("\n"),
    priority: priorityFromLevel(incident.level, incident.occurrences),
  };
}

export async function draftTicket(incident) {
  const errors = [];
  if (isGroqConfigured()) {
    try {
      const draft = await draftTicketWithGroq(incident);
      return { ...draft, draftedBy: "groq" };
    } catch (err) {
      errors.push(`Groq: ${err.message}`);
    }
  }
  if (isGeminiConfigured()) {
    try {
      const draft = await draftTicketWithGemini(incident);
      return { ...draft, draftedBy: "gemini" };
    } catch (err) {
      errors.push(`Gemini: ${err.message}`);
    }
  }
  return {
    ...draftTicketDeterministic(incident),
    draftedBy: "rules",
    ...(errors.length ? { llmError: errors.join(" | ") } : {})
  };
}
