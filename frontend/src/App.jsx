import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function severityBadge(severity) {
  return <span className={`badge badge-${severity}`}>{severity}</span>;
}

function worstSeverity(findings) {
  return findings.reduce(
    (worst, f) => (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[worst] ? f.severity : worst),
    "low"
  );
}

function ShieldIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M12 3l7 3v6c0 4.6-3 8.3-7 9-4-.7-7-4.4-7-9V6l7-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TicketsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
    </svg>
  );
}
function AlertIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M12 4l9 16H3L12 4z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17.5v.01" strokeLinecap="round" />
    </svg>
  );
}
function BranchIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 8.2V15.8M6 8.5c0 3.5 2.8 4.5 6.5 4.5H15" strokeLinecap="round" />
    </svg>
  );
}
function RocketIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M13.5 3.5c3 .3 5 2.3 5.3 5.3.3 3-2 6.7-5.3 9-1-1.7-2-2.7-3.7-3.7 2.3-3.3 6-5.3 9-5.3" strokeLinejoin="round" />
      <path d="M9.8 14.2 5 15.5l1.3-4.8c1-1 2-1.6 3.3-1.6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M9 15l0 4-2.5-1.5M5 12.5 3.5 10" strokeLinecap="round" />
      <circle cx="14.5" cy="9.5" r="1.4" />
    </svg>
  );
}
function ExternalLinkIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M9 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3M14 4h6v6M20 4l-9 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" {...props}>
      <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SpinnerIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" className="spinner" {...props}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="42 100" />
    </svg>
  );
}
function SearchIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

function StatusPill({ status }) {
  const copy = { connected: "Live", connecting: "Connecting…", disconnected: "Offline" }[status];
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot" />
      {copy}
    </span>
  );
}

function StatChip({ label, value, tone, icon }) {
  return (
    <div className={`stat-chip stat-${tone}`}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function TicketList({ tickets, selectedKey, onSelect }) {
  if (tickets.length === 0) {
    return <div className="empty-state">Loading tickets from the Jira MCP server…</div>;
  }
  return (
    <ul className="ticket-list">
      {tickets.map((t) => (
        <li
          key={t.key}
          className={`ticket-row sev-${t.priority?.toLowerCase() || "medium"} ${t.key === selectedKey ? "selected" : ""}`}
          onClick={() => onSelect(t.key)}
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onSelect(t.key)}
        >
          <div className="ticket-row-top">
            <span className="ticket-key">{t.key}</span>
            {severityBadge(t.priority?.toLowerCase() || "medium")}
          </div>
          <div className="ticket-summary">{t.summary}</div>
          <div className="ticket-status">
            <span className={`status-tag status-tag-${t.status?.toLowerCase().replace(/\s+/g, "-")}`}>{t.status}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TicketDetail({ ticket, onCreatePr, creating, prResult, prError }) {
  if (!ticket) {
    return (
      <div className="empty-state empty-state-lg">
        <TicketsIcon />
        <p>Select a ticket to view its description, history, and logs.</p>
      </div>
    );
  }
  return (
    <div className="ticket-detail">
      <h3>
        {ticket.key} {severityBadge(ticket.priority?.toLowerCase() || "medium")}
        <span className={`status-tag status-tag-${ticket.status?.toLowerCase().replace(/\s+/g, "-")}`}>{ticket.status}</span>
      </h3>
      <p className="ticket-detail-summary">{ticket.summary}</p>
      <p className="ticket-detail-description">{ticket.description}</p>

      <h4>Comment / activity history</h4>
      <ul className="comment-list">
        {ticket.comments?.map((c, i) => (
          <li key={i}>
            <span className="comment-author">{c.author}</span>
            <span className="comment-time">{new Date(c.timestamp).toLocaleString()}</span>
            <div className="comment-body">{c.body}</div>
          </li>
        ))}
      </ul>

      <h4>Attached logs</h4>
      <div className="log-source">source: {ticket.logs?.source}</div>
      <pre className="log-block">{ticket.logs?.stacktrace}</pre>
      <pre className="log-block">{ticket.logs?.raw}</pre>

      <button className="pr-button" onClick={() => onCreatePr(ticket.key)} disabled={creating}>
        {creating ? <SpinnerIcon /> : <RocketIcon />}
        {creating ? "Opening PR…" : "Auto-fix & open PR"}
      </button>

      {prError && (
        <div className="pr-error">
          <AlertIcon /> {prError}
        </div>
      )}
      {prResult && <PrResultPreview result={prResult} />}
    </div>
  );
}

function PrResultPreview({ result }) {
  return (
    <div className={`pr-preview ${result.dryRun ? "pr-preview-dry" : "pr-preview-live"}`}>
      <div className="pr-preview-title">
        {result.dryRun ? (
          <>
            <AlertIcon /> Dry run — no GitHub token configured
          </>
        ) : (
          <>
            <CheckIcon /> PR opened
          </>
        )}
      </div>
      <div className="pr-preview-branch">
        <BranchIcon /> {result.branch}
      </div>
      {result.url && (
        <a href={result.url} target="_blank" rel="noreferrer" className="pr-preview-link">
          View pull request <ExternalLinkIcon />
        </a>
      )}
      <details>
        <summary>Diff ({result.file})</summary>
        <pre className="diff-block diff-before">- {result.diff.before}</pre>
        <pre className="diff-block diff-after">+ {result.diff.after}</pre>
      </details>
    </div>
  );
}

function CodeFindingsPanel({ findingsByFile }) {
  const files = useMemo(() => {
    return Object.values(findingsByFile)
      .map((entry) => ({ ...entry, worst: worstSeverity(entry.findings) }))
      .sort((a, b) => {
        const bySeverity = SEVERITY_ORDER[a.worst] - SEVERITY_ORDER[b.worst];
        return bySeverity !== 0 ? bySeverity : a.file.localeCompare(b.file);
      });
  }, [findingsByFile]);

  return (
    <div className="panel-body">
      {files.length === 0 && (
        <div className="empty-state">
          <AlertIcon /> Watching backend/watched-repo for changes…
        </div>
      )}
      {files.map((entry) => (
        <div key={entry.file} className={`file-findings sev-${entry.worst}`}>
          <div className="file-name-row">
            <span className="file-sev-dot" />
            <span className="file-name">{entry.file}</span>
            <span className="file-count">{entry.findings.length || 0}</span>
          </div>
          {entry.findings.length === 0 ? (
            <div className="no-findings">
              <CheckIcon /> no issues found
            </div>
          ) : (
            <ul className="finding-list">
              {[...entry.findings]
                .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
                .map((f, i) => (
                  <li key={i} className={`finding-row sev-${f.severity}`}>
                    <div className="finding-row-top">
                      {severityBadge(f.severity)}
                      <span className="finding-line">L{f.line}</span>
                      <span className="finding-message">{f.message}</span>
                    </div>
                    <pre className="finding-snippet">{f.snippet}</pre>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function PrActivityPanel({ activity }) {
  return (
    <div className="panel-body">
      {activity.length === 0 && (
        <div className="empty-state">
          <BranchIcon /> No PRs opened yet this session.
        </div>
      )}
      <ul className="pr-activity-list">
        {activity.map((pr, i) => (
          <li key={i} className={`pr-activity-row ${pr.dryRun ? "dry" : "live"}`}>
            <div className="pr-activity-title">{pr.title}</div>
            <div className="pr-activity-meta">
              <span className="pr-activity-key">{pr.ticketKey}</span>
              <span className="pr-activity-branch">
                <BranchIcon /> {pr.branch}
              </span>
              <span className={`pr-activity-mode ${pr.dryRun ? "mode-dry" : "mode-live"}`}>
                {pr.dryRun ? "dry run" : "live PR"}
              </span>
              {pr.url && (
                <a href={pr.url} target="_blank" rel="noreferrer" className="pr-activity-link">
                  <ExternalLinkIcon />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IncidentCard({ draft, onCreateTicket, creating, result, error }) {
  const { incident, ticket } = draft;
  const sev = (ticket.priority || "medium").toLowerCase();
  return (
    <div className={`incident-card sev-${sev}`}>
      <div className="incident-card-top">
        <span className="incident-service">{incident.service}</span>
        {severityBadge(sev)}
        <span className="incident-source">{incident.source}</span>
      </div>
      <div className="incident-error-code">{incident.errorCode}</div>
      <div className="incident-message">{incident.message}</div>
      <div className="incident-meta">
        {incident.occurrences} occurrences · first seen {new Date(incident.firstSeen).toLocaleString()}
      </div>

      <div className="incident-draft">
        <div className="incident-draft-label">
          LLM-drafted ticket {ticket.draftedBy === "gemini" ? "(Gemini)" : "(rule-based fallback)"}
        </div>
        <div className="incident-draft-summary">{ticket.summary}</div>
        <pre className="incident-draft-description">{ticket.description}</pre>
        {ticket.llmError && (
          <div className="incident-llm-error">
            <AlertIcon /> Gemini call failed, used fallback draft: {ticket.llmError}
          </div>
        )}
      </div>

      {result ? (
        <div className="incident-result">
          <CheckIcon /> Created {result.key}
          {result.url && (
            <a href={result.url} target="_blank" rel="noreferrer">
              view <ExternalLinkIcon />
            </a>
          )}
        </div>
      ) : (
        <button className="incident-button" onClick={onCreateTicket} disabled={creating}>
          {creating ? <SpinnerIcon /> : <TicketsIcon />}
          {creating ? "Creating…" : "Create Jira ticket"}
        </button>
      )}
      {error && (
        <div className="incident-error">
          <AlertIcon /> {error}
        </div>
      )}
    </div>
  );
}

function IncidentsPanel({ drafts, onScan, scanning, onCreateTicket, creatingId, results, errors }) {
  return (
    <div className="panel-body">
      <button className="scan-button" onClick={onScan} disabled={scanning}>
        {scanning ? <SpinnerIcon /> : <SearchIcon />}
        {scanning ? "Scanning…" : "Scan for incidents"}
      </button>
      {drafts.length === 0 && !scanning && (
        <div className="empty-state">
          <SearchIcon /> No incidents scanned yet — click "Scan for incidents".
        </div>
      )}
      <div className="incident-list">
        {drafts.map((draft) => (
          <IncidentCard
            key={draft.incident.id}
            draft={draft}
            onCreateTicket={() => onCreateTicket(draft.incident.id)}
            creating={creatingId === draft.incident.id}
            result={results[draft.incident.id]}
            error={errors[draft.incident.id]}
          />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [findingsByFile, setFindingsByFile] = useState({});
  const [prActivity, setPrActivity] = useState([]);
  const [creatingKey, setCreatingKey] = useState(null);
  const [prResults, setPrResults] = useState({});
  const [prErrors, setPrErrors] = useState({});
  const [connectionError, setConnectionError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [incidents, setIncidents] = useState([]);
  const [scanningIncidents, setScanningIncidents] = useState(false);
  const [creatingIncidentId, setCreatingIncidentId] = useState(null);
  const [incidentResults, setIncidentResults] = useState({});
  const [incidentErrors, setIncidentErrors] = useState({});

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/tickets`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        if (!Array.isArray(body)) throw new Error("Unexpected response shape from /api/tickets");
        setTickets(body);
      })
      .catch((err) => setConnectionError(`Could not reach backend at ${BACKEND_URL}: ${err.message}`));
  }, []);

  useEffect(() => {
    const socket = io(BACKEND_URL);
    socket.on("connect", () => {
      setConnectionStatus("connected");
      setConnectionError(null);
    });
    socket.on("disconnect", () => setConnectionStatus("disconnected"));
    socket.on("connect_error", (err) => {
      setConnectionStatus("disconnected");
      setConnectionError(`Socket connection failed: ${err.message}`);
    });
    socket.on("code:snapshot", (snapshot) => {
      const map = {};
      snapshot.forEach((entry) => (map[entry.file] = entry));
      setFindingsByFile(map);
    });
    socket.on("code:finding", (entry) => {
      setFindingsByFile((prev) => ({ ...prev, [entry.file]: entry }));
    });
    socket.on("pr:created", (result) => {
      setPrActivity((prev) => [result, ...prev]);
    });
    socket.on("incident:ticket-created", (payload) => {
      setIncidentResults((prev) => ({ ...prev, [payload.incidentId]: payload }));
    });
    return () => socket.disconnect();
  }, []);

  const selectTicket = (key) => {
    setSelectedKey(key);
    setTicketDetail(null);
    fetch(`${BACKEND_URL}/api/tickets/${key}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        setTicketDetail(body);
      })
      .catch((err) => setConnectionError(err.message));
  };

  const createPr = (key) => {
    setCreatingKey(key);
    setPrErrors((prev) => ({ ...prev, [key]: null }));
    fetch(`${BACKEND_URL}/api/tickets/${key}/create-pr`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Failed to create PR");
        setPrResults((prev) => ({ ...prev, [key]: body }));
      })
      .catch((err) => setPrErrors((prev) => ({ ...prev, [key]: err.message })))
      .finally(() => setCreatingKey(null));
  };

  const scanIncidents = () => {
    setScanningIncidents(true);
    fetch(`${BACKEND_URL}/api/incidents/scan`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        if (!Array.isArray(body)) throw new Error("Unexpected response shape from /api/incidents/scan");
        setIncidents(body);
      })
      .catch((err) => setConnectionError(err.message))
      .finally(() => setScanningIncidents(false));
  };

  const createIncidentTicket = (incidentId) => {
    setCreatingIncidentId(incidentId);
    setIncidentErrors((prev) => ({ ...prev, [incidentId]: null }));
    fetch(`${BACKEND_URL}/api/incidents/${incidentId}/create-ticket`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Failed to create ticket");
        setIncidentResults((prev) => ({ ...prev, [incidentId]: body }));
      })
      .catch((err) => setIncidentErrors((prev) => ({ ...prev, [incidentId]: err.message })))
      .finally(() => setCreatingIncidentId(null));
  };

  const findingsSummary = useMemo(() => {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    Object.values(findingsByFile).forEach((entry) => {
      entry.findings.forEach((f) => {
        summary[f.severity] = (summary[f.severity] || 0) + 1;
        summary.total += 1;
      });
    });
    return summary;
  }, [findingsByFile]);

  const openTicketsCount = tickets.filter((t) => t.status !== "Done").length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-title-group">
            <ShieldIcon className="app-icon" />
            <div>
              <h1>DevSecOps Copilot</h1>
              <p className="app-subtitle">Jira MCP · real-time code analyzer · automated PR bot</p>
            </div>
          </div>
          <StatusPill status={connectionStatus} />
        </div>

        <div className="stats-bar">
          <StatChip label="open tickets" value={openTicketsCount} tone="neutral" icon={<TicketsIcon />} />
          <StatChip
            label="critical findings"
            value={findingsSummary.critical}
            tone={findingsSummary.critical > 0 ? "critical" : "clear"}
            icon={<AlertIcon />}
          />
          <StatChip
            label="total findings"
            value={findingsSummary.total}
            tone={findingsSummary.total > 0 ? "warn" : "clear"}
            icon={<AlertIcon />}
          />
          <StatChip label="PRs opened" value={prActivity.length} tone="accent" icon={<BranchIcon />} />
        </div>
      </header>

      {connectionError && (
        <div className="connection-error">
          <AlertIcon /> {connectionError}
        </div>
      )}

      <main className="dashboard">
        <section className="panel panel-tickets">
          <h2>
            <TicketsIcon /> Jira Tickets <span className="panel-hint">via MCP</span>
          </h2>
          <TicketList tickets={tickets} selectedKey={selectedKey} onSelect={selectTicket} />
        </section>

        <section className="panel panel-detail">
          <h2>Ticket Detail</h2>
          <TicketDetail
            ticket={ticketDetail}
            onCreatePr={createPr}
            creating={creatingKey === selectedKey}
            prResult={selectedKey ? prResults[selectedKey] : null}
            prError={selectedKey ? prErrors[selectedKey] : null}
          />
        </section>

        <section className="panel panel-code">
          <h2>
            <AlertIcon /> Live Code Findings
            {findingsSummary.total > 0 && <span className="panel-count">{findingsSummary.total}</span>}
          </h2>
          <CodeFindingsPanel findingsByFile={findingsByFile} />
        </section>

        <section className="panel panel-pr">
          <h2>
            <BranchIcon /> PR Activity
            {prActivity.length > 0 && <span className="panel-count">{prActivity.length}</span>}
          </h2>
          <PrActivityPanel activity={prActivity} />
        </section>
      </main>

      <section className="panel panel-incidents">
        <h2>
          <SearchIcon /> Log Incidents <span className="panel-hint">Splunk/Elasticsearch → LLM → Jira</span>
          {incidents.length > 0 && <span className="panel-count">{incidents.length}</span>}
        </h2>
        <IncidentsPanel
          drafts={incidents}
          onScan={scanIncidents}
          scanning={scanningIncidents}
          onCreateTicket={createIncidentTicket}
          creatingId={creatingIncidentId}
          results={incidentResults}
          errors={incidentErrors}
        />
      </section>
    </div>
  );
}
