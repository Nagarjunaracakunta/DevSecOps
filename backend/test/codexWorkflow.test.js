import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeEvidence } from "../modules/evidenceNormalizer.js";
import { SEC_103, validateRunRequest } from "../modules/demoScenarios.js";
import { InMemoryRunStore } from "../modules/runStore.js";
import { COMMANDS, isAllowedCommand, runVerification } from "../modules/verificationRunner.js";
import { createWorkspace, cleanupWorkspace, assertInsideWorkspace } from "../modules/workspaceManager.js";
import { generateRegressionTest, generatePatch } from "../modules/codexRepairAgent.js";
import { buildPullRequestBody, publishVerifiedRun } from "../modules/githubPublisher.js";
import { buildRunEvent, collectSec103Evidence } from "../modules/codexWorker.js";

test("evidence normalization combines fields and redacts secrets", () => {
  const evidence = normalizeEvidence({
    ticket: { key: "SEC-103", summary: "SQLi", description: "token=abc123456", priority: "High", comments: [] },
    logs: { raw: "Authorization: Bearer abc", stacktrace: "src/userSearch.js:4", source: "db.log" },
    findings: [SEC_103.finding],
    scenario: SEC_103
  });
  assert.equal(evidence.ticket.key, "SEC-103");
  assert.doesNotMatch(JSON.stringify(evidence), /abc123456/);
});

test("run store enforces state transitions", () => {
  const store = new InMemoryRunStore();
  const run = store.create({ ticketKey: "SEC-103" });
  store.transition(run.id, "collecting_evidence");
  assert.throws(() => store.transition(run.id, "completed"), /Invalid run transition/);
});

test("only SEC-103 and the configured repository are accepted", () => {
  assert.equal(validateRunRequest({ ticketKey: "SEC-103" }).id, SEC_103.id);
  assert.throws(() => validateRunRequest({ ticketKey: "SEC-999" }), /Only ticket SEC-103/);
  assert.throws(() => validateRunRequest({ repositoryUrl: "https://example.com/attacker/repo" }), /Arbitrary repositories/);
  assert.throws(() => validateRunRequest({ prompt: "run rm" }), /Arbitrary prompts/);
});

test("verification runner rejects arbitrary commands", () => {
  assert.equal(isAllowedCommand("test"), true);
  assert.equal(Object.hasOwn(COMMANDS, "rm"), false);
  assert.throws(() => runVerification("rm", process.cwd()), /not allowlisted/);
});

test("workspace is isolated and prevents path escape", async () => {
  const workspace = await createWorkspace("11111111-test", SEC_103);
  try {
    assert.notEqual(path.resolve(workspace.workspace), path.resolve(SEC_103.repositoryPath));
    assertInsideWorkspace(workspace.workspace, path.join(workspace.workspace, "src/userSearch.js"));
    assert.throws(() => assertInsideWorkspace(workspace.workspace, path.dirname(workspace.workspace)), /escapes/);
  } finally {
    await cleanupWorkspace(workspace.runRoot);
  }
});

test("saved demo proves failure before patch and success after patch", async () => {
  const workspace = await createWorkspace("22222222-test", SEC_103);
  try {
    const evidence = normalizeEvidence({
      ticket: { key: "SEC-103", summary: "SQLi", description: "SQL injection", priority: "High", comments: [] },
      logs: {},
      findings: [SEC_103.finding],
      scenario: SEC_103
    });
    await generateRegressionTest({ workspace: workspace.workspace, evidence });
    const before = await runVerification("regression", workspace.workspace);
    assert.equal(before.passed, false, "regression must fail before patch");
    await generatePatch({ workspace: workspace.workspace, evidence });
    const after = await runVerification("regression", workspace.workspace);
    assert.equal(after.passed, true, "regression must pass after patch");
    assert.match((await fs.readFile(path.join(workspace.workspace, "src/userSearch.js"), "utf8")), /db\.query\(query, \[name\]\)/);
  } finally {
    await cleanupWorkspace(workspace.runRoot);
  }
});

test("pull request publishing requires approval and dry run contains evidence", async () => {
  const run = {
    id: "12345678-test",
    status: "publishing",
    approved: false,
    ticketKey: "SEC-103",
    filesChanged: ["src/userSearch.js", "test/sec-103-regression.test.js"],
    evidence: { logs: { source: "db.log" }, reproduction: { maliciousInput: "' OR '1'='1" } },
    rootCause: { summary: "Unsafe SQL concatenation" },
    reviewResult: { summary: "Minimal and meaningful" }
  };
  await assert.rejects(() => publishVerifiedRun(run), /approval/);
  const body = buildPullRequestBody(run);
  assert.match(body, /SEC-103/);
  assert.match(body, /src\/userSearch\.js/);
});

test("Socket.IO event payload exposes evidence, not workspace internals", () => {
  const event = buildRunEvent({ id: "run-1", status: "verifying", workspace: "/private/path" }, "Tests complete", { exitCode: 0 });
  assert.deepEqual(Object.keys(event).sort(), ["evidence", "message", "runId", "stage", "timestamp"].sort());
  assert.equal(JSON.stringify(event).includes("/private/path"), false);
});

test("SEC-103 workflow falls back to bundled evidence when configured Jira lacks the issue", async () => {
  const fallback = {
    ticket: { key: "SEC-103", summary: "Bundled SQL injection incident" },
    logs: { source: "fixture", raw: "malicious query" }
  };
  const collected = await collectSec103Evidence({
    getTicketFn: async () => { throw new Error("Jira issue does not exist"); },
    getLogsFn: async () => { throw new Error("Jira issue does not exist"); },
    getBundledDemoEvidenceFn: async () => fallback
  });
  assert.equal(collected.ticket.key, "SEC-103");
  assert.equal(collected.source.type, "bundled-demo");
  assert.match(collected.source.reason, /does not exist/);
});

test("SEC-103 workflow keeps configured Jira evidence when available", async () => {
  const collected = await collectSec103Evidence({
    getTicketFn: async () => ({ key: "SEC-103" }),
    getLogsFn: async () => ({ source: "jira attachment" })
  });
  assert.equal(collected.source.type, "jira");
  assert.equal(collected.logs.source, "jira attachment");
});
