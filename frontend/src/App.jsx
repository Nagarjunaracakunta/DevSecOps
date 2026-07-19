import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import OperationsDashboard from "./OperationsDashboard.jsx";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const TERMINAL = new Set(["awaiting_approval", "completed", "failed", "reproduction_failed", "rejected"]);
const TIMELINE = [
  ["collecting_evidence", "Evidence collected"],
  ["creating_workspace", "Repository cloned"],
  ["root_cause_found", "Root cause identified"],
  ["generating_test", "Regression test generated"],
  ["incident_reproduced", "Incident reproduced"],
  ["generating_patch", "Patch generated"],
  ["verifying", "Tests passed"],
  ["reviewing", "Security review completed"],
  ["awaiting_approval", "Pull request ready"]
];

async function api(path, options) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

function Result({ title, result, expectedFailure = false }) {
  if (!result) return null;
  const passed = expectedFailure ? !result.passed : result.passed;
  return (
    <section className={`story-card ${passed ? "story-pass" : "story-fail"}`}>
      <div className="story-card-heading">
        <h2>{title}</h2>
        <span>{passed ? "Passed" : "Failed"}</span>
      </div>
      <div className="command-line">$ {result.command} · exit {result.exitCode ?? "n/a"} · {result.durationMs}ms</div>
      <pre>{result.stdout || result.stderr || "No command output"}</pre>
    </section>
  );
}

function IncidentToFix() {
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("connecting");

  useEffect(() => {
    const socket = io(BACKEND_URL);
    socket.on("connect", () => setConnection("live"));
    socket.on("disconnect", () => setConnection("offline"));
    socket.on("connect_error", () => setConnection("offline"));
    const eventNames = [
      "codex:run-started", "codex:evidence-collected", "codex:workspace-created",
      "codex:root-cause-found", "codex:test-generated", "codex:incident-reproduced",
      "codex:patch-generated", "codex:verification-complete", "codex:review-complete",
      "codex:awaiting-approval", "codex:pr-created", "codex:run-failed"
    ];
    eventNames.forEach((name) => socket.on(name, (payload) => {
      setEvents((current) => current.some((item) => item.timestamp === payload.timestamp && item.stage === payload.stage)
        ? current : [...current, payload]);
      if (payload.runId) api(`/api/codex/runs/${payload.runId}`).then(setRun).catch(() => {});
    }));
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (!run || TERMINAL.has(run.status)) return undefined;
    const timer = setInterval(() => api(`/api/codex/runs/${run.id}`).then(setRun).catch((err) => setError(err.message)), 1200);
    return () => clearInterval(timer);
  }, [run]);

  const completedStatuses = useMemo(() => new Set(run?.timeline?.map((item) => item.status) || []), [run]);

  const start = async () => {
    setBusy(true);
    setError("");
    setEvents([]);
    try {
      setRun(await api("/api/codex/runs", {
        method: "POST",
        body: JSON.stringify({ ticketKey: "SEC-103", scenarioId: "sec-103-sql-injection" })
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approveAndOpen = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/codex/runs/${run.id}/approve`, { method: "POST", body: "{}" });
      setRun(await api(`/api/codex/runs/${run.id}/open-pr`, { method: "POST", body: "{}" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      setRun(await api(`/api/codex/runs/${run.id}/reject`, { method: "POST", body: "{}" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="incident-view">
      <section className="hero-card">
        <div>
          <div className="eyebrow">SEC-103 · SQL injection · High priority</div>
          <h1>Incident to Verified Fix</h1>
          <p>Production evidence becomes a reproduced test, minimal Codex patch, independent verification, and a human-approved pull request.</p>
        </div>
        <div className={`connection-chip ${connection}`}>Socket.IO {connection}</div>
        <button className="primary-action" onClick={start} disabled={busy || (run && !TERMINAL.has(run.status))}>
          {busy ? "Working…" : run ? "Run sample incident again" : "Run sample incident"}
        </button>
      </section>

      {error && <div className="workflow-error" role="alert">{error}</div>}
      {!run && !error && <section className="empty-workflow">Start the allowlisted SEC-103 scenario. No Jira or GitHub credentials are required for the saved demonstration mode.</section>}

      {run && (
        <>
          <section className="story-card incident-summary">
            <div className="story-card-heading"><h2>Incident Summary</h2><span className={`run-status status-${run.status}`}>{run.status.replaceAll("_", " ")}</span></div>
            <div className="summary-grid">
              <div><small>Ticket</small><strong>{run.ticketKey}</strong></div>
              <div><small>Scenario</small><strong>SQL injection</strong></div>
              <div><small>Evidence source</small><strong>{run.evidence?.source?.type === "bundled-demo" ? "Bundled SEC-103 demo" : "Configured Jira"}</strong></div>
              <div><small>Execution</small><strong>{run.codexMode === "live-codex" ? "OpenAI Codex live" : "Saved demonstration result"}</strong></div>
              <div><small>Base commit</small><strong>{run.baseCommitSha?.slice(0, 10) || "pending"}</strong></div>
            </div>
            {run.evidence?.source?.type === "bundled-demo" && <p className="evidence-notice">Configured Jira did not provide SEC-103, so this run uses the clearly labeled bundled demonstration evidence.</p>}
            {run.evidence?.logs?.raw && <pre>{run.evidence.logs.raw}</pre>}
          </section>

          <section className="story-card">
            <h2>Codex Run Timeline</h2>
            <ol className="run-timeline">
              {TIMELINE.map(([status, label], index) => (
                <li key={status} className={completedStatuses.has(status) ? "done" : run.status === status ? "active" : ""}>
                  <span>{completedStatuses.has(status) ? "✓" : index + 1}</span>
                  <div><strong>{label}</strong><small>{events.find((event) => event.stage === status)?.message || "Waiting"}</small></div>
                </li>
              ))}
            </ol>
          </section>

          {run.rootCause && <section className="story-card"><h2>Root Cause</h2><p>{run.rootCause.summary}</p><code>{run.affectedFiles?.join(", ")}</code></section>}
          <Result title="Regression Test Before Patch" result={run.beforePatchTest} expectedFailure />
          {run.generatedDiff && <section className="story-card"><h2>Generated Diff</h2><div className="file-pills">{run.filesChanged?.map((file) => <code key={file}>{file}</code>)}</div><pre className="diff-view">{run.generatedDiff}</pre></section>}
          <Result title="Regression Test After Patch" result={run.afterPatchTest} />
          <Result title="Complete Test Suite" result={run.fullTestResult} />
          <Result title="Lint" result={run.lintResult} />
          {run.securityResult && <Result title="Security Check" result={run.securityResult} />}
          {run.reviewResult && <section className={`story-card ${run.reviewResult.passed ? "story-pass" : "story-fail"}`}><h2>Independent Review</h2><p>{run.reviewResult.summary}</p><small>{run.reviewResult.provider}</small></section>}

          {run.status === "awaiting_approval" && (
            <section className="story-card approval-card">
              <h2>Human Approval</h2>
              <p>The verified workspace will not be published until you approve it.</p>
              <div><button className="primary-action" onClick={approveAndOpen} disabled={busy}>Approve and open PR</button><button className="reject-action" onClick={reject} disabled={busy}>Reject patch</button></div>
            </section>
          )}

          {run.status === "completed" && (
            <section className="outcome-card">
              <div className="outcome-icon">✓</div><div><div className="eyebrow">Incident resolved</div><h2>Verified pull request {run.pullRequest?.dryRun ? "preview ready" : "created"}</h2>
              <p>Root cause: SQL injection through string concatenation · Files changed: {run.filesChanged?.length} · Before patch: failed as expected · After patch: all tests passed · Security review: passed</p>
              {run.pullRequestUrl && <a href={run.pullRequestUrl} target="_blank" rel="noreferrer">View pull request</a>}
              {run.pullRequest?.dryRun && <details><summary>Dry-run pull request content</summary><pre>{run.pullRequest.body}</pre></details>}</div>
            </section>
          )}
          {["failed", "reproduction_failed", "rejected"].includes(run.status) && <section className="story-card story-fail"><h2>Run stopped</h2><p>{run.error?.message || `Run ${run.status.replaceAll("_", " ")}`}</p></section>}
        </>
      )}
    </main>
  );
}

export default function App() {
  const [view, setView] = useState("incident");
  return (
    <div>
      <nav className="view-nav" aria-label="Application views">
        <div className="brand-mark">◆ DevSecOps Copilot</div>
        <button className={view === "incident" ? "selected" : ""} onClick={() => setView("incident")}>Incident to Verified Fix</button>
        <button className={view === "operations" ? "selected" : ""} onClick={() => setView("operations")}>Operations</button>
      </nav>
      {view === "incident" ? <IncidentToFix /> : <OperationsDashboard />}
    </div>
  );
}
