// Real-time source code analyzer: watches a directory with chokidar and
// runs a small set of regex-based security/quality rules against every
// file that changes, emitting findings as they're discovered.
import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";

export const RULES = [
  {
    id: "hardcoded-secret",
    severity: "critical",
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{6,}["']/gi,
    message: "Possible hardcoded credential/secret",
  },
  {
    id: "eval-usage",
    severity: "high",
    pattern: /\beval\s*\(/g,
    message: "Use of eval() — arbitrary code execution risk",
  },
  {
    id: "sql-string-concat",
    severity: "high",
    pattern: /(SELECT|INSERT|UPDATE|DELETE)[^;]*["'`]\s*\+\s*\w+/gi,
    message: "SQL query built via string concatenation — possible SQL injection",
  },
  {
    id: "insecure-random",
    severity: "medium",
    pattern: /Math\.random\(\)/g,
    message: "Math.random() is not cryptographically secure",
  },
  {
    id: "console-sensitive-log",
    severity: "low",
    pattern: /console\.log\([^)]*(password|token|secret)[^)]*\)/gi,
    message: "Logging a value that looks sensitive",
  },
];

export function analyzeSource(filePath, content) {
  const findings = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          message: rule.message,
          file: filePath,
          line: idx + 1,
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  });
  return findings;
}

export function startWatching(watchDir, onFindings) {
  if (!fs.existsSync(watchDir)) fs.mkdirSync(watchDir, { recursive: true });

  const watcher = chokidar.watch(watchDir, {
    ignoreInitial: false,
    persistent: true,
    ignored: /(^|[/\\])\../,
  });

  const scanFile = (filePath) => {
    if (!/\.(js|ts|jsx|tsx|py|java)$/.test(filePath)) return;
    fs.readFile(filePath, "utf8", (err, content) => {
      if (err) return;
      const relPath = path.relative(watchDir, filePath);
      const findings = analyzeSource(relPath, content);
      onFindings({ file: relPath, findings, scannedAt: new Date().toISOString() });
    });
  };

  watcher.on("add", scanFile).on("change", scanFile);
  return watcher;
}
