// Thin wrapper around Jira Cloud's REST API v3 (Basic Auth via email + API
// token). Only used when JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/
// JIRA_PROJECT_KEY are all set; otherwise the server falls back to mock data.
import { adfToText } from "./adf.js";

const TEXTY_ATTACHMENT = /\.(log|txt|json|stacktrace|out)$/i;
const MAX_ATTACHMENT_CHARS = 5000;
const MAX_ATTACHMENTS_FETCHED = 5;

export function isRealJiraConfigured() {
  return Boolean(
    process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN && process.env.JIRA_PROJECT_KEY
  );
}

function authHeader() {
  const token = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${token}`;
}

function baseUrl() {
  return process.env.JIRA_BASE_URL.replace(/\/+$/, "");
}

async function jiraFetch(pathAndQuery) {
  const res = await fetch(`${baseUrl()}${pathAndQuery}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function listTickets() {
  const jql = `project = "${process.env.JIRA_PROJECT_KEY}" ORDER BY created DESC`;
  const data = await jiraFetch(`/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=25&fields=summary,status,priority`);
  return data.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? "Unknown",
    priority: issue.fields.priority?.name ?? "Medium",
  }));
}

export async function getTicket(key) {
  const data = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,priority,reporter,created,comment`
  );
  const f = data.fields;
  return {
    key: data.key,
    summary: f.summary,
    status: f.status?.name ?? "Unknown",
    priority: f.priority?.name ?? "Medium",
    reporter: f.reporter?.displayName ?? "unknown",
    created: f.created,
    description: adfToText(f.description),
    comments: (f.comment?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? "unknown",
      timestamp: c.created,
      body: adfToText(c.body),
    })),
  };
}

export async function getLogs(key) {
  const data = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment`);
  const attachments = data.fields.attachment ?? [];
  const texty = attachments.filter((a) => TEXTY_ATTACHMENT.test(a.filename) || (a.mimeType || "").startsWith("text/"));

  const fetched = [];
  for (const att of texty.slice(0, MAX_ATTACHMENTS_FETCHED)) {
    try {
      const res = await fetch(att.content, { headers: { Authorization: authHeader() } });
      const text = await res.text();
      fetched.push({ filename: att.filename, text: text.slice(0, MAX_ATTACHMENT_CHARS) });
    } catch {
      fetched.push({ filename: att.filename, text: "(failed to fetch attachment content)" });
    }
  }

  const raw = fetched.length
    ? fetched.map((f) => `--- ${f.filename} ---\n${f.text}`).join("\n\n")
    : "(no text-like attachments found on this ticket)";

  return {
    source: attachments.length ? `${attachments.length} attachment(s) on ${key}` : `No attachments on ${key}`,
    stacktrace: fetched[0]?.text ?? "(no text-like attachments found)",
    raw,
  };
}
