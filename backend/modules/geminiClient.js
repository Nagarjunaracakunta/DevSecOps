// Drafts Jira ticket fields (summary/description/priority) from a log
// incident. Uses Google Gemini (free-tier API key, no billing required) when
// GEMINI_API_KEY is set; otherwise falls back to a deterministic, rule-based
// draft so the pipeline still works with zero configuration.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    description: { type: "string" },
    priority: { type: "string", enum: ["Highest", "High", "Medium", "Low"] },
  },
  required: ["summary", "description", "priority"],
};

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function isGroqConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

function buildPrompt(incident) {
  return `You are a site-reliability engineer triaging a production incident from log data. Based on the evidence below, draft a Jira ticket.

Service: ${incident.service}
Error code: ${incident.errorCode}
Log level: ${incident.level}
Occurrences: ${incident.occurrences} (first seen ${incident.firstSeen}, last seen ${incident.lastSeen})
Message: ${incident.message}

Sample log line(s):
${incident.sample}

Draft a concise one-line Jira ticket summary, a description (2-4 sentences explaining likely impact and root cause for an engineer who hasn't seen the raw logs), and a priority (Highest/High/Medium/Low) based on severity and occurrence count.`;
}

async function draftTicketWithGemini(incident) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(incident) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return JSON.parse(text);
}

async function draftTicketWithGroq(incident) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON with summary, description, and priority (Highest, High, Medium, or Low)." },
        { role: "user", content: buildPrompt(incident) }
      ]
    })
  });
  if (!res.ok) throw new Error(`Groq API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no content");
  return JSON.parse(text);
}

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
      return { ...(await draftTicketWithGroq(incident)), draftedBy: "groq" };
    } catch (err) {
      errors.push(`Groq: ${err.message}`);
    }
  }
  if (isGeminiConfigured()) {
    try {
      return { ...(await draftTicketWithGemini(incident)), draftedBy: "gemini" };
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
