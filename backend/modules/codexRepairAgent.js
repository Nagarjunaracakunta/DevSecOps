import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const REGRESSION_FILE = "test/sec-103-regression.test.js";

function executeCodex(workspace, prompt, sandbox = "read-only") {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(workspace, `.codex-result-${Date.now()}.txt`);
    const args = ["exec", "--ephemeral", "--ignore-user-config", "--sandbox", sandbox, "--ask-for-approval", "never", "--cd", workspace, "--output-last-message", outputFile, prompt];
    const child = spawn(process.env.CODEX_CLI_PATH || "codex", args, {
      cwd: workspace,
      shell: false,
      env: { ...process.env, CODEX_NETWORK_DISABLED: "1" }
    });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", async (code) => {
      const message = await fs.readFile(outputFile, "utf8").catch(() => "");
      await fs.rm(outputFile, { force: true }).catch(() => {});
      if (code !== 0) reject(new Error(`Codex CLI failed (${code}): ${stderr.slice(-1000)}`));
      else resolve(message.trim());
    });
  });
}

export function codexMode() {
  return process.env.CODEX_MODE === "cli" ? "live-codex" : "saved-demo";
}

export async function investigate({ workspace, evidence }) {
  if (codexMode() === "live-codex") {
    const result = await executeCodex(workspace, `Investigation stage only. Do not modify files. Read AGENTS.md and inspect the repository. Incident evidence:\n${JSON.stringify(evidence, null, 2)}\nReturn a concise root-cause explanation, affected files/functions, evidence connection, and proposed regression test. Do not include hidden reasoning.`, "read-only");
    return { summary: result, affectedFiles: ["src/userSearch.js"], provider: "OpenAI Codex" };
  }
  return {
    summary: "searchUsersByName concatenates the untrusted name value into SQL text, so the incident payload closes the string literal and adds an always-true predicate.",
    affectedFiles: ["src/userSearch.js"],
    function: "searchUsersByName",
    proposedTest: "Assert SQL structure remains constant and the malicious name is supplied only in the bound parameters array.",
    provider: "Saved demonstration result"
  };
}

export async function generateRegressionTest({ workspace, evidence }) {
  if (codexMode() === "live-codex") {
    await executeCodex(workspace, `Regression-test stage. Read AGENTS.md. Create exactly one focused test at ${REGRESSION_FILE} for SEC-103 using ${JSON.stringify(evidence.reproduction.maliciousInput)}. It must prove input cannot change SQL structure and must fail against current vulnerable code. Do not modify application code. Run only that test.`, "workspace-write");
  } else {
    await fs.writeFile(path.join(workspace, REGRESSION_FILE), `"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { searchUsersByName } = require("../src/userSearch");

test("SEC-103: malicious name remains a bound value", async () => {
  const calls = [];
  const db = { query(sql, params) { calls.push({ sql, params }); return Promise.resolve([]); } };
  const maliciousName = "' OR '1'='1";
  await searchUsersByName(db, maliciousName);
  assert.equal(calls[0].sql, "SELECT * FROM users WHERE name = ?");
  assert.deepEqual(calls[0].params, [maliciousName]);
});
`, "utf8");
  }
  return { file: REGRESSION_FILE, provider: codexMode() === "live-codex" ? "OpenAI Codex" : "Saved demonstration result" };
}

export async function generatePatch({ workspace, evidence }) {
  if (codexMode() === "live-codex") {
    await executeCodex(workspace, `Patch stage. The SEC-103 regression test failed against the original implementation as required. Read AGENTS.md and evidence:\n${JSON.stringify(evidence, null, 2)}\nImplement the smallest safe parameterized-query fix in application code, preserve interfaces and the regression test, avoid unrelated changes, and run the focused and full tests.`, "workspace-write");
  } else {
    await fs.writeFile(path.join(workspace, "src/userSearch.js"), `"use strict";

function searchUsersByName(db, name) {
  const query = "SELECT * FROM users WHERE name = ?";
  return db.query(query, [name]);
}

module.exports = { searchUsersByName };
`, "utf8");
  }
  return { provider: codexMode() === "live-codex" ? "OpenAI Codex" : "Saved demonstration result" };
}

export async function review({ workspace, evidence, diff, results }) {
  if (codexMode() === "live-codex") {
    const summary = await executeCodex(workspace, `Restricted review stage. Do not modify files. Review only this incident evidence, diff, and verification results:\n${JSON.stringify({ evidence, diff, results }, null, 2)}\nAnswer whether root cause is addressed, test is meaningful, change is minimal, obvious regressions exist, and remaining risks. State CRITICAL if publication must be blocked.`, "read-only");
    return { passed: !/\bCRITICAL\b/i.test(summary), summary, provider: "OpenAI Codex" };
  }
  return {
    passed: true,
    summary: "The parameterized query directly addresses the reproduced injection path. The focused test checks both stable SQL structure and exact bound value. The two-file change is minimal. Remaining risk: behavior depends on the production database driver supporting ? placeholders.",
    provider: "Saved demonstration result"
  };
}
