#!/usr/bin/env node
// Standalone MCP server exposing mock Jira data over stdio. Any MCP client
// (Claude Code, Claude Desktop, or this project's backend) can connect to it
// and call list_tickets / get_ticket / get_logs without needing a real Jira
// account or network access.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICKETS_PATH = path.join(__dirname, "data", "tickets.json");

async function loadTickets() {
  const raw = await readFile(TICKETS_PATH, "utf8");
  return JSON.parse(raw);
}

const server = new McpServer({
  name: "mock-jira-mcp-server",
  version: "1.0.0",
});

server.tool(
  "list_tickets",
  "List all mock Jira tickets (key, summary, status, priority) without full detail",
  {},
  async () => {
    const tickets = await loadTickets();
    const summary = tickets.map(({ key, summary, status, priority }) => ({
      key,
      summary,
      status,
      priority,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

server.tool(
  "get_ticket",
  "Get the full description, metadata, and comment/activity history for a Jira ticket by key",
  { key: z.string().describe("Ticket key, e.g. SEC-101") },
  async ({ key }) => {
    const tickets = await loadTickets();
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
    const tickets = await loadTickets();
    const ticket = tickets.find((t) => t.key.toLowerCase() === key.toLowerCase());
    if (!ticket) {
      return { content: [{ type: "text", text: `No ticket found with key ${key}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(ticket.logs, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("mock-jira-mcp-server failed to start:", err);
  process.exit(1);
});
