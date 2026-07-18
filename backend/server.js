import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { startWatching } from "./modules/codeAnalyzer.js";
import { listTickets, getTicket, getLogs } from "./modules/mcpJiraClient.js";
import { createFixPr } from "./modules/prBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCH_DIR = path.join(__dirname, "watched-repo");
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CORS_ORIGIN } });

const latestFindingsByFile = new Map();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/tickets", async (_req, res) => {
  try {
    res.json(await listTickets());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tickets/:key", async (req, res) => {
  try {
    const [ticket, logs] = await Promise.all([getTicket(req.params.key), getLogs(req.params.key)]);
    res.json({ ...ticket, logs });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get("/api/code-findings", (_req, res) => {
  res.json(Array.from(latestFindingsByFile.values()));
});

app.post("/api/tickets/:key/create-pr", async (req, res) => {
  try {
    const result = await createFixPr(req.params.key);
    io.emit("pr:created", result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

io.on("connection", (socket) => {
  socket.emit("code:snapshot", Array.from(latestFindingsByFile.values()));
});

startWatching(WATCH_DIR, (result) => {
  latestFindingsByFile.set(result.file, result);
  io.emit("code:finding", result);
});

httpServer.listen(PORT, () => {
  console.log(`DevSecOps Copilot backend listening on http://localhost:${PORT}`);
});
