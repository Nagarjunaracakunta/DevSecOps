import { getTicket, getLogs, getBundledDemoEvidence } from "./mcpJiraClient.js";
import { normalizeEvidence } from "./evidenceNormalizer.js";
import { createWorkspace, cleanupWorkspace } from "./workspaceManager.js";
import { runVerification } from "./verificationRunner.js";
import { investigate, generateRegressionTest, generatePatch, review, codexMode } from "./codexRepairAgent.js";
import { runStore } from "./runStore.js";
import { SEC_103 } from "./demoScenarios.js";

const EVENTS = {
  collecting_evidence: "codex:evidence-collected",
  creating_workspace: "codex:workspace-created",
  root_cause_found: "codex:root-cause-found",
  generating_test: "codex:test-generated",
  incident_reproduced: "codex:incident-reproduced",
  generating_patch: "codex:patch-generated",
  verifying: "codex:verification-complete",
  reviewing: "codex:review-complete",
  awaiting_approval: "codex:awaiting-approval",
  completed: "codex:pr-created",
  failed: "codex:run-failed",
  reproduction_failed: "codex:run-failed"
};

function safeRun(run) {
  const safe = { ...run };
  delete safe.workspace;
  delete safe.runRoot;
  return safe;
}

export function buildRunEvent(run, message, evidence = {}) {
  return {
    runId: run.id,
    stage: run.status,
    message,
    evidence,
    timestamp: new Date().toISOString()
  };
}

function emit(io, event, run, message, evidence = {}) {
  io.emit(event, buildRunEvent(run, message, evidence));
}

function transition(io, runId, status, patch, message, evidence) {
  const run = runStore.transition(runId, status, patch);
  const event = EVENTS[status];
  if (event) emit(io, event, run, message, evidence);
  return run;
}

export function publicRun(run) {
  return safeRun(run);
}

export async function collectSec103Evidence({
  getTicketFn = getTicket,
  getLogsFn = getLogs,
  getBundledDemoEvidenceFn = getBundledDemoEvidence
} = {}) {
  try {
    const [ticket, logs] = await Promise.all([
      getTicketFn(SEC_103.ticketKey),
      getLogsFn(SEC_103.ticketKey)
    ]);
    return {
      ticket,
      logs,
      source: { type: "jira", mode: "configured-provider" }
    };
  } catch (error) {
    const bundled = await getBundledDemoEvidenceFn(SEC_103.ticketKey);
    return {
      ...bundled,
      source: {
        type: "bundled-demo",
        mode: "SEC-103 fallback",
        reason: error.message
      }
    };
  }
}

export async function executeRun(runId, io) {
  let workspaceInfo;
  try {
    let run = transition(io, runId, "collecting_evidence", {}, "Collecting Jira, log, and scanner evidence");
    const collected = await collectSec103Evidence();
    const evidence = normalizeEvidence({
      ...collected,
      findings: [SEC_103.finding],
      scenario: SEC_103
    });
    run = runStore.update(runId, { evidence });
    const sourceMessage = evidence.source.type === "bundled-demo"
      ? "SEC-103 was unavailable in configured Jira; using the bundled demo evidence"
      : "SEC-103 evidence collected from configured Jira";
    emit(io, "codex:evidence-collected", run, `${sourceMessage} and secrets redacted`, {
      source: evidence.source,
      ticket: evidence.ticket,
      relevantLog: evidence.logs.raw
    });

    run = transition(io, runId, "creating_workspace", {}, "Creating an isolated repository clone");
    workspaceInfo = await createWorkspace(runId, SEC_103);
    const installResult = await runVerification("ci", workspaceInfo.workspace);
    if (!installResult.passed) throw new Error("Unable to install locked target dependencies");
    run = runStore.update(runId, { ...workspaceInfo, repositoryUrl: workspaceInfo.source, baseCommitSha: workspaceInfo.baseCommitSha, installResult });
    emit(io, "codex:workspace-created", run, "Dedicated target cloned and locked dependencies installed", { baseCommitSha: workspaceInfo.baseCommitSha, installResult });

    run = transition(io, runId, "investigating", {}, "OpenAI Codex is investigating without modifying files");
    const rootCause = await investigate({ workspace: workspaceInfo.workspace, evidence });
    run = transition(io, runId, "root_cause_found", { rootCause, affectedFiles: rootCause.affectedFiles }, "Root cause connected to production evidence", rootCause);

    run = transition(io, runId, "generating_test", {}, "Generating a focused SEC-103 regression test");
    const generatedTest = await generateRegressionTest({ workspace: workspaceInfo.workspace, evidence });
    emit(io, "codex:test-generated", run, "Regression test added without changing application code", generatedTest);
    const beforePatchTest = await runVerification("regression", workspaceInfo.workspace);
    if (beforePatchTest.passed) {
      transition(io, runId, "reproduction_failed", { beforePatchTest, error: { message: "Regression test unexpectedly passed before patch" } }, "Incident could not be reproduced", { beforePatchTest });
      return;
    }
    run = transition(io, runId, "incident_reproduced", { beforePatchTest }, "Regression test failed against the vulnerable base as expected", { beforePatchTest });

    run = transition(io, runId, "generating_patch", {}, "Generating the smallest safe patch");
    await generatePatch({ workspace: workspaceInfo.workspace, evidence });
    const diffResult = await runVerification("diff", workspaceInfo.workspace);
    const statusResult = await runVerification("status", workspaceInfo.workspace);
    const filesChanged = statusResult.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
    const generatedDiff = diffResult.stdout;
    if (!generatedDiff.trim() || filesChanged.length > 5 || generatedDiff.split("\n").length > 300) {
      throw new Error("Patch is empty or exceeds configured size limits");
    }
    emit(io, "codex:patch-generated", run, "Codex generated a bounded two-file repair", { filesChanged, generatedDiff });

    run = transition(io, runId, "verifying", { generatedDiff, filesChanged }, "Running independent verification");
    const [afterPatchTest, fullTestResult, lintResult, securityResult] = await Promise.all([
      runVerification("regression", workspaceInfo.workspace),
      runVerification("test", workspaceInfo.workspace),
      runVerification("lint", workspaceInfo.workspace),
      runVerification("security", workspaceInfo.workspace)
    ]);
    if (!afterPatchTest.passed || !fullTestResult.passed || !lintResult.passed) {
      throw new Error("Post-patch verification failed");
    }
    run = runStore.update(runId, { afterPatchTest, fullTestResult, lintResult, securityResult });
    emit(io, "codex:verification-complete", run, "Regression, full suite, and lint verification completed", { afterPatchTest, fullTestResult, lintResult, securityResult });

    run = transition(io, runId, "reviewing", {}, "Performing a restricted independent review");
    const reviewResult = await review({ workspace: workspaceInfo.workspace, evidence, diff: generatedDiff, results: { beforePatchTest, afterPatchTest, fullTestResult, lintResult, securityResult } });
    if (!reviewResult.passed) throw new Error("Independent review found a critical problem");
    run = runStore.update(runId, { reviewResult, codexMode: codexMode() });
    emit(io, "codex:review-complete", run, "Independent review found no critical blocker", reviewResult);
    transition(io, runId, "awaiting_approval", {}, "Verified patch is awaiting explicit human approval");
  } catch (error) {
    const current = runStore.get(runId);
    if (current && !["failed", "reproduction_failed"].includes(current.status)) {
      try {
        transition(io, runId, "failed", { error: { message: error.message } }, error.message);
      } catch {
        runStore.update(runId, { status: "failed", error: { message: error.message } });
      }
    }
    if (workspaceInfo?.runRoot) await cleanupWorkspace(workspaceInfo.runRoot).catch(() => {});
  }
}
