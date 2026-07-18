// Drafts Jira ticket fields (summary/description/priority) from a log
// incident using Groq's OpenAI-compatible chat completions API. Only called
// when GROQ_API_KEY is set; throws on any failure — the caller
// (llmDrafter.js) decides what to fall back to.
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function draftTicketWithGroq(incident, attempt = 1) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Respond with only a single JSON object with exactly these keys: "summary" (string), "description" (string), "priority" (one of "Highest", "High", "Medium", "Low"). No other text.',
        },
        { role: "user", content: buildPrompt(incident) },
      ],
    }),
  });

  if (res.status === 429 && attempt < 3) {
    const retryAfterSec = Number(res.headers.get("retry-after")) || attempt * 3;
    await sleep(retryAfterSec * 1000);
    return draftTicketWithGroq(incident, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no content");
  return JSON.parse(text);
}
