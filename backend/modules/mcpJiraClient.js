// Connects to the standalone jira-mcp-server (in ../../mcp-jira-server) over
// stdio using the MCP SDK client, and exposes plain async functions the rest
// of the backend can call without knowing anything about MCP.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_ENTRY = path.resolve(__dirname, "..", "..", "mcp-jira-server", "index.js");

let clientPromise = null;

function connect() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [MCP_SERVER_ENTRY],
        // The SDK spawns with a restricted default environment (PATH/HOME/etc
        // only) unless env is passed explicitly — without this, JIRA_* creds
        // set on the backend process would silently never reach this
        // subprocess, and real-Jira mode would fall back to mock data.
        env: { ...process.env },
      });
      const client = new Client({ name: "devsecops-copilot-backend", version: "1.0.0" });
      await client.connect(transport);
      return client;
    })();
  }
  return clientPromise;
}

function textFromResult(result) {
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error("MCP tool returned no text content");
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

export async function listTickets() {
  const client = await connect();
  const result = await client.callTool({ name: "list_tickets", arguments: {} });
  return textFromResult(result);
}

export async function getTicket(key) {
  const client = await connect();
  const result = await client.callTool({ name: "get_ticket", arguments: { key } });
  return textFromResult(result);
}

export async function getLogs(key) {
  const client = await connect();
  const result = await client.callTool({ name: "get_logs", arguments: { key } });
  return textFromResult(result);
}
