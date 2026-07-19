const SECRET_PATTERN = /(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*([^\s,;]+)/gi;

export function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(SECRET_PATTERN, "$1=[REDACTED]")
      .replace(/\b(?:ghp|github_pat|sk_live|sk_test)_[A-Za-z0-9_]{8,}\b/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(apiKey|api_key|authorization|credential|password|secret|token)/i.test(key))
        .map(([key, item]) => [key, redact(item)])
    );
  }
  return value;
}

export function normalizeEvidence({ ticket, logs = {}, findings = [], scenario, source = { type: "jira" } }) {
  return redact({
    source,
    ticket: {
      key: ticket.key,
      summary: ticket.summary,
      description: ticket.description,
      priority: ticket.priority,
      affectedFile: ticket.affectedFile || scenario.affectedFile,
      comments: (ticket.comments || []).map(({ author, timestamp, body }) => ({ author, timestamp, body }))
    },
    logs: {
      source: logs.source || "unknown",
      stackTrace: logs.stacktrace || "",
      raw: logs.raw || ""
    },
    findings,
    reproduction: {
      maliciousInput: scenario.maliciousInput,
      expectedInvariant: "User input is passed as a bound value and cannot alter SQL query structure"
    }
  });
}
