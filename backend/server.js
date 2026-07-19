import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { startWatching } from "./modules/codeAnalyzer.js";
import { listTickets, getTicket, getLogs, createTicket } from "./modules/mcpJiraClient.js";
import { createFixPr } from "./modules/prBot.js";
import { scanForIncidents, getDraft } from "./modules/incidentAnalyzer.js";
import { validateRunRequest, SEC_103 } from "./modules/demoScenarios.js";
import { runStore } from "./modules/runStore.js";
import { executeRun, publicRun } from "./modules/codexWorker.js";
import { publishVerifiedRun } from "./modules/githubPublisher.js";
import { cleanupWorkspace } from "./modules/workspaceManager.js";

function normalizeOrigin(raw) {
  if (!raw || raw === "*") return "*";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCH_DIR = path.join(__dirname, "watched-repo");
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = normalizeOrigin(process.env.CORS_ORIGIN);

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CORS_ORIGIN } });

const latestFindingsByFile = new Map();
const runCreationByIp = new Map();

function canCreateRun(ip) {
  const now = Date.now();
  const recent = (runCreationByIp.get(ip) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 3) return false;
  runCreationByIp.set(ip, [...recent, now]);
  return true;
}

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

app.post("/api/incidents/scan", async (_req, res) => {
  try {
    const drafts = await scanForIncidents();
    res.json(drafts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/incidents/:id/create-ticket", async (req, res) => {
  const draft = getDraft(req.params.id);
  if (!draft) {
    res.status(404).json({ error: `No scanned incident found with id ${req.params.id}. Run a scan first.` });
    return;
  }
  try {
    const result = await createTicket(draft.ticket);
    const payload = { incidentId: req.params.id, incident: draft.incident, ticket: draft.ticket, ...result };
    io.emit("incident:ticket-created", payload);
    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/codex/runs", (req, res) => {
  try {
    if (!canCreateRun(req.ip)) {
      res.status(429).json({ error: "Run creation limit reached. Try again in one minute." });
      return;
    }
    const scenario = validateRunRequest(req.body);
    const run = runStore.create({
      ticketKey: scenario.ticketKey,
      scenarioId: scenario.id,
      repositoryUrl: process.env.CODEX_TARGET_REPOSITORY || scenario.repositoryPath
    });
    emitRunStarted(run);
    res.status(202).json(publicRun(run));
    setImmediate(() => executeRun(run.id, io));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/codex/runs/:runId", (req, res) => {
  const run = runStore.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(publicRun(run));
});

app.post("/api/codex/runs/:runId/approve", (req, res) => {
  const run = runStore.get(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.status !== "awaiting_approval") return res.status(409).json({ error: "Run is not awaiting approval" });
  res.json(publicRun(runStore.update(run.id, { approved: true, approvedAt: new Date().toISOString() })));
});

app.post("/api/codex/runs/:runId/reject", async (req, res) => {
  try {
    const run = runStore.get(req.params.runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    if (run.status !== "awaiting_approval") return res.status(409).json({ error: "Run is not awaiting approval" });
    const rejected = runStore.transition(run.id, "rejected", { rejectedAt: new Date().toISOString() });
    await cleanupWorkspace(run.runRoot);
    res.json(publicRun(rejected));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/codex/runs/:runId/open-pr", async (req, res) => {
  try {
    const existing = runStore.get(req.params.runId);
    if (!existing) return res.status(404).json({ error: "Run not found" });
    if (!existing.approved) return res.status(403).json({ error: "Human approval is required" });
    const publishing = runStore.transition(existing.id, "publishing");
    const pullRequest = await publishVerifiedRun(publishing);
    const completed = runStore.transition(existing.id, "completed", {
      pullRequestUrl: pullRequest.url,
      pullRequest
    });
    io.emit("codex:pr-created", {
      runId: completed.id,
      stage: completed.status,
      message: pullRequest.dryRun ? "Dry-run pull request prepared" : "Pull request created",
      evidence: pullRequest,
      timestamp: new Date().toISOString()
    });
    await cleanupWorkspace(existing.runRoot);
    res.json(publicRun(completed));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/codex/runs/:runId", async (req, res) => {
  const run = runStore.get(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  await cleanupWorkspace(run.runRoot).catch(() => {});
  runStore.delete(run.id);
  res.status(204).end();
});

function emitRunStarted(run) {
  io.emit("codex:run-started", {
    runId: run.id,
    stage: run.status,
    message: `SEC-103 run queued for ${SEC_103.id}`,
    evidence: { ticketKey: run.ticketKey, scenarioId: run.scenarioId },
    timestamp: new Date().toISOString()
  });
}

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
