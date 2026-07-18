#!/usr/bin/env node
// MCP server exposing Jira ticket data over stdio. Uses real Jira Cloud (REST
// API v3) when JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/JIRA_PROJECT_KEY are
// all set; otherwise falls back to local mock data so the demo still runs
// with zero configuration. Any MCP client (Claude Code, Claude Desktop, or
// this project's backend) can connect and call list_tickets / get_ticket /
// get_logs.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  isRealJiraConfigured,
  listTickets as jiraListTickets,
  getTicket as jiraGetTicket,
  getLogs as jiraGetLogs,
  createTicket as jiraCreateTicket,
} from "./jiraClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICKETS_PATH = path.join(__dirname, "data", "tickets.json");

async function loadMockTickets() {
  const raw = await readFile(TICKETS_PATH, "utf8");
  return JSON.parse(raw);
}

const server = new McpServer({
  name: "jira-mcp-server",
  version: "1.0.0",
});

server.tool(
  "list_tickets",
  "List Jira tickets (key, summary, status, priority) without full detail",
  {},
  async () => {
    const tickets = isRealJiraConfigured()
      ? await jiraListTickets()
      : (await loadMockTickets()).map(({ key, summary, status, priority }) => ({ key, summary, status, priority }));
    return { content: [{ type: "text", text: JSON.stringify(tickets, null, 2) }] };
  }
);

server.tool(
  "get_ticket",
  "Get the full description, metadata, and comment/activity history for a Jira ticket by key",
  { key: z.string().describe("Ticket key, e.g. SEC-101") },
  async ({ key }) => {
    if (isRealJiraConfigured()) {
      try {
        const ticket = await jiraGetTicket(key);
        return { content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
    const tickets = await loadMockTickets();
    const ticket = tickets.find((t) => t.key.toLowerCase() === key.toLowerCase());
    if (!ticket) {
      return { content: [{ type: "text", text: `No ticket found with key ${key}` }], isError: true };
    }
    const { logs, ...ticketWithoutLogs } = ticket;
    return { content: [{ type: "text", text: JSON.stringify(ticketWithoutLogs, null, 2) }] };
  }
);

server.tool(
  "get_logs",
  "Get the attached error logs / stack trace for a Jira ticket by key",
  { key: z.string().describe("Ticket key, e.g. SEC-101") },
  async ({ key }) => {
    if (isRealJiraConfigured()) {
      try {
        const logs = await jiraGetLogs(key);
        return { content: [{ type: "text", text: JSON.stringify(logs, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
    const tickets = await loadMockTickets();
    const ticket = tickets.find((t) => t.key.toLowerCase() === key.toLowerCase());
    if (!ticket) {
      return { content: [{ type: "text", text: `No ticket found with key ${key}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(ticket.logs, null, 2) }] };
  }
);

let mockCreatedCount = 0;

server.tool(
  "create_ticket",
  "Create a new Jira ticket with the given summary, description, and priority",
  {
    summary: z.string(),
    description: z.string(),
    priority: z.string().optional().describe("e.g. Highest, High, Medium, Low"),
  },
  async ({ summary, description, priority }) => {
    if (isRealJiraConfigured()) {
      try {
        const result = await jiraCreateTicket({ summary, description, priority });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
    mockCreatedCount += 1;
    const key = `MOCK-${100 + mockCreatedCount}`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ key, url: `https://mock-jira.example.com/browse/${key}`, mock: true }, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("jira-mcp-server failed to start:", err);
  process.exit(1);
});
