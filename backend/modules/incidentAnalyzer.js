// Loads incident/log data (mock Splunk/Elasticsearch-style entries for now)
// and drafts Jira ticket fields for each one via geminiClient. Drafts are
// cached in-memory so the confirm step (actually creating the Jira ticket)
// doesn't need to re-run the LLM or re-derive the fields.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draftTicket } from "./geminiClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_LOGS_PATH = path.join(__dirname, "..", "data", "mockLogs.json");

const draftCache = new Map(); // incident id -> { incident, ticket }

async function loadIncidents() {
  const raw = await readFile(MOCK_LOGS_PATH, "utf8");
  return JSON.parse(raw);
}

export async function scanForIncidents() {
  const incidents = await loadIncidents();
  // Sequential, not Promise.all — free-tier LLM keys have low per-minute
  // request limits, and firing every incident's draft call at once is an
  // easy way to burst past that even well under the daily quota.
  const drafts = [];
  for (const incident of incidents) {
    const ticket = await draftTicket(incident);
    const draft = { incident, ticket };
    draftCache.set(incident.id, draft);
    drafts.push(draft);
  }
  return drafts;
}

export function getDraft(incidentId) {
  return draftCache.get(incidentId);
}
